/**
 * The support ladder's history as a core fold (`ol-egov.141.89.9.4`; the
 * attainment chain spec's section 2.6 in `olea-service`) — what row 3.9's
 * chooser (`../study-session/support-level-chooser.ts`) folds, per concept ×
 * tier, built once from her log for every caller.
 *
 * **Whole sessions, never single reviews** (`[D-094]` counts sessions; C5.4
 * defines a session as `../session/cluster.ts`'s maximal cluster of reviews
 * separated by less than the declared gap). Within one session, per concept
 * and tier, the outcome is the WORST shape shown: escalate on any blank or
 * wrong-concept failure; clean only when every answer was clean. Recall and
 * explanation are separate ladders, so a clean recall answer never papers
 * over a failing explanation of the same concept in the same sitting.
 *
 * **A review is an outcome for its scored concept only** (`[D-419]`, `[D-423]`,
 * `ol-egov.141.89.9.73`): the first id of the record's own `conceptIds`, through
 * `../session/scored-concept.ts`, the rule the mastery rollup reads. A concept a
 * record names only as context gets no outcome from it, and a record keeps the
 * subject it was written with, so reordering a note's topics later never moves
 * an old outcome to another concept.
 *
 * **Explanations read correctness first** (`[D-286]`, `[D-281]`):
 * `../study-session/support-level-signal.ts`'s `deriveFailureShape` reads the
 * verdict before depth, so a relational but incorrect answer is a failure and
 * unknown correctness never reads as a clean pass.
 *
 * **Only her own failures move the ladder** (rulings of 2026-09-28,
 * `ol-egov.141.89.9.66`). An operational failure — the grader unavailable, a
 * transport fault, a check that failed — is never read as hers: it leaves an
 * explanation with no correctness verdict, and such a record has no reading
 * here unless its depth grade itself shows she missed the point
 * (`prestructural`, a reading of what she wrote). Before, an unknown verdict
 * read as a minor slip and broke a run of clean sessions. Evidence proven
 * invalid is not hers either: every review of an instrument proven invalid
 * as of the composition instant (a standing rejection, a defect) is left out,
 * and a review whose grade a contest resolved `corrected` proved wrong is read
 * through its corrective re-grade where one was recorded, and not at all where
 * none was — the instrument's other reviews stand. A withdrawal is not
 * invalidity: her suspended instruments keep their history.
 *
 * **Blank, skipped and unassessable submissions are not practice**: a skip is
 * a `non-attempt` record, never a review; an unassessable answer and a blank
 * one are refused before anything is written (`[D-321]`; the explain-back
 * modal's empty-submit guard); an explanation with neither depth nor verdict
 * has no reading here. So nothing she did not genuinely attempt escalates
 * the ladder as a failure of hers.
 *
 * **A verdict with no depth grade counts where correctness alone counts**
 * (`ol-ryrh`, ruled 2026-09-27). Escalation is such a place: it needs a
 * failure shape and nothing else (`[D-094]` item 5, "one session with a blank
 * or wrong-concept failure"), and an `'incorrect'` verdict is one whatever
 * depth says — `[D-286]` skips the depth pass for exactly that verdict, so
 * skipping the record here would mean an incorrect explanation never
 * escalates the explanation ladder. Recession is not such a place: support
 * fades only on "strong recent recall together with depth evidence" (F2.20),
 * so a `'correct'` or `'partial'` verdict without a depth grade has no
 * reading here and is skipped, as before — it neither counts as a clean
 * session nor breaks a run of them.
 *
 * **Fixed at composition** (`[D-186]`): given the composition instant, the
 * fold reads only sessions CLOSED before it — reviews logged at or after it
 * are not yet history, and a cluster whose last review sits within the
 * clustering gap of it is the sitting still in progress. An extension asks
 * as of its session's original composition instant and so reads exactly the
 * levels the session was composed with, whatever she has answered since.
 *
 * **Hint use is not recorded** (`[D-350]`, open): every outcome reads
 * `hintUptake: false` — never a fabricated positive — so the ratchet's
 * "a hint taken holds a level" half cannot fire until the field exists.
 *
 * **The recognition tier has no ladder** (`[D-094]` item 4): this module
 * builds history for `'recall'` and `'explanation'` only, per
 * `SupportLadderTier`. {@link NO_LADDER_SUPPORT_LEVEL} is that tier's ruled
 * answer for a caller building a reading across all three instrument tiers.
 *
 * This is the plugin's per-review fold (`packages/plugin/src/review/
 * queue-adapter.ts`'s `buildSupportLevelHistoryLookup`, fixed per session by
 * `5d1487f` and given explanations by `abd69d7`) moved into core, with the
 * composition cut added. Replacing the plugin's fold with this one is
 * `ol-egov.141.89.9.5`'s; until then nothing calls it.
 */

