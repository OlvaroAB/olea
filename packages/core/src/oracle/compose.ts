/**
 * `composeOracleRanking` — the one join that turns a vault and a review log
 * into a `RankOracleResult` (P5-T07).
 *
 * `rank.ts`'s own module doc says `rankOracle` is "the whole of F4.2's
 * inspectable ranking… computed with no model call and no network", and its
 * `RankOracleInput` is "typed against the exact result shapes P5-T03 and
 * P4-T06 already produce". Both of those shapes existed, both were tested,
 * and nothing in production called either one to build the third — the gap
 * this bead measured (`ol-p5t07`'s notes, `ol-2tyj`'s discovery): `rankOracle`
 * had no non-test caller anywhere in either repo.
 *
 * This module is that caller, and nothing more. It does not tune a weight, it
 * does not decide a folder default beyond what `evidence-edge/build.ts` and
 * `concept/evidence.ts` already default, and the one thing it cannot default
 * — `basePath`, the Bases assignments table F1.1 reads — it takes as a
 * required argument, exactly as `buildConceptAssessmentEdges` already
 * requires it. No new judgment is exercised here; it composes.
 *
 * ## Which concepts get a mastery lookup, and why not "every concept in the
 * log"
 *
 * Mastery is computed for exactly the concepts the ranking's universe holds
 * — the concepts `buildConceptAssessmentEdges` found evidence for, plus the
 * concepts the need-only doors below admit — rather than for every concept
 * `conceptIdsInLog` finds. A concept she has reviewed but that no assessment
 * cites and no need-only door admits never appears in a `ConceptPriority` at
 * all (P5-T03's join is course-and-evidence only), so computing its mastery
 * would be work with no reader. **Since `[D-447]` option (b)** (ruled
 * 2026-09-29, `ol-egov.141.89.10.96`) a caller that opts into need-only
 * ranking has one more door: a concept she HAS practised, in a course that
 * has assessment records but where no assessment reaches it, is admitted at
 * need-only (see {@link ComposeOracleRankingInput.admitPractisedUnlinkedConcepts}),
 * so it does not disappear from planning because alignment is incomplete. A
 * concept with an edge but no review history still gets a real
 * `computeConceptMastery` call and reads `'seed'` — which is the correct,
 * *not* `'unknown'`, answer: mastery data was supplied for it, it simply
 * shows no scored evidence yet (see `rank.ts`'s `resolveMasteryState` doc for
 * why those two absences are deliberately different values).
 *
 * ## Cost, and why this is not called on every render
 *
 * `extractTier3Evidence` walks and re-segments her past papers and
 * objectives — real vault I/O, not a cache read. Nothing in this module
 * caches its own result; that is `plan/cache.ts`'s job, one layer up, and is
 * exactly why `StudyPlanStore` exists at all. A caller composing this on
 * every review-session open would re-pay the tier-3 walk every time she
 * opens a card; the intended caller is a `StudyPlanProvider.fetchPlan`
 * implementation invoked through `refreshStudyPlan`'s "may refresh"
 * discipline, not the review session path.
 *
 * ## This IS the named producer for `[YIELD-1]` / `ol-evr1` (foundation item 42)
 *
 * "Olea reads past papers to judge what a course tends to examine" resolves
 * to exactly this call: `composeOracleRanking` → `rankOracle` (`./rank.ts`),
 * a probabilistic per-course, per-concept judgement built from
 * `buildConceptAssessmentEdges`'s yield rank and confidence (P5-T03, itself
 * over `extractTier3Evidence`'s reading of registered past papers, P5-T01).
 * It is not the same thing item 25 disclaims building — that is
 * `oracle.rank.v1` (`olea-service/src/tasks/oracleRank.ts`), a separate,
 * unratified LLM narrative pass that narrates this module's own ranking and
 * is barred from re-deciding it (see `rank.ts`'s module doc). Three
 * production call sites consume this function's result, each reachable from
 * the shipped plugin via `main.ts` rather than only the workbench:
 *
 *   - `packages/plugin/src/gap/provider.ts` (`createLocalGapProvider`) — the
 *     gap view's ranking and abstention state.
 *   - `packages/plugin/src/plan/provider.ts` (`createLocalStudyPlanProvider`)
 *     — the cached study plan `refreshStudyPlan` may rebuild; this is also
 *     the seam `[D-110]`'s delivered `rank-weights` envelope threads into via
 *     `options` (`ol-v7r5.3`, wired at `main.ts`'s `rankWeights` field).
 *   - `packages/plugin/src/session-builder/provider.ts`
 *     (`createLocalSessionBuilderProvider`) — the session builder's input,
 *     via `buildGapView` and `buildComposedStudySession`.
 *
 * See `findings/YIELD-1-exam-likelihood.md` (olea-service) for the full
 * producer/consumer/check account.
 *
 * ## Retrievability's producer is threaded here, and now reached from all three callers
 *
 * `RankOracleInput.retrievability`'s doc (`./types.ts`) used to say nothing
 * threads a vitality-fold output through this composition at all — that gap
 * is closed: `retrievability` (`ComposeRetrievabilityInput`, below) accepts a
 * `Scheduler` and an instant, and this module folds them through
 * `readAllConceptReadiness` (`../mastery/attainment.js`, the C5.6/`[D-264]`
 * entry point, `ol-v7r5.54`) into exactly the `ReadonlyMap<string, number>`
 * shape `rankOracle` wants. `readAllConceptReadiness` — not the plain
 * `readAllConceptVitality` fold this composition used before — is what
 * carries `[D-264]` ruling 1's supported-only exclusion: an instrument whose
 * only successes were shown at `'prompted'` or `'guided'` support carries no
 * eligible recall evidence for readiness, though it still schedules and
 * still counts toward mastery under `[D-094]`'s discount. **Corrected — the
 * reachability gap one hop further out is closed too**: `plan/provider.ts`,
 * `session-builder/provider.ts` and `gap/provider.ts` (`ol-egov.141.89.10.22`)
 * now all pass this field, each threading its own `Scheduler` and `now`
 * through the identical `{ scheduler, now }` shape.
 *
 * **Corrected again (`ol-egov.141.89.10.80`): the same fold now also reaches
 * `[D-332]`'s need term as `demandAwareReadiness`, not only as
 * `retrievability`.** Before this bead every caller's need fell back to the
 * blend's `'current-recall'` branch, because nothing supplied
 * `RankOracleInput.demandAwareReadiness` at all — see `retrievability`'s own
 * doc, below, for the full account (what changed, and what this still is
 * not: a fold that also checks the assessment's DEMANDED operation).
 *
 * ## `[D-404]`'s eligibility veto is produced here, for the callers that serve practice
 *
 * `rankOracle` vetoes a concept once none of its practice instruments is
 * eligible (`./rank.ts`'s module doc). The facts come from here:
 * {@link ComposeOracleRankingInput.instrumentInventory} names the
 * instruments, the review log already in hand says which she suspended or
 * withdrew, and the caller may add ids it found ineligible for a citation
 * reason. The gap view and the note offer deliberately never pass it
 * (`[D-404]` condition 3). **Both callers that serve practice pass it**:
 * the plugin's `session-builder/provider.ts` (`composeStudySessionForRequest`,
 * `61bdf67`) and `plan/provider.ts` (`48d3067`), each as
 * `enumeration.records`. A course whose every concept is vetoed stays in the
 * plan with zero allocation and a named reason (`plan/build.ts`'s
 * `emptyRankingReasonFor`, `[D-408]`), never a failed plan refresh.
 */

