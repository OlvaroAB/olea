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
 * Mastery is computed for exactly the concepts `buildConceptAssessmentEdges`
 * found evidence for — the ranking's own universe — rather than for every
 * concept `conceptIdsInLog` finds. A concept she has reviewed but that no
 * assessment cites never appears in a `ConceptPriority` at all (P5-T03's join
 * is course-and-evidence only), so computing its mastery would be work with
 * no reader. A concept with an edge but no review history still gets a real
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
 * ## Retrievability's producer is threaded here, not yet reached from a caller
 *
 * `RankOracleInput.retrievability`'s doc (`./types.ts`) used to say nothing
 * threads a vitality-fold output through this composition at all — that gap
 * is closed: `retrievability` (`ComposeRetrievabilityInput`, below) accepts a
 * `Scheduler` and an instant, and this module folds them through
 * `readAllConceptVitality` (register join 1-2, `[D-087]`, `ol-95vv.1`) into
 * exactly the `ReadonlyMap<string, number>` shape `rankOracle` wants. What
 * remains open is reachability one hop further out: none of the three
 * production callers above passes this field yet.
 * `session-builder/provider.ts` already holds both a `Scheduler` and `now` in
 * its own deps for an unrelated obligation-classifier replay, which makes it
 * the natural next call site — but threading it is outside this composition's
 * own file, and outside this bead's owned files (`ol-sxfl`'s `owns` names
 * only `oracle/compose.ts` and `mastery/vitality.ts`), so it is left as a
 * named follow-on rather than done here.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { ConceptRecord } from '../concept/types.js';
import { buildConceptAssessmentEdges } from '../evidence-edge/build.js';
import type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
} from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import { computeAllConceptMastery, readAllConceptVitality } from '../mastery/rollup.js';
import { findComparableObservationDisagreements } from '../review-log/tiebreak.js';
import { hasDifferentEligibleOrdinaryInstrument } from '../routing/instrument-eligibility.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultSource } from '../vault/types.js';
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

/**
 * `readVitality`'s fold (`../mastery/vitality.ts`) is gated on a `holdingCut`
 * that decides `holding` vs `tending`. `VIT-1` / `ol-1bjz` closed 2026-08-25:
 * `[D-115]` ratified 0.90, provisional, as the ADOPTED VALUE, but this module
 * still takes it as a handed parameter with no default (see that module's
 * doc) — the ratification settled the number, not this call site's shape. This
 * composition never reads a vitality READING (the `holding`/`tending`/`early`
 * classification) — it only reads `VitalityReading.weakest.recallProbability`,
 * the raw number the classification is computed FROM, which does not depend
 * on where the cut sits. `1` here is not a stand-in for VIT-1's answer; it is
 * an inert argument to a required parameter of a function whose *other*
 * output this call never looks at, chosen because passing a value that could
 * be mistaken for a considered guess (e.g. something mid-range) is worse than
 * one that plainly cannot be.
 */
const UNUSED_VITALITY_HOLDING_CUT = 1;

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
  /** The calendar day exam proximity is measured from — passed straight to `rankOracle`. */
  readonly asOf: string;
  /**
   * Retrievability's producer (register join 1-2, `[D-087]`, `ol-95vv.1`).
   * Omit for a caller with no `Scheduler` handy — `rankOracle` reads every
   * concept as neutral in that case, exactly as
   * `RankOracleInput.retrievability`'s own doc requires. Supplied, this
   * composition folds each ranked concept's instruments through
   * `readAllConceptVitality` (D-087's minimum-over-instruments shape) and
   * passes the weakest instrument's recall probability through as the
   * signal — never the `holding`/`tending`/`early` classification, which
   * this composition does not compute a cut for (see
   * `UNUSED_VITALITY_HOLDING_CUT`'s doc, below).
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
    asOf,
    options,
    retrievability,
    resolveTiebreakSourceVersion,
    rankedReasons,
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
  const conceptKeys = [...new Set(edges.edges.map((edge) => edge.conceptKey))].sort();
  const mastery = computeAllConceptMastery(reviewLog, conceptKeys);
  const retrievabilityScores = resolveRetrievabilityScores(reviewLog, conceptKeys, retrievability);
  const tiebreakEligible = resolveTiebreakEligibleConcepts(
    reviewLog,
    asOf,
    resolveTiebreakSourceVersion,
  );

  const ranking = rankOracle({
    evidence: {
      edges: edges.edges,
      assessmentsRead: edges.assessmentsRead,
      assessmentsWithNoEvidence: edges.assessmentsWithNoEvidence,
    },
    mastery,
    asOf,
    ...(retrievabilityScores !== undefined ? { retrievability: retrievabilityScores } : {}),
    ...(tiebreakEligible.size > 0 ? { tiebreakEligible } : {}),
    ...(options !== undefined ? { options } : {}),
  });

  return {
    ranking,
    edges,
    mastery,
    rankedReasons: resolveRankedReasonsByKey(edges, rankedReasons),
  };
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
 * Register join 1-2 (`[D-087]`, `ol-95vv.1`): the producer for
 * `RankOracleInput.retrievability`, over exactly the concepts this
 * composition already ranks. `undefined` when `retrievabilityInput` is
 * omitted — `rankOracle` reads that as neutral for every concept, the same
 * "absent signal is neutral" rule its own doc states.
 *
 * A concept with no recall-tier instrument read (`readAllConceptVitality`'s
 * `weakest === null` — no evidence, or recognition-only, or never-practised;
 * `../mastery/vitality.ts`'s sufficiency floor) is left OUT of the returned
 * map rather than defaulted to some placeholder number — `resolveRetrievabilityWeight`
 * (`./rank.ts`) already reads a missing key as neutral for that one concept,
 * which is the honest answer: "no reading" is not the same fact as "reading
 * of 1", and this composition should not manufacture the latter out of the
 * former.
 */
function resolveRetrievabilityScores(
  reviewLog: readonly ReviewLogEntry[],
  conceptKeys: readonly string[],
  retrievabilityInput: ComposeRetrievabilityInput | undefined,
): ReadonlyMap<string, number> | undefined {
  if (retrievabilityInput === undefined) return undefined;
  const { scheduler, now } = retrievabilityInput;
  const readings = readAllConceptVitality(
    reviewLog,
    conceptKeys,
    scheduler,
    now,
    UNUSED_VITALITY_HOLDING_CUT,
  );
  const scores = new Map<string, number>();
  for (const [conceptKey, reading] of readings) {
    if (reading.weakest !== null) {
      scores.set(conceptKey, reading.weakest.recallProbability);
    }
  }
  return scores;
}
