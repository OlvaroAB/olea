/**
 * `aggregate.ts` tests (F7.3, `ol-p3t09`). Pure function, no obsidian
 * import, no DOM — runs in plain Vitest. Covers the scenarios in
 * `features/F7-plugin-surface.md`'s F7.3 section (olea-service).
 */
import { describe, expect, it } from 'vitest';
import { aggregateUsageByFeature } from '../../src/usage/aggregate.js';
import type { UsageLogEntry } from '../../src/usage/types.js';

function entry(overrides: Partial<UsageLogEntry> = {}): UsageLogEntry {
  return {
    taskId: 'quiz.generate.v1',
    promptVersion: '1.0.0',
    modelId: 'model-a',
    recordedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('aggregateUsageByFeature', () => {
  it('groups per-feature call counts by task id', () => {
    const entries: UsageLogEntry[] = [
      entry({ taskId: 'quiz.generate.v1', recordedAt: '2026-08-01T00:00:00.000Z' }),
      entry({ taskId: 'quiz.generate.v1', recordedAt: '2026-08-02T00:00:00.000Z' }),
      entry({ taskId: 'quiz.generate.v1', recordedAt: '2026-08-03T00:00:00.000Z' }),
      entry({ taskId: 'explain-why.generate.v1', recordedAt: '2026-08-01T00:00:00.000Z' }),
    ];

    const summaries = aggregateUsageByFeature(entries);

    expect(summaries).toHaveLength(2);
    const quiz = summaries.find((s) => s.taskId === 'quiz.generate.v1');
    const explain = summaries.find((s) => s.taskId === 'explain-why.generate.v1');
    expect(quiz?.callCount).toBe(3);
    expect(explain?.callCount).toBe(1);
  });

  it('aggregates an empty log to an empty list, not an error or a placeholder row', () => {
    expect(aggregateUsageByFeature([])).toEqual([]);
  });

  it('preserves every distinct prompt version and model id actually seen for a feature, not just the latest', () => {
    const entries: UsageLogEntry[] = [
      entry({ promptVersion: '1.0.0', modelId: 'model-a', recordedAt: '2026-08-01T00:00:00.000Z' }),
      entry({ promptVersion: '1.1.0', modelId: 'model-b', recordedAt: '2026-08-02T00:00:00.000Z' }),
    ];

    const [summary] = aggregateUsageByFeature(entries);

    expect(summary?.promptVersions).toEqual(['1.0.0', '1.1.0']);
    expect(summary?.modelIds).toEqual(['model-a', 'model-b']);
  });

  it('never fabricates a cost figure — every summary reports costUsd as null, never zero or invented', () => {
    const summaries = aggregateUsageByFeature([entry()]);
    expect(summaries[0]?.costUsd).toBeNull();
  });

  it('reports the latest recordedAt seen, regardless of input order', () => {
    const entries: UsageLogEntry[] = [
      entry({ recordedAt: '2026-08-01T00:00:00.000Z' }),
      entry({ recordedAt: '2026-08-03T00:00:00.000Z' }),
      entry({ recordedAt: '2026-08-02T00:00:00.000Z' }),
    ];
    const [summary] = aggregateUsageByFeature(entries);
    expect(summary?.lastCalledAt).toBe('2026-08-03T00:00:00.000Z');
  });

  it('sorts by call count descending, then task id, for stable rendering', () => {
    const entries: UsageLogEntry[] = [
      entry({ taskId: 'b.task.v1' }),
      entry({ taskId: 'a.task.v1' }),
      entry({ taskId: 'a.task.v1' }),
    ];
    const summaries = aggregateUsageByFeature(entries);
    expect(summaries.map((s) => s.taskId)).toEqual(['a.task.v1', 'b.task.v1']);
  });
});
