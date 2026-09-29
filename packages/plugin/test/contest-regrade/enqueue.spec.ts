/**
 * `enqueueContestRegradeJobOnDispute` — the moment-of-dispute half of
 * `[D-360]`'s queued regrading workflow.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import type { EnqueueResult } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ContestRegradeJobEnqueuer,
  contestRegradeContentHash,
  enqueueContestRegradeJobOnDispute,
} from '../../src/contest-regrade/enqueue.js';
import {
  CONTEST_REGRADE_JOB_KIND,
  type ContestRegradeJobPayload,
} from '../../src/contest-regrade/types.js';
import { createVaultGradeContestPort } from '../../src/review/contest.js';
import { memoryVault } from '../review/memory-vault.js';

// Synthetic fixtures only (INV-3).
const INSTRUMENT = 'instrument-1';
const CONCEPTS = ['concept-a'];

function gradedExplainBackReview(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'eb-1',
    timestamp: '2026-08-20T09:00:00+02:00',
    instrumentId: INSTRUMENT,
    instrumentType: 'explain-back',
    conceptIds: CONCEPTS,
    rating: null,
    wasUnsure: false,
    durationMs: 4000,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: 'incorrect',
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    },
    ...overrides,
  } as ReviewLogRecord;
}

class RecordingEnqueuer implements ContestRegradeJobEnqueuer {
  readonly calls: { contentHash: string; label: string; payload: unknown }[] = [];
  result: EnqueueResult = { status: 'queued' };

  async enqueue(input: { contentHash: string; label: string; payload: unknown }) {
    this.calls.push(input);
    return this.result;
  }
}

describe('enqueueContestRegradeJobOnDispute', () => {
  it('enqueues a job naming the standing grade as originalGradeEventId, frozen at dispute time', async () => {
    const vault = memoryVault();
    const port = createVaultGradeContestPort(vault, 'device-1', () => '2026-08-21T09:00:00+02:00');
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });

    const enqueuer = new RecordingEnqueuer();
    const result = await enqueueContestRegradeJobOnDispute(enqueuer, opening, [
      gradedExplainBackReview(),
    ]);

    expect(result).toEqual({ status: 'queued' });
    expect(enqueuer.calls).toHaveLength(1);
    const call = enqueuer.calls[0]!;
    expect(call.label).toBe(`Regrade dispute · ${INSTRUMENT}`);
    expect(call.contentHash).toBe(await contestRegradeContentHash(opening.eventId));
    expect(call.payload).toEqual({
      kind: CONTEST_REGRADE_JOB_KIND,
      disputeEventId: opening.eventId,
      instrumentId: INSTRUMENT,
      originalGradeEventId: 'eb-1',
      conceptIds: CONCEPTS,
    } satisfies ContestRegradeJobPayload);
  });

  it('reports no-standing-grade, and enqueues nothing, when the instrument carries no graded explain-back event', async () => {
    const vault = memoryVault();
    const port = createVaultGradeContestPort(vault, 'device-1', () => '2026-08-21T09:00:00+02:00');
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });

    const enqueuer = new RecordingEnqueuer();
    const result = await enqueueContestRegradeJobOnDispute(enqueuer, opening, []);

    expect(result).toEqual({ status: 'no-standing-grade' });
    expect(enqueuer.calls).toEqual([]);
  });

  it('reports not-a-grade-dispute, and enqueues nothing, when the dispute names no instrument', async () => {
    const enqueuer = new RecordingEnqueuer();
    const disputeWithNoInstrument = {
      schemaVersion: 6,
      kind: 'dispute',
      eventId: 'd-1',
      timestamp: '2026-08-21T09:00:00+02:00',
      claimKind: 'reading',
      claimRendering: 'mastery-reading',
      conceptIds: CONCEPTS,
      evidenceBasis: 'fingerprint-1',
      effect: 'held',
    } as const;

    const result = await enqueueContestRegradeJobOnDispute(enqueuer, disputeWithNoInstrument, []);

    expect(result).toEqual({ status: 'not-a-grade-dispute' });
    expect(enqueuer.calls).toEqual([]);
  });

  describe('follows the review a dispute names (row 48, ol-egov.141.89.9.74)', () => {
    /** Two graded attempts on one instrument: the dispute is about the earlier one, the later one is the standing grade. */
    const EARLIER = gradedExplainBackReview({ eventId: 'eb-earlier' });
    const LATER = gradedExplainBackReview({
      eventId: 'eb-later',
      timestamp: '2026-08-22T09:00:00+02:00',
    });

    /** The one job the enqueuer was handed, or a failure naming that none was. */
    function queuedPayload(enqueuer: RecordingEnqueuer): ContestRegradeJobPayload {
      const call = enqueuer.calls[0];
      if (call === undefined) throw new Error('expected one enqueued job');
      return call.payload as ContestRegradeJobPayload;
    }

    async function contest(reviewId?: string) {
      const port = createVaultGradeContestPort(
        memoryVault(),
        'device-1',
        () => '2026-08-23T09:00:00+02:00',
      );
      return port.contestGrade({
        instrumentId: INSTRUMENT,
        conceptIds: CONCEPTS,
        evidenceBasis: 'mcq|instrument-1|2|false',
        ...(reviewId === undefined ? {} : { reviewId }),
      });
    }

    it('aims the job at the named review, not at the grade standing since', async () => {
      const opening = await contest('eb-earlier');
      expect(opening.reviewId).toBe('eb-earlier');

      const enqueuer = new RecordingEnqueuer();
      const result = await enqueueContestRegradeJobOnDispute(enqueuer, opening, [EARLIER, LATER]);

      expect(result).toEqual({ status: 'queued' });
      expect(queuedPayload(enqueuer).originalGradeEventId).toBe('eb-earlier');
    });

    it('a dispute that names no review keeps the standing grade, exactly as before', async () => {
      const opening = await contest();
      expect(Object.hasOwn(opening, 'reviewId')).toBe(false);

      const enqueuer = new RecordingEnqueuer();
      await enqueueContestRegradeJobOnDispute(enqueuer, opening, [EARLIER, LATER]);

      expect(queuedPayload(enqueuer).originalGradeEventId).toBe('eb-later');
    });

    it('a named review the log does not hold enqueues nothing, and never falls back to the standing grade', async () => {
      // The quiz path: the contest names a review that is written only when she
      // moves on, so at enqueue time the name resolves to nothing yet.
      const opening = await contest('review-not-written-yet');

      const enqueuer = new RecordingEnqueuer();
      const result = await enqueueContestRegradeJobOnDispute(enqueuer, opening, [EARLIER, LATER]);

      expect(result).toEqual({ status: 'no-standing-grade' });
      expect(enqueuer.calls).toEqual([]);
    });

    it("a named review that is another instrument's, or carries no explain-back grade, enqueues nothing", async () => {
      const otherInstrument = gradedExplainBackReview({
        eventId: 'eb-other',
        instrumentId: 'instrument-2',
      });
      const ungraded = gradedExplainBackReview({ eventId: 'review-ungraded' });
      delete (ungraded as { explainBackGrade?: unknown }).explainBackGrade;

      const enqueuer = new RecordingEnqueuer();
      const otherResult = await enqueueContestRegradeJobOnDispute(
        enqueuer,
        await contest('eb-other'),
        [EARLIER, LATER, otherInstrument],
      );
      const ungradedResult = await enqueueContestRegradeJobOnDispute(
        enqueuer,
        await contest('review-ungraded'),
        [EARLIER, LATER, ungraded],
      );

      expect(otherResult).toEqual({ status: 'no-standing-grade' });
      expect(ungradedResult).toEqual({ status: 'no-standing-grade' });
      expect(enqueuer.calls).toEqual([]);
    });
  });

  it("a second dispute on the same evidence produces the identical contentHash — idempotent under the engine's own dedup", async () => {
    const vault = memoryVault();
    const port = createVaultGradeContestPort(vault, 'device-1', () => '2026-08-21T09:00:00+02:00');
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });

    const first = await contestRegradeContentHash(opening.eventId);
    const second = await contestRegradeContentHash(opening.eventId);
    expect(first).toBe(second);
  });
});
