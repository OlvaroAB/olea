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
 * **Explanations read correctness first** (`[D-286]`, `[D-281]`):
 * `../study-session/support-level-signal.ts`'s `deriveFailureShape` reads the
 * verdict before depth, so a relational but incorrect answer is a failure and
 * unknown correctness never reads as a clean pass.
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
 * This is the plugin's per-review fold (`packages/plugin/src/review/
 * queue-adapter.ts`'s `buildSupportLevelHistoryLookup`, fixed per session by
 * `5d1487f` and given explanations by `abd69d7`) moved into core, with the
 * composition cut added. Replacing the plugin's fold with this one is
 * `ol-egov.141.89.9.5`'s; until then nothing calls it.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { clusterReviewSessions, SESSION_CLUSTERING_GAP_SECONDS } from '../session/cluster.js';
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
}

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
    const grade = review.explainBackGrade;
    if (grade === undefined || grade.soloLevel === undefined) return null;
    return {
      tier: 'explanation',
      evidence: {
        instrumentType: 'explain-back',
        // `deriveFailureShape` never reads `rating` on the explain-back
        // branch (an explain-back review's rating is always null, F2.16); the
        // shape requires one, so a placeholder is supplied, as the plugin's
        // fold and the signal's own spec do.
        rating: 'again',
        soloLevel: grade.soloLevel,
        ...(grade.correctness !== undefined ? { correctness: grade.correctness } : {}),
      },
    };
  }
  // `mcq`: recognition has no ladder (`[D-094]`).
  return null;
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
      const read = ladderEvidence(review);
      if (read === null) continue;
      const shape = deriveFailureShape(read.evidence);
      for (const conceptId of review.conceptIds) {
        const cell = `${conceptId}\u0000${read.tier}`;
        const prior = shapeByCell.get(cell);
        shapeByCell.set(cell, prior === undefined ? shape : worse(prior, shape));
      }
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