import type { DisputeLogRecord, ReviewLogEntry } from 'olea-contracts';
import { readDeclaredScope } from '../assessment/scope.js';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptRecord } from '../concept/types.js';
import { daysBetween } from '../dates.js';
import { buildConceptAssessmentEdges } from '../evidence-edge/build.js';
import type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
  ConceptAssessmentEdge,
} from '../evidence-edge/types.js';
import { readAllConceptReadiness } from '../mastery/attainment.js';
import type { ConceptMasteryResult, MasteryRollupOptions } from '../mastery/rollup.js';
import { computeAllConceptMastery, foldConceptStage } from '../mastery/rollup.js';
import type { InstrumentValidityProjection } from '../mastery/validity.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import { suspendedInstrumentIds } from '../review-log/suspension.js';
import { findComparableObservationDisagreements } from '../review-log/tiebreak.js';
import { hasDifferentEligibleOrdinaryInstrument } from '../routing/instrument-eligibility.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { ConceptInstrumentEligibilityFact } from './rank.js';
import { rankOracle } from './rank.js';
import type { RankOracleOptions, RankOracleResult } from './types.js';

/**
 * Retrievability's raw materials (register join 1-2, `[D-087]`, `ol-95vv.1`):
 * the vitality fold needs a `Scheduler` port AND the instant to read it at, so
 * this bundles the two rather than accepting them as two independently
 * optional fields — a caller with only one of them cannot honestly ask for a
 * reading, and an object that can be half-supplied invites exactly that bug.
 *
 * Omitting this field entirely is the documented default path:
 * `RankOracleInput.retrievability` reads every concept as neutral (1, no
 * adjustment) when it is never supplied at all (see its own doc) — this
 * bundle being absent is how `composeOracleRanking` reaches that same
 * omission rather than fabricating a scheduler or a clock read of its own.
 */
export interface ComposeRetrievabilityInput {
  readonly scheduler: Scheduler;
  /**
   * The instant retrievability is read at. Never read from a clock inside
   * this module — same discipline `asOf` above already documents — so the
   * caller's own `now` (already threaded through `session-builder/provider.ts`
   * and `plan/provider.ts` for `asOf`/`computedAt`) is what belongs here, not
   * a fresh `new Date()`.
   */
  readonly now: Date;
}

