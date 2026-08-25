/**
 * `copy.ts` tests (F7.3, `ol-p3t09`). Asserts the cost-unavailable note
 * exists and reads as an honest absence rather than a number, and that
 * `describeFeatureUsage` never prints anything for a `costUsd` field
 * (there is nothing to print — it's typed `null` on every summary).
 */
import { describe, expect, it } from 'vitest';
import { describeFeatureUsage, USAGE_COST_UNAVAILABLE_NOTE } from '../../src/usage/copy.js';
import type { FeatureUsageSummary } from '../../src/usage/types.js';

describe('usage copy', () => {
  it('the cost-unavailable note never contains a dollar amount or "0" as a figure', () => {
    expect(USAGE_COST_UNAVAILABLE_NOTE).not.toMatch(/\$\d/);
    expect(USAGE_COST_UNAVAILABLE_NOTE.toLowerCase()).toMatch(/cost/);
  });

  it('describeFeatureUsage renders the task id, call count, models and prompt versions actually seen', () => {
    const summary: FeatureUsageSummary = {
      taskId: 'quiz.generate.v1',
      callCount: 3,
      promptVersions: ['1.0.0', '1.1.0'],
      modelIds: ['model-a'],
      lastCalledAt: '2026-08-03T00:00:00.000Z',
      costUsd: null,
    };
    const line = describeFeatureUsage(summary);
    expect(line).toContain('quiz.generate.v1');
    expect(line).toContain('3 calls');
    expect(line).toContain('model-a');
    expect(line).toContain('1.0.0, 1.1.0');
  });

  it('describeFeatureUsage never mentions cost or a dollar figure — that lives in the separate unavailable note', () => {
    const summary: FeatureUsageSummary = {
      taskId: 'quiz.generate.v1',
      callCount: 1,
      promptVersions: ['1.0.0'],
      modelIds: ['model-a'],
      lastCalledAt: '2026-08-01T00:00:00.000Z',
      costUsd: null,
    };
    expect(describeFeatureUsage(summary)).not.toMatch(/\$/);
  });
});
