/**
 * `enqueueContestRegradeJobOnDispute` — the moment-of-dispute half of
 * `[D-360]`'s queued regrading workflow.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import type { EnqueueResult } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultGradeContestPort } from '../../src/review/contest.js';
import {
  CONTEST_REGRADE_JOB_KIND,
  type ContestRegradeJobPayload,
} from '../../src/contest-regrade/types.js';
import {
  type ContestRegradeJobEnqueuer,
  contestRegradeContentHash,
  enqueueContestRegradeJobOnDispute,
} from '../../src/contest-regrade/enqueue.js';
import { memoryVault } from '../review/memory-vault.js';

// Synthetic fixtures only (INV-3).
const INSTRUMENT = 'instrument-1';
const CONCEPTS = ['concept-a'];

function gradedExplainBackReview(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
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
      schemaVersion: 5,
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

  it('a second dispute on the same evidence produces the identical contentHash — idempotent under the engine\'s own dedup', async () => {
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
