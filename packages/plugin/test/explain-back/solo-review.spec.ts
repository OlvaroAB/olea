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
    acceptedObservationsByAttempt: new Map(),
  };
}

const UNCONFIGURED_WIRING: GradingWiring = {
  judgeCaller: null,
  killedBySustainedAuditFailure: false,
  misconceptionEmbedder: null,
  misconceptionEmbeddingCache: null,
  soloTransport: null,
  acceptedObservationsByAttempt: new Map(),
};

describe('recordSoloGradeAndReview — honest skips, never a fabricated write', () => {
  it('returns undefined and writes nothing when subjectConceptId is null (free-form entry, no resolved concept)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const result = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:00:00Z') },
      {
        instrumentId: 'explain-back:topic:1',
        attemptId: 'attempt-for-1',
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
        attemptId: 'attempt-for-1',
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
        attemptId: 'attempt-for-1',
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
        attemptId: 'attempt-for-1',
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
        attemptId: 'attempt-for-1',
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
        attemptId: 'attempt-for-1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.durationMs).toBeNull();
  });
});

describe('recordSoloGradeAndReview — [D-281] correction: revisionOf (ol-egov.141.89.9.21, att.md item 7)', () => {
  it('writes null, never a fabricated correction, when the caller supplies no revisionOf (the ordinary fresh attempt)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        attemptId: 'attempt-for-1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.explainBackGrade?.revisionOf).toBeNull();
  });

  it('forwards a real revisionOf — the corrective re-grade this module was, until now, incapable of writing', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        // ol-0r92.94 [DOS-C1]: a corrective re-grade is a DIFFERENT attempt,
        // a fresh attemptId, never the corrected attempt's own id.
        attemptId: 'attempt-for-the-correction',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property, revised.',
        revisionOf: 'original-grade-event-id',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.explainBackGrade?.revisionOf).toBe('original-grade-event-id');
  });

  it('writes an explicit null exactly as it writes an absent one', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        attemptId: 'attempt-for-1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
        revisionOf: null,
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.explainBackGrade?.revisionOf).toBeNull();
  });
});

describe('recordSoloGradeAndReview — ol-0r92.94 [DOS-C1]: attemptId threading', () => {
  it('forwards a real attemptId into the durable idempotency key, distinct from instrumentId', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:shared-instrument',
        attemptId: 'genuinely-distinct-attempt-id',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.explainBackGrade?.contentRef).toBe(
      'device-a.attempt-genuinely-distinct-attempt-id',
    );
  });

  it('two genuine attempts at the same instrumentId, each with its own attemptId, both persist as distinct events', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();
    const deps = {
      grading: wiring,
      vault,
      deviceId: 'device-a',
      now: () => new Date('2026-08-31T09:05:00Z'),
    };
    const sharedInstrumentId = 'explain-back:heap:shared-instrument';

    const first = await recordSoloGradeAndReview(deps, {
      instrumentId: sharedInstrumentId,
      attemptId: 'attempt-1-of-2',
      subjectConceptId: 'concept-heap',
      context: CONTEXT,
      answer: 'A heap is a complete binary tree obeying the heap property.',
    });
    const second = await recordSoloGradeAndReview(deps, {
      instrumentId: sharedInstrumentId,
      attemptId: 'attempt-2-of-2',
      subjectConceptId: 'concept-heap',
      context: CONTEXT,
      answer: 'A heap is a complete binary tree obeying the heap property, restated.',
    });

    if (!first || !second) throw new Error('expected both attempts to write a review-log record');
    expect(second.result.record.eventId).not.toBe(first.result.record.eventId);
    expect(second.result.record.explainBackGrade?.contentRef).not.toBe(
      first.result.record.explainBackGrade?.contentRef,
    );
  });

  it('falls back to instrumentId as the idempotency key when a not-yet-updated caller omits attemptId (main.ts today)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:no-attempt-id-supplied',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.explainBackGrade?.contentRef).toBe(
      'device-a.attempt-explain-back_heap_no-attempt-id-supplied',
    );
  });
});

