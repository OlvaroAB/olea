/**
 * `UsageLogEntry` — the local record of one AI call, F7.3's data source
 * (`ol-p3t09`, extended by `ol-p6t06`).
 *
 * **Was deliberately narrower than C4.4/D-005's telemetry list; now shaped
 * to match what the wire can honestly carry.** `ol-p3t09`'s cut was correct
 * at the time: `responseStamp` (D7.3) carried only `contractVersion`,
 * `promptVersion`, `modelId` — carried on every successful response — and
 * the richer figures (token counts, cost, latency) lived solely in
 * server-side `requestTelemetry` (`packages/contracts/src/worker.ts`),
 * write-only to Analytics Engine (D-005/D-014), so nothing sent them back
 * to a client.
 *
 * **`[D-123]` (2026-08-26) changed that.** `responseStamp` now carries a
 * `usage` block (CONTRACT_VERSION 2) — `inputTokens`, `inputTokensSource`,
 * `outputTokens`, `costUsd`, `latencyMs`, and an optional `cachedInputTokens`
 * for Slot O's cached-input pricing nuance (D-005, named in the usage view,
 * F7.3). This type's new fields mirror that block exactly.
 *
 * **Still all optional, and still never defaulted to zero.** The one thing
 * that has NOT happened yet is wiring: the production call site that builds
 * a `UsageLogEntry` is `worker/transport.ts`'s `WorkerHttpTransport` (via
 * `onCallRecorded`, invoked from `main.ts`), and both files sit outside
 * `packages/plugin/src/usage/` — outside this bead's owned paths, same as
 * `log-store.ts`'s original wiring gap sat outside `ol-p3t09`'s. So every
 * entry this build actually persists still carries only
 * `taskId`/`promptVersion`/`modelId`/`recordedAt`; the new fields exist so
 * `aggregate.ts` has something real to sum the day that wiring lands,
 * without a further type change. A missing figure must read as "not
 * available", never as `0` — this module's job is to make that the
 * type-level default, not an accident a caller has to remember.
 */

/** Where a usage figure came from (`ol-xzah`, `[D-123]`) — mirrors `contracts/worker.ts`'s `usageSource`. Kept as a literal union here rather than importing the zod enum, same "no catalogue import for storage" reasoning as `taskId` below. */
export type UsageSource = 'reported' | 'derived' | 'unreported';

/** One successful call, recorded at the moment its response stamp is read. */
export interface UsageLogEntry {
  /** `KnownTaskId` (`olea-contracts`) — kept as `string` here so this module never has to import the closed catalogue just to store what a caller already validated. */
  readonly taskId: string;
  /** D7.3 `responseStamp.promptVersion` — the prompt template version that served this call. */
  readonly promptVersion: string;
  /** D7.3 `responseStamp.modelId` — the model that produced this call's result. */
  readonly modelId: string;
  /** ISO-8601 with offset — when this entry was recorded, client-side. */
  readonly recordedAt: string;
  /** `[D-123]` `stamp.usage.inputTokens` — absent until the recording call site is extended to pass it through (see module doc). */
  readonly inputTokens?: number;
  /** `[D-123]` `stamp.usage.inputTokensSource` — present whenever `inputTokens` is. */
  readonly inputTokensSource?: UsageSource;
  /** `[D-123]` `stamp.usage.outputTokens`. */
  readonly outputTokens?: number;
  /** `[D-123]` `stamp.usage.costUsd` — real dollars from the provider's own reported usage, never estimated here. */
  readonly costUsd?: number;
  /** `[D-123]` `stamp.usage.latencyMs`. */
  readonly latencyMs?: number;
  /** `[D-123]` `stamp.usage.cachedInputTokens` — Slot O's cached-input pricing nuance (D-005). Optional and typically absent: no slot's cost model measures it yet (`src/slots.ts`'s Slot O note, service repo). */
  readonly cachedInputTokens?: number;
}

/** `undefined`, or a real finite non-negative number — the shape every optional numeric usage figure must satisfy. Never a negative or non-numeric placeholder passes as a figure. */
function isOptionalNonNegativeNumber(n: unknown): boolean {
  return n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

export function isUsageLogEntry(value: unknown): value is UsageLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    !(
      typeof v.taskId === 'string' &&
      v.taskId.length > 0 &&
      typeof v.promptVersion === 'string' &&
      v.promptVersion.length > 0 &&
      typeof v.modelId === 'string' &&
      v.modelId.length > 0 &&
      typeof v.recordedAt === 'string' &&
      v.recordedAt.length > 0
    )
  ) {
    return false;
  }
  // Every D-123 figure is optional, but each present one must be a real,
  // non-negative number (or, for the source label, one of the three known
  // strings) — a corrupted or hand-edited data.json must not pass through
  // as a fabricated usage figure.
  return (
    isOptionalNonNegativeNumber(v.inputTokens) &&
    (v.inputTokensSource === undefined ||
      v.inputTokensSource === 'reported' ||
      v.inputTokensSource === 'derived' ||
      v.inputTokensSource === 'unreported') &&
    isOptionalNonNegativeNumber(v.outputTokens) &&
    isOptionalNonNegativeNumber(v.costUsd) &&
    isOptionalNonNegativeNumber(v.latencyMs) &&
    isOptionalNonNegativeNumber(v.cachedInputTokens)
  );
}

/**
 * Per-feature (per-task-id) rollup — what the settings pane renders.
 *
 * `costUsd` was always `null` in `ol-p3t09`'s build. It stays typed as
 * `number | null` now: `null` when none of this feature's recorded entries
 * carry a cost figure (today's actual state, since nothing populates the
 * new `UsageLogEntry` fields yet — see that type's module doc), or the sum
 * of whichever entries do once the wiring gap above is closed.
 * `pricedCallCount` says how many of `callCount` contributed, so a renderer
 * can say "partial" honestly rather than implying the total covers every
 * call.
 */
export interface FeatureUsageSummary {
  readonly taskId: string;
  readonly callCount: number;
  /** Every distinct prompt version this build has actually seen for this task id, sorted for stable rendering. */
  readonly promptVersions: readonly string[];
  /** Every distinct model id this build has actually seen for this task id, sorted for stable rendering. */
  readonly modelIds: readonly string[];
  readonly lastCalledAt: string;
  /** Sum of `costUsd` across entries that carry one; `null` when none of this feature's recorded calls do. Never a fabricated `0`. */
  readonly costUsd: number | null;
  /** How many of `callCount` entries contributed to `costUsd`. `0` whenever `costUsd` is `null`. */
  readonly pricedCallCount: number;
}
