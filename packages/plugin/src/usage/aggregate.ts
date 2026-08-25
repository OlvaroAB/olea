/**
 * Groups a `UsageLogEntry[]` into one `FeatureUsageSummary` per task id
 * (`ol-p3t09`, F7.3). Pure function, no obsidian import, no I/O — the
 * loading side lives in `log-store.ts`.
 */

import type { FeatureUsageSummary, UsageLogEntry } from './types.js';

/** Sorted by call count descending, then task id, for stable rendering. */
export function aggregateUsageByFeature(
  entries: readonly UsageLogEntry[],
): readonly FeatureUsageSummary[] {
  const byTaskId = new Map<
    string,
    { count: number; promptVersions: Set<string>; modelIds: Set<string>; lastCalledAt: string }
  >();

  for (const entry of entries) {
    const existing = byTaskId.get(entry.taskId);
    if (existing === undefined) {
      byTaskId.set(entry.taskId, {
        count: 1,
        promptVersions: new Set([entry.promptVersion]),
        modelIds: new Set([entry.modelId]),
        lastCalledAt: entry.recordedAt,
      });
      continue;
    }
    existing.count += 1;
    existing.promptVersions.add(entry.promptVersion);
    existing.modelIds.add(entry.modelId);
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
    // costUsd is always null: see types.ts's module doc — the client has
    // no data source for it in this build, and this function must never
    // invent one.
    costUsd: null,
    promptVersions: Array.from(agg.promptVersions).sort(),
    modelIds: Array.from(agg.modelIds).sort(),
    lastCalledAt: agg.lastCalledAt,
  }));

  summaries.sort((a, b) => b.callCount - a.callCount || a.taskId.localeCompare(b.taskId));
  return summaries;
}