export interface ComposeOracleRankingInput extends BuildConceptAssessmentEdgesOptions {
  readonly vault: VaultSource;
  /**
   * The whole review log, already read. This module does no vault I/O for
   * it — the callers that have one differ on how they got there (a full
   * history read for a background refresh, a session's own read for a
   * harness), and re-reading it here would be a second, possibly
   * inconsistent, read of the same files.
   */
  readonly reviewLog: readonly ReviewLogEntry[];
  /**
   * `[D-095]` grade-contest records read apart from `reviewLog`, folded into
   * the one validity projection this composition reads (`ol-egov.141.89.9.68`).
   * A contest resolved `corrected` proves ONE review's grade wrong: that
   * review stays practice, a re-grade is read in its place, readiness replays
   * without it, and the instrument's other reviews keep counting. Optional
   * and defaults to none — rejections and defect suspensions, inside
   * `reviewLog`, count without it.
   */
  readonly disputes?: readonly DisputeLogRecord[];
  /** The calendar day exam proximity is measured from — passed straight to `rankOracle`. */
  readonly asOf: string;
  /**
   * Retrievability's producer (register join 1-2, `[D-087]`, `ol-95vv.1`;
   * `[D-264]` ruling 1's supported-only exclusion, `ol-v7r5.54`). Omit for a
   * caller with no `Scheduler` handy — `rankOracle` reads every concept as
   * neutral in that case, exactly as `RankOracleInput.retrievability`'s own
   * doc requires. Supplied, this composition folds each ranked concept's
   * instruments through `readAllConceptReadiness`
   * (`../mastery/attainment.js`) and passes the weakest ELIGIBLE instrument's
   * recall probability through as the signal — eligible meaning recall-tier
   * (never recognition), with at least one completed review, AND at least
   * one success shown at `'independent'` support: an instrument whose only
   * successes were supported (`'prompted'`/`'guided'`) is excluded from the
   * fold entirely, per `[D-264]` ruling 1, even though it still schedules and
   * still counts toward mastery. There is no `holding`/`tending`/`early`
   * classification here — `readAllConceptReadiness` computes no cut at all,
   * unlike the vitality fold it is a sibling of.
   *
   * **Corrected (`ol-egov.141.89.10.80`): this same fold is now ALSO the
   * producer for `RankOracleInput.demandAwareReadiness`.** Attainment owns
   * "the readiness reading" (`../mastery/attainment.js`'s `readAllConceptReadiness`,
   * C5.6) — the fold this field's doc describes above is that reading, not a
   * plainer "current recall". Before this bead, `composeOracleRanking`
   * passed it to `rankOracle` only under the legacy `retrievability` name, so
   * `[D-332]`'s blend always took the `needSource: 'current-recall'` branch —
   * "every caller falls back to recall" (this bead's own filed description).
   * The identical map is now passed a second time as `demandAwareReadiness`,
   * so the blend reads `needSource: 'demand-aware-readiness'` instead
   * whenever this fold has a reading for a concept, and does not also read
   * `retrievabilityWeight` for `need` (`[D-332]`'s "counted once" check;
   * `./rank.js`'s `resolveNeed` already picks `demandAwareReadiness` first
   * and short-circuits before touching the recall value at all). The
   * `retrievability` field itself is left wired unchanged — a caller's
   * `factors.retrievabilityWeight` keeps reporting the same number, exactly
   * as `OracleConceptFactors.retrievabilityWeight`'s own doc says it should
   * ("reaches `priorityScore` only as `need`... and not at all when
   * demand-aware readiness was supplied").
   *
   * **What this is not, yet.** `readAllConceptReadiness`'s eligibility rule
   * (recall-tier, independent success) is not filtered against the specific
   * operation an assessment DEMANDS of a concept (`recall-a-fact` vs.
   * `calculate` vs. `apply`, `[D-281]`'s "a demand-aware calculation: what
   * the course actually asks her to DO... against what she has practised").
   * No declared-demand data reaches this composition today (`../gap/demand.js`'s
   * `demandsMetNow` needs `declaredDemands`/`instrumentDemands` this input
   * does not carry) — folding that in is real, separate plumbing, filed as a
   * follow-up rather than built speculatively here.
   */
  readonly retrievability?: ComposeRetrievabilityInput;
  /**
   * C5.10 ruling 1's tiebreak producer (`[D-265]`, `ol-egov.141.62`) —
   * threaded straight to `../review-log/tiebreak.js`'s
   * `findComparableObservationDisagreements`, which needs it to confirm two
   * observations were read against the SAME revision of an instrument's
   * source material (one of the clause's four required comparability
   * facts). **Omit — as every caller does today** — to have this
   * composition find NO tiebreak-eligible concepts; see that module's doc
   * for why omission is the honest default rather than a loosened check.
   * Nothing in `review-log/`, `routing/` or `ingestion/materiality/`
   * produces a per-review source-version stamp yet, so this field exists
   * for the day one does, the same "structurally correct, never-a-gate
   * place for it" reasoning `retrievability` above already documents.
   */
  readonly resolveTiebreakSourceVersion?: (instrumentId: string) => string | undefined;
  readonly options?: RankOracleOptions;
  /**
   * `oracle.rank.v1`'s one-clause reasoning per concept (`ol-3ux7.5.57.14.53`),
   * keyed by the Worker task's own `conceptName` spelling
   * (`OracleConceptRanking.reasoning`, prompt v1.2.0, `ol-3ux7.5.57.14.44`
   * [HARD-23]) — the shape a caller receives straight from a grounded
   * `OracleRankResponse.rankings` (olea-service's `src/tasks/oracleRank.ts`;
   * `groundRankings` there already guarantees `conceptName` echoes a real
   * candidate's own spelling byte-for-byte). This composition is where the
   * join from a display name to this session's own opaque `conceptKey`
   * already happens for every other per-concept signal
   * ({@link resolveCaseInsensitiveConceptKeys}, `retrievability` above) —
   * the natural seam for this one too: a caller supplies names,
   * {@link ComposeOracleRankingResult.rankedReasons} on the result reads
   * keys.
   *
   * **Omit — as every caller does today.** `oracle.rank.v1` has no
   * production caller anywhere in either repo (that task's own module doc);
   * `ol-egov.142.2` is filed to give it one. Until then this composition's
   * `rankedReasons` output is always empty, which is the honest state of
   * production, not a placeholder standing in for a real one.
   *
   * **Never `ConceptPriority.reasoning`.** This module already produces
   * that field on every ranked entry (`rank.ts`'s deterministic,
   * mechanically-assembled trail) and this input is not it, does not
   * derive from it, and is never folded into it — two different producers,
   * kept apart the same way `packages/plugin/src/gap/copy.ts`'s STY-2 ban
   * already keeps `ConceptPriority.reasoning` off her screen.
   */
  readonly rankedReasons?: ReadonlyMap<string, string>;
  /**
   * `[D-404]` (`ol-egov.141.89.10.5`): the caller's instrument inventory —
   * every practice instrument currently in the vault, with the concept keys
   * it is filed under (`enumerateVaultInstruments`'s `records` satisfy this
   * shape as they are, enumerated with `stampConceptKeys: true` so the keys
   * are the ones edges and the review log carry). Supplied, this
   * composition folds the review log's suspension projection
   * (`../review-log/suspension.ts`, which covers her withdrawals too) over
   * it and hands `rankOracle` one eligibility list per concept, so a concept
   * whose every instrument is ineligible is vetoed and listed with its
   * reason, and a concept with one eligible instrument left ranks exactly as
   * before.
   *
   * **Supply it from a caller that serves practice** — the session
   * composition, and the plan once an all-vetoed course can be carried by
   * it (see the module doc) — `[D-404]` condition 2: "removed from the
   * servable practice list". **Omit it from a scope or coverage reader** — the gap
   * view and the note offer — so no scope or coverage reading loses a
   * vetoed concept (condition 3). Omitted, nothing is vetoed by this rule,
   * byte-identical to before.
   *
   * A note gone from the vault is not in the inventory at all, so its
   * instruments are simply not there; a concept whose every instrument's
   * note is gone reads as having no instruments (not vetoed, condition 4's
   * reading), and the session's fill then has nothing of it to serve.
   */
  readonly instrumentInventory?: readonly ComposeInventoryInstrument[];
  /**
   * `[D-404]` with `[D-330]`'s other causes: instrument ids the caller has
   * already found ineligible for a reason the review log does not carry —
   * a cited passage marked changed, or pending revalidation (`[D-343]`).
   * Read only together with {@link instrumentInventory}. Omit when the
   * caller has no such reading; nothing is then withheld on those grounds.
   */
  readonly otherIneligibleInstrumentIds?: ReadonlySet<string>;
  /**
   * `[D-373]` applying `[D-329]` (`ol-76pt`): opt a course she has material
   * for but that has no assessment record at all into `rankOracle`'s
   * need-only reading. Supplied `true`, this composition hands `rankOracle`
   * a `courseConcepts` universe (`RankOracleCourseConceptsInput`) for
   * exactly those courses — every concept in `concepts` whose course no
   * record in `assessmentsRead` names — so their concepts rank at unknown
   * relevance, served on need alone, instead of being absent from the
   * ranking altogether. Their keys also join the mastery and readiness folds
   * below, so need reads her own review evidence rather than none.
   *
   * **This door is for courses with no assessment record.** A course with
   * records keeps its ordinary reading, abstain or veto included, except for
   * the practised concepts {@link admitPractisedUnlinkedConcepts} admits
   * (`[D-447]` option (b), below): a course whose every assessment has passed
   * is completed-course maintenance, which `[D-373]` hands to a separate
   * reading and neither door touches. Omitted or `false`, `courseConcepts` is
   * never supplied and the ranking is byte-identical to before. Supply it
   * from a caller that serves practice (the session composition); a scope or
   * coverage reader has no need-only reading to show.
   */
  readonly serveCoursesWithoutAssessmentsOnNeed?: boolean;
  /**
   * `[D-447]` option (b), ruled 2026-09-29 (`ol-egov.141.89.10.96`): in a
   * course that HAS assessment records, admit a concept she has practised but
   * that no assessment edge in the course reaches, at `[D-329]`'s need-only
   * treatment, instead of leaving it out of the ranking because the course's
   * assessment alignment is incomplete. An otherwise eligible course concept
   * does not disappear from ordinary planning for that reason.
   *
   * **What is admitted.** A concept for which all of these hold:
   *  - it belongs to a course with at least one assessment record;
   *  - no edge in that course reaches it, live or vetoed (a linked concept,
   *    including one whose only assessment has passed, keeps its current
   *    treatment: this door never overrides a real edge);
   *  - she has practised it, on evidence that stands: the mastery fold reads
   *    above the never-practised floor with every instrument the log proves
   *    invalid left out (`[D-345]`). A blank or skipped attempt, or practice
   *    only on a defective instrument, admits nothing; a withdrawal is not
   *    invalidity, so earlier practice on a withdrawn instrument still counts
   *    (the `[D-404]` veto below still removes the concept when nothing
   *    remains to serve);
   *  - the course is not completed: some assessment of it is undated,
   *    unreadably dated, or due today or later (`[D-373]`);
   *  - no explicit assessment scope leaves it out: the course is closed to this
   *    door when EVERY assessment of it still to come states its scope in a
   *    scope property (`[D-399]`'s declared scope; body prose is never a
   *    filter). A concept the scope names has an edge and never reaches here.
   *    When any assessment still to come states none, the concept's relevance
   *    to that one is unknown, and unknown stays unknown.
   *
   * **What the entry says.** It rides `rankOracle`'s unknown-relevance entry
   * (`[D-329]`): no contribution, no citation, proximity nil. Its relevance is
   * a declared planning placement, never evidence that the concept matters to
   * an assessment; any reason built from it must not claim otherwise (rows 32
   * and 33 of the 2026-09-29 rulings). Never-practised unlinked concepts in a
   * course with records stay absent, as before: the ruling names practised
   * ones.
   *
   * Follows {@link serveCoursesWithoutAssessmentsOnNeed} when omitted, so the
   * one production caller that opts into need-only ranking (the session
   * composition) takes it. Passing `false` restores the earlier reading for a
   * before/after comparison; passing `true` alone opens this door without the
   * no-assessment-course one.
   */
  readonly admitPractisedUnlinkedConcepts?: boolean;
}

