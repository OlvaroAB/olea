/**
 * `[D-416]` (`ol-egov.141.89.6.63`): the attempt she sets aside with Try again
 * is written to her log as its own content-free record, and the accepted
 * retry's review names the attempt it followed, so the attempt sequence reads
 * back from her log alone.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.9
 * (continued) / [D-416]" — "the attempt she did not accept is written to her
 * log as its own record" and "the accepted retry names the attempt it
 * follows". The writers run against a real in-memory `VaultSource`; the view's
 * wiring is asserted against `modal.ts`'s source with comments stripped
 * (`modal.ts` extends Obsidian's `Modal` and cannot load under Vitest — the
 * same instrument as `modal-answer-after-feedback.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExplainBackPromptContext, PendingExplainBackGrading } from 'olea-core';
import { readReviewLogFile, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  type ExplainBackAttemptSequence,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  createRecordSetAsideAttempt,
  setAsideRecordInput,
} from '../../src/explain-back/set-aside-record.js';
import { recordSoloGradeAndReview } from '../../src/explain-back/solo-review.js';
import type { GradingWiring } from '../../src/grading/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const modal = readFileSync(`${srcDir}explain-back/modal.ts`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;
const JUDGE_STAMP = { promptVersion: 'judge-7', modelId: 'judge-model' };
const AT = new Date('2026-09-28T14:15:00Z');
const DAY = reviewLogPath(
  // The writer files by the timestamp's local calendar day, as every review-log write does.
  (() => {
    const d = AT;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })(),
  'device-a',
);

/** A pending grading carrying only what `setAsideRecordInput` reads; the grading's text never reaches the record. */
function pending(
  outcome: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess',
  { withStamp = true }: { withStamp?: boolean } = {},
): PendingExplainBackGrading {
  const grading =
    outcome === 'unable-to-assess'
      ? { outcome: 'unable-to-assess' }
      : {
          outcome: 'graded',
          verdict: outcome,
          feedback: 'synthetic feedback',
          missedPoints: ['synthetic missed point'],
          citedIssues: [],
          misconceptionCandidates: [],
        };
  return {
    status: 'pending-review',
    grading,
    overlap: {},
    ...(withStamp ? { stamp: JUDGE_STAMP } : {}),
  } as unknown as PendingExplainBackGrading;
}

function setAside(
  sequence: ExplainBackAttemptSequence,
  attemptId: string,
  outcome: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess',
): ExplainBackAttemptSequence {
  return appendSetAsideAttempt(sequence, {
    attemptId,
    outcome:
      outcome === 'unable-to-assess'
        ? { kind: 'unable-to-assess' }
        : { kind: 'graded', verdict: outcome },
    support: sealAttemptSupport(sequence, UNAIDED),
  });
}

function last(sequence: ExplainBackAttemptSequence) {
  const entry = sequence[sequence.length - 1];
  if (entry === undefined) throw new Error('empty sequence');
  return entry;
}

describe('the attempt she did not accept becomes its own record (setAsideRecordInput)', () => {
  it('a first graded attempt: its id, its verdict with the correctness call’s stamp, not-accepted is the writer’s, the rung and the duration', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('partial'),
      durationMs: 42_000,
      at: AT,
    });
    expect(input).toMatchObject({
      instrumentId: 'explain-back:concept-a',
      conceptIds: ['concept-a'],
      attemptId: 'at-1',
      outcome: {
        kind: 'graded',
        verdict: 'partial',
        artifactProvenance: {
          taskId: 'explain-back.judge.v1',
          promptVersion: 'judge-7',
          modelId: 'judge-model',
        },
      },
      supportLevelShown: 'independent',
      durationMs: 42_000,
    });
    // A first attempt follows nothing: no key, never null.
    expect(input).not.toHaveProperty('followsAttemptId');
  });

  it('a second set-aside attempt follows the first and was answered at the guided rung', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('partial'),
      durationMs: null,
      at: AT,
    });
    expect(input?.followsAttemptId).toBe('at-1');
    expect(input?.supportLevelShown).toBe('guided');
    expect(input?.durationMs).toBeNull();
  });

  it('could-not-assess keeps the attempt with no verdict', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('unable-to-assess'),
      durationMs: 5_000,
      at: AT,
    });
    expect(input?.outcome).toEqual({ kind: 'unable-to-assess' });
  });

  it('a verdict whose call surfaced no stamp is kept without one, never with an invented stamp', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'correct');
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('correct', { withStamp: false }),
      durationMs: 5_000,
      at: AT,
    });
    expect(input?.outcome).toEqual({ kind: 'graded', verdict: 'correct' });
  });

  it('an unknown rung is omitted, never written as unaided', () => {
    const sequence = appendSetAsideAttempt(EMPTY_ATTEMPT_SEQUENCE, {
      attemptId: 'at-1',
      outcome: { kind: 'graded', verdict: 'partial' },
      support: sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, null),
    });
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('partial'),
      durationMs: 5_000,
      at: AT,
    });
    expect(input).not.toHaveProperty('supportLevelShown');
  });

  it('a prompt with no subject concept writes nothing, as its accepted retry would write nothing', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(
      setAsideRecordInput({
        instrumentId: 'explain-back:topic-1',
        subjectConceptId: null,
        attempt: last(sequence),
        pending: pending('partial'),
        durationMs: 5_000,
        at: AT,
      }),
    ).toBeNull();
  });

  it('never carries her answer, the feedback or the missed points (D-005)', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    const input = setAsideRecordInput({
      instrumentId: 'explain-back:concept-a',
      subjectConceptId: 'concept-a',
      attempt: last(sequence),
      pending: pending('partial'),
      durationMs: 5_000,
      at: AT,
    });
    expect(JSON.stringify(input)).not.toContain('synthetic');
    expect(Object.keys(input ?? {}).sort()).toEqual(
      [
        'attemptId',
        'conceptIds',
        'durationMs',
        'instrumentId',
        'outcome',
        'supportLevelShown',
        'timestamp',
      ].sort(),
    );
  });
});