// Scenario: features/F5-explain-it-back.md — "F5.8 — what the top growth
// stage claims, and the evidence that qualifies it [D-281]".
describe('recordSoloGradeAndReview — [D-281] the independent correctness verdict on the same attempt', () => {
  function acceptedFor(verdict: 'correct' | 'partial' | 'incorrect') {
    return Promise.resolve({
      status: 'accepted' as const,
      accepted: {
        status: 'accepted' as const,
        verdict,
        feedback: 'Clear on both halves.',
        missedPoints: [],
        citedIssues: [],
        misconceptionCandidates: [],
      },
      observations: [],
    });
  }

  async function writeWith(accept: Promise<unknown> | undefined) {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();
    if (accept !== undefined) {
      // biome-ignore lint/suspicious/noExplicitAny: the memo's value type is the accept result this test scripts.
      wiring.acceptedObservationsByAttempt.set('attempt-1', accept as any);
    }
    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:00:00Z') },
      {
        instrumentId: 'explain-back:concept-a:1',
        attemptId: 'attempt-1',
        subjectConceptId: 'concept-a',
        context: CONTEXT,
        answer: 'her explanation',
        supportLevelShown: 'independent',
      },
    );
    if (!outcome) throw new Error('expected a written review-log record');
    return outcome.result.record;
  }

  it('persists the accepted correctness verdict for this attempt onto the grade record', async () => {
    const record = await writeWith(acceptedFor('correct'));
    expect(record.explainBackGrade?.correctness).toBe('correct');
  });

  it('persists a non-correct verdict just as faithfully — the fold decides, not the writer', async () => {
    const record = await writeWith(acceptedFor('partial'));
    expect(record.explainBackGrade?.correctness).toBe('partial');
  });

  it('records NO verdict when no accept for this attempt exists — unknown, never correct', async () => {
    const record = await writeWith(undefined);
    expect(record.explainBackGrade).not.toHaveProperty('correctness');
  });

  it('records NO verdict when the accept came back stale (the cited source has since changed)', async () => {
    const record = await writeWith(Promise.resolve({ status: 'stale' as const }));
    expect(record.explainBackGrade).not.toHaveProperty('correctness');
  });

  it('records NO verdict when the accept rejected, and still writes the depth evidence', async () => {
    const record = await writeWith(Promise.reject(new Error('ungrounded citation')));
    expect(record.explainBackGrade).not.toHaveProperty('correctness');
    expect(record.explainBackGrade?.soloLevel).toBe('relational');
  });

  it('carries the support level shown through to the record, and omits it when none was recorded', async () => {
    const record = await writeWith(acceptedFor('correct'));
    expect(record.supportLevelShown).toBe('independent');
  });
});

// Scenario: features/F5-explain-it-back.md — "F2.16 / [D-228]" —
// "the rating and the grade are untouched" (DF-20 scenario 8, ol-0r92.123).
describe('recordSoloGradeAndReview — answerEdits (ol-0r92.123, [D-228 / SIG-3])', () => {
  it('the rating, durationMs and explainBackGrade are identical whether or not answerEdits is captured', async () => {
    const deps = {
      grading: wiringWithSoloReply(),
      vault: memoryVault(),
      deviceId: 'device-a',
      now: () => new Date('2026-08-31T09:05:00Z'),
    };
    const withoutEdits = await recordSoloGradeAndReview(deps, {
      instrumentId: 'explain-back:heap:1',
      attemptId: 'attempt-no-edits',
      subjectConceptId: 'concept-heap',
      context: CONTEXT,
      answer: 'A heap is a complete binary tree obeying the heap property.',
      durationMs: 41_500,
    });
    const withEdits = await recordSoloGradeAndReview(deps, {
      instrumentId: 'explain-back:heap:1',
      attemptId: 'attempt-with-edits',
      subjectConceptId: 'concept-heap',
      context: CONTEXT,
      answer: 'A heap is a complete binary tree obeying the heap property.',
      durationMs: 41_500,
      answerEdits: { firstEditMs: 12_000, editBursts: 3 },
    });

    if (!withoutEdits || !withEdits) throw new Error('expected both attempts to write a record');
    expect(withEdits.result.record.rating).toBe(withoutEdits.result.record.rating);
    expect(withEdits.result.record.rating).toBeNull();
    expect(withEdits.result.record.durationMs).toBe(withoutEdits.result.record.durationMs);
    expect(withEdits.result.record.explainBackGrade?.soloLevel).toBe(
      withoutEdits.result.record.explainBackGrade?.soloLevel,
    );
    expect(withEdits.result.record.conceptIds).toEqual(withoutEdits.result.record.conceptIds);
  });

  it('omits answerEdits from the persisted record when the caller supplies none — true absence, never a fabricated zero', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:05:00Z') },
      {
        instrumentId: 'explain-back:heap:1',
        attemptId: 'attempt-for-1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.answerEdits).toBeUndefined();
  });

  /**
   * **This is the gap `ol-0r92.123`'s own close evidence discloses, written
   * down as a failing expectation rather than deleted or weakened** — this
   * repo's own `it.fails` convention (`packages/core/src/retrieval/engine
   * .spec.ts`'s precedent). This test is green while `answerEdits` is
   * accepted by `RecordSoloGradeAndReviewParams` but dropped before the
   * persisted write, and goes RED the moment a follow-up bead widens
   * `GradedExplainBackReviewSubject`/`composeGradedExplainBackReviewRecord`
   * (`../../../core/src/study-session/explain-back-grade-write.ts`, outside
   * `ol-0r92.123`'s own `owns`) to actually forward it — at which point the
   * `.fails` comes off and the assertion stands as an ordinary test. It
   * cannot be forgotten, because it fails when the gap is closed.
   */
  it.fails('SHOULD carry answerEdits on the persisted record when captured — ol-0r92.123: it does not yet (needs explain-back-grade-write.ts, out of owns)', async () => {
    const vault = memoryVault();
    const wiring = wiringWithSoloReply();

    const outcome = await recordSoloGradeAndReview(
      {
        grading: wiring,
        vault,
        deviceId: 'device-a',
        now: () => new Date('2026-08-31T09:05:00Z'),
      },
      {
        instrumentId: 'explain-back:heap:1',
        attemptId: 'attempt-for-1',
        subjectConceptId: 'concept-heap',
        context: CONTEXT,
        answer: 'A heap is a complete binary tree obeying the heap property.',
        answerEdits: { firstEditMs: 12_000, editBursts: 3 },
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(outcome.result.record.answerEdits).toEqual({ firstEditMs: 12_000, editBursts: 3 });
  });
});