import {
  type ExplainBackCorrectnessVerdict,
  type ReviewLogEntry,
  type ReviewLogRecord,
  readExplainBackCorrectness,
  type SoloLevel,
} from 'olea-contracts';
import {
  type InstrumentValidityProjection,
  projectInstrumentValidity,
} from '../mastery/validity.js';
import { clusterReviewSessions, SESSION_CLUSTERING_GAP_SECONDS } from '../session/cluster.js';
import { scoredConceptOf } from '../session/scored-concept.js';
import {
  deriveFailureShape,
  type GradedReviewEvidence,
} from '../study-session/support-level-signal.js';
import type { FailureShape, SessionSupportOutcome, SupportLadderTier } from './types.js';

/** The chooser's input, per concept and tier — the shape `study-session/build.ts` reads. */
export interface SupportLevelHistory {
  /** Past session outcomes, oldest first. Empty for a cell with no history (the chooser's cold start). */
  outcomesFor(conceptId: string, tier: SupportLadderTier): readonly SessionSupportOutcome[];
}

export interface SupportLevelHistoryOptions {
  /**
   * The session's composition instant. Present: only sessions closed before
   * it are read (`[D-186]`). Absent: every session in `entries`, as the
   * plugin's fold does today.
   */
  readonly composedAt?: Date;
  /** Override the declared clustering gap — sweeps and tests only, as `clusterReviewSessions` itself says. */
  readonly gapSeconds?: number;
  /**
   * The validity projection to read proven-invalid evidence from. Defaults to
   * `projectInstrumentValidity(entries)`; a caller that reads dispute records
   * apart from the log passes `projectInstrumentValidity(entries, disputes)`.
   * Judged as of `composedAt` when one is given.
   */
  readonly validity?: InstrumentValidityProjection;
}

/**
 * The recognition tier's support-level reading (`[D-094]` item 4's scope
 * clause, restated at the attainment chain spec's §2.6: "at composition, per
 * concept × tier (recall, explanation; recognition has no ladder)"). Not a
 * cold start and never one of `SupportLevel`'s three ladder values ---
 * `[D-094]`'s own words: "a hinted MCQ is a different question — the
 * excluded case". There is no history to fold and no level to choose, so
 * this is a constant, not a computation over `entries`. The chain spec's §5
 * class L6 and the attainment case set's S5 assertion a4 both target this
 * value by name (`eval/data/ilb/att` in the service repo, cited by path
 * only).
 *
 * `SupportLevelHistory.outcomesFor`'s `tier` parameter is typed to
 * `SupportLadderTier`, which excludes `'recognition'`; a caller answering a
 * support-level reading across all three instrument tiers reads this
 * constant for the third, rather than routing an empty history through this
 * module's recall/explanation cold start (`chooseSupportLevel`'s
 * `'prompted'`, `study-session/support-level-chooser.ts`) and reading the
 * wrong tier's default by mistake — an mcq-only log's `'recall'` cell is
 * still cold, not the recognition tier's answer.
 */
export const NO_LADDER_SUPPORT_LEVEL = 'none' as const;

