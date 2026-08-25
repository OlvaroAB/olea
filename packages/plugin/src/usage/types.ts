/**
 * `UsageLogEntry` — the local record of one AI call, F7.3's data source
 * (`ol-p3t09`).
 *
 * **Deliberately narrower than C4.4/D-005's telemetry list.** That list —
 * task id, token counts, cost, latency, model, prompt version — describes
 * `requestTelemetry` in `packages/contracts/src/worker.ts`, and that record
 * is server-side only: it travels to Analytics Engine, which is write-only
 * from a Worker (D-005, corrected by D-014), so nothing sends it back to a
 * client. What the client actually receives and persists is D7.3's
 * `responseStamp` — `contractVersion`, `promptVersion`, `modelId` — carried
 * on every successful response. `taskId` is known locally (the caller
 * chose it) rather than echoed back.
 *
 * This type is exactly that intersection: fields this build can honestly
 * populate. `inputTokens`/`outputTokens`/`costUsd`/`latencyMs` are not
 * fields here at all, on purpose — adding them as always-`undefined`
 * optionals would invite a future caller to render a "0" or skip a null
 * check and print a lie. If a later contract version echoes cost/tokens on
 * the response envelope, this type grows a real field then, backed by a
 * real value, not before.
 */

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
}

export function isUsageLogEntry(value: unknown): value is UsageLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.taskId === 'string' &&
    v.taskId.length > 0 &&
    typeof v.promptVersion === 'string' &&
    v.promptVersion.length > 0 &&
    typeof v.modelId === 'string' &&
    v.modelId.length > 0 &&
    typeof v.recordedAt === 'string' &&
    v.recordedAt.length > 0
  );
}

/**
 * Per-feature (per-task-id) rollup — what the settings pane renders.
 *
 * `costUsd` is always `null` in this build: see the module doc above for
 * why it is a typed, explicit absence rather than a missing/zero field. A
 * future contract version that echoes real cost back to the client
 * replaces `null` with a real number here; nothing about this shape needs
 * to change to carry that.
 */
export interface FeatureUsageSummary {
  readonly taskId: string;
  readonly callCount: number;
  /** Every distinct prompt version this build has actually seen for this task id, sorted for stable rendering. */
  readonly promptVersions: readonly string[];
  /** Every distinct model id this build has actually seen for this task id, sorted for stable rendering. */
  readonly modelIds: readonly string[];
  readonly lastCalledAt: string;
  /** Deliberately always `null` in v0.9 — see module doc. */
  readonly costUsd: null;
}