/**
 * `[D-373]`/`[D-329]` (`ol-76pt`): the `courseConcepts` universe for every
 * course `concepts` names that no assessment record names — see
 * {@link ComposeOracleRankingInput.serveCoursesWithoutAssessmentsOnNeed}.
 * Keyed course → concept key → concept name, the shape `rankOracle` reads.
 * Exported for `compose.spec.ts`.
 */
export function coursesWithoutAssessmentRecords(
  concepts: readonly ConceptRecord[],
  assessmentRecords: readonly { readonly course?: string | undefined }[],
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const coursesWithRecords = new Set<string>();
  for (const record of assessmentRecords) {
    if (record.course !== undefined) coursesWithRecords.add(record.course);
  }
  const universe = new Map<string, Map<string, string>>();
  for (const concept of concepts) {
    for (const course of concept.courses) {
      if (coursesWithRecords.has(course)) continue;
      const inner = universe.get(course) ?? new Map<string, string>();
      if (!inner.has(concept.key)) inner.set(concept.key, concept.name);
      universe.set(course, inner);
    }
  }
  return universe;
}

/**
 * What {@link practisedUnlinkedConceptsByCourse} reads. Plain values, so the rule is testable
 * without a vault; `composeOracleRanking` resolves each one from its own inputs.
 */
export interface PractisedUnlinkedAdmissionInput {
  readonly concepts: readonly ConceptRecord[];
  /** Every assessment record read, whatever its course. */
  readonly assessmentRecords: readonly AssessmentRecord[];
  /** Only the two fields the rule reads: an edge links a concept to its course's assessments. */
  readonly edges: readonly Pick<ConceptAssessmentEdge, 'course' | 'conceptKey'>[];
  /** The calendar day the composition is read at; the same day `rankOracle` measures a due date from. */
  readonly asOf: string;
  /** Whether she has practised the concept on evidence that stands (see the option's doc). */
  readonly isPractised: (conceptKey: string) => boolean;
  /** Paths of assessment notes that state their scope in a scope property (`readDeclaredScope`). */
  readonly declaredScopePaths: ReadonlySet<VaultPath>;
}

const ADMISSION_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `record`'s due date has passed at `asOf`: the same fact `rank.ts`'s date veto
 * (`checkEdgeVeto`, `'assessment-passed'`) acts on, restated here because the composition must
 * know a course is completed before it decides what to admit. A due date that is absent or
 * unreadable has not passed: "we do not know when this is due" is not a veto there either, and
 * the parity cases in `compose.practised-unlinked.d-447.spec.ts` hold the two together.
 */
function assessmentHasPassed(record: AssessmentRecord, asOf: string): boolean {
  const { due } = record;
  if (due === undefined || !ADMISSION_CALENDAR_DAY.test(due)) return false;
  if (!ADMISSION_CALENDAR_DAY.test(asOf)) return false;
  const dueDate = new Date(`${due}T00:00:00.000Z`);
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(dueDate.getTime()) || Number.isNaN(asOfDate.getTime())) return false;
  return daysBetween(asOfDate, dueDate) < 0;
}

/**
 * `[D-447]` option (b): for each course that has assessment records, the concepts to admit at
 * need-only, keyed course to concept key to concept name (the shape `rankOracle`'s
 * `courseConcepts` reads). See {@link ComposeOracleRankingInput.admitPractisedUnlinkedConcepts}
 * for the rule. A course with nothing to admit is left out of the result entirely: an empty entry
 * would flip an abstaining course to `'ranked'` with nothing in it.
 *
 * The two-step reading of a course's live assessments (completed, then explicitly scoped) is
 * deliberate. A course with no assessment still to come is completed-course maintenance
 * (`[D-373]`) and is skipped whatever its scope statements say; a course whose every upcoming
 * assessment states its scope has told us what it covers, so a concept outside that statement is
 * not unknown but known-out, and stays out.
 *
 * Exported for `compose.practised-unlinked.d-447.spec.ts`.
 */