describe('the persisted record (createRecordSetAsideAttempt)', () => {
  it('appends one explain-back-set-aside line with acceptance not-accepted, read back as that kind', async () => {
    const vault = memoryVault();
    const write = createRecordSetAsideAttempt({ vault, deviceId: async () => 'device-a' });
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    for (const attempt of sequence) {
      const input = setAsideRecordInput({
        instrumentId: 'explain-back:concept-a',
        subjectConceptId: 'concept-a',
        attempt,
        pending: pending(attempt.outcome.kind === 'graded' ? attempt.outcome.verdict : 'partial'),
        durationMs: 30_000,
        at: AT,
      });
      if (input === null) throw new Error('expected an input');
      await write(input);
    }

    const file = await readReviewLogFile(vault, DAY);
    expect(file.invalidLines).toEqual([]);
    expect(file.records).toHaveLength(2);
    const [first, second] = file.records;
    expect(first).toMatchObject({
      schemaVersion: 6,
      kind: 'explain-back-set-aside',
      attemptId: 'at-1',
      acceptance: 'not-accepted',
      outcome: { kind: 'graded', verdict: 'incorrect' },
      supportLevelShown: 'independent',
    });
    expect(first).not.toHaveProperty('followsAttemptId');
    expect(second).toMatchObject({
      kind: 'explain-back-set-aside',
      attemptId: 'at-2',
      followsAttemptId: 'at-1',
      supportLevelShown: 'guided',
    });
  });
});

