/**
 * `recordSoloGradeAndReview` tests (`ol-cqz8`) — the composition
 * `ExplainBackModal`'s accept flow calls to run the SOLO depth pipeline and
 * append the subject's own review-log event. Runs against a real, in-memory
 * `VaultSource` (`../review/memory-vault.js`) and a hand-built `GradingWiring`
 * — no `obsidian` import anywhere in this file (INV-1).
 */

import type { ExplainBackPromptContext, WorkerTaskRequest } from 'olea-core';
import { readContentRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type RecordSoloGradeAndReviewOutcome,
  recordSoloGradeAndReview,
} from '../../src/explain-back/solo-review.js';
import type { GradingWiring } from '../../src/grading/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const CONTEXT: ExplainBackPromptContext = {
  question: 'What is a heap?',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [{ blockId: 'blk-1', text: 'A heap is a complete binary tree...' }],
  misconceptionDigest: [],
};

/** A `GradingWiring` whose `soloTransport` answers `explain-back.solo.v1` with a scripted grading. */
function wiringWithSoloReply(
  reply: (request: WorkerTaskRequest) => unknown = () => ({
    ok: true,
    stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'solo-test-model' },
    result: { soloLevel: 'relational', rationale: 'Connects both ideas under one principle.' },
  }),
): GradingWiring {
  return {
    judgeCaller: null,
    killedBySustainedAuditFailure: false,
    misconceptionEmbedder: null,
    misconceptionEmbeddingCache: null,
    soloTransport: { send: async (request) => reply(request) },
  };
}

const UNCONFIGURED_WIRING: GradingWiring = {
  judgeCaller: null,
  killedBySustainedAuditFailure: false,
  misconceptionEmbedder: null,
  misconceptionEmbeddingCache: null,
  soloTransport: null,
};

describe('recordSoloGradeAndReview — honest skips, never a fabricated write', () => {
  it('returns undefined and writes nothing when subjectConceptId is null (free-form entry, no resolved concept)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const result = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:00:00Z') },
      {
        instrumentId: 'explain-back:topic:1',
        subjectConceptId: null,
        context: CONTEXT,
        answer: 'her explanation',
      },
    );

    expect(result).toBeUndefined();
    expect(vault.writes).toEqual([]);
  });

  it('returns undefined and writes nothing when the Worker is unconfigured (F7.8 grey-out)', async () => {
    const vault = memoryVault();

    const result = await recordSoloGradeAndReview(
      {
        grading: UNCONFIGURED_WIRING,
        vault,
        deviceId: 'device-a',
        now: () => new Date('2026-08-31T09:00:00Z'),
      },
      {
        instrumentId: 'explain-back:heap:1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'her explanation',
      },
    );

    expect(result).toBeUndefined();
    expect(vault.writes).toEqual([]);
  });

  it('returns undefined and writes nothing when the Worker response carries no D7.3 stamp', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply(() => ({
      ok: true,
      result: { soloLevel: 'relational', rationale: 'Connects both ideas under one principle.' },
    }));

    const result = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:00:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'her explanation',
      },
    );

    expect(result).toBeUndefined();
    expect(vault.writes).toEqual([]);
  });
});

describe('recordSoloGradeAndReview — the real write, one review event', () => {
  it('mints a real contentRef, appends ONE review-kind event carrying rating:null and explainBackGrade', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome: RecordSoloGradeAndReviewOutcome | undefined = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    const { result } = outcome;
    // `ol-iti2`: the outcome surfaces the graded level directly, not just
    // buried in `result.record.explainBackGrade` — this is what `main.ts`'s
    // wrapper forwards on to `modal.ts`'s `[D-217]` depth heading.
    expect(outcome.soloLevel).toBe('relational');
    expect(result.record.kind).toBe('review');
    expect(result.record.instrumentType).toBe('explain-back');
    expect(result.record.rating).toBeNull();
    expect(result.record.conceptIds).toEqual(['concept-heap']);
    expect(result.record.explainBackGrade?.soloLevel).toBe('relational');
    expect(result.record.explainBackGrade?.artifactProvenance).toEqual({
      taskId: 'explain-back.solo.v1',
      promptVersion: '1.0.0',
      modelId: 'solo-test-model',
    });
    // schedulingObservation is absent — concept-only, relationExpected always false.
    expect(result.record.schedulingObservation).toBeUndefined();

    // Exactly one review-log write and one content-store write — never a
    // second event for the correctness verdict (this module's own "ONE
    // EVENT, NOT TWO" design-question answer).
    expect(vault.writes).toHaveLength(2);

    const contentRef = result.record.explainBackGrade?.contentRef;
    if (!contentRef) throw new Error('expected a contentRef');
    const content = await readContentRecord(vault, contentRef);
    expect(content.status).toBe('found');
    if (content.status === 'found') {
      expect(content.record.studentAnswer).toBe(
        'A heap is a complete binary tree obeying the heap property.',
      );
    }
  });
});

describe('recordSoloGradeAndReview — durationMs (ol-yj0k)', () => {
  it('persists the caller-supplied durationMs (modal.ts times presentation-to-submit; this module only relays it)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
        durationMs: 41_500,
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.durationMs).toBe(41_500);
  });

  it('relays null, never a guessed number, when the caller supplies no durationMs', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.durationMs).toBeNull();
  });
});
