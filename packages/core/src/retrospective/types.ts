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

import type { DisputeLogRecord, MasteryState, ReviewLogEntry } from 'olea-contracts';
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
 * "What carries" (F8.7 reuse, `[D-058]`) — an OVERLAY on the held / faded /
 * too-early partition, never a fourth grouping (DSN-2 `NOTES.md` §1, second
 * finding), computed for every concept in scope, practised or not
 * (`[D-388]`). Two ways a concept can carry, mirroring D-134 Q3/Q9:
 *
 * - **Cross-course** (the ordinary case): the concept's identity is also held
 *   by at least one OTHER course, read from the same concept-to-course join
 *   `../today/earlier-course-recognition.ts` reads, or named by another
 *   course's declared scope — `otherCourses` is that module's own "every
 *   other course, never narrowed to one" rule, reused rather than re-derived.
 *   Identity is the same key or a confirmed same-as link, never a label
 *   (`[D-388]` condition 4, `[D-402]`).
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

/**
 * `[D-388]` condition 3: on what ground a later scope holds the concept.
 * `'declared-scope'` is the later course's examiner-declared units (or, for
 * the same-course fallback, the final assessment's own recorded scope);
 * `'olea-reading'` is Olea's labelled reading, never the examiner's
 * authority. Where both hold, the declared scope is named: it is the
 * stronger fact, and the reading adds nothing to it.
 */
export type RetrospectiveCarryBasis = 'declared-scope' | 'olea-reading';

/** One later course a concept carries into, with the basis that places it there. */
export interface RetrospectiveCarryDestination {
  readonly course: string;
  readonly basis: RetrospectiveCarryBasis;
}

/**
 * One "what carries" entry as `buildRetrospective` returns it (`[D-388]`):
 * the line above plus the two facts the ruling requires every entry to
 * record. A renderer that takes the narrower `RetrospectiveCarriesLine`
 * still compiles; one that draws the ruled line reads these.
 *
 * - `destinations`: one per `otherCourses` entry, same order, each with its
 *   basis.
 * - `finalAssessmentBasis`: the basis of the same-course fallback, `null`
 *   exactly when `carriesToFinalAssessment` is false.
 * - `hasQualifyingPractice`: whether the concept has qualifying practice
 *   history, a completed review on a recall-tier instrument (the sufficiency
 *   floor that separates `held`/`faded` from the too-early count). `false`
 *   is a plain absence of evidence, never faded, weak or forgotten
 *   (`[D-388]` conditions 1 and 2); it is stated, never inferred from the
 *   entry being absent from `held` and `faded`.
 */
export interface RetrospectiveCarriesEntry extends RetrospectiveCarriesLine {
  readonly destinations: readonly RetrospectiveCarryDestination[];
  readonly finalAssessmentBasis: RetrospectiveCarryBasis | null;
  readonly hasQualifyingPractice: boolean;
}

/**
 * The concepts a course's examiner-declared units are aligned to (`SCP`'s
 * active declarations, `[D-355]`), for `[D-388]`'s basis. A course absent
 * here has no declared scope this reading knows of, so anything carrying
 * into it does so on Olea's reading.
 */
export interface RetrospectiveDeclaredScope {
  readonly course: string;
  readonly conceptIds: readonly string[];
}

/**
 * One concept's assembly before the assessment's date (`./assembly.ts`; vew.md 2.7): whether she had
 * attempted it (a scored review or an explain-back attempt) and the stage her evidence from before
 * that date showed. Assembled apart for the reading's checks; never drawn, never a group.
 */
export interface RetrospectiveAssemblyEntry {
  readonly conceptId: string;
  readonly conceptName: string;
  readonly attempted: boolean;
  readonly demonstrated: MasteryState;
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
  /**
   * Overlay only — never counted into `scopeCount` a second time. Computed
   * for every concept in scope, practised or not (`[D-388]`): a too-early
   * concept can carry while staying counted once, in `tooEarlyCount`.
   */
  readonly carries: readonly RetrospectiveCarriesEntry[];
  /**
   * Attempted and demonstrated by the assessment's date, for every concept in scope, sorted by name.
   * Present only when the caller supplied `RetrospectiveInput.assessmentDate`; not drawn, not a
   * group, and the partition above is unchanged by it.
   */
  readonly assembly?: readonly RetrospectiveAssemblyEntry[];
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
  /**
   * Where `finalAssessmentScope` came from, for `[D-388]`'s basis:
   * `'assessment-stated'` (the final assessment's own recorded scope) reads
   * as the declared scope; `'evidenced'`, or omitted, reads as Olea's
   * reading. Omitted never borrows the declared scope's authority.
   */
  readonly finalAssessmentScopeOrigin?: RetrospectiveScopeOrigin;
  /** `[D-388]`'s basis input; see `RetrospectiveDeclaredScope`. Omitted, no later course has a declared scope. */
  readonly declaredScopes?: readonly RetrospectiveDeclaredScope[];
  /**
   * The persisted same-as links (`../concept/same-as.js`), every status.
   * `[D-388]` condition 4: history carries to another course only through
   * one identity, the same key or a link she CONFIRMED (its reason and
   * confirmation are the justifying evidence); a proposed, declined or
   * severed link joins nothing, and a shared label never does. Read through
   * `buildSameAsKeyRedirect`, the seam `../today/earlier-course-recognition.ts`
   * reads. Omitted, identity is exactly `conceptId`.
   */
  readonly sameAsLinks?: readonly import('../concept/same-as.js').SameAsLinkRecord[];
  /** The key store's canonical-key index (`[D-378]`), read with `sameAsLinks`. Optional. */
  readonly canonicalKeys?: import('../concept/key-store.js').ConceptKeyCanonicalIndex;
  /**
   * `[D-095]` grade-contest records, read alongside `entries` (`ol-egov.
   * 141.89.9.61`) — same field, same rule as `../today/panel.ts`'s
   * `TodayPanelInput.disputes` (ruling of 2026-09-28 on `ol-egov.
   * 141.89.9.66`, wired here by `ol-egov.141.89.9.68`): a contest resolved
   * `corrected` proves ONE review's grade wrong (its `correctedEvidence`),
   * never the whole instrument invalid — that review stays practice, a
   * re-grade is read in its place, and the instrument's other reviews keep
   * counting. `[D-338]` item 3's "a CURRENT reading must exclude" still
   * applies, but to that one review via the replay `held`/`faded`'s
   * vitality partition above reads, not to `provenInvalid`. Optional and
   * defaults to none — a standing rejection or a defect suspension already
   * inside `entries` still excludes without this field; only the
   * corrected-contest half, read apart from the log, needs it. Supplied in
   * production by `packages/plugin/src/retrospective/provider.ts`'s
   * `buildRetrospective` call, from the same `readReviewHistory` read
   * (`ol-egov.141.89.9.63`).
   */
  readonly disputes?: readonly DisputeLogRecord[];
  /**
   * The assessment's own calendar day. When supplied, the reading also assembles, per concept in
   * scope, what she had attempted and demonstrated from evidence strictly before that day
   * (`RetrospectiveReading.assembly`). Optional: omitted, no assembly is built and nothing else
   * changes.
   */
  readonly assessmentDate?: import('../today/calendar-day.js').CalendarDay;
}
