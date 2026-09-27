/**
 * Audit of identities formed by the old cross-course name merge — `[D-402]` binding condition 3,
 * `ol-egov.141.89.3.18`.
 *
 * **The defect this audits.** Before the extraction fix (`ol-egov.141.89.3.15`), `./extract.ts`
 * accumulated a topic-only concept's evidence by wording alone, across the whole vault, so one
 * wording used in two courses became one `./key-store.ts` `ConceptKeyRecord` — a single
 * `TopicAnchor`, anchored to whichever course introduced it first, but carrying introducing
 * material from both. Some of those are genuine recurrences (`ONT-R8`: one concept, taught in two
 * courses) and some are homonyms (two different ideas that merely share a wording) — `[D-402]`'s
 * own words: "code cannot tell which". This module never tries to. It finds the shape the old bug
 * leaves behind, and turns each occurrence into exactly one proposal she answers — never a verdict
 * this module reaches on its own.
 *
 * **Pure, over records already on disk — never a vault.** Every function here takes
 * `ConceptKeyRecord`/`SameAsLinkRecord` values a caller already has (a `listConceptKeyRecords` /
 * `listSameAsLinkRecords` pass) and returns new plain objects. Nothing here reads or writes a
 * `VaultSource`, mints a key, or touches an existing record's `key`, `anchor` or history — the
 * conservation property (`[D-088]`) is automatic here, not merely observed, because nothing in
 * this file is capable of writing anything. Persisting a finding, a proposal or its answer as a
 * durable record (the way `./same-as.ts` persists a `SameAsLinkRecord`) is a follow-up for the
 * caller that wires this in — this module owns detection and the propose/confirm/decline state
 * transitions only.
 *
 * **Course evidence is derived from paths, not frontmatter.** A `TopicAnchor.introducingPaths`
 * entry's course is read with `./course.ts`'s `courseFromPath` — the folder-location signal,
 * never her `course:` frontmatter override, because this module has no vault to read that
 * property from. This can under-count relative to what a vault-aware caller would see (a note
 * naming a course explicitly, filed elsewhere) — an honest gap given the "pure function over
 * existing identity records" scope, not a claim of exhaustiveness. A path with no derivable
 * course (outside the courses folder, or loose in it) contributes no course evidence either way.
 *
 * **Two proposal surfaces, never a third state and never an executor.** `[D-402]` binding
 * condition 3 asks for two things once an occurrence is found: report it, and propose a repair
 * for a known mistake. Both land in the one vocabulary F8.6 permits F8.4a's identity section —
 * "propose, accept [confirmed] and decline, and nothing more; browsing the concept graph, and
 * splitting and merging themselves, stay deferred" (functional scope F8.6, `[D-257]`):
 *
 *   1. `MergeAuditProposal` — one per finding, asking "is this wording's cross-course evidence a
 *      genuine recurrence, or a mistake?" `proposeMergeAudits` writes only `'proposed'` records;
 *      `confirmMergeAuditProposal`/`declineMergeAuditProposal` are the only transitions, and
 *      either direction is reachable from the other (this is a binary read of one identity, not
 *      the same-as mechanism's severable merge, so there is no `'severed'` fourth state here —
 *      nothing was ever read as merged for this proposal to undo).
 *   2. `MergeRepairProposal` — produced only from a **declined** `MergeAuditProposal` (a known
 *      mistake), naming the one misattributed course and the introducing paths that should be
 *      re-bound to that course's own identity. **This function never re-binds anything** — F8.6
 *      defers splitting itself wholesale in v0.9, so `proposeMergeRepair` only ever produces
 *      data describing the repair, or refuses to guess (see below). Actually moving evidence onto
 *      a new identity is a later bead's job, once splitting itself is built.
 *
 * **When a repair would need more than propose/confirm/decline, this module stops and says so —
 * it never guesses.** `proposeMergeRepair` returns a `'needs-decision'` outcome, not a repair
 * proposal, when: more than one course besides the anchor shares the wording's evidence (a
 * two-way propose/decline has nothing to say about a three-way entanglement); or the key already
 * carries a confirmed same-as link to another identity (repairing a merge that is also being read
 * together with a second identity is exactly the compound case F8.6's deferred splitting-and-
 * merging interaction covers, not a plain rebind). Both cases are a decision-bead escalation for
 * the caller to raise, never a best-effort split this module attempts on its own.
 */

