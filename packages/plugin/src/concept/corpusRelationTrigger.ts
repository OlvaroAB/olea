/**
 * Ingestion-session-close detection for the corpus-level relation stage's
 * batch trigger (`[D-082]`, `packages/core/src/concept/corpus-relations/
 * trigger.ts`'s `shouldRunCorpusRelationBatch`, `[EXT-11]` `ol-kw4a`).
 *
 * **Why this exists rather than a new "session" concept in the ingestion
 * engine.** `IngestionQueueEngine` (`olea-core`) has no notion of a
 * "session" — it is a persistent queue that drains one job at a time,
 * polled by `main.ts`'s interval. `trigger.ts`'s own doc requires "batch
 * boundaries only, never per document arrival", and is deliberately
 * incapable of expressing a per-document event at the type level. The
 * honest operational reading of "an ingestion session closing" against
 * that engine is: the queue was doing work, and now it is caught up. This
 * function detects exactly that transition — non-empty to empty — from two
 * `QueueSnapshot`s the host already has on every tick
 * (`IngestionQueueEngine.snapshot()`), so it adds no new engine state and no
 * new event source.
 *
 * **Structurally distinct from the per-document ("material lands") trigger.**
 * `ingestion/wiring.ts`'s `onUnitsLanded` fires once per DRAINED JOB — the
 * per-document trigger `features/F1-sources.md`'s "the corpus stage fires on
 * batch boundaries, never on document arrival" scenario names explicitly.
 * This function takes two queue-level snapshots, never a single job or unit,
 * so there is no parameter shape here that could be wired to that hook by
 * mistake — the same "incapable of expressing a per-document event" argument
 * `trigger.ts` makes for `CorpusRelationBatchTriggerInput`, one layer up.
 */

import type { QueueSnapshot } from 'olea-core';

/**
 * True exactly when the queue was doing work as of `previous` (something
 * queued or in flight) and has drained to fully idle as of `current`
 * (nothing queued, nothing in flight). `previous === null` — no prior tick
 * observed yet, e.g. the very first interval tick after `onload` — can never
 * be a session close: there is nothing to have closed.
 *
 * Pure and synchronous. The host calls this once per tick with the snapshot
 * from the tick before and the one just taken; nothing here reads a clock,
 * a timer, or engine state directly.
 */
export function ingestionSessionJustClosed(
  previous: QueueSnapshot | null,
  current: QueueSnapshot,
): boolean {
  if (previous === null) return false;
  const wasActive = previous.queued > 0 || previous.inFlight > 0;
  const isIdleNow = current.queued === 0 && current.inFlight === 0;
  return wasActive && isIdleNow;
}