export function practisedUnlinkedConceptsByCourse(
  input: PractisedUnlinkedAdmissionInput,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const recordsByCourse = new Map<string, AssessmentRecord[]>();
  for (const record of input.assessmentRecords) {
    if (record.course === undefined) continue;
    const list = recordsByCourse.get(record.course);
    if (list === undefined) recordsByCourse.set(record.course, [record]);
    else list.push(record);
  }
  const linked = new Map<string, Set<string>>();
  for (const edge of input.edges) {
    const keys = linked.get(edge.course);
    if (keys === undefined) linked.set(edge.course, new Set([edge.conceptKey]));
    else keys.add(edge.conceptKey);
  }

  const eligibleCourses = new Set<string>();
  for (const [course, records] of recordsByCourse) {
    const upcoming = records.filter((record) => !assessmentHasPassed(record, input.asOf));
    if (upcoming.length === 0) continue; // completed: its own reading (D-373)
    // Not vacuous: `every` over nothing is true, and a completed course must not read as scoped.
    const everyUpcomingStatesScope =
      upcoming.length > 0 && upcoming.every((record) => input.declaredScopePaths.has(record.path));
    if (everyUpcomingStatesScope) continue; // an explicit scope: known-out, not unknown
    eligibleCourses.add(course);
  }

  const admitted = new Map<string, Map<string, string>>();
  for (const concept of input.concepts) {
    for (const course of concept.courses) {
      if (!eligibleCourses.has(course)) continue;
      if (linked.get(course)?.has(concept.key) === true) continue;
      if (!input.isPractised(concept.key)) continue;
      const inner = admitted.get(course) ?? new Map<string, string>();
      if (!inner.has(concept.key)) inner.set(concept.key, concept.name);
      admitted.set(course, inner);
    }
  }
  return admitted;
}

/**
 * One inventory entry {@link ComposeOracleRankingInput.instrumentInventory}
 * reads — the two fields of `../session/types.js`'s `VaultInstrumentRecord`
 * this composition needs, so an enumeration's records pass as they are.
 */
export interface ComposeInventoryInstrument {
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
}

export interface ComposeOracleRankingResult {
  readonly ranking: RankOracleResult;
  /**
   * `buildConceptAssessmentEdges`'s full result, passed through — `ol-2tyj`'s
   * gap and coverage views need `tier3.sourcesReport` for `ol-cvsc`'s
   * coverage scope, and re-running the tier-3 walk a second time to get it
   * would defeat the point of composing it once here.
   */
  readonly edges: BuildConceptAssessmentEdgesResult;
  /**
   * The mastery map this composition already builds for `rankOracle`,
   * passed through — `buildGapView`'s `mastery` input is keyed exactly the
   * same way (by `ConceptAssessmentEdge.conceptKey`, the opaque join key —
   * `ol-63e1`), and re-deriving it a second time from the same review log
   * would be a second, possibly inconsistent, computation of the same thing.
   * Additive: existing callers that only read `ranking`/`edges` are
   * unaffected.
   */
  readonly mastery: ReadonlyMap<string, ConceptMasteryResult>;
  /**
   * {@link ComposeOracleRankingInput.rankedReasons}, re-keyed from concept
   * name to this composition's own `conceptKey` — see that field's doc.
   * Always present, empty when the input was omitted or named no concept
   * this composition's edges actually resolved a key for (additive,
   * `ol-3ux7.5.57.14.53`; existing callers reading only `ranking`/`edges`/
   * `mastery` are unaffected).
   *
   * **Not yet wired to any production caller.** `study-session/build.ts`'s
   * `BuildStudySessionInput.rankedReasons` takes the identical key-keyed
   * shape, but threading THIS map into THAT input is `study-session/
   * compose.ts`'s call (outside this bead's owned files) once
   * `ol-egov.142.2` gives `oracle.rank.v1` a caller to source it from.
   */
  readonly rankedReasons: ReadonlyMap<string, string>;
  /**
   * `[D-447]` option (b) (`ol-egov.141.89.10.96`): per course that has assessment
   * records, the concept keys admitted at need-only because she has practised
   * them and no assessment reaches them — see
   * {@link ComposeOracleRankingInput.admitPractisedUnlinkedConcepts}. Empty
   * when the door was closed or nothing qualified. A key listed here can still
   * be absent from `ranking`'s `ranked` list: the `[D-404]` eligibility veto
   * applies to it exactly as to any concept, and it then appears under
   * `vetoedConcepts` with its reason. Additive; a caller reading only
   * `ranking`/`edges`/`mastery` is unaffected.
   */
  readonly practisedUnlinkedAdmitted: ReadonlyMap<string, readonly string[]>;
}

/**
 * Case-insensitive, course-scoped fallback for the exact-match name→key
 * lookup `buildConceptAssessmentEdges` performs internally
 * (`evidence-edge/build.ts`'s `conceptKeyByName`, `ol-63e1`).
 *
 * **The bug this closes (`ol-5y40`).** A `topic:` value that does not
 * byte-match its note's exact Zettelkasten title is the ORDINARY case, not
 * an exotic one — tier-2 extraction mints the `ConceptRecord` under the
 * topic's own casing (R1/R2 forbid folding it there), while
 * `extractTier3Evidence`'s vocabulary match returns the edge's `conceptName`
 * in the *Zettelkasten note title's* casing (R2 — matched case-insensitively,
 * returned verbatim in the vocabulary's own casing). The exact-match lookup
 * then misses and the edge falls back to its own `conceptName` as the key
 * (see `ConceptAssessmentEdge.conceptKey`'s doc) — a value that never
 * matches `buildMaterialPresence`'s map (`gap/build.ts`, keyed by the real
 * `ConceptRecord.key`), so a concept she genuinely has notes on
 * misclassifies as `'material-gap'` (F4.10): the single most
 * trust-damaging thing that screen can say, said silently.
 *
 * **Scoped narrowly to this composition seam, per the bead's acceptance
 * criteria — this is not a case-folding of concept identity.** `extract.ts`
 * is untouched: two topic strings differing only by case still mint two
 * distinct `ConceptRecord`s (R1/R2), and this function never merges their
 * evidence. It only ever fires for an edge whose exact-match lookup already
 * failed (`edge.conceptKey === edge.conceptName` is the *only* way that can
 * happen — a real key always carries `concept-prov1:`, never a bare display
 * name), and it resolves on `(course, lowercased name)`, never name alone —
 * so a same-named concept in a *different* course is never pulled in, and a
 * genuine collision (two records, same course, same name, differing only by
 * case) picks the extraction-order-first one deterministically rather than
 * silently merging two identities. A term absent from `concepts`, in every
 * casing, for this course, is left exactly as `buildConceptAssessmentEdges`
 * resolved it — that is a true material-gap, not a residue of this join.
 */
