/**
 * `evaluateItemValidationTrigger` / `checkItemValidation` — F2.23's mismatch
 * trigger and defect-evidence list (`[D-265]`, ruling 3).
 *
 * Mirrors `features/F2-review.md`'s
 * `Feature: F2.23 — item validation: a mismatch may flag an item, and only
 * the existing defect routes move eligibility` scenario cluster.
 *
 * INV-3: every string here is coined. No course code, note title or wording
 * comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Clock } from '../../ingestion/types.js';
import { checkItemValidation, evaluateItemValidationTrigger } from './item-validation.js';
import type {
  ItemValidationJudgeInput,
  ItemValidationJudgePort,
  ItemValidationJudgeVerdict,
  SameClaimMismatchInput,
} from './types.js';

const clock: Clock = { now: () => 9_000 };

function stubJudge(verdict: ItemValidationJudgeVerdict): ItemValidationJudgePort {
  return { judge: async () => verdict };
}

const judgeInput: ItemValidationJudgeInput = {
  instrumentText: 'Which process releases stored energy along a fault line?',
  citedSourceText: 'Stored elastic energy is released along a fault during rupture.',
};

const baseMismatch: SameClaimMismatchInput = {
  harderInstrumentId: 'inst-harder',
  harderOutcome: 'strong',
  easierInstrumentId: 'inst-easier',
  easierOutcome: 'failed',
  sameDay: true,
  sameClaim: true,
};

describe('evaluateItemValidationTrigger', () => {
  it('does not trigger an ordinary lapse with no mismatch evidence at all', () => {
    const outcome = evaluateItemValidationTrigger({
      ...baseMismatch,
      harderOutcome: 'failed',
    });
    expect(outcome).toEqual({ kind: 'no-trigger' });
  });

  it('triggers a check on a same-day, same-claim mismatch: harder strong, easier failed', () => {
    const outcome = evaluateItemValidationTrigger(baseMismatch);
    expect(outcome).toEqual({ kind: 'check-warranted', suspectInstrumentId: 'inst-easier' });
  });

  it('does not trigger when the instruments do not concern the same claim', () => {
    const outcome = evaluateItemValidationTrigger({ ...baseMismatch, sameClaim: false });
    expect(outcome).toEqual({ kind: 'no-trigger' });
  });

  it('does not trigger when the outcomes are not from the same day', () => {
    const outcome = evaluateItemValidationTrigger({ ...baseMismatch, sameDay: false });
    expect(outcome).toEqual({ kind: 'no-trigger' });
  });

  it('does not trigger when both instruments merely stayed strong', () => {
    const outcome = evaluateItemValidationTrigger({ ...baseMismatch, easierOutcome: 'strong' });
    expect(outcome).toEqual({ kind: 'no-trigger' });
  });
});

describe('checkItemValidation', () => {
  it('reports no-trigger without calling the judge when the precondition does not hold', async () => {
    let called = false;
    const judge: ItemValidationJudgePort = {
      judge: async () => {
        called = true;
        return { suspected: true, kind: 'key-conflicts-with-source' };
      },
    };
    const outcome = await checkItemValidation(
      { ...baseMismatch, sameClaim: false },
      judgeInput,
      judge,
      clock,
    );
    expect(outcome).toEqual({ kind: 'no-trigger' });
    expect(called).toBe(false);
  });

  it('reports judge-unavailable when the precondition holds but no judge is configured', async () => {
    const outcome = await checkItemValidation(baseMismatch, judgeInput, null, clock);
    expect(outcome).toEqual({ kind: 'judge-unavailable' });
  });

  it('reports not-suspected when the judge finds no defect', async () => {
    const outcome = await checkItemValidation(
      baseMismatch,
      judgeInput,
      stubJudge({ suspected: false }),
      clock,
    );
    expect(outcome).toEqual({ kind: 'not-suspected' });
  });

  it('reports not-suspected when the judge marks suspected but supplies no kind', async () => {
    const outcome = await checkItemValidation(
      baseMismatch,
      judgeInput,
      stubJudge({ suspected: true }),
      clock,
    );
    expect(outcome).toEqual({ kind: 'not-suspected' });
  });

  it('proposes one of the five defect kinds when the judge suspects a defect, and never decides it', async () => {
    const outcome = await checkItemValidation(
      baseMismatch,
      judgeInput,
      stubJudge({
        suspected: true,
        kind: 'stem-satisfied-by-multiple-options',
        reason: 'two distractors both satisfy the stem',
      }),
      clock,
    );
    expect(outcome).toEqual({
      kind: 'proposed',
      proposal: {
        instrumentId: 'inst-easier',
        kind: 'stem-satisfied-by-multiple-options',
        at: 9_000,
        reason: 'two distractors both satisfy the stem',
      },
    });
  });

  it('a proposal names the ITEM, never the student — no field on the outcome carries anything about her', async () => {
    const outcome = await checkItemValidation(
      baseMismatch,
      judgeInput,
      stubJudge({ suspected: true, kind: 'corrupted-prompt-or-source' }),
      clock,
    );
    expect(outcome.kind).toBe('proposed');
    if (outcome.kind === 'proposed') {
      expect(Object.keys(outcome.proposal).sort()).toEqual([
        'at',
        'instrumentId',
        'kind',
        'reason',
      ]);
    }
  });
});
