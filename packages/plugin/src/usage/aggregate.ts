/**
 * Groups a `UsageLogEntry[]` into one `FeatureUsageSummary` per task id
 * (`ol-p3t09`, extended `ol-p6t06`, F7.3). Pure function, no obsidian
 * import, no I/O — the loading side lives in `log-store.ts`.
 */

import type { FeatureUsageSummary, UsageLogEntry } from './types.js';

/** Sorted by call count descending, then task id, for stable rendering. */
export function aggregateUsageByFeature(
  entries: readonly UsageLogEntry[],
): readonly FeatureUsageSummary[] {
  const byTaskId = new Map<
    string,
    {
      count: number;
      promptVersions: Set<string>;
      modelIds: Set<string>;
      lastCalledAt: string;
      costUsdSum: number;
      pricedCallCount: number;
    }
  >();

  for (const entry of entries) {
    const existing = byTaskId.get(entry.taskId);
    // `[D-123]`: sum only entries that actually carry a `costUsd` — see
    // `types.ts`'s `FeatureUsageSummary` doc. Nothing populates this field
    // in production yet (the wiring gap that module doc names), so this
    // sum is `0`/`pricedCallCount` `0` for every real entry today; the loop
    // is written for the day that stops being true, not for today's data.
    const hasCost = typeof entry.costUsd === 'number';
    if (existing === undefined) {
      byTaskId.set(entry.taskId, {
        count: 1,
        promptVersions: new Set([entry.promptVersion]),
        modelIds: new Set([entry.modelId]),
        lastCalledAt: entry.recordedAt,
        costUsdSum: hasCost ? (entry.costUsd as number) : 0,
        pricedCallCount: hasCost ? 1 : 0,
      });
      continue;
    }
    existing.count += 1;
    existing.promptVersions.add(entry.promptVersion);
    existing.modelIds.add(entry.modelId);
    if (hasCost) {
      existing.costUsdSum += entry.costUsd as number;
      existing.pricedCallCount += 1;
    }
    // Entries are not guaranteed to arrive in timestamp order (a caller
    // could pass them in any order), so compare rather than assume last-in
    // is latest.
    if (entry.recordedAt > existing.lastCalledAt) {
      existing.lastCalledAt = entry.recordedAt;
    }
  }

  const summaries: FeatureUsageSummary[] = Array.from(byTaskId.entries()).map(([taskId, agg]) => ({
    taskId,
    callCount: agg.count,
    // `null` — never a fabricated `0` — when nothing this feature recorded
    // carries a cost figure; the real sum otherwise. See types.ts's module
    // doc — this function must never invent a figure no entry reported.
    costUsd: agg.pricedCallCount > 0 ? agg.costUsdSum : null,
    pricedCallCount: agg.pricedCallCount,
    promptVersions: Array.from(agg.promptVersions).sort(),
    modelIds: Array.from(agg.modelIds).sort(),
    lastCalledAt: agg.lastCalledAt,
  }));

  summaries.sort((a, b) => b.callCount - a.callCount || a.taskId.localeCompare(b.taskId));
  return summaries;
}
