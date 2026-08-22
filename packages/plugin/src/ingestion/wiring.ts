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
 */

import {
  createExtractionJobRunner,
  type DeviceCapability,
  deferredEnqueuer,
  IngestionQueueEngine,
  type QueueStore,
  type VaultSource,
} from 'olea-core';
import { PendingIndexingSink } from './pending-indexing-sink.js';

export interface IngestionWiringDeps {
  readonly vault: VaultSource;
  readonly queueStore: QueueStore;
  readonly capability: DeviceCapability;
}

export interface IngestionWiring {
  readonly engine: IngestionQueueEngine;
  readonly sink: PendingIndexingSink;
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
  const enqueuer = deferredEnqueuer();
  const runner = createExtractionJobRunner({ vault: deps.vault, enqueuer, sink });
  const engine = await IngestionQueueEngine.create({
    store: deps.queueStore,
    capability: deps.capability,
    runner,
  });
  enqueuer.bind(engine);
  return { engine, sink };
}
