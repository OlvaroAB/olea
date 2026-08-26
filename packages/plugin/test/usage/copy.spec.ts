/**
 * `copy.ts` tests (F7.3, `ol-p3t09`, extended `ol-p6t06`). Asserts the
 * cost-unavailable note exists and reads as an honest absence rather than a
 * number, that `describeFeatureUsage` never prints a figure it doesn't
 * have, that a real figure IS printed once present, and that D-005's
 * cached-input pricing nuance appears only once the oracle feature has been
 * recorded.
 */
import { describe, expect, it } from 'vitest';
import {
  describeCostAvailabilityNote,
  describeFeatureUsage,
  USAGE_CACHED_INPUT_NOTE,
  USAGE_COST_AVAILABLE_NOTE,
  USAGE_COST_PARTIAL_NOTE,
  USAGE_COST_UNAVAILABLE_NOTE,
  usesCachedInputPricing,
} from '../../src/usage/copy.js';
import type { FeatureUsageSummary } from '../../src/usage/types.js';

function summary(overrides: Partial<FeatureUsageSummary> = {}): FeatureUsageSummary {
  return {
    taskId: 'quiz.generate.v1',
    callCount: 3,
    promptVersions: ['1.0.0', '1.1.0'],
    modelIds: ['model-a'],
    lastCalledAt: '2026-08-03T00:00:00.000Z',
    costUsd: null,
    pricedCallCount: 0,
    ...overrides,
  };
}

describe('usage copy', () => {
  it('the cost-unavailable note never contains a dollar amount or "0" as a figure', () => {
    expect(USAGE_COST_UNAVAILABLE_NOTE).not.toMatch(/\$\d/);
    expect(USAGE_COST_UNAVAILABLE_NOTE.toLowerCase()).toMatch(/cost/);
  });

  it('describeFeatureUsage renders the task id, call count, models and prompt versions actually seen', () => {
    const line = describeFeatureUsage(summary());
    expect(line).toContain('quiz.generate.v1');
    expect(line).toContain('3 calls');
    expect(line).toContain('model-a');
    expect(line).toContain('1.0.0, 1.1.0');
  });

  it('describeFeatureUsage never mentions cost or a dollar figure when costUsd is null', () => {
    expect(describeFeatureUsage(summary({ callCount: 1, pricedCallCount: 0 }))).not.toMatch(/\$/);
  });

  it('describeFeatureUsage renders a real total once every call is priced', () => {
    const line = describeFeatureUsage(summary({ costUsd: 0.0123, pricedCallCount: 3 }));
    expect(line).toContain('$0.0123');
    expect(line).not.toMatch(/at least/);
  });

  it('describeFeatureUsage marks a partial total as "at least", not a full total', () => {
    const line = describeFeatureUsage(summary({ costUsd: 0.01, pricedCallCount: 1, callCount: 3 }));
    expect(line).toContain('at least $0.0100');
    expect(line).toContain('1 of 3');
  });

  describe('describeCostAvailabilityNote', () => {
    it('picks the unavailable note when no summary has a priced call', () => {
      expect(describeCostAvailabilityNote([summary(), summary({ taskId: 'b.v1' })])).toBe(
        USAGE_COST_UNAVAILABLE_NOTE,
      );
    });

    it('picks the available note when every summary has at least one priced call', () => {
      const priced = summary({ costUsd: 0.01, pricedCallCount: 3 });
      expect(describeCostAvailabilityNote([priced])).toBe(USAGE_COST_AVAILABLE_NOTE);
    });

    it('picks the partial note when some but not all summaries are priced', () => {
      const priced = summary({ costUsd: 0.01, pricedCallCount: 3 });
      const unpriced = summary({ taskId: 'b.v1' });
      expect(describeCostAvailabilityNote([priced, unpriced])).toBe(USAGE_COST_PARTIAL_NOTE);
    });
  });

  describe('usesCachedInputPricing (D-005 named nuance)', () => {
    it('is true once oracle.rank.v1 (Slot O) has been recorded', () => {
      expect(usesCachedInputPricing([summary({ taskId: 'oracle.rank.v1' })])).toBe(true);
    });

    it('is false when only other features have been recorded', () => {
      expect(usesCachedInputPricing([summary({ taskId: 'quiz.generate.v1' })])).toBe(false);
    });

    it('is false for an empty summary list', () => {
      expect(usesCachedInputPricing([])).toBe(false);
    });
  });

  it('the cached-input note names the pricing mechanism without claiming content is stored', () => {
    expect(USAGE_CACHED_INPUT_NOTE.toLowerCase()).toMatch(/cache/);
    expect(USAGE_CACHED_INPUT_NOTE.toLowerCase()).toMatch(/transient|time-limited/);
  });
});