describe('the accepted retry names the attempt it follows', () => {
  const CONTEXT: ExplainBackPromptContext = {
    question: 'synthetic question',
    referenceAnswer: 'synthetic reference answer',
    sourceBlocks: [{ blockId: 'blk-1', text: 'synthetic source' }],
    misconceptionDigest: [],
  };

  function wiring(): GradingWiring {
    return {
      judgeCaller: null,
      killedBySustainedAuditFailure: false,
      misconceptionEmbedder: null,
      misconceptionEmbeddingCache: null,
      soloTransport: {
        send: async () => ({
          ok: true,
          stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'solo-test-model' },
          result: { soloLevel: 'relational', rationale: 'synthetic rationale' },
        }),
      },
      acceptedObservationsByAttempt: new Map(),
    };
  }

  function acceptedVerdict() {
    return Promise.resolve({
      status: 'accepted' as const,
      accepted: {
        status: 'accepted' as const,
        verdict: 'correct' as const,
        feedback: 'synthetic feedback',
        missedPoints: [],
        citedIssues: [],
        misconceptionCandidates: [],
        stamp: JUDGE_STAMP,
      },
      observations: [],
    });
  }

  async function acceptRetry(
    followsAttemptId: string | undefined,
    depthPass: 'run' | 'skipped',
    vault = memoryVault(),
  ) {
    const grading = wiring();
    // biome-ignore lint/suspicious/noExplicitAny: the memo's value type is the accept result this test scripts.
    grading.acceptedObservationsByAttempt.set('at-3', acceptedVerdict() as any);
    const outcome = await recordSoloGradeAndReview(
      { grading, vault, deviceId: 'device-a', now: () => AT },
      {
        instrumentId: 'explain-back:concept-a',
        attemptId: 'at-3',
        subjectConceptId: 'concept-a',
        context: CONTEXT,
        answer: 'synthetic answer',
        durationMs: 20_000,
        supportLevelShown: 'guided',
        depthPass,
        ...(followsAttemptId !== undefined ? { followsAttemptId } : {}),
      },
    );
    if (!outcome) throw new Error('expected a written review');
    return outcome.result.record;
  }

  it('the depth-graded review carries followsAttemptId and the guided rung', async () => {
    const record = await acceptRetry('at-2', 'run');
    expect(record.followsAttemptId).toBe('at-2');
    expect(record.supportLevelShown).toBe('guided');
    expect(record.explainBackGrade?.soloLevel).toBe('relational');
  });

  it('the correctness-only review carries it too', async () => {
    const record = await acceptRetry('at-2', 'skipped');
    expect(record.followsAttemptId).toBe('at-2');
    expect(record).not.toHaveProperty('explainBackGrade');
  });

  it('a first attempt’s review carries no link at all', async () => {
    const record = await acceptRetry(undefined, 'run');
    expect(record).not.toHaveProperty('followsAttemptId');
  });

  it('the whole sequence reads back from the log alone: review → last set-aside → first', async () => {
    const vault = memoryVault();
    const write = createRecordSetAsideAttempt({ vault, deviceId: async () => 'device-a' });
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    for (const attempt of sequence) {
      const input = setAsideRecordInput({
        instrumentId: 'explain-back:concept-a',
        subjectConceptId: 'concept-a',
        attempt,
        pending: pending('partial'),
        durationMs: 30_000,
        at: AT,
      });
      if (input !== null) await write(input);
    }
    const sealed = sealAttemptSupport(sequence, UNAIDED);
    await acceptRetry(sealed.followsAttemptId ?? undefined, 'run', vault);

    const { records } = await readReviewLogFile(vault, DAY);
    const setAsides = new Map(
      records.flatMap((r) => (r.kind === 'explain-back-set-aside' ? [[r.attemptId, r]] : [])),
    );
    const review = records.find((r) => r.kind === 'review');
    expect(review?.kind === 'review' && review.supportLevelShown).toBe('guided');
    const chain: string[] = [];
    let next = review?.kind === 'review' ? review.followsAttemptId : undefined;
    while (next !== undefined) {
      chain.push(next);
      next = setAsides.get(next)?.followsAttemptId;
    }
    expect(chain).toEqual(['at-2', 'at-1']);
  });
});

describe('the view writes the set-aside attempt and forwards the link', () => {
  const discard = modal.slice(
    modal.indexOf('private discardGrading('),
    modal.indexOf('private async recordSetAsideAttemptIfPossible('),
  );
  const writer = modal.slice(
    modal.indexOf('private async recordSetAsideAttemptIfPossible('),
    modal.indexOf('private skipPrompt('),
  );

  it('Try again writes the entry it just appended, before the pending grading is discarded', () => {
    expect(discard).toMatch(
      /this\.attemptSequence = appendSetAsideAttempt\([\s\S]*?const setAside = this\.attemptSequence\[this\.attemptSequence\.length - 1\];[\s\S]*?void this\.recordSetAsideAttemptIfPossible\(prompt, pending, setAside, durationMs\);[\s\S]*?discardExplainBackGrading\(pending\);/,
    );
  });

  it('the write is best-effort: an unwired dep writes nothing, a failure is caught and never thrown', () => {
    expect(writer).toMatch(/if \(!this\.deps\.recordSetAsideAttempt\) return;/);
    expect(writer).toMatch(/if \(input === null\) return;/);
    expect(writer).toMatch(
      /try \{\s*await this\.deps\.recordSetAsideAttempt\(input\);\s*\} catch \(error\) \{\s*console\.error\(/,
    );
  });

  it('the write is built from the prompt’s instrument and subject concept, never from her answer', () => {
    expect(writer).toMatch(/instrumentId: prompt\.originInstrumentId,/);
    expect(writer).toMatch(/subjectConceptId: prompt\.subjectConceptId,/);
    expect(writer).not.toMatch(/answer/);
  });

  it('Accept forwards the link sealed at submit, only when there is one', () => {
    expect(modal).toMatch(
      /\.\.\.\(support\.followsAttemptId !== null\s*\?\s*\{ followsAttemptId: support\.followsAttemptId \}\s*: \{\}\)/,
    );
  });
});
