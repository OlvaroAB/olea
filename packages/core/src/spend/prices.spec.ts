/**
 * The declared per-call price ceilings and holds (`[D-540]`, `ol-egov.141.89.7.76`). Scenario: F4.1,
 * "each call is sent with its hold as the remaining allowance" (the hold half). The figures are the
 * service paper's (`docs/direction/papers/examiner-scope-status/11-driver-cost.md` sections 3, 9.4).
 */

import { describe, expect, it } from 'vitest';
import {
  BILLABLE_CALLS_PER_REQUEST,
  DECLARED_INPUT_OVERBOUND_TOKENS,
  holdUsdFor,
  inputBoundTokens,
  isSpendTaskId,
  perCallCeilingUsd,
  SCOPE_READING_PAUSE_FRACTION,
  SPEND_LIMIT_USD,
  SPEND_PERIOD_DAYS,
  SPEND_TASK_IDS,
  SPEND_TASK_PRICES,
  toMicroUsd,
  WORST_CASE_HOLD_USD,
} from './prices.js';

/** The service's system prompts at the versions the allowances were declared from (characters). */
const SYSTEM_PROMPT_CHARS = {
  'demand.classify.v1': 4_430,
  'outcomes.align.v1': 5_920,
  'outcomes.extract.v1': 9_751,
} as const;

describe('the declared limit', () => {
  it('is USD 12 over a rolling 120 days, the scope reads pausing at 80 percent, two billable calls per request', () => {
    expect(SPEND_LIMIT_USD).toBe(12);
    expect(SPEND_LIMIT_USD * SCOPE_READING_PAUSE_FRACTION).toBeCloseTo(9.6, 10);
    expect(SPEND_PERIOD_DAYS).toBe(120);
    expect(BILLABLE_CALLS_PER_REQUEST).toBe(2);
    expect(DECLARED_INPUT_OVERBOUND_TOKENS).toBe(20_000);
  });
});

describe('per-call price ceilings', () => {
  it('match the paper at the 20k-token input overbound: demand 0.0223, alignment 0.0776', () => {
    expect(perCallCeilingUsd('demand.classify.v1')).toBeCloseTo(0.0223, 4);
    expect(perCallCeilingUsd('outcomes.align.v1')).toBeCloseTo(0.0776, 4);
    expect(perCallCeilingUsd('demand.classify.v1')).toBeCloseTo(0.022288, 9);
    expect(perCallCeilingUsd('outcomes.align.v1')).toBeCloseTo(0.077584, 9);
  });

  it('price outcome extraction on the bulk slot at its 94,208-token ceiling, about 0.057 for two calls in output', () => {
    const extract = SPEND_TASK_PRICES['outcomes.extract.v1'];
    expect(extract.slot).toBe('G');
    expect((2 * extract.outputCeilingTokens * extract.outputUsdPerMillionTokens) / 1e6).toBeCloseTo(
      0.057,
      3,
    );
    expect(perCallCeilingUsd('outcomes.extract.v1')).toBeCloseTo(0.0302624, 9);
  });

  it('only the scope reads pause at 80 percent', () => {
    expect(SPEND_TASK_PRICES['demand.classify.v1'].pausesForScopeReading).toBe(true);
    expect(SPEND_TASK_PRICES['outcomes.align.v1'].pausesForScopeReading).toBe(true);
    expect(SPEND_TASK_PRICES['outcomes.extract.v1'].pausesForScopeReading).toBe(false);
  });

  it('knows the three tasks and no other', () => {
    expect([...SPEND_TASK_IDS].sort()).toEqual([
      'demand.classify.v1',
      'outcomes.align.v1',
      'outcomes.extract.v1',
    ]);
    expect(isSpendTaskId('outcomes.extract.v1')).toBe(true);
    expect(isSpendTaskId('cards.generate.v1')).toBe(false);
  });
});

describe('holds', () => {
  it('are the per-call ceiling times two: demand 0.0446, alignment 0.1552, extraction 0.0605', () => {
    expect(holdUsdFor('demand.classify.v1')).toBe(0.044576);
    expect(holdUsdFor('outcomes.align.v1')).toBe(0.155168);
    expect(holdUsdFor('outcomes.extract.v1')).toBe(0.060525);
    expect(holdUsdFor('demand.classify.v1')).toBeCloseTo(0.0446, 4);
    expect(holdUsdFor('outcomes.align.v1')).toBeCloseTo(0.1552, 4);
  });

  it('never fall below the paper figure, and grow with a payload past the overbound', () => {
    for (const taskId of SPEND_TASK_IDS) {
      const floor = holdUsdFor(taskId);
      expect(holdUsdFor(taskId, 1_000)).toBe(floor);
      const big = holdUsdFor(taskId, 400_000);
      expect(big).toBeGreaterThan(floor);
      expect(big).toBeGreaterThanOrEqual(
        BILLABLE_CALLS_PER_REQUEST * perCallCeilingUsd(taskId, 400_000),
      );
    }
  });

  it('cover the Worker’s own worst case for two attempts on a request of any size', () => {
    // The Worker refuses a call whose one attempt at reservationTokens(system, user) and the output
    // ceiling does not fit the allowance, and affords floor(allowance / that) attempts.
    for (const taskId of SPEND_TASK_IDS) {
      const price = SPEND_TASK_PRICES[taskId];
      for (const payloadChars of [0, 2_000, 30_000, 97_000, 250_000, 1_500_000]) {
        const renderedChars = SYSTEM_PROMPT_CHARS[taskId] + payloadChars;
        const workerAttempt =
          (Math.ceil((2 * renderedChars) / 3) * price.inputUsdPerMillionTokens +
            price.outputCeilingTokens * price.outputUsdPerMillionTokens) /
          1e6;
        expect(
          Math.floor(holdUsdFor(taskId, payloadChars) / workerAttempt),
          `${taskId} ${payloadChars}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('are whole micro-dollars rounded up, never down', () => {
    expect(toMicroUsd(0.0000011)).toBe(2);
    expect(toMicroUsd(0.044576)).toBe(44_576);
    expect(toMicroUsd(0.1 + 0.2)).toBe(300_000);
    for (const taskId of SPEND_TASK_IDS) {
      const hold = holdUsdFor(taskId, 12_345);
      expect(Number.isInteger(Math.round(hold * 1e6))).toBe(true);
      expect(hold).toBeGreaterThanOrEqual(2 * perCallCeilingUsd(taskId, 12_345) - 1e-12);
    }
  });

  it('size the input bound from the payload and the prompt allowance, as the Worker estimates it', () => {
    expect(inputBoundTokens('outcomes.extract.v1', 0)).toBe(20_000);
    expect(inputBoundTokens('outcomes.extract.v1', 100_000)).toBe(Math.ceil((2 * 120_000) / 3));
  });

  it('a line the reader cannot trust counts as the largest declared hold of any task', () => {
    expect(WORST_CASE_HOLD_USD).toBe(holdUsdFor('outcomes.align.v1'));
    for (const taskId of SPEND_TASK_IDS)
      expect(WORST_CASE_HOLD_USD).toBeGreaterThanOrEqual(holdUsdFor(taskId));
  });
});
