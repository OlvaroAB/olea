/**
 * `UsageLogEntry` — the local record of one AI call, F7.3's data source
 * (`ol-p3t09`, extended by `ol-p6t06`, `ol-egov.141.89.10.50`).
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
 *
 * **`ol-egov.141.89.10.50`: a failed call is now representable too.** The
 * Worker transport's `onCallFailed` recorder (`ol-egov.141.89.10.25`, item 5,
 * `worker/transport.ts`) fires on a well-formed error response with only a
 * task id and, when the response carried one, the Worker's own `ErrorCode` —
 * a failed call has no `stamp`, so it structurally cannot carry
 * `promptVersion`/`modelId`/any usage figure, ever (see `transport.ts`'s
 * doc). `outcome` and `errorCode` below are the additive, optional fields
 * that let a row say so; `promptVersion`/`modelId` are widened from required
 * to optional to make room. **This is a Class B persisted-shape change**
 * (widened, additive, never removes a field): every row this build already
 * persisted has no `outcome` field at all and reads exactly as before —
 * `outcome` absent means "success", the same as `outcome: 'success'` — and
 * `isUsageLogEntry` below still requires `promptVersion`/`modelId` whenever
 * `outcome` is not `'failed'`, so an old row still fails to validate if it's
 * missing them, exactly as before. **A reader that assumes every entry
 * carries `promptVersion`/`modelId` (`usage/aggregate.ts`, outside this
 * bead's owned paths) will not compile once a caller passes a failed entry
 * through — flagged in this bead's report with the exact patch, not fixed
 * here.**
 */

/** Where a usage figure came from (`ol-xzah`, `[D-123]`) — mirrors `contracts/worker.ts`'s `usageSource`. Kept as a literal union here rather than importing the zod enum, same "no catalogue import for storage" reasoning as `taskId` below. */
export type UsageSource = 'reported' | 'derived' | 'unreported';

/**
 * Whether a recorded call succeeded. Absent means `'success'` — every row
 * persisted before `ol-egov.141.89.10.50` has no `outcome` field at all and
 * must keep reading as a successful call, so this is never defaulted to a
 * literal string at rest; readers treat "absent" and `'success'`
 * identically (see `isUsageLogEntry` below).
 */
export type UsageLogOutcome = 'success' | 'failed';

/** One recorded AI call — successful or failed. */
export interface UsageLogEntry {
  /** `KnownTaskId` (`olea-contracts`) — kept as `string` here so this module never has to import the closed catalogue just to store what a caller already validated. */
  readonly taskId: string;
  /**
   * D7.3 `responseStamp.promptVersion` — the prompt template version that
   * served this call. Present for every successful call; absent for a
   * failed one, which has no response stamp to read it from (never a
   * fabricated placeholder — see `ol-egov.141.89.10.50`'s module-doc note).
   */
  readonly promptVersion?: string;
  /** D7.3 `responseStamp.modelId` — the model that produced this call's result. Present for every successful call; absent for a failed one, same reasoning as `promptVersion`. */
  readonly modelId?: string;
  /** ISO-8601 with offset — when this entry was recorded, client-side. */
  readonly recordedAt: string;
  /** `[D-123]` `stamp.usage.inputTokens` — absent until the recording call site is extended to pass it through (see module doc). */
  readonly inputTokens?: number;
  /** `[D-123]` `stamp.usage.inputTokensSource` — present whenever `inputTokens` is. */
  readonly inputTokensSource?: UsageSource;
  /** `[D-123]` `stamp.usage.outputTokens`. */
  readonly outputTokens?: number;
  /** `[D-123]` `stamp.usage.costUsd` — real dollars from the provider's own reported usage, never estimated here. Never present on a failed row: a failed call carries no stamp on the wire, so there is nothing honest to sum (see `ol-egov.141.89.10.50`'s report for what carrying it would require). */
  readonly costUsd?: number;
  /** `[D-123]` `stamp.usage.latencyMs` for a successful call. For a failed call this is only ever populated once the transport itself measures and passes a client-side round-trip duration through `onCallFailed` — not yet built, outside this bead's owned paths; see the report. Never fabricated either way. */
  readonly latencyMs?: number;
  /** `[D-123]` `stamp.usage.cachedInputTokens` — Slot O's cached-input pricing nuance (D-005). Optional and typically absent: no slot's cost model measures it yet (`src/slots.ts`'s Slot O note, service repo). */
  readonly cachedInputTokens?: number;
  /** `ol-egov.141.89.10.50`: absent or `'success'` for a successful call (every row persisted before this bead is absent, and reads the same way); `'failed'` for a row the transport recorded from a well-formed error response. Never inferred from the presence of other fields — only the recorder sets it. */
  readonly outcome?: UsageLogOutcome;
  /** `ol-egov.141.89.10.50`: the Worker's own `ErrorCode` (`packages/contracts/src/worker.ts`), present only on a `'failed'` row, and only when the error response itself carried one. Never content, never a message string — D-005: this is a closed code, not free text. */
  readonly errorCode?: string;
}

