/**
 * `buildIngestionRunner` — the composition root P3-T03a/DF-21a asks for:
 * ties `createExtractionJobRunner` and `IngestionQueueEngine` together over
 * whichever `VaultSource`/`QueueStore`/`DeviceCapability` it's given,
 * closing the loop `deferredEnqueuer()`'s own module doc describes ("build
 * the enqueuer first, hand it to the runner, construct the engine, then
 * bind the enqueuer to the real engine").
 *
 * Deliberately takes only the structural ports `olea-core` already defines
 * — `VaultSource`, `QueueStore`, `DeviceCapability` — and never an
 * `obsidian` type, so this file runs and is unit tested (`wiring.spec.ts`)
 * against fakes, with no real Obsidian host. `main.ts` is the only caller
 * that supplies the real, Obsidian-backed instances (`ObsidianSource`,
 * `ObsidianQueueStore`, `obsidianDeviceCapability()`) — same split
 * `queue-store.ts` and `commands/register-commands.ts` already use, for the
 * same reason.
 *
 * **The sink.** See `pending-indexing-sink.ts`'s own module doc for why
 * `PendingIndexingSink` — not a real embeddings/retrieval consumer — is
 * what this wires today, and why that's an honest, bounded placeholder
 * rather than this bead quietly deciding C2.3/C2.5's design.
 *
 * **`onUnitsLanded` (`ol-p3t07a`).** F3.3's automatic generation pipeline
 * needs to react the instant a drained job's units are accumulated — the
 * "material lands" event the contract names — without this module knowing
 * anything about generation, drafts, or the cache. So the real
 * `PendingIndexingSink` this function builds is unchanged (still exactly
 * what `IngestionWiring.sink` returns, still exactly what
 * `retrieval/wiring.ts`'s `drainIntoEmbeddingCache` reads via `.all()`), and
 * a thin, unexported wrapper sits in front of it in the runner's own
 * `ExtractedUnitSink` slot: accumulate first (unchanged behaviour), then
 * best-effort notify. A hook that throws or rejects never fails the
 * ingestion job it rode in on — a generation failure is not an extraction
 * failure, and `IngestionQueueEngine` has no notion of "extraction succeeded
 * but something downstream of it didn't."
 */

import {
  createExtractionJobRunner,
  type DeviceCapability,
  deferredEnqueuer,
  type ExtractedUnit,
  type ExtractedUnitSink,
  IngestionQueueEngine,
  type QueueStore,
  type VaultSource,
} from 'olea-core';
import { PendingIndexingSink } from './pending-indexing-sink.js';

export interface IngestionWiringDeps {
  readonly vault: VaultSource;
  readonly queueStore: QueueStore;
  readonly capability: DeviceCapability;
  /**
   * Best-effort notification that a drained job accumulated `units` into the
   * sink (`ol-p3t07a`'s F3.3 trigger). Never awaited by anything that could
   * fail the ingestion job — errors and rejections are swallowed here, not
   * propagated. Omitted means no notification, unchanged from this module's
   * pre-`ol-p3t07a` behaviour.
   */
  readonly onUnitsLanded?: (units: readonly ExtractedUnit[]) => Promise<void> | void;
}

export interface IngestionWiring {
  readonly engine: IngestionQueueEngine;
  readonly sink: PendingIndexingSink;
}

/** Accumulates into `pendingSink` unchanged, then best-effort notifies `onUnitsLanded` — see this module's doc. */
function withUnitsLandedHook(
  pendingSink: PendingIndexingSink,
  onUnitsLanded: (units: readonly ExtractedUnit[]) => Promise<void> | void,
): ExtractedUnitSink {
  return {
    async receive(units) {
      await pendingSink.receive(units);
      try {
        await onUnitsLanded(units);
      } catch (error) {
        console.error('Olea: generation-trigger hook failed (ingestion unaffected)', error);
      }
    },
  };
}

/**
 * Builds one real, drainable ingestion pipeline: `createExtractionJobRunner`
 * wired to `deps.vault` and a fresh `PendingIndexingSink`, fed into
 * `IngestionQueueEngine.create` with `deps.queueStore`/`deps.capability`,
 * with the runner's `deferredEnqueuer` bound to the constructed engine
 * before this resolves. `engine.enqueue`/`engine.tick` are safe to call the
 * instant this promise settles — the ordering `deferredEnqueuer`'s own
 * module doc requires (build the enqueuer, construct the runner, construct
 * the engine, bind) is exactly what this function does, in that order.
 */
export async function buildIngestionRunner(deps: IngestionWiringDeps): Promise<IngestionWiring> {
  const sink = new PendingIndexingSink();
  const runnerSink: ExtractedUnitSink = deps.onUnitsLanded
    ? withUnitsLandedHook(sink, deps.onUnitsLanded)
    : sink;
  const enqueuer = deferredEnqueuer();
  const runner = createExtractionJobRunner({ vault: deps.vault, enqueuer, sink: runnerSink });
  const engine = await IngestionQueueEngine.create({
    store: deps.queueStore,
    capability: deps.capability,
    runner,
  });
  enqueuer.bind(engine);
  return { engine, sink };
}
