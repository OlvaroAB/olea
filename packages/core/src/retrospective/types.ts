/**
 * F8.8 — the post-assessment retrospective (`[POST-1]`, `ol-r68l`). Mechanics
 * ruled `[D-134]` (`ol-cooc`), approving the DSN-2 drawing
 * (`docs/design/dsn2-retrospective/` in olea-service) and its ten open
 * questions. Types shared between the pure computation (`build.ts`,
 * `offer.ts`) and whatever caller assembles real inputs from a vault
 * (`packages/plugin/src/retrospective/provider.ts`).
 *
 * ## What this module deliberately does NOT derive
 *
 * F8.8's own scenario (`features/F8-concepts-scope.md`, olea-service) says
 * the retrospective "covers exactly the concepts that assessment's scope
 * names" — a PER-ASSESSMENT concept list. Nothing in this codebase produces
 * one today: `../assessment/scope.ts`'s `resolveScope` (F1.7) resolves a
 * *prose* scope string ("covers weeks 1-5"), never a concept-id list, and
 * `../evidence-edge/build.ts`'s `buildConceptAssessmentEdges` is COURSE-level
 * evidence replicated across every assessment sharing a course, by that
 * module's own documented coarse-graining — not a per-assessment join
 * either. Neither is a safe route to "the concepts this ONE assessment
 * covered".
 *
 * So this module never attempts that derivation itself: `RetrospectiveInput.
 * scope` is a caller-resolved concept list, and `scopeOrigin` states which of
 * the two D-134 Q6 paths produced it — the same discipline
 * `../today/earlier-course-recognition.ts` uses for its own genuinely-missing
 * joins (see that module's doc, point 1). `packages/plugin/src/retrospective/
 * provider.ts` names exactly what it supplies in production and the gap it
 * could not close.
 */

import type { MasteryState, ReviewLogEntry } from 'olea-contracts';
import type { VaultPath } from '../vault/types.js';

/** One concept named in an assessment's resolved scope. */
export interface RetrospectiveConceptCoverage {
  readonly conceptId: string;
  readonly conceptName: string;
}

/**
 * D-134 Q6: "the assessment's stated scope (F1.7) where recorded; otherwise
 * the evidenced concept set, VISIBLY LABELLED as drawn from her review
 * history rather than the assessment's own words". `'assessment-stated'` and
 * `'evidenced'` name exactly those two paths — never blended, never silently
 * defaulted, because F8.8/knowledge-model discipline keeps a stated fact and
 * an evidence-derived set from borrowing each other's authority (DSN-2
 * `NOTES.md` §5 Q6).
 */
export type RetrospectiveScopeOrigin = 'assessment-stated' | 'evidenced';

/**
 * Re-exported here rather than imported from `../mastery/vitality.js` at
 * every call site — this is the vitality VALUE alone (`readAllConceptVitality`'s
 * `VitalityReading.value`), the only field this surface reads. Registry
 * display words: `holding` → "holding", `tending` → "needs tending",
 * `early` → "too early to say".
 */
export type { Vitality } from '../mastery/vitality.js';

/**
 * One line in "what held" or "what faded". F2.11 co-presence (`[D-116]`):
 * every row on this surface carries BOTH axes — stage and vitality — or
 * neither, so this type has no field that can exist without the other.
 */
export interface RetrospectiveConceptLine {
  readonly conceptId: string;
  readonly conceptName: string;
  readonly stage: MasteryState;
  readonly vitality: import('../mastery/vitality.js').Vitality;
}

/**
 * "What carries" (F8.7 reuse, `[D-058]`) — an OVERLAY on `held`/`faded`, never
 * a third grouping (DSN-2 `NOTES.md` §1, second finding). Two ways a concept
 * can carry, mirroring D-134 Q3/Q9:
 *
 * - **Cross-course** (the ordinary case): the concept is also associated with
 *   at least one OTHER course, read from the same concept-to-course join
 *   `../today/earlier-course-recognition.ts` reads — `otherCourses` is that
 *   module's own "every other course, never narrowed to one" rule, reused
 *   rather than re-derived.
 * - **Same-course fallback** (D-134 Q3: "where the course has no later
 *   course, what carries reads against the term's last assessment"): fires
 *   only when `otherCourses` is empty AND the caller supplied a scope for the
 *   course's own final assessment that also names this concept. There is no
 *   course-order or course-phase field anywhere in the contract (F2.19), so
 *   "later course" cannot be read off the data model at all — this fallback
 *   is the one case D-134 names explicitly where "later" collapses to "this
 *   course's own last assessment" instead of another course.
 */
export interface RetrospectiveCarriesLine {
  readonly conceptId: string;
  readonly conceptName: string;
  readonly otherCourses: readonly string[];
  readonly carriesToFinalAssessment: boolean;
}

export interface RetrospectiveReading {
  readonly assessmentPath: VaultPath;
  readonly course: string;
  readonly scopeOrigin: RetrospectiveScopeOrigin;
  /**
   * Total concepts in scope — the count F8.3 says fills the space a grade
   * would occupy (DSN-2 `README.md`, "no-score treatment"). Never divided by
   * anything on this surface: `held.length`, `faded.length` and
   * `tooEarlyCount` are reported as independent counts, and no renderer of
   * this type may compute a ratio, percentage or fraction from them.
   */
  readonly scopeCount: number;
  /** Practised and still recalled — vitality `holding`. */
  readonly held: readonly RetrospectiveConceptLine[];
  /** Practised, recall faded — vitality `tending`. */
  readonly faded: readonly RetrospectiveConceptLine[];
  /**
   * A STATED COUNT, never a fourth grouping (DSN-2 `NOTES.md` §1, the
   * structural gap this kit found and D-134 approved the fix for): concepts
   * in scope with no recall-tier review completed yet (vitality `early`) are
   * neither held nor faded — principle 12 part 3 forbids filing them under
   * "faded" as a false middle, and the scenario's "no more and no fewer"
   * forbids simply dropping them. `held.length + faded.length +
   * tooEarlyCount === scopeCount`, always.
   */
  readonly tooEarlyCount: number;
  /** Overlay only — never counted into `scopeCount` a second time. */
  readonly carries: readonly RetrospectiveCarriesLine[];
}

/** Everything `buildRetrospective` needs, all caller-resolved (see this file's module doc). */
export interface RetrospectiveInput {
  readonly assessmentPath: VaultPath;
  readonly course: string;
  readonly scope: readonly RetrospectiveConceptCoverage[];
  readonly scopeOrigin: RetrospectiveScopeOrigin;
  /** Whole review log — vitality and mastery are both computed fresh here, never accepted pre-rolled, matching `../today/mastery-overview.ts`'s own rule. */
  readonly entries: readonly ReviewLogEntry[];
  readonly scheduler: import('../scheduler/types.js').Scheduler;
  readonly now: Date;
  readonly holdingCut: number;
  /**
   * The concept-to-course join (F1.3), the same shape
   * `EarlierCourseRecognitionInput.concepts` reads — used only to compute
   * `carries[].otherCourses`.
   */
  readonly conceptCourses: readonly import('../insights/types.js').ConceptCourses[];
  /**
   * D-134 Q3's same-course fallback input: the concept scope of the course's
   * own LAST assessment, when the course has none other associated with any
   * of its concepts. `undefined` when this assessment already IS the last
   * one, or the caller has not resolved one — either way, "no fallback",
   * never a guess.
   */
  readonly finalAssessmentScope?: readonly RetrospectiveConceptCoverage[];
}
