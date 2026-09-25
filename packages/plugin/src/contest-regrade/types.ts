/**
 * The queued regrading workflow's job shape — `[D-360]` (`ol-egov.141.89.9.34`).
 *
 * Ruling `[D-360]` (David, 2026-09-25) approves a background job that starts
 * the moment she disputes a grade, persists durably and drains the next time
 * she reconnects — the same durable-queue-and-drain-on-reconnect shape
 * `packages/core/src/ingestion/` already builds for extraction and
 * generation calls, applied here to one more job kind. **Paid activation
 * stays OFF**: the follow-up ruling naming the model, spend allowance and
 * retry limit has not landed, and the external-spend go/no-go
 * (`ol-egov.141.45`) has not closed either. This module only defines the
 * job's shape; `runner.ts` is where the activation gate actually lives.
 */

/** The one literal `payload.kind` this queue's jobs carry — same discriminant shape `isGenerationJobPayload`/`isExtractionJobPayload` (`olea-core`) already use for the other job kinds sharing the ingestion queue's engine class. */
export const CONTEST_REGRADE_JOB_KIND = 'contest-regrade' as const;

/**
 * What a contested grade's re-derivation job needs to run — captured **at
 * enqueue time**, i.e. the moment she disputes, never re-derived later.
 *
 * This is `[D-360]` criterion 2's mechanism: `originalGradeEventId` is
 * resolved from the log as it stood at dispute time (`enqueue.ts` calls
 * `originalGradeEventIdFor` before this payload is built), so a drain that
 * runs later — possibly after her vault has moved on — still names the
 * exact event the corrective re-grade must carry as `revisionOf`, rather
 * than re-resolving "the standing grade" against whatever is current then.
 * The frozen answer and context themselves are not copied onto this
 * payload: they live in the `[D-077]` content store, reached at drain time
 * through `originalGradeEventId`'s own `explainBackGrade.contentRef` — this
 * payload only needs to be a JSON-serialisable pointer, matching
 * `PersistedJob.payload`'s "opaque to the engine" contract.
 */
export interface ContestRegradeJobPayload {
  readonly kind: typeof CONTEST_REGRADE_JOB_KIND;
  /** The dispute event's own `eventId` — the catalyst id a corrective re-grade names indirectly via `resolveContestedGradeAndRegrade`'s own resolution write. */
  readonly disputeEventId: string;
  /** The instrument the grade was on. Present because `DisputeLogRecord.instrumentId` is present for exactly the grade case this job exists for. */
  readonly instrumentId: string;
  /** The `eventId` of the grade event standing at dispute time — the `revisionOf` a correction must name (`[D-281]`'s correction rule; see `contest.ts`'s `originalGradeEventIdFor`). */
  readonly originalGradeEventId: string;
  /** Every concept the dispute named, carried through for UI/telemetry only — never read to decide anything the engine does. */
  readonly conceptIds: readonly string[];
}

/** Type guard mirroring `isGenerationJobPayload`/`isExtractionJobPayload` (`olea-core`) — the same shape check pattern for one more job kind sharing that engine. */
export function isContestRegradeJobPayload(value: unknown): value is ContestRegradeJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === CONTEST_REGRADE_JOB_KIND &&
    typeof candidate.disputeEventId === 'string' &&
    candidate.disputeEventId.length > 0 &&
    typeof candidate.instrumentId === 'string' &&
    candidate.instrumentId.length > 0 &&
    typeof candidate.originalGradeEventId === 'string' &&
    candidate.originalGradeEventId.length > 0 &&
    Array.isArray(candidate.conceptIds) &&
    candidate.conceptIds.every((id) => typeof id === 'string')
  );
}

/**
 * Whether the drain may call anything paid. `[D-360]`'s ruling: OFF until a
 * later ruling names the model, spend allowance and retry limit, made after
 * the integrated practice run (`ol-egov.141.6.15`) measures real per-call
 * costs, and `ol-egov.141.45`'s external-spend go/no-go closes. There is
 * deliberately no way to turn this on from inside this package — flipping
 * it is a ruling, not a config edit a lane can make; see `wiring.ts`'s
 * `DEFAULT_CONTEST_REGRADE_ACTIVATION`, the one place production reads it.
 */
export interface ContestRegradeActivation {
  readonly enabled: boolean;
}