/**
 * Builds a `'failed'` `UsageLogEntry` from what `worker/transport.ts`'s
 * `onCallFailed` recorder honestly has — task id, and optionally the
 * Worker's error code and a client-measured latency, once a caller supplies
 * one (see `latencyMs`'s doc above). Never sets `promptVersion`, `modelId`
 * or any cost figure: a failed call has no stamp to read them from. Kept
 * here, not duplicated at each call site, so `main.ts`'s wiring (proposed in
 * this bead's report; `main.ts` sits outside this bead's owned paths) is a
 * one-line call, the same "plain spread" shape `onCallRecorded`'s call site
 * already uses.
 */
export function buildFailedUsageLogEntry(
  entry: { readonly taskId: string; readonly errorCode?: string; readonly latencyMs?: number },
  recordedAt: string,
): UsageLogEntry {
  return {
    taskId: entry.taskId,
    recordedAt,
    outcome: 'failed',
    ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
    ...(entry.latencyMs !== undefined ? { latencyMs: entry.latencyMs } : {}),
  };
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
      typeof v.recordedAt === 'string' &&
      v.recordedAt.length > 0
    )
  ) {
    return false;
  }
  if (v.outcome !== undefined && v.outcome !== 'success' && v.outcome !== 'failed') {
    return false;
  }
  const isFailed = v.outcome === 'failed';
  // A successful row (outcome absent or 'success', covering every row
  // persisted before ol-egov.141.89.10.50) still requires promptVersion and
  // modelId exactly as before — widening those fields to optional on the
  // type must never widen what a *success* row is allowed to omit. A
  // failed row has neither, and must not: a fabricated placeholder here
  // would be exactly the "invent a value nothing reported" mistake this
  // module's own doc warns against for the numeric figures.
  if (!isFailed) {
    if (typeof v.promptVersion !== 'string' || v.promptVersion.length === 0) return false;
    if (typeof v.modelId !== 'string' || v.modelId.length === 0) return false;
  } else {
    // A failed call has no response stamp, so none of the stamp-derived
    // figures can be honest on this row — only errorCode (from the error
    // body) and latencyMs (a client-measured round trip, once a caller
    // supplies one) are ever legitimate here.
    if (v.promptVersion !== undefined) return false;
    if (v.modelId !== undefined) return false;
    if (v.costUsd !== undefined) return false;
    if (v.inputTokens !== undefined) return false;
    if (v.inputTokensSource !== undefined) return false;
    if (v.outputTokens !== undefined) return false;
    if (v.cachedInputTokens !== undefined) return false;
  }
  if (v.errorCode !== undefined && (typeof v.errorCode !== 'string' || v.errorCode.length === 0)) {
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