/** Escalation shapes rank equally, above a minor slip, above a clean pass. */
const FAILURE_SHAPE_SEVERITY: Readonly<Record<FailureShape, number>> = {
  none: 0,
  'minor-slip': 1,
  blank: 2,
  'wrong-concept': 2,
};

function worse(a: FailureShape, b: FailureShape): FailureShape {
  return FAILURE_SHAPE_SEVERITY[b] > FAILURE_SHAPE_SEVERITY[a] ? b : a;
}

/** The ladder tier and graded evidence of one review, or `null` when it has no ladder or no honest reading. */
function ladderEvidence(
  review: ReviewLogRecord,
): { readonly tier: SupportLadderTier; readonly evidence: GradedReviewEvidence } | null {
  if (review.instrumentType === 'qa' || review.instrumentType === 'cloze') {
    if (review.rating === null) return null;
    return {
      tier: 'recall',
      evidence: { instrumentType: review.instrumentType, rating: review.rating },
    };
  }
  if (review.instrumentType === 'explain-back') {
    const correctness = correctnessEvidence(review);
    const soloLevel = review.explainBackGrade?.soloLevel;
    if (!hasExplanationReading(correctness.correctness, soloLevel)) return null;
    return {
      tier: 'explanation',
      evidence: {
        instrumentType: 'explain-back',
        // `deriveFailureShape` never reads `rating` on the explain-back
        // branch (an explain-back review's rating is always null, F2.16); the
        // shape requires one, so a placeholder is supplied, as the plugin's
        // fold and the signal's own spec do.
        rating: 'again',
        ...(soloLevel === undefined ? {} : { soloLevel }),
        ...correctness,
      },
    };
  }
  // `mcq`: recognition has no ladder (`[D-094]`).
  return null;
}

/**
 * Whether an explanation has a ladder reading (see the module doc). An
 * `'incorrect'` verdict always does (`ol-ryrh`: escalation needs no depth).
 * A `'correct'` or `'partial'` one does only with a depth grade (F2.20:
 * recession needs depth evidence). With NO verdict — an operational failure
 * or a record older than the verdict — only a `prestructural` depth grade
 * does, since that grade reads what she wrote; anything else would read the
 * missing verdict as a slip of hers.
 */
function hasExplanationReading(
  correctness: ExplainBackCorrectnessVerdict | undefined,
  soloLevel: SoloLevel | undefined,
): boolean {
  if (correctness === 'incorrect') return true;
  if (correctness === undefined) return soloLevel === 'prestructural';
  return soloLevel !== undefined;
}

/**
 * The review whose verdict stands for `review`: `review` itself, or the
 * corrective re-grade that replaced it (`explainBackGrade.revisionOf`,
 * followed to the last one), or `null` when its grade was proven wrong with
 * no corrected verdict recorded. `replacement` maps a replaced event id to
 * its re-grade.
 */
function standingVerdictOf(
  review: ReviewLogRecord,
  replacement: ReadonlyMap<string, ReviewLogRecord>,
  correctedEventIds: ReadonlySet<string>,
): ReviewLogRecord | null {
  let source = review;
  const visited = new Set<string>([source.eventId]);
  for (;;) {
    const next = replacement.get(source.eventId);
    if (next === undefined || visited.has(next.eventId)) break;
    visited.add(next.eventId);
    source = next;
  }
  return correctedEventIds.has(source.eventId) ? null : source;
}

/**
 * Builds the support history from her log. Pure: same entries, same options,
 * same history; input order does not matter (sessions are clustered in the
 * log's own total order).
 */
