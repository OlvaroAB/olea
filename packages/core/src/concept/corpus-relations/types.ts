/**
 * Shared shapes for the corpus-level relation stage (`[EXT-5]`, `ol-2zfj.7`)
 * — the build side of `[D-082]`.
 *
 * `[D-082]` permits a second, corpus-level stage **if and only if** every
 * edge it emits was produced with the introducing passages of BOTH
 * endpoints in context, and records which passages those were. This
 * directory (`./nominate.js`, `./verdict.js`, `./trigger.js`, `./batch.js`)
 * is that stage. It is structurally separate from `../read.js` (the
 * per-document stage) and `../reconcile.js` (that stage's own
 * reconciliation) — this module **imports** from `../relation.js` but never
 * edits it, and never redefines the six-type vocabulary, the directedness
 * table or `ConceptRelation` itself. Those stay this stage's single source
 * of truth.
 *
 * **Scope, exactly as ruled — three things, no more:**
 * 1. Candidate nomination (`./nominate.js`) — cheap signals nominate, the
 *    material decides.
 * 2. The combined-passage verdict (`./verdict.js`) — every emitted edge
 *    was produced with both endpoints' introducing passages in context.
 * 3. Trigger and scope (`./trigger.js`) — batch boundaries only, scoped to
 *    new-concept × all-concepts, never full recomputation.
 *
 * **What this directory deliberately does NOT build.** `[D-093]`
 * (`ol-egov.17`) later amended row 1.2a with two further batch-pass duties —
 * judging every changed cited passage, and re-verdicting edges degraded to
 * candidate on endpoint-passage change — plus the use-time existence check.
 * Those are edge **lifecycle** concerns (an edge that already exists going
 * stale and being re-checked), not candidate generation or first emission,
 * and they need the same live-corpus machinery `[CORP-3]` (`ol-2zfj.2`,
 * component 1.4) already owns for instrument staleness. Building them here
 * would be scope invented past this bead's own three ruled things. See the
 * follow-on bead this build files (`discovered-from` this one) for where
 * that lands.
 */

import type { Provenance } from '../../extract/types.js';
import {
  type ConceptRelation,
  RELATION_EMISSION_STATUS,
  RELATION_TYPES,
  type RelationType,
} from '../relation.js';

/**
 * The two types this stage — and only this stage — may emit, derived from
 * `../relation.js`'s own emission table rather than restated as a second
 * literal list. If that table's `'emitted-via-corpus-stage'` entries ever
 * change, this set moves with it instead of silently drifting out of sync.
 *
 * (Renamed from checking `'blocked-on-corpus-stage'` — `ol-2zfj.16`,
 * 2026-08-26: that literal implied the corpus stage was still unbuilt, which
 * stopped being true when `[EXT-11]`/`ol-kw4a` wired a real production
 * caller on 2026-08-25. The derivation itself, and this set's membership,
 * are unchanged — only the status literal it keys off was renamed to say
 * what is actually true today.)
 */
export const CORPUS_STAGE_EMITTABLE_TYPES: ReadonlySet<RelationType> = new Set(
  RELATION_TYPES.filter((type) => RELATION_EMISSION_STATUS[type] === 'emitted-via-corpus-stage'),
);

/**
 * What this stage needs to know about one concept in the course's finished
 * set — deliberately narrow, the same discipline `../reconcile.js`'s
 * `ReconcilableConcept` uses and for the same reason: no import-cycle onto
 * `../read.js`, and a test fixture that never needs a whole `ReadConcept`.
 *
 * `anchor` is **required, not optional**, on purpose — unlike
 * `ReconcilableConcept.anchor`. A concept with no introducing passage is
 * honestly ineligible for this stage (`../read.js`'s `ReadConcept.anchor`
 * doc calls this out explicitly), so this stage's own input type refuses to
 * accept one at all rather than accepting it and dropping it later. Filter
 * before calling in, and this module never has to reason about the case.
 */
