/**
 * The seams the registry provider depends on instead of talking to a real
 * vault or Obsidian directly — same narrow-port split `review/ports.ts` and
 * `commands/types.ts` already draw, so a plain fake object can satisfy these
 * in tests.
 *
 * **`PruneInstrumentPort` is a second production caller of
 * `appendSuspendRecord`, symmetric where `review/ports.ts`'s `SuspendPort`
 * is not.** `SuspendPort.suspend` (F2.6's durable half) only ever writes
 * `kind: 'suspend'` — nothing in review offers unsuspending yet, per that
 * port's own doc. F8.5's withdrawal is explicitly reversible ("can return"),
 * so this port writes both directions through the same frozen writer,
 * exactly as that module's doc anticipates: *"the day an unsuspend command
 * exists it is a caller of the same writer, not a new one."* Nothing here
 * duplicates `SuspendPort` or reaches into `review/`; it calls
 * `olea-core`'s `appendSuspendRecord` directly, carrying the `conceptIds`
 * `RegistryInstrumentSummary` already has on hand (no reconstruction problem
 * — see that record's own doc for why the id alone was never enough).
 *
 * **The withdrawn set this reads back is `../review-log/suspension.ts`'s
 * existing projection** (`suspendedInstrumentIds`), read by the provider,
 * not by this port — a prune here and an in-session suspend (F2.6) are
 * therefore the SAME state, viewed from two surfaces, never two competing
 * withdrawal mechanisms for one instrument.
 */

import { appendSuspendRecord, type RegistryInstrumentSummary, type VaultSource } from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';

export interface PruneInstrumentPort {
  prune(instrument: RegistryInstrumentSummary): Promise<void>;
  restore(instrument: RegistryInstrumentSummary): Promise<void>;
}

/**
 * The real `PruneInstrumentPort`: `olea-core`'s `appendSuspendRecord` over a
 * `VaultSource` — needs no Obsidian, so it runs under Vitest, matching
 * `review/ports.ts`'s `createVaultSuspendPort`.
 */
export function createVaultPruneInstrumentPort(
  vault: VaultSource,
  deviceId: string,
): PruneInstrumentPort {
  async function write(kind: 'suspend' | 'unsuspend', instrument: RegistryInstrumentSummary) {
    await appendSuspendRecord(
      vault,
      {
        kind,
        timestamp: isoWithLocalOffset(new Date()),
        instrumentId: instrument.instrumentId,
        conceptIds: [...instrument.conceptIds],
      },
      { deviceId },
    );
  }

  return {
    prune: (instrument) => write('suspend', instrument),
    restore: (instrument) => write('unsuspend', instrument),
  };
}
