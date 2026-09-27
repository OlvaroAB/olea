/**
 * `buildMergeAuditIdentityProposals` / `buildMergeRepairIdentityProposals` /
 * `confirmMergeAuditIdentityProposal` / `declineMergeAuditIdentityProposal` — `[D-402]` binding
 * condition 3's old cross-course merge audit, landed on F8.4a's existing concept-identity
 * section (`ol-egov.141.89.3.19`, discovered from `ol-egov.141.89.3.18`).
 *
 * **No new control.** F8.6's own words: "F8.4a's identity section surfaces propose, accept and
 * decline for the concept-identity proposals this section describes, and nothing more." This
 * file only ever reaches `olea-core`'s persisted `MergeAuditProposalRecord`/
 * `MergeRepairProposalRecord` through that section's existing three actions — there is no fourth
 * verb, no score, and no execution of a repair (confirming one only records intent;
 * `olea-core`'s `merge-audit-store.ts` module doc is explicit that nothing here moves a path or
 * mints a key).
 *
 * **Reuses F8.4a's exact display shape.** `./same-as-identity.ts`'s `SameAsIdentityProposal`
 * shows "exactly three things" per side: a name, a course, a passage excerpt. A merge-audit
 * finding is naturally the SAME question, asked more literally — one wording, attributed to two
 * courses; is it one concept (`nameA === nameB`, the wording itself) taught in both, or two that
 * merely share a wording? `MergeAuditIdentityProposal` below carries that exact shape, so the
 * registry view's existing `renderIdentityProposal` pattern (name/course/passage per side, then
 * accept/decline) is reused for both the audit judgement AND the repair proposal it may produce
 * on decline — see `kind` below for how confirm/decline routes to the right persisted store.
 *
 * **Passages come from the finding's own recorded paths, not a second registry walk.** Unlike
 * `./same-as-identity.ts` (which resolves against `RegistryConceptEntry.sourceLocations`, built
 * for a LIVE concept), a merge-audit proposal is about historical evidence
 * (`MergeAuditProposalRecord.anchorPaths`/`.misattributedCourses[].paths`) that may belong to a
 * concept the current registry walk no longer surfaces the same way. This module reads those
 * recorded paths directly. `excerptFromPath`'s "first non-empty paragraph, bounded" rule
 * deliberately duplicates `./same-as-identity.ts`'s `firstNonEmptyParagraph`/budget logic rather
 * than importing it — the two files answer to different beads' ownership and a merge-audit
 * passage has no block/heading grain to resolve (only a bare note path), so the shared logic is
 * a few lines, not the whole excerpt machinery.
 *
 * **"A proposal that cannot show its passages is not shown" (F8.4a) applies here too.** A record
 * whose anchor or misattributed-course path list is empty, or whose note cannot be read or
 * yields no excerpt, contributes no row.
 *
 * **One row per misattributed course, one persisted decision per key.** `[D-402]` acceptance:
 * "each affected identity produces exactly one proposal she can answer" — the underlying
 * `MergeAuditProposalRecord` is one record per `key`, regardless of how many courses its evidence
 * spans. When a finding carries more than one misattributed course (`proposeMergeRepair`'s own
 * "more than one course besides the anchor" escalation case), this module shows one row per
 * course so every course's evidence is visible, but confirming or declining ANY of those rows
 * answers the SAME underlying proposal for that key — the next `load()` clears every row for it
 * at once, never a scenario where one course's row is answered and a sibling row for the same
 * key is still pending.
 */

import type { RegistrySourceLocation, VaultPath, VaultSource } from 'olea-core';
// Imported by source path, not `olea-core`'s barrel (`src/index.ts`) — see `../concept/
// wiring.ts`'s own comment on the same choice: several other lanes are concurrently landing
// exports into that shared file today.
import {
  confirmMergeAuditProposalRecord,
  confirmMergeRepairProposalRecord,
  declineMergeAuditProposalRecord,
  declineMergeRepairProposalRecord,
  type MergeAuditProposalRecord,
  type MergeRepairProposalRecord,
  proposeAndPersistMergeRepair,
} from 'olea-core/src/concept/merge-audit-store.js';

/** DECLARED, not derived — same posture `./same-as-identity.ts`'s
 * `IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET` documents: chosen only to keep one row legible, never a
 * threshold any accept/decline decision reads. */
export const MERGE_AUDIT_EXCERPT_CHAR_BUDGET = 240;

export interface MergeAuditIdentityPassage {
  readonly location: RegistrySourceLocation;
  readonly excerpt: string;
}

/**
 * One row, fully resolved and ready to render — F8.4a's exact three fields per side, no score.
 * `kind` says which persisted store `confirmMergeAuditIdentityProposal`/
 * `declineMergeAuditIdentityProposal` reach: `'audit'` is "is this wording's cross-course
 * evidence a genuine recurrence, or a mistake?" (`MergeAuditProposalRecord`); `'repair'` is the
 * proposed rebind a declined audit judgement produced (`MergeRepairProposalRecord`) — data only,
 * never executed.
 */