export interface CorpusConcept {
  /** Post-corroboration identity — matches `ReadConcept.name`. */
  readonly name: string;
  /** Every other wording seen for this concept, verbatim. */
  readonly aliases: readonly string[];
  /** This concept's own introducing passage (`[D-082]`'s passage-grain provenance). */
  readonly anchor: Provenance;
  /**
   * Which course(s) this concept was seen in, M:N — mirrors
   * `../read.js`'s `ReadConcept.courses` ("Empty is a statement, not a
   * failure"). Feeds `./nominate.js`'s course-overlap check: contract C7.10
   * and `[D-082]` both rule the corpus-level stage runs **"over a course's
   * concept set"** (D-082's close reason, verbatim: "the pairwise space over
   * a course's concept set"), never across every course in the vault at
   * once (`ol-x3qg`).
   *
   * **Optional, not merely absent-by-convenience.** A caller that has this
   * information supplies it as a (possibly empty) array, exactly as
   * `ReadConcept.courses` does. `undefined` means *this caller does not yet
   * thread course affiliation through* — as of this writing,
   * `packages/plugin/src/concept/wiring.ts`'s `corpusConceptsFrom` is such a
   * caller (`ol-x3qg`'s findings paper names the one-line fix still
   * outstanding there) — and is read by `./nominate.js` as "do not filter on
   * course," so a not-yet-updated caller keeps today's behaviour rather than
   * silently having every candidate dropped. Once a caller supplies real
   * `courses` data, the filter engages: an empty array (`[]`) is a concept
   * confirmed to sit in no course, and `./nominate.js` reads C7.10 literally
   * — such a concept belongs to no course's set, so it is excluded from
   * pairing on either side, the same "ineligible for this stage" posture
   * `anchor` above already holds for provenance.
   */
  readonly courses?: readonly string[];
}

/**
 * A cheap signal that nominates a pair for the corpus stage to consider.
 * **Nomination only** — none of these, alone or combined, is the verdict.
 * `[D-082]`: "cheap signals nominate; the material decides."
 *
 * - `'assessment-cooccurrence'` — both concepts appear in the same
 *   assessment document (past paper, objectives) — component register row
 *   1.2a's "co-occurrence in assessment documents."
 * - `'embedding-proximity'` — the local vector cache places the two
 *   concepts close together.
 * - `'her-link'` — she linked the two concept notes herself. Component
 *   register row 1.2a calls this "usefully, human-asserted" — strong
 *   nomination evidence. It is still only nomination for the purpose of
 *   `[D-082]`'s combined-passage rule: "the verdict on each candidate must
 *   come from reading the combined passages" applies to every candidate,
 *   hers included, so this signal never skips the port call or invents a
 *   type/direction from the two names alone. What it DOES change,
 *   post-verdict (`[D-070]`, `ol-9qwy`): a candidate this signal nominated
 *   reconciles to `RelationProvenanceKind: 'hers'` rather than
 *   `'model-proposed'` — see `./verdict.js`'s doc for the reconciliation
 *   rule and why that is a separate question from what the verdict types
 *   the relation as.
 * - `'assessment-error-adjacency'` — the grading judge attributed a wrong
 *   answer to her confusing this concept with another one
 *   (`../../misconception/types.js`'s `MisconceptionRecord.confusedWithConceptId`,
 *   surfaced by `workerJudgeCaller.ts`'s `confusedWith` parsing through the
 *   grading pipeline and the misconception projection — `ol-2zfj.19`, the
 *   "assessment-error adjacency" producer named in the confusion-pairing
 *   scoping memo, `docs/direction/papers/confusion-pairing-home/PROPOSAL.md`
 *   §2(a) in `olea-service`). This is real EVIDENCE that she was confused,
 *   which the knowledge model (§5) and functional scope (C7.10) both say
 *   should be able to corroborate a `contrasts-with` HYPOTHESIS, not the same
 *   fact as one — nominating from it is still only nomination, same as every
 *   other kind here: `[D-082]`'s combined-passage verdict decides whether the
 *   pair actually becomes an edge, and this signal never mints one directly.
 * - `'explain-back-relation-demonstrated'` — a graded explain-back response
 *   correctly related the subject concept to a neighbour the graph does not
 *   already connect (`[D-083]`'s `CandidateEdgeNomination`,
 *   `../../mastery/gradingInputContract.js`, F5.2a's `no-edge` provenance
 *   case: "her correct inference of a relation the graph does not have").
 *   Surfaced by the SOLO grading pipeline
 *   (`../../grading/explainBackSolo.js`'s
 *   `PendingSoloGrading.candidateEdgeNomination`) as two concept IDs, no
 *   type, no direction, no confidence — a nomination like every other kind
 *   here, never a verdict. **Member added, not yet produced by
 *   `./nominate.js`**: `CandidateEdgeNomination` carries concept IDs and
 *   `NominationSignal.a`/`.b` are concept NAMES (this type's own doc,
 *   above), so turning one into the other needs a concept-id-to-name
 *   resolution `./nominate.js` does not yet accept — named, not built, by
 *   `ol-95vv.2`'s own module header and `ol-95vv.3`'s scope (the enum member
 *   only; wiring `nominate.js` to actually emit it is separate, unstarted
 *   work, `corpus-relations/` proper being outside both beads' `owns`).
 */