function resolveCaseInsensitiveConceptKeys(
  edges: BuildConceptAssessmentEdgesResult,
  concepts: readonly ConceptRecord[],
): BuildConceptAssessmentEdgesResult {
  const keyByCourseAndLowerName = new Map<string, string>();
  for (const concept of concepts) {
    for (const course of concept.courses) {
      const fallbackKey = `${course}::${concept.name.toLowerCase()}`;
      // First concept wins on a same-course/same-casefold collision
      // (extraction order) — deterministic, and this seam's job is ordinary
      // topic-casing slips, not adjudicating a genuine name collision.
      if (!keyByCourseAndLowerName.has(fallbackKey)) {
        keyByCourseAndLowerName.set(fallbackKey, concept.key);
      }
    }
  }

  return {
    ...edges,
    edges: edges.edges.map((edge) => {
      if (edge.conceptKey !== edge.conceptName) return edge; // already a real key
      const resolvedKey = keyByCourseAndLowerName.get(
        `${edge.course}::${edge.conceptName.toLowerCase()}`,
      );
      return resolvedKey === undefined ? edge : { ...edge, conceptKey: resolvedKey };
    }),
  };
}

/**
 * Build a fresh `RankOracleResult` from a vault and a review log.
 *
 * No cache, no clock read here (`asOf` is the caller's, same discipline as
 * `rankOracle` itself) — this is the vault-and-log-in, ranking-out
 * composition and nothing about *when* to call it or *where to keep* what it
 * returns.
 */
export async function composeOracleRanking(
  input: ComposeOracleRankingInput,
): Promise<ComposeOracleRankingResult> {
  const {
    vault,
    reviewLog,
    disputes,
    asOf,
    options,
    retrievability,
    resolveTiebreakSourceVersion,
    rankedReasons,
    instrumentInventory,
    otherIneligibleInstrumentIds,
    serveCoursesWithoutAssessmentsOnNeed,
    admitPractisedUnlinkedConcepts,
    ...edgeOptions
  } = input;
  const rawEdges = await buildConceptAssessmentEdges(vault, edgeOptions);
  // `ol-5y40`: repairs the case-mismatched fallback `buildConceptAssessmentEdges`
  // leaves behind before anything downstream (the mastery join below,
  // `rankOracle`'s grouping, `buildMaterialPresence`'s lookup) ever sees it.
  const edges = resolveCaseInsensitiveConceptKeys(rawEdges, edgeOptions.concepts);

  // Keyed by the opaque join key, not the display name (`ol-63e1`) — this is
  // exactly the value `session/enumerate.ts` now mints into a review-log
  // record's `conceptIds`, so this is the join that used to silently miss
  // every entry before the coordinated flip.
  // `ol-a07q` (`[D-281]` item 4), at the ruled scope (`ol-egov.141.89.9.66`,
  // `ol-egov.141.89.9.68`): one dispute-aware validity projection, folded
  // once here and threaded to the need-only door below, the mastery join and
  // readiness. An instrument proven invalid (a standing rejection, a defect
  // suspension) qualifies nothing at the top stage and leaves readiness; a
  // review a corrected contest proved wrong is practice only, with any
  // re-grade read in its place, and readiness replays without it. Never a
  // withdrawal.
  const validity = projectInstrumentValidity(reviewLog, disputes ?? []);
  const masteryOptions: MasteryRollupOptions = {
    invalidInstrumentIds: [...validity.provenInvalid.keys()],
    correctedEventIds: [...validity.correctedEvidence.keys()],
  };
  // `ol-76pt`: courses with material but no assessment record, served on
  // need alone — empty (and nothing supplied to `rankOracle`) unless the
  // caller opted in.
  const noAssessmentCourseConcepts =
    serveCoursesWithoutAssessmentsOnNeed === true
      ? coursesWithoutAssessmentRecords(edgeOptions.concepts, edges.assessmentsRead.records)
      : new Map<string, ReadonlyMap<string, string>>();
  // `[D-447]` option (b): in a course that HAS records, the practised concepts
  // no assessment reaches, at the same need-only treatment. The two doors name
  // disjoint courses (a course has records or it does not). It follows the
  // first door's opt-in unless a caller says otherwise.
  const practisedUnlinked =
    (admitPractisedUnlinkedConcepts ?? serveCoursesWithoutAssessmentsOnNeed === true)
      ? await resolvePractisedUnlinkedConcepts({
          vault,
          concepts: edgeOptions.concepts,
          edges,
          asOf,
          reviewLog,
          masteryOptions,
          invalidInstrumentIds: new Set(validity.provenInvalid.keys()),
        })
      : new Map<string, ReadonlyMap<string, string>>();
  const courseConcepts = new Map<string, ReadonlyMap<string, string>>([
    ...noAssessmentCourseConcepts,
    ...practisedUnlinked,
  ]);
  const needOnlyKeys = [...courseConcepts.values()].flatMap((inner) => [...inner.keys()]);
  const conceptKeys = [
    ...new Set([...edges.edges.map((edge) => edge.conceptKey), ...needOnlyKeys]),
  ].sort();
  const mastery = computeAllConceptMastery(reviewLog, conceptKeys, masteryOptions);
  const retrievabilityScores = resolveRetrievabilityScores(
    reviewLog,
    conceptKeys,
    retrievability,
    validity,
  );
  const tiebreakEligible = resolveTiebreakEligibleConcepts(
    reviewLog,
    asOf,
    resolveTiebreakSourceVersion,
  );

  const conceptInstrumentEligibility =
    instrumentInventory !== undefined
      ? resolveConceptInstrumentEligibility(
          instrumentInventory,
          reviewLog,
          otherIneligibleInstrumentIds,
        )
      : undefined;

  const ranking = rankOracle({
    evidence: {
      edges: edges.edges,
      assessmentsRead: edges.assessmentsRead,
      assessmentsWithNoEvidence: edges.assessmentsWithNoEvidence,
    },
    mastery,
    asOf,
    ...(retrievabilityScores !== undefined
      ? {
          retrievability: retrievabilityScores,
          // `ol-egov.141.89.10.80`: the identical attainment fold, ALSO as
          // `demandAwareReadiness` — see `retrievability`'s own doc above for
          // why these are the same map under two names, and `[D-332]`'s
          // "counted once" check for why passing both is safe: `rank.ts`'s
          // `resolveNeed` reads `demandAwareReadiness` first and never
          // touches `retrievabilityWeight` for `need` once it has, so recall
          // is not ALSO read for any concept this fold covers.
          demandAwareReadiness: retrievabilityScores,
        }
      : {}),
    ...(tiebreakEligible.size > 0 ? { tiebreakEligible } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(conceptInstrumentEligibility !== undefined ? { conceptInstrumentEligibility } : {}),
    ...(courseConcepts.size > 0 ? { courseConcepts } : {}),
  });

  return {
    ranking,
    edges,
    mastery,
    rankedReasons: resolveRankedReasonsByKey(edges, rankedReasons),
    practisedUnlinkedAdmitted: new Map(
      [...practisedUnlinked].map(([course, inner]) => [course, [...inner.keys()].sort()]),
    ),
  };
}

/**
 * `[D-447]` option (b)'s resolver: what {@link practisedUnlinkedConceptsByCourse} needs that only
 * this composition can supply. "Practised" is the stage fold over her review log with every
 * instrument the log proves invalid taken out of it at every stage (`[D-345]`): above the
 * never-practised floor means at least one rated attempt, or a graded or verdict-carrying
 * explanation, on an instrument that stands. A blank or skipped attempt establishes nothing
 * (ruling of 2026-09-28 on `ol-egov.141.89.6.59`), and neither does practice only on a defective
 * instrument.
 *
 * The scope statements are read only for the courses that survive the rest of the rule, so a
 * composition with nothing to admit (the ordinary case for a caller with no practice yet) reads no
 * assessment note here. A note gone from the vault, or one with no frontmatter or scope property,
 * states no scope: `readDeclaredScope` returns `undefined` for all three, and that keeps the
 * course open to the door, since a scope nobody stated cannot leave a concept out.
 */
async function resolvePractisedUnlinkedConcepts(args: {
  readonly vault: VaultSource;
  readonly concepts: readonly ConceptRecord[];
  readonly edges: BuildConceptAssessmentEdgesResult;
  readonly asOf: string;
  readonly reviewLog: readonly ReviewLogEntry[];
  readonly masteryOptions: MasteryRollupOptions;
  readonly invalidInstrumentIds: ReadonlySet<string>;
}): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const { vault, concepts, edges, asOf, reviewLog, masteryOptions, invalidInstrumentIds } = args;
  const practised = new Map<string, boolean>();
  const isPractised = (conceptKey: string): boolean => {
    const known = practised.get(conceptKey);
    if (known !== undefined) return known;
    const reading = foldConceptStage(reviewLog, conceptKey, masteryOptions, {
      excludedInstrumentIds: invalidInstrumentIds,
    });
    const result = reading.state !== 'seed';
    practised.set(conceptKey, result);
    return result;
  };
  const rule = {
    concepts,
    assessmentRecords: edges.assessmentsRead.records,
    edges: edges.edges,
    asOf,
    isPractised,
  };
  // First pass with every course open: if nothing qualifies there, no scope can add anything.
  const open = practisedUnlinkedConceptsByCourse({ ...rule, declaredScopePaths: new Set() });
  if (open.size === 0) return open;
  const declaredScopePaths = new Set<VaultPath>();
  for (const record of edges.assessmentsRead.records) {
    if (record.course === undefined || !open.has(record.course)) continue;
    if ((await readDeclaredScope(vault, record.path)) !== undefined) {
      declaredScopePaths.add(record.path);
    }
  }
  return practisedUnlinkedConceptsByCourse({ ...rule, declaredScopePaths });
}