export interface MergeAuditIdentityProposal {
  readonly kind: 'audit' | 'repair';
  readonly key: string;
  readonly nameA: string;
  readonly nameB: string;
  readonly coursesA: readonly string[];
  readonly coursesB: readonly string[];
  readonly passageA: MergeAuditIdentityPassage;
  readonly passageB: MergeAuditIdentityPassage;
}

function firstNonEmptyParagraph(content: string): string {
  for (const paragraph of content.split(/\n\s*\n/)) {
    const collapsed = paragraph.replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) return collapsed;
  }
  return '';
}

/** `undefined` means "cannot show this side's passage" (F8.4a) — no path recorded, the note is
 * unreadable (deleted, moved), or its first paragraph is empty. */
async function passageForPath(
  vault: VaultSource,
  path: VaultPath | undefined,
): Promise<MergeAuditIdentityPassage | undefined> {
  if (path === undefined) return undefined;
  let content: string;
  try {
    content = await vault.read(path);
  } catch {
    return undefined;
  }
  const paragraph = firstNonEmptyParagraph(content);
  if (paragraph.length === 0) return undefined;
  const excerpt =
    paragraph.length > MERGE_AUDIT_EXCERPT_CHAR_BUDGET
      ? `${paragraph.slice(0, MERGE_AUDIT_EXCERPT_CHAR_BUDGET).trimEnd()}…`
      : paragraph;
  return { location: { sourcePath: path }, excerpt };
}

/**
 * Every currently-`'proposed'` `MergeAuditProposalRecord` that can show its passages, one row per
 * misattributed course — see this module's own doc for why several rows may share one `key`.
 */
export async function buildMergeAuditIdentityProposals(
  vault: VaultSource,
  records: readonly MergeAuditProposalRecord[],
): Promise<readonly MergeAuditIdentityProposal[]> {
  const proposals: MergeAuditIdentityProposal[] = [];
  for (const record of records) {
    if (record.status !== 'proposed') continue;
    const passageA = await passageForPath(vault, record.anchorPaths[0]);
    if (passageA === undefined) continue;
    for (const evidence of record.misattributedCourses) {
      const passageB = await passageForPath(vault, evidence.paths[0]);
      if (passageB === undefined) continue;
      proposals.push({
        kind: 'audit',
        key: record.key,
        nameA: record.wording,
        nameB: record.wording,
        coursesA: [record.anchorCourse],
        coursesB: [evidence.course],
        passageA,
        passageB,
      });
    }
  }
  return proposals;
}

/** Every currently-`'proposed'` `MergeRepairProposalRecord` that can show its passages — one row
 * per key (a repair proposal names exactly one course to rebind). */
export async function buildMergeRepairIdentityProposals(
  vault: VaultSource,
  records: readonly MergeRepairProposalRecord[],
): Promise<readonly MergeAuditIdentityProposal[]> {
  const proposals: MergeAuditIdentityProposal[] = [];
  for (const record of records) {
    if (record.status !== 'proposed') continue;
    const passageA = await passageForPath(vault, record.anchorPaths[0]);
    if (passageA === undefined) continue;
    const passageB = await passageForPath(vault, record.paths[0]);
    if (passageB === undefined) continue;
    proposals.push({
      kind: 'repair',
      key: record.key,
      nameA: record.wording,
      nameB: record.wording,
      coursesA: [record.anchorCourse],
      coursesB: [record.course],
      passageA,
      passageB,
    });
  }
  return proposals;
}

/** F8.4a's accept, reused: for `'audit'`, "yes, a genuine recurrence" — confirms the merge
 * stands. For `'repair'`, records intent to rebind; nothing is moved or minted either way. */
export async function confirmMergeAuditIdentityProposal(
  vault: VaultSource,
  proposal: MergeAuditIdentityProposal,
): Promise<void> {
  if (proposal.kind === 'audit') {
    await confirmMergeAuditProposalRecord(vault, proposal.key);
    return;
  }
  await confirmMergeRepairProposalRecord(vault, proposal.key);
}

/**
 * F8.4a's decline, reused: for `'audit'`, "a known mistake" — a hard labelled negative, never a
 * claim the anchor course's own attribution is wrong. Declining the audit judgement then attempts
 * the repair proposal (`olea-core`'s `proposeAndPersistMergeRepair`) — idempotent, and a no-op
 * (writes nothing) on the `'needs-decision'` escalation, which this module never surfaces as a
 * row (module doc: no third state, no best-effort split). For `'repair'`, declining is a hard
 * labelled negative on the REPAIR only, never a reopening of the audit judgement it came from.
 */
export async function declineMergeAuditIdentityProposal(
  vault: VaultSource,
  proposal: MergeAuditIdentityProposal,
): Promise<void> {
  if (proposal.kind === 'audit') {
    await declineMergeAuditProposalRecord(vault, proposal.key);
    await proposeAndPersistMergeRepair(vault, proposal.key);
    return;
  }
  await declineMergeRepairProposalRecord(vault, proposal.key);
}
