/**
 * The enqueue half of `[D-360]`'s queued regrading workflow: the moment a
 * grade is contested, this builds and submits the job a future drain will
 * (once activation is on — `runner.ts`) resolve through
 * `resolveContestedGradeAndRegrade` (`../review/contest.js:225`).
 *
 * **Production caller:** `main.ts`'s
 * `enqueueContestRegradeJobOnDisputeBestEffort`, reached from
 * `review/session.ts`'s `contestGrade` through `contestRegradeEnqueuer`, the
 * instant the dispute is durably recorded. What this module guarantees on its
 * own: given a written `DisputeLogRecord` and the log it was written against,
 * it either enqueues exactly the job `[D-360]` criterion 2 needs (frozen at
 * THIS moment, not re-resolved later) or reports honestly why there is
 * nothing to regrade — never a guess.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { DisputeLogRecord, EnqueueResult } from 'olea-core';
import { hashContent } from 'olea-core';
import { contestedGradeEventIdFor } from '../review/contest.js';
import { CONTEST_REGRADE_JOB_KIND, type ContestRegradeJobPayload } from './types.js';

/** Structurally the same `enqueue` method `IngestionQueueEngine` itself implements — the duck-typed seam `../ingestion/generation-queue.js`'s `JobEnqueuer` already uses for other job kinds sharing that engine. */
export interface ContestRegradeJobEnqueuer {
  enqueue(input: {
    readonly contentHash: string;
    readonly label: string;
    readonly payload: unknown;
  }): Promise<EnqueueResult>;
}

/** Why `enqueueContestRegradeJobOnDispute` did not enqueue anything, alongside the ordinary `EnqueueResult`. */
export type EnqueueContestRegradeOutcome =
  | EnqueueResult
  /** `dispute.instrumentId` is absent — this dispute was never about a grade (`GradeContestPort` only opens grade disputes with one, but the type admits `undefined`; see `DisputeLogRecord`'s own schema). Nothing to regrade. */
  | { readonly status: 'not-a-grade-dispute' }
  /**
   * No graded explain-back review was found for this dispute to revise —
   * the same "nothing to revise" case `contestedGradeEventIdFor`'s own doc
   * names (a corrected outcome with nothing to revise also lands here
   * inside `resolveContestedGradeAndRegrade` itself; this is the enqueue-
   * time twin of that check, so a job that could never be actioned is
   * never queued in the first place). Two ways to get here, both never a
   * guess: a dispute that names no review, on an instrument carrying no
   * graded explain-back event; or (row 48) a dispute that NAMES a review
   * the log does not resolve to a graded explain-back review of this
   * instrument — a review not written yet, another instrument's, or one with
   * no explain-back grade. A named review that does not resolve is not
   * answered with the standing grade: that could aim the job at a review the
   * contest was not about.
   */
  | { readonly status: 'no-standing-grade' };

/**
 * Builds this job's `contentHash` from the dispute's own `eventId` — already
 * "a stable unique id" per that schema field's own doc, and unique per
 * two-device merge exactly the way `IngestionQueueEngine`'s idempotency
 * needs a `contentHash` to be. Hashed (never passed raw) so this queue's
 * persisted `contentHash` field carries the same SHA-256-hex shape every
 * other job kind sharing that engine class does, rather than a
 * differently-shaped identity by convention alone.
 */
export async function contestRegradeContentHash(disputeEventId: string): Promise<string> {
  return hashContent(new TextEncoder().encode(disputeEventId));
}

/**
 * The moment she disputes a grade (per `[D-360]`'s ruling: "started the
 * moment she disputes"): given the just-written opening `DisputeLogRecord`
 * and every record her review log currently carries (read only, to resolve
 * `contestedGradeEventIdFor` — never written here), enqueues the regrade job
 * or reports why there is nothing to enqueue.
 *
 * **The job follows the name (row 48, `ol-egov.141.89.9.74`).** A dispute
 * that names its review (`reviewId`) aims the job at exactly that graded
 * explain-back review, whatever has been graded on the instrument since; a
 * dispute that names none (every record written before the field) is aimed at
 * the grade standing on the instrument now, as before.
 *
 * `records` should be the same read `GradeContestPort.contestGrade`'s
 * caller already has in hand at the moment of the gesture — no second vault
 * read is performed by this function.
 */
export async function enqueueContestRegradeJobOnDispute(
  enqueuer: ContestRegradeJobEnqueuer,
  dispute: DisputeLogRecord,
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): Promise<EnqueueContestRegradeOutcome> {
  if (dispute.instrumentId === undefined) {
    return { status: 'not-a-grade-dispute' };
  }

  const originalGradeEventId = contestedGradeEventIdFor(dispute, records);
  if (originalGradeEventId === null) {
    return { status: 'no-standing-grade' };
  }

  const payload: ContestRegradeJobPayload = {
    kind: CONTEST_REGRADE_JOB_KIND,
    disputeEventId: dispute.eventId,
    instrumentId: dispute.instrumentId,
    originalGradeEventId,
    conceptIds: [...dispute.conceptIds],
  };

  return enqueuer.enqueue({
    contentHash: await contestRegradeContentHash(dispute.eventId),
    label: `Regrade dispute · ${dispute.instrumentId}`,
    payload,
  });
}