export function buildSupportLevelHistory(
  entries: readonly ReviewLogEntry[],
  options: SupportLevelHistoryOptions = {},
): SupportLevelHistory {
  const gapSeconds = options.gapSeconds ?? SESSION_CLUSTERING_GAP_SECONDS;
  const composedAt = options.composedAt?.getTime();
  const readable =
    composedAt === undefined
      ? entries
      : entries.filter((entry) => {
          if (entry.kind !== 'review') return false;
          const instant = Date.parse(entry.timestamp);
          return Number.isFinite(instant) && instant < composedAt;
        });

  const validity = options.validity ?? projectInstrumentValidity(entries);
  const asOf = composedAt ?? Number.POSITIVE_INFINITY;
  const invalidInstrumentIds = new Set(validity.provenInvalidAsOf(asOf).keys());
  const correctedEventIds = new Set(validity.correctedEvidenceAsOf(asOf).keys());

  // Corrective re-grades read in place of the review they replace; a
  // re-grade whose target is not in the readable log stands on its own.
  const readableReviews = new Map<string, ReviewLogRecord>();
  for (const entry of readable)
    if (entry.kind === 'review') readableReviews.set(entry.eventId, entry);
  const replacement = new Map<string, ReviewLogRecord>();
  const replacing = new Set<string>();
  for (const review of readableReviews.values()) {
    const revisionOf = review.explainBackGrade?.revisionOf;
    if (typeof revisionOf !== 'string' || !readableReviews.has(revisionOf)) continue;
    const prior = replacement.get(revisionOf);
    if (prior === undefined || isLaterReview(review, prior)) replacement.set(revisionOf, review);
    replacing.add(review.eventId);
  }

  const sessions = clusterReviewSessions(readable, { gapSeconds });
  const closed =
    composedAt === undefined
      ? sessions
      : sessions.filter(
          (session) => (composedAt - Date.parse(session.endedAt)) / 1000 > gapSeconds,
        );

  const byCell = new Map<string, SessionSupportOutcome[]>();
  for (const session of closed) {
    const shapeByCell = new Map<string, FailureShape>();
    for (const review of session.reviews) {
      if (replacing.has(review.eventId)) continue;
      if (invalidInstrumentIds.has(review.instrumentId)) continue;
      const source = standingVerdictOf(review, replacement, correctedEventIds);
      if (source === null) continue;
      const read = ladderEvidence(source);
      if (read === null) continue;
      const shape = deriveFailureShape(read.evidence);
      // `[D-423]`: a review is a session outcome for the concept it scored — the first id of the
      // record as written, never a concept it names only as context, and never re-read against
      // today's note (a corrective re-grade replaces the verdict, not the subject).
      const conceptId = scoredConceptOf(review);
      if (conceptId === undefined) continue;
      const cell = `${conceptId}\u0000${read.tier}`;
      const prior = shapeByCell.get(cell);
      shapeByCell.set(cell, prior === undefined ? shape : worse(prior, shape));
    }
    for (const [cell, failureShape] of shapeByCell) {
      const outcome: SessionSupportOutcome = { failureShape, hintUptake: false };
      const bucket = byCell.get(cell);
      if (bucket === undefined) byCell.set(cell, [outcome]);
      else bucket.push(outcome);
    }
  }

  return {
    outcomesFor(conceptId, tier) {
      return byCell.get(`${conceptId}\u0000${tier}`) ?? [];
    },
  };
}

/** `a` was logged after `b`, by `(instant, eventId)`; an unreadable instant never wins. */
function isLaterReview(a: ReviewLogRecord, b: ReviewLogRecord): boolean {
  const aInstant = Date.parse(a.timestamp);
  const bInstant = Date.parse(b.timestamp);
  if (!Number.isFinite(aInstant)) return false;
  if (!Number.isFinite(bInstant)) return true;
  return aInstant > bInstant || (aInstant === bInstant && a.eventId > b.eventId);
}

/**
 * The independent correctness verdict as this signal's evidence field
 * (`[D-386]`): the top-level `explainBackCorrectness` first, the legacy nested
 * verdict second, and no field at all when neither is recorded (unknown).
 */
function correctnessEvidence(review: ReviewLogRecord): {
  readonly correctness?: ExplainBackCorrectnessVerdict;
} {
  const verdict = readExplainBackCorrectness(review)?.verdict;
  return verdict === undefined ? {} : { correctness: verdict };
}
