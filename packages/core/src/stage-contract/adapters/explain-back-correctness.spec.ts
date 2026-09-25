/**
 * The explain-back correctness seam through the Decision contract
 * (`ol-egov.141.89.20`). Seam values come from the seam itself:
 * `gradeExplainBack` over a stub `JudgeCaller`, and the production
 * `createWorkerJudgeCaller` over a stub transport for each failure shape.
 * No behaviour change: the verdict payload is the seam's own pending grading,
 * the same object, and the seam's accept step still takes it.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import {
  acceptExplainBackGrading,
  type ExplainBackGradingWireResponse,
  type GradeExplainBackInput,
  gradeExplainBack,
  type JudgeCaller,
  type PendingExplainBackGrading,
} from '../../grading/gradingPipeline.js';
import { createWorkerJudgeCaller } from '../../grading/workerJudgeCaller.js';
import { decisionEnvelopeProblems } from '../decision.js';
import type { StageSeamContext } from '../provenance.js';
import {
  decisionFromExplainBackGrading,
  EMPTY_REFERENCE_ANSWER_RULE,
  EXPLAIN_BACK_CORRECTNESS_VOCABULARY,
} from './explain-back-correctness.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'explain-back.judge.v1',
  stamp: { promptVersion: 'judge-prompt-1', modelId: 'judge-model' },
  evidenceDigests: ['context-digest-1'],
};

const input: GradeExplainBackInput = {
  question: 'Why does effect B follow cause A?',
  studentAnswer: 'Because A raises B through step C.',
  referenceAnswer: 'A raises B through step C.',
  sourceBlocks: [{ blockId: 'b1', text: 'A raises B through step C.' }],
  misconceptionDigest: [],
};

function wire(verdict: ExplainBackGradingWireResponse['verdict']): ExplainBackGradingWireResponse {
  return {
    verdict,
    feedback: 'Coined feedback.',
    missedPoints: [],
    citedIssues: [{ kind: 'omission', description: 'coined', sourceBlockIds: ['b1', 'ghost'] }],
    misconceptionCandidates: [],
  };
}

function caller(response: ExplainBackGradingWireResponse): JudgeCaller {
  return async () => response;
}

function transportReturning(body: unknown) {
  return { send: async () => body };
}

async function settle(
  run: () => Promise<PendingExplainBackGrading>,
): Promise<PromiseSettledResult<PendingExplainBackGrading>> {
  const [settled] = await Promise.allSettled([run()]);
  return settled as PromiseSettledResult<PendingExplainBackGrading>;
}

describe('decisionFromExplainBackGrading', () => {
  it('reads each seam verdict as the same verdict, carrying the pending grading unchanged', async () => {
    for (const verdict of ['correct', 'partial', 'incorrect'] as const) {
      const settled = await settle(() => gradeExplainBack(input, caller(wire(verdict))));
      const decision = decisionFromExplainBackGrading(settled, context);
      expect(decision.kind).toBe('verdict');
      if (decision.kind !== 'verdict' || settled.status !== 'fulfilled')
        throw new Error('unreachable');
      expect(decision.verdict).toBe(verdict);
      expect(decision.payload).toBe(settled.value);
      expect(decision.payload.status).toBe('pending-review');
      expect(acceptExplainBackGrading(decision.payload).verdict).toBe(verdict);
      expect(decision.provenance.producer).toEqual({
        kind: 'model',
        seat: 'candidate',
        taskId: 'explain-back.judge.v1',
        stamp: { promptVersion: 'judge-prompt-1', modelId: 'judge-model' },
      });
    }
  });

  it('reads an empty reference answer as undecided by code: nothing to grade against, nothing about her', async () => {
    const settled = await settle(() =>
      gradeExplainBack({ ...input, referenceAnswer: '  ' }, caller(wire('correct'))),
    );
    expect(decisionFromExplainBackGrading(settled, context)).toEqual({
      kind: 'undecided',
      basis: 'nothing-to-decide-from',
      provenance: {
        producer: { kind: 'code', rule: EMPTY_REFERENCE_ANSWER_RULE },
        evidenceDigests: ['context-digest-1'],
      },
    });
  });

  it("reads the production caller's failures as unavailable, keeping the Worker's code", async () => {
    const refused = await settle(() =>
      gradeExplainBack(
        input,
        createWorkerJudgeCaller({
          transport: transportReturning({ ok: false, code: 'upstream-error', message: 'coined' }),
        }),
      ),
    );
    expect(decisionFromExplainBackGrading(refused, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'service-refused',
      serviceCode: 'upstream-error',
      provenance: { producer: { stamp: null } },
    });

    const malformed = await settle(() =>
      gradeExplainBack(
        input,
        createWorkerJudgeCaller({ transport: transportReturning({ ok: true, result: {} }) }),
      ),
    );
    expect(decisionFromExplainBackGrading(malformed, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'malformed',
    });

    const down = await settle(() =>
      gradeExplainBack(
        input,
        createWorkerJudgeCaller({
          transport: {
            send: async () => {
              throw new Error('network down');
            },
          },
        }),
      ),
    );
    expect(decisionFromExplainBackGrading(down, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'call-failed',
    });
  });

  it('reads a grounding refusal from the Worker as undecided, never as an outage', async () => {
    const settled = await settle(() =>
      gradeExplainBack(
        input,
        createWorkerJudgeCaller({
          transport: transportReturning({ ok: false, code: 'grounding-refused', message: 'c' }),
        }),
      ),
    );
    expect(decisionFromExplainBackGrading(settled, context)).toMatchObject({
      kind: 'undecided',
      basis: 'nothing-to-decide-from',
    });
  });

  it('produces a well-formed envelope for every seam value', async () => {
    const settledValues = [
      await settle(() => gradeExplainBack(input, caller(wire('partial')))),
      await settle(() =>
        gradeExplainBack({ ...input, referenceAnswer: '' }, caller(wire('correct'))),
      ),
      { status: 'rejected', reason: new Error('x') } as const,
    ];
    for (const settled of settledValues) {
      const decision = decisionFromExplainBackGrading(settled, context);
      expect(decisionEnvelopeProblems(decision, EXPLAIN_BACK_CORRECTNESS_VOCABULARY)).toEqual([]);
    }
  });
});
