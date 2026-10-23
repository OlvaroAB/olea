/**
 * `ol-egov.141.89.6.95` (ruled Class B): the arms `ol-egov.141.89.6.5` asks for, pinned on the
 * grading path that ships (`main.ts` -> `grading/wiring.ts` `gradeExplainBackAttempt`, and
 * `explain-back/solo-review.ts` -> `gradeSoloAttempt`), after the uncalled Decision-contract
 * variants were removed. Synthetic fixtures only; no `obsidian` import (INV-1).
 *
 *  - (a) an unconfigured, switched-off or unreachable judge is the unavailable or could-not-check
 *    state, never a verdict and never an undecided state;
 *  - (b) a judge that cannot assess never yields a verdict;
 *  - (c) the stored review record carries the correctness stamp and the depth stamp, the depth
 *    stamp read once from the core caller's return value; a depth reply with no usable stamp still
 *    stores a correctness-only record with no depth field;
 *  - the app's composition reaches both calls (source-level, comments stripped, the technique every
 *    sibling spec uses for `main.ts` and `modal.ts`, which cannot be imported under Vitest).
 *
 * **Dormant in v0.9 (`[D-603]`).** The explain-back view is ungraded practice and calls neither: no
 * grading request leaves it (`./practice-no-grading.spec.ts`). This file still pins the graded path
 * as built, and the composition `main.ts` still constructs, so it is intact if grading returns.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExplainBackPromptContext, WorkerTaskRequest } from 'olea-core';
import { readReviewLogFile, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { runGradingAttempt } from '../../src/explain-back/grading-attempt.js';
import { recordSoloGradeAndReview } from '../../src/explain-back/solo-review.js';
import {
  buildGradingWiring,
  type GradingWiring,
  gradeExplainBackAttempt,
  gradeSoloAttempt,
} from '../../src/grading/wiring.js';
import { EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY } from '../../src/settings/explain-back-audit-gate.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import { memoryVault } from '../review/memory-vault.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

function configuredHost(extra: Record<string, unknown> = {}): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [WORKER_CONFIG_STORAGE_KEY]: {
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'synthetic-token',
    },
    ...extra,
  };
  return host;
}

function scriptedTransport(reply: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return reply(request);
    },
  };
}

const GRADE_INPUT = {
  question: 'What is a heap?',
  studentAnswer: 'A tree-shaped structure.',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [],
  misconceptionDigest: [],
};

describe('(a) an unconfigured, switched-off or unreachable judge is unavailable or could-not-check, never a verdict', () => {
  it('no Worker configured: unavailable, and no call is made', async () => {
    const transport = scriptedTransport(() => ({}));
    const wiring = await buildGradingWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => transport,
    });
    const result = await runGradingAttempt({
      grade: (input) => gradeExplainBackAttempt(wiring, input),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    expect(result).toEqual({ kind: 'unavailable' });
    expect(transport.calls).toHaveLength(0);
  });

  it('the sustained-failure switch tripped on a configured Worker: unavailable, and no call is made', async () => {
    const transport = scriptedTransport(() => ({}));
    const wiring = await buildGradingWiring({
      dataHost: configuredHost({
        [EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY]: { version: 1, sustainedFailure: true },
      }),
      createTransport: () => transport,
    });
    const result = await runGradingAttempt({
      grade: (input) => gradeExplainBackAttempt(wiring, input),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    expect(result).toEqual({ kind: 'unavailable' });
    expect(transport.calls).toHaveLength(0);
  });

  it('an unreachable Worker (the transport throws) or a Worker error reply is could-not-check, never graded', async () => {
    const replies: readonly (() => unknown)[] = [
      () => {
        throw new Error('network down');
      },
      () => ({ ok: false, code: 'upstream_error', message: 'down' }),
    ];
    for (const reply of replies) {
      const wiring = await buildGradingWiring({
        dataHost: configuredHost(),
        createTransport: () => scriptedTransport(reply),
      });
      const result = await runGradingAttempt({
        grade: (input) => gradeExplainBackAttempt(wiring, input),
        input: GRADE_INPUT,
        isCurrent: () => true,
      });
      expect(result).toEqual({ kind: 'refused', reason: 'check-failed' });
    }
  });
});

describe('(b) a judge that cannot assess her answer never yields a verdict', () => {
  it('unable-to-assess reaches the pending grading with a reason and no verdict', async () => {
    const wiring = await buildGradingWiring({
      dataHost: configuredHost(),
      createTransport: () =>
        scriptedTransport(() => ({
          ok: true,
          stamp: { contractVersion: 1, promptVersion: '1.2.0', modelId: 'synthetic-judge' },
          result: { outcome: 'unable-to-assess', reason: 'no attempt to grade' },
        })),
    });
    const result = await runGradingAttempt({
      grade: (input) => gradeExplainBackAttempt(wiring, input),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    if (result.kind !== 'graded') throw new Error('expected the pending grading to be handed on');
    expect(result.pending.grading.outcome).toBe('unable-to-assess');
    expect(result.pending.grading).not.toHaveProperty('verdict');
    expect(JSON.stringify(result.pending.grading)).not.toMatch(
      /"verdict"|"(correct|partial|incorrect)"/,
    );
  });
});

const CONTEXT: ExplainBackPromptContext = {
  question: 'What is a heap?',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [{ blockId: 'blk-1', text: 'A heap is a complete binary tree.' }],
  misconceptionDigest: [],
};
const JUDGE_STAMP = { promptVersion: 'judge-7', modelId: 'judge-model' };

function soloWiring(reply: () => unknown): GradingWiring {
  return {
    judgeCaller: null,
    killedBySustainedAuditFailure: false,
    misconceptionEmbedder: null,
    misconceptionEmbeddingCache: null,
    soloTransport: { send: async () => reply() },
    acceptedObservationsByAttempt: new Map(),
  };
}

async function acceptAndRecord(wiring: GradingWiring) {
  const vault = memoryVault();
  wiring.acceptedObservationsByAttempt.set(
    'attempt-1',
    // The memo's value type is the accept result this test scripts.
    Promise.resolve({
      status: 'accepted' as const,
      accepted: {
        status: 'accepted' as const,
        verdict: 'partial' as const,
        feedback: 'Clear on one half.',
        missedPoints: [],
        citedIssues: [],
        misconceptionCandidates: [],
        stamp: JUDGE_STAMP,
      },
      observations: [],
    }) as never,
  );
  const outcome = await recordSoloGradeAndReview(
    { grading: wiring, vault, deviceId: 'device-a', now: () => new Date('2026-08-31T09:00:00Z') },
    {
      instrumentId: 'explain-back:concept-a:1',
      attemptId: 'attempt-1',
      subjectConceptId: 'concept-a',
      context: CONTEXT,
      answer: 'her explanation',
      depthPass: 'run',
    },
  );
  const file = await readReviewLogFile(vault, reviewLogPath('2026-08-31', 'device-a'));
  return { outcome, records: file.records };
}

describe('(c) the stored review record carries the correctness stamp and the depth stamp', () => {
  it('stores exactly the task, prompt version and model id of the depth call, and the correctness call’s own stamp', async () => {
    const { outcome, records } = await acceptAndRecord(
      soloWiring(() => ({
        ok: true,
        // Extra envelope fields must not leak into the stored triple.
        stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'solo-model', extra: 'x' },
        result: { soloLevel: 'relational', rationale: 'Connects both ideas.' },
      })),
    );
    expect(records).toHaveLength(1);
    const record = outcome?.result.record;
    const depth = record?.explainBackGrade?.artifactProvenance;
    expect(depth).toEqual({
      taskId: 'explain-back.solo.v1',
      promptVersion: '1.0.0',
      modelId: 'solo-model',
    });
    expect(Object.keys(depth ?? {}).sort()).toEqual(['modelId', 'promptVersion', 'taskId']);
    expect(record?.explainBackCorrectness?.artifactProvenance).toEqual({
      taskId: 'explain-back.judge.v1',
      ...JUDGE_STAMP,
    });
    expect(outcome).toMatchObject({ depth: 'graded', soloLevel: 'relational' });
  });

  it('the depth transport is asked once, and gradeSoloAttempt returns that call’s stamp as the provenance', async () => {
    let sends = 0;
    const wiring = soloWiring(() => {
      sends += 1;
      return {
        ok: true,
        stamp: { contractVersion: 2, promptVersion: '3.1.0', modelId: 'solo-model-b' },
        result: { soloLevel: 'multistructural', rationale: 'Lists the parts.' },
      };
    });
    const outcome = await gradeSoloAttempt(wiring, {
      question: CONTEXT.question,
      studentAnswer: 'her explanation',
      sourceMaterial: { sourceBlocks: [], omissionDenominator: [], candidateEdgeNomination: null },
      relationExpected: false,
    });
    expect(sends).toBe(1);
    expect(outcome?.artifactProvenance).toEqual({
      taskId: 'explain-back.solo.v1',
      promptVersion: '3.1.0',
      modelId: 'solo-model-b',
    });
  });

  for (const [label, stamp] of [
    ['no stamp', undefined],
    ['an empty model id', { contractVersion: 2, promptVersion: '1.0.0', modelId: '' }],
  ] as const) {
    it(`a depth reply with ${label} still stores a correctness-only record with no depth field`, async () => {
      const { outcome, records } = await acceptAndRecord(
        soloWiring(() => ({
          ok: true,
          ...(stamp !== undefined ? { stamp } : {}),
          result: { soloLevel: 'relational', rationale: 'Connects both ideas.' },
        })),
      );
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        explainBackCorrectness: { verdict: 'partial', artifactProvenance: { ...JUDGE_STAMP } },
      });
      expect(records[0]).not.toHaveProperty('explainBackGrade');
      expect(outcome?.depth).toBe('unavailable');
      expect(outcome).not.toHaveProperty('soloLevel');
    });
  }
});

describe('the app composition still constructs both grading calls (dormant in v0.9: the practice view calls neither)', () => {
  const main = codeOf('main.ts');
  const soloReview = codeOf('explain-back/solo-review.ts');

  it('main.ts: the modal’s grade dependency reaches gradeExplainBackAttempt', () => {
    expect(main).toMatch(
      /async gradeExplainBackAttempt\([\s\S]*?\)\s*:\s*Promise<PendingExplainBackGrading \| null>\s*\{[\s\S]*?return gradeExplainBackAttempt\(this\.grading, input\);/,
    );
    expect(main).toMatch(/grade: \(input\) => this\.gradeExplainBackAttempt\(input\)/);
  });

  it('main.ts: the modal’s record dependency reaches recordSoloGradeAndReview, which reaches gradeSoloAttempt', () => {
    expect(main).toMatch(
      /recordSoloGradeAndReview: \(params\) => this\.recordExplainBackSoloGradeAndReview\(params\)/,
    );
    expect(main).toMatch(/await recordSoloGradeAndReview\(/);
    expect(soloReview).toMatch(/outcome = await gradeSoloAttempt\(deps\.grading, soloInput\)/);
  });

  it('the removed Decision variants stay removed', () => {
    const wiring = codeOf('grading/wiring.ts');
    expect(wiring).not.toMatch(/gradeExplainBackAttemptDecision|gradeSoloAttemptDecision/);
  });
});