export type NominationSignalKind =
  | 'assessment-cooccurrence'
  | 'embedding-proximity'
  | 'her-link'
  | 'assessment-error-adjacency'
  | 'explain-back-relation-demonstrated';

/** One occurrence of a cheap signal linking two concept names, unordered. */
export interface NominationSignal {
  readonly kind: NominationSignalKind;
  readonly a: string;
  readonly b: string;
}

/**
 * A pair nominated for a verdict — output of `./nominate.js`, input to
 * `./verdict.js`. Not yet a relation: it carries no type, no direction and
 * no confidence, because nothing has read the passages yet.
 */
export interface CorpusRelationCandidate {
  readonly a: CorpusConcept;
  readonly b: CorpusConcept;
  /** Every signal kind that nominated this pair, deduplicated. */
  readonly signals: readonly NominationSignalKind[];
}

/**
 * Every way a corpus-stage candidate fails to become an edge — closed, like
 * `../reconcile.js`'s `RelationDropReason`.
 *
 * - `'unknown-concept'` — a verdict names an endpoint outside the candidate
 *   set that was actually sent (`./verdict.js`'s "the candidate set is
 *   authoritative").
 * - `'not-corpus-eligible-type'` — a verdict's type is not one of the two
 *   this stage may emit (`CORPUS_STAGE_EMITTABLE_TYPES`).
 * - `'missing-passage-provenance'` — an endpoint reached reconciliation
 *   without an anchor; belt-and-braces, since `CorpusConcept.anchor` is
 *   required at the type level.
 * - `'no-relation'` — a directed type's verdict carried no `direction`. The
 *   material did not settle order, and this stage refuses to guess one
 *   rather than emit an edge with an invented direction.
 */
export type CorpusRelationDropReason =
  | 'unknown-concept'
  | 'not-corpus-eligible-type'
  | 'missing-passage-provenance'
  | 'no-relation';

export const CORPUS_RELATION_DROP_REASONS: readonly CorpusRelationDropReason[] = [
  'unknown-concept',
  'not-corpus-eligible-type',
  'missing-passage-provenance',
  'no-relation',
];

export interface CorpusRelationBatchResult {
  readonly relations: readonly ConceptRelation[];
  /** Counts only, per reason (D-005) — see `../reconcile.js`'s identical discipline. */
  readonly dropped: Readonly<Record<CorpusRelationDropReason, number>>;
  /** How many candidates this run nominated, before any verdict — a coverage measurement, not a log of names. */
  readonly candidatesNominated: number;
}

export function emptyCorpusDropCounts(): Record<CorpusRelationDropReason, number> {
  const counts = {} as Record<CorpusRelationDropReason, number>;
  for (const reason of CORPUS_RELATION_DROP_REASONS) counts[reason] = 0;
  return counts;
}

export function totalCorpusDropped(dropped: CorpusRelationBatchResult['dropped']): number {
  return CORPUS_RELATION_DROP_REASONS.reduce((sum, reason) => sum + dropped[reason], 0);
}