import type { VaultPath } from '../vault/types.js';
import { courseFromPath, DEFAULT_COURSES_FOLDER } from './course.js';
import type { ConceptKeyRecord } from './key-store.js';
import type { SameAsLinkRecord } from './same-as.js';

/** One course's introducing evidence found on a single stored identity, besides its own anchor course. */
export interface MergeAuditCourseEvidence {
  readonly course: string;
  /** Sorted, de-duplicated. */
  readonly paths: readonly VaultPath[];
}

/**
 * One stored identity whose wording carries more than one course's evidence — the shape the old
 * cross-course merge leaves behind. `misattributedCourses` is never empty on a finding this module
 * returns.
 */
export interface MergeAuditFinding {
  readonly key: string;
  /** The anchor's wording — copied verbatim (R1/R2), never normalised or title-cased. */
  readonly wording: string;
  /** The identity's own anchored course. */
  readonly anchorCourse: string;
  /** Every OTHER course this identity's introducing paths carry evidence for. Sorted by course. */
  readonly misattributedCourses: readonly MergeAuditCourseEvidence[];
  /** Other keys with a `'confirmed'` same-as link to this one. Sorted, de-duplicated, empty when none. */
  readonly confirmedSameAsPartners: readonly string[];
}

export interface FindMergeAuditFindingsOptions {
  /** Passed through to `courseFromPath`. Defaults to `DEFAULT_COURSES_FOLDER` ("01 Courses"). */
  readonly coursesFolder?: VaultPath;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every key with a `'confirmed'` same-as link to `key`, sorted and de-duplicated. */
function confirmedSameAsPartnersOf(
  key: string,
  links: readonly SameAsLinkRecord[],
): readonly string[] {
  const partners: string[] = [];
  for (const link of links) {
    if (link.status !== 'confirmed') continue;
    if (link.keyA === key) partners.push(link.keyB);
    else if (link.keyB === key) partners.push(link.keyA);
  }
  return sortedUnique(partners);
}

/**
 * Scans `records` for the old cross-course merge's shape: a `TopicAnchor` record whose
 * `introducingPaths` carry evidence for a course other than the one it is anchored to. Pure and
 * read-only — see the module doc. `sameAsLinks` is optional context folded onto each finding
 * (`confirmedSameAsPartners`); omitting it simply means every finding reports none.
 *
 * Records with a `NoteAnchor`, or a `TopicAnchor` with no `introducingPaths` at all (every record
 * minted before `[D-180]`, or one whose introducing material never resolved to a course), never
 * produce a finding — there is no cross-course evidence on file to report.
 */
export function findMergeAuditFindings(
  records: readonly ConceptKeyRecord[],
  sameAsLinks: readonly SameAsLinkRecord[] = [],
  options: FindMergeAuditFindingsOptions = {},
): readonly MergeAuditFinding[] {
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const findings: MergeAuditFinding[] = [];

  for (const record of records) {
    if (record.anchor.kind !== 'topic') continue;
    const anchor = record.anchor;
    const introducingPaths = anchor.introducingPaths ?? [];
    if (introducingPaths.length === 0) continue;

    const byCourse = new Map<string, Set<VaultPath>>();
    for (const path of introducingPaths) {
      const course = courseFromPath(path, coursesFolder);
      if (course === undefined || course === anchor.course) continue;
      const bucket = byCourse.get(course);
      if (bucket === undefined) byCourse.set(course, new Set([path]));
      else bucket.add(path);
    }
    if (byCourse.size === 0) continue;

    const misattributedCourses: MergeAuditCourseEvidence[] = [...byCourse.entries()]
      .map(([course, paths]) => ({ course, paths: [...paths].sort() }))
      .sort((a, b) => (a.course < b.course ? -1 : a.course > b.course ? 1 : 0));

    findings.push({
      key: record.key,
      wording: anchor.name,
      anchorCourse: anchor.course,
      misattributedCourses,
      confirmedSameAsPartners: confirmedSameAsPartnersOf(record.key, sameAsLinks),
    });
  }

  return findings;
}

/** F8.4a's own three-state vocabulary for this proposal (`'severed'` is the same-as mechanism's own fourth state, not this one's — see the module doc). */
export type MergeAuditProposalStatus = 'proposed' | 'confirmed' | 'declined';

/**
 * "Is this wording's cross-course evidence a genuine recurrence, or a mistake?" — the one
 * question `[D-402]` says code cannot answer on its own. Confirming it means "yes, a genuine
 * recurrence — the merge stands." Declining it means "a known mistake" and is the only route to
 * `proposeMergeRepair`.
 */
export interface MergeAuditProposal {
  readonly key: string;
  readonly wording: string;
  readonly anchorCourse: string;
  /** The finding's `misattributedCourses`, course codes only — this proposal names the courses in question; the evidence paths live on the finding. Sorted. */
  readonly misattributedCourseCodes: readonly string[];
  readonly status: MergeAuditProposalStatus;
}

/**
 * One `'proposed'` `MergeAuditProposal` per finding — "each affected identity produces exactly one
 * proposal she can answer" (`[D-402]` acceptance). Never writes a `'confirmed'` or `'declined'`
 * proposal itself, matching `./same-as.ts`'s `proposeSameAsLink` discipline of never producing
 * anything but a fresh proposal on its own initiative.
 */
export function proposeMergeAudits(
  findings: readonly MergeAuditFinding[],
): readonly MergeAuditProposal[] {
  return findings.map((finding) => ({
    key: finding.key,
    wording: finding.wording,
    anchorCourse: finding.anchorCourse,
    misattributedCourseCodes: finding.misattributedCourses.map((evidence) => evidence.course),
    status: 'proposed',
  }));
}

/**
 * The evidential read landing as "yes, a genuine recurrence" — idempotent (confirming an
 * already-`'confirmed'` proposal returns it unchanged), and reachable from `'declined'` too: a
 * decline never asserts the two attributions are wrong forever and never blocks a later confirm
 * (`[D-257]` ruling 3's rule, applied here to this proposal's own binary judgement).
 */
export function confirmMergeAuditProposal(proposal: MergeAuditProposal): MergeAuditProposal {
  if (proposal.status === 'confirmed') return proposal;
  return { ...proposal, status: 'confirmed' };
}

/**
 * The evidential read landing as "a known mistake" — a hard labelled negative on THIS proposal,
 * never a claim that the anchor course's own attribution is wrong (`[D-257]` ruling 3's rule,
 * applied here). Idempotent, and reachable from `'confirmed'` too, symmetrically with confirm
 * above — this proposal has no `'severed'` state to protect the way a same-as link does, because
 * nothing is read as merged on disk for a decline to undo; declining only ever changes what she
 * is asked next (whether `proposeMergeRepair` may run).
 */
export function declineMergeAuditProposal(proposal: MergeAuditProposal): MergeAuditProposal {
  if (proposal.status === 'declined') return proposal;
  return { ...proposal, status: 'declined' };
}

export type MergeRepairProposalStatus = 'proposed' | 'confirmed' | 'declined';

/**
 * A repair: the misattributed course's introducing material should be re-bound to that course's
 * own identity, once splitting itself is built. **Data only** — nothing in this module, or
 * reachable from it, moves a path, mints a key, or rewrites the audited record. Confirming this
 * proposal records intent; execution is a later bead's job ([D-072] — see this module's own
 * production-caller note in the bead that builds it).
 */
export interface MergeRepairProposal {
  readonly key: string;
  readonly course: string;
  /** Sorted. The paths `proposeMergeRepair` found under `course` on the finding it was given. */
  readonly paths: readonly VaultPath[];
  readonly status: MergeRepairProposalStatus;
}

/** Why `proposeMergeRepair` stopped instead of producing a `MergeRepairProposal` — always an escalation for the caller to raise as a decision bead, never a guess this module makes on its own. */
export interface MergeAuditRepairEscalation {
  readonly key: string;
  readonly reason: string;
}

export type MergeAuditRepairOutcome =
  | { readonly kind: 'repair-proposal'; readonly proposal: MergeRepairProposal }
  | { readonly kind: 'needs-decision'; readonly escalation: MergeAuditRepairEscalation };

/**
 * The repair `[D-402]` binding condition 3 asks for on a known mistake — "propose re-binding that
 * course's instruments to the course's own identity" — produced ONLY from a declined
 * `MergeAuditProposal` for the SAME finding (a caller error to call this on a still-`'proposed'`
 * or `'confirmed'` one: nothing was judged a mistake yet).
 *
 * Refuses to guess — returns `'needs-decision'` instead of a proposal — in exactly the two cases
 * the module doc names: more than one course besides the anchor shares this wording's evidence
 * (a plain two-way rebind has nothing to say about a three-or-more-way entanglement), or the key
 * already carries a confirmed same-as link to another identity (repairing a merge that is also
 * read together with a second identity is the compound case F8.6's deferred splitting-and-merging
 * interaction covers). Both are escalations for the caller to raise as a decision bead — this
 * function never attempts either split on its own (F8.6: splitting stays deferred in v0.9).
 */
export function proposeMergeRepair(
  finding: MergeAuditFinding,
  proposal: MergeAuditProposal,
): MergeAuditRepairOutcome {
  if (proposal.key !== finding.key) {
    throw new Error(
      'proposeMergeRepair: proposal and finding name different keys — pass the proposal that ' +
        'was built from this finding.',
    );
  }
  if (proposal.status !== 'declined') {
    throw new Error(
      'proposeMergeRepair: a repair is proposed only after her audit proposal is declined — a ' +
        "still-'proposed' or confirmed merge is not a known mistake yet.",
    );
  }

  if (finding.confirmedSameAsPartners.length > 0) {
    return {
      kind: 'needs-decision',
      escalation: {
        key: finding.key,
        reason:
          `this identity already carries a confirmed same-as link to ` +
          `${finding.confirmedSameAsPartners.length} other identity/ies; repairing a cross-course ` +
          'merge that is also being read together with another identity is beyond propose/' +
          'confirm/decline (F8.6 defers splitting in v0.9) — raise a decision bead.',
      },
    };
  }

  if (finding.misattributedCourses.length !== 1) {
    return {
      kind: 'needs-decision',
      escalation: {
        key: finding.key,
        reason:
          `${finding.misattributedCourses.length} courses besides the anchor course carry this ` +
          "wording's evidence; a plain two-way rebind has nothing to say about a three-or-more-way " +
          'entanglement (F8.6 defers splitting in v0.9) — raise a decision bead.',
      },
    };
  }

  const [evidence] = finding.misattributedCourses;
  if (evidence === undefined) {
    throw new Error('proposeMergeRepair: unreachable — length check above guarantees one entry.');
  }
  return {
    kind: 'repair-proposal',
    proposal: {
      key: finding.key,
      course: evidence.course,
      paths: evidence.paths,
      status: 'proposed',
    },
  };
}

/** Idempotent; reachable from `'declined'` too — same rule as `confirmMergeAuditProposal`. */
export function confirmMergeRepairProposal(proposal: MergeRepairProposal): MergeRepairProposal {
  if (proposal.status === 'confirmed') return proposal;
  return { ...proposal, status: 'confirmed' };
}

/** Idempotent; reachable from `'confirmed'` too — same rule as `declineMergeAuditProposal`. */
export function declineMergeRepairProposal(proposal: MergeRepairProposal): MergeRepairProposal {
  if (proposal.status === 'declined') return proposal;
  return { ...proposal, status: 'declined' };
}
