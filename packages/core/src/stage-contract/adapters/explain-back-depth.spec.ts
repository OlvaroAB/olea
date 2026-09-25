/**
 * The explain-back depth seam through the Decision contract
 * (`ol-egov.141.89.20`). Seam values come from `gradeSolo` over a stub
 * `SoloJudgeCaller`, and from the production `createWorkerSoloJudgeCaller`
 * over a stub transport for the failure shapes.
 *
 * INV-3: every string here is coined; no real content.
 */

import type { SoloLevel } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  acceptSoloGrading,
  type GradeSoloInput,
  gradeSolo,
  type PendingSoloGrading,
  type SoloJudgeCaller,
} from '../../grading/explainBackSolo.js';
import { createWorkerSoloJudgeCaller } from '../../grading/workerSoloJudgeCaller.js';
import { decisionEnvelopeProblems } from '../decision.js';
import type { StageSeamContext } from '../provenance.js';
import { decisionFromSoloGrading, EXPLAIN_BACK_DEPTH_VOCABULARY } from './explain-back-depth.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'explain-back.solo.v1',
  stamp: null,
  evidenceDigests: [],
};

const input: GradeSoloInput = {
  question: 'Explain how part A relates to part B.',
  studentAnswer: 'A feeds B.',
  sourceMaterial: {
    sourceBlocks: [{ blockId: 'b1', text: 'A feeds B.' }],
    omissionDenominator: null,
    candidateEdgeNomination: null,
  },
  relationExpected: false,
};

function caller(level: SoloLevel): SoloJudgeCaller {
  return async () => ({ soloLevel: level, rationale: 'coined', citedBlockIds: ['b1'] });
}

async function settle(
  run: () => Promise<PendingSoloGrading>,
): Promise<PromiseSettledResult<PendingSoloGrading>> {
  const [settled] = await Promise.allSettled([run()]);
  return settled as PromiseSettledResult<PendingSoloGrading>;
}

describe('decisionFromSoloGrading', () => {
  it('reads each level as the same verdict, carrying the pending grading unchanged', async () => {
    for (const level of EXPLAIN_BACK_DEPTH_VOCABULARY.verdicts) {
      const settled = await settle(() => gradeSolo(input, caller(level)));
      const decision = decisionFromSoloGrading(settled, context);
      if (decision.kind !== 'verdict' || settled.status !== 'fulfilled') {
        throw new Error('expected a verdict');
      }
      expect(decision.verdict).toBe(level);
      expect(decision.payload).toBe(settled.value);
      expect(acceptSoloGrading(decision.payload).soloLevel).toBe(level);
      expect(decisionEnvelopeProblems(decision, EXPLAIN_BACK_DEPTH_VOCABULARY)).toEqual([]);
    }
  });

  it("reads the production caller's failures by the Worker's code", async () => {
    const run = (body: unknown) =>
      settle(() =>
        gradeSolo(input, createWorkerSoloJudgeCaller({ transport: { send: async () => body } })),
      );
    expect(
      decisionFromSoloGrading(
        await run({ ok: false, code: 'quota-exceeded', message: 'c' }),
        context,
      ),
    ).toMatchObject({
      kind: 'unavailable',
      cause: 'service-refused',
      serviceCode: 'quota-exceeded',
    });
    expect(decisionFromSoloGrading(await run({ ok: true, result: {} }), context)).toMatchObject({
      kind: 'unavailable',
      cause: 'malformed',
    });
    expect(
      decisionFromSoloGrading(
        await run({ ok: false, code: 'grounding-refused', message: 'c' }),
        context,
      ),
    ).toMatchObject({ kind: 'undecided', basis: 'nothing-to-decide-from' });
  });

  it('reads any other failure as unavailable call-failed', async () => {
    const settled = await settle(() =>
      gradeSolo(input, async () => {
        throw new Error('network down');
      }),
    );
    const decision = decisionFromSoloGrading(settled, context);
    expect(decision).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
    expect(decisionEnvelopeProblems(decision, EXPLAIN_BACK_DEPTH_VOCABULARY)).toEqual([]);
  });
});
