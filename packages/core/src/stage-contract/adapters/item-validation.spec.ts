/**
 * The item-validation seam (F2.23) through the Decision contract
 * (`ol-egov.141.89.20`), with seam values from `checkItemValidation` over
 * stub judges.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { checkItemValidation } from '../../concept/revision/item-validation.js';
import type {
  ItemValidationJudgePort,
  ItemValidationJudgeVerdict,
  SameClaimMismatchInput,
} from '../../concept/revision/types.js';
import type { Clock } from '../../ingestion/types.js';
import { decisionEnvelopeProblems } from '../decision.js';
import type { StageSeamContext } from '../provenance.js';
import { decisionFromItemValidation, ITEM_VALIDATION_VOCABULARY } from './item-validation.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'item.validate.example',
  stamp: null,
  evidenceDigests: [],
};

const clock: Clock = { now: () => 9_000 };

const mismatch: SameClaimMismatchInput = {
  harderInstrumentId: 'hard-1',
  harderOutcome: 'strong',
  easierInstrumentId: 'easy-1',
  easierOutcome: 'failed',
  sameDay: true,
  sameClaim: true,
};

const judgeInput = { instrumentText: 'coined item', citedSourceText: 'coined source' };

function judge(verdict: ItemValidationJudgeVerdict): ItemValidationJudgePort {
  return { judge: async () => verdict };
}

describe('decisionFromItemValidation', () => {
  it('reads a proposal as suspected, carrying the proposal unchanged', async () => {
    const outcome = await checkItemValidation(
      mismatch,
      judgeInput,
      judge({ suspected: true, kind: 'key-conflicts-with-source', reason: 'coined' }),
      clock,
    );
    const decision = decisionFromItemValidation(outcome, context);
    expect(outcome.kind).toBe('proposed');
    expect(decision).toMatchObject({
      kind: 'verdict',
      verdict: 'suspected',
      payload: outcome.kind === 'proposed' ? outcome.proposal : null,
    });
    expect(decisionEnvelopeProblems(decision, ITEM_VALIDATION_VOCABULARY)).toEqual([]);
  });

  it('reads not-suspected as a verdict and a missing judge as unavailable', async () => {
    const clear = await checkItemValidation(
      mismatch,
      judgeInput,
      judge({ suspected: false }),
      clock,
    );
    const noJudge = await checkItemValidation(mismatch, judgeInput, null, clock);
    expect(decisionFromItemValidation(clear, context)).toMatchObject({
      kind: 'verdict',
      verdict: 'not-suspected',
      payload: null,
    });
    expect(decisionFromItemValidation(noJudge, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'not-configured',
    });
  });

  it('returns null when the precondition did not hold: no decision was asked for', async () => {
    const lapse = await checkItemValidation(
      { ...mismatch, sameDay: false },
      judgeInput,
      judge({ suspected: true, kind: 'superseded-material' }),
      clock,
    );
    expect(lapse.kind).toBe('no-trigger');
    expect(decisionFromItemValidation(lapse, context)).toBeNull();
  });
});