/**
 * `ol-3ux7.5.57.14.53`: re-keys {@link ComposeOracleRankingInput.rankedReasons}
 * from `oracle.rank.v1`'s own `conceptName` spelling onto this composition's
 * `conceptKey`, using the identical (post-case-resolution) `edges.edges`
 * name→key join `resolveCaseInsensitiveConceptKeys` already produced above —
 * no second, independent name resolution invented here. A name the input
 * names that this composition's edges never resolved a key for (a concept
 * this ranking has no evidence for at all) is dropped silently, the same
 * "absent signal, no-op" posture {@link resolveRetrievabilityScores} and
 * every optional per-concept lookup on this path already take. First edge
 * wins on a same-name collision, matching {@link resolveCaseInsensitiveConceptKeys}'s
 * own tiebreak.
 */
function resolveRankedReasonsByKey(
  edges: BuildConceptAssessmentEdgesResult,
  rankedReasons: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> {
  if (rankedReasons === undefined || rankedReasons.size === 0) return new Map();
  const keyByName = new Map<string, string>();
  for (const edge of edges.edges) {
    if (!keyByName.has(edge.conceptName)) keyByName.set(edge.conceptName, edge.conceptKey);
  }
  const byKey = new Map<string, string>();
  for (const [name, reason] of rankedReasons) {
    const key = keyByName.get(name);
    if (key !== undefined) byKey.set(key, reason);
  }
  return byKey;
}

/**
 * `[D-404]`'s producer (`ol-egov.141.89.10.5`): per concept key, each
 * practice instrument filed under it and whether it can be served now —
 * `'suspended'` when the review log's suspension fold holds it (her suspend
 * or withdraw action; last event wins, `../review-log/suspension.ts`),
 * `'instrument-ineligible'` when the caller named it in
 * `otherIneligible` (a changed or pending citation), and eligible
 * otherwise. An instrument filed under two concepts counts on both; one
 * listed twice under a concept counts once. `rankOracle`'s
 * `conceptEligibilityVeto` does the rollup; this only states the facts.
 *
 * Exported for `compose.spec.ts`, which proves the fold against a real
 * suspend/unsuspend sequence without a vault fixture.
 */
export function resolveConceptInstrumentEligibility(
  inventory: readonly ComposeInventoryInstrument[],
  reviewLog: readonly ReviewLogEntry[],
  otherIneligible: ReadonlySet<string> | undefined,
): ReadonlyMap<string, readonly ConceptInstrumentEligibilityFact[]> {
  const suspended = suspendedInstrumentIds(reviewLog);
  const byConcept = new Map<string, Map<string, ConceptInstrumentEligibilityFact>>();
  for (const record of inventory) {
    const fact: ConceptInstrumentEligibilityFact = suspended.has(record.instrumentId)
      ? { instrumentId: record.instrumentId, ineligible: 'suspended' }
      : otherIneligible?.has(record.instrumentId) === true
        ? { instrumentId: record.instrumentId, ineligible: 'instrument-ineligible' }
        : { instrumentId: record.instrumentId };
    for (const conceptKey of record.conceptIds) {
      const facts = byConcept.get(conceptKey);
      if (facts === undefined) byConcept.set(conceptKey, new Map([[record.instrumentId, fact]]));
      else if (!facts.has(record.instrumentId)) facts.set(record.instrumentId, fact);
    }
  }
  const result = new Map<string, readonly ConceptInstrumentEligibilityFact[]>();
  for (const [conceptKey, facts] of byConcept) result.set(conceptKey, [...facts.values()]);
  return result;
}

/**
 * C5.10 ruling 1's tiebreak (`[D-265]`) — folds `../review-log/tiebreak.js`'s
 * comparable-observation-disagreement reading together with
 * `../routing/instrument-eligibility.js`'s "a different eligible ordinary
 * instrument exists" check into the one opaque flag `rankOracle`'s
 * `RankOracleTiebreakInput.tiebreakEligible` reads. Neither producer decides
 * the other's half: a concept qualifies only when BOTH agree, exactly as
 * the clause's own "disagree ... but only where a different eligible
 * ordinary instrument ... exists to resolve it" reads.
 *
 * Exported so `compose.spec.ts` can exercise it directly against a
 * caller-supplied `resolveSourceVersion` — the vault-fixture-based
 * `composeOracleRanking` suite would otherwise need to engineer an exact
 * `priorityScore` tie before this could be observed at all, and the
 * producer half is worth proving live on its own terms (the same
 * "demonstrated, not merely inert" standard `ol-egov.141.52`'s own tests
 * hold `rank.ts`'s mechanism to).
 */
export function resolveTiebreakEligibleConcepts(
  reviewLog: readonly ReviewLogEntry[],
  asOf: string,
  resolveSourceVersion: ((instrumentId: string) => string | undefined) | undefined,
): ReadonlySet<string> {
  const disagreements = findComparableObservationDisagreements({
    entries: reviewLog,
    asOf,
    ...(resolveSourceVersion !== undefined ? { resolveSourceVersion } : {}),
  });

  const eligible = new Set<string>();
  for (const [conceptKey, disagreement] of disagreements) {
    if (
      hasDifferentEligibleOrdinaryInstrument(
        reviewLog,
        conceptKey,
        disagreement.disagreeingInstrumentIds,
      )
    ) {
      eligible.add(conceptKey);
    }
  }
  return eligible;
}

/**
 * Register join 1-2 (`[D-087]`, `ol-95vv.1`), now carrying `[D-264]` ruling
 * 1's supported-only exclusion (`ol-v7r5.54`): the producer for
 * `RankOracleInput.retrievability`, over exactly the concepts this
 * composition already ranks. `undefined` when `retrievabilityInput` is
 * omitted — `rankOracle` reads that as neutral for every concept, the same
 * "absent signal is neutral" rule its own doc states.
 *
 * Folds through `readAllConceptReadiness` (`../mastery/attainment.js`), the
 * C5.6/`[D-264]` entry point — not the plain `readAllConceptVitality`
 * (`../mastery/rollup.js`) this composition used before, which applies R3's
 * recall-tier filter but not the supported-only exclusion: an instrument
 * whose only successes were shown at `'prompted'` or `'guided'` support is
 * eligible for vitality and still counts toward mastery, but carries no
 * eligible recall evidence for readiness. `readAllConceptReadiness` needs an
 * `InstrumentValidityProjection` (proven-invalid instruments excluded from
 * every current reading, per `[D-338]` item 3) — `composeOracleRanking`
 * folds `reviewLog` through `projectInstrumentValidity`
 * (`../mastery/validity.js`) exactly once and passes the result in here
 * (`ol-a07q`), rather than this function re-folding the same log a second
 * time; the mastery join above reads the identical projection for its own
 * `invalidInstrumentIds`, so the two readers cannot disagree about which
 * instrument is proven invalid.
 *
 * A concept with no eligible recall-tier instrument (`readAllConceptReadiness`'s
 * `weakest === null` — no evidence, recognition-only, never-practised, or
 * every success was supported; `../mastery/vitality.ts#readReadinessRecall`'s
 * sufficiency floor) is left OUT of the returned map rather than defaulted to
 * some placeholder number — `resolveRetrievabilityWeight` (`./rank.ts`)
 * already reads a missing key as neutral for that one concept, which is the
 * honest answer: "no reading" is not the same fact as "reading of 1", and
 * this composition should not manufacture the latter out of the former.
 */
function resolveRetrievabilityScores(
  reviewLog: readonly ReviewLogEntry[],
  conceptKeys: readonly string[],
  retrievabilityInput: ComposeRetrievabilityInput | undefined,
  validity: InstrumentValidityProjection,
): ReadonlyMap<string, number> | undefined {
  if (retrievabilityInput === undefined) return undefined;
  const { scheduler, now } = retrievabilityInput;
  // `[D-347]` as ruled (`ol-egov.141.89.9.94`): a sound review she withheld keeps counting in
  // readiness, because "a personal withdrawal or replacement does not automatically invalidate a
  // sound review" (the attainment matching rule, section 7, judgement J1); `validity` removes the
  // proven-invalid ones (`[D-338]` item 3). Named so the ruled reading is visible here: option
  // (c), dropping every withheld instrument, was the proposal the ruling did not adopt. The gap
  // view's need, recognition credit and demand rule pass the same policy
  // (`plugin/src/gap/provider.ts`'s `RULED_CURRENT_READING`). A changed, unrevalidated passage
  // (`AttainmentOptions.passageChanges`) has no production input yet.
  const readings = readAllConceptReadiness(reviewLog, conceptKeys, scheduler, now, validity, {
    withheldEvidence: 'count',
  });
  const scores = new Map<string, number>();
  for (const [conceptKey, reading] of readings) {
    if (reading.weakest !== null) {
      scores.set(conceptKey, reading.weakest.recallProbability);
    }
  }
  return scores;
}
