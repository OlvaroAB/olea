/**
 * `PersistentVaultSource` — the lived-term half of the simulator
 * (`docs/dev/simulator-design.md` §3).
 *
 * Wraps a `MemoryVaultSource` (the fetched fixture snapshot — the base layer,
 * never mutated except through this wrapper) with a `SimulatorStore` overlay.
 * Every write and delete lands in the store FIRST (so a crash between the two
 * never leaves the in-memory vault ahead of what a reload would restore),
 * then in the base — exactly `docs/dev/simulator-design.md` §3's own
 * ordering ("`write` and `delete` go to the overlay first, then memory").
 *
 * At construction, every persisted overlay entry is replayed onto the base —
 * "startup applies the overlay over the base" — so after `create()` resolves,
 * the base `MemoryVaultSource` IS the up-to-date vault and every read
 * (`list`, `read`, `readBinary`, `exists`, `watch`) is plain delegation to it.
 * Nothing here re-implements `MemoryVaultSource`'s byte-exact decode/encode;
 * it is reused, not duplicated.
 *
 * **What lands in the overlay.** The plugin's own event files — the
 * per-device review log, suspend records, explain-back offers, contests,
 * scope, retrospective offers, misconceptions — are all written through
 * `VaultSource.write`/`delete`, so every one of them lands in the overlay
 * untouched: this wrapper never inspects a path to decide what to persist.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import type { SimulatorStore } from './store.js';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });
const encoder = new TextEncoder();

export class PersistentVaultSource implements VaultSource {
  private constructor(
    private readonly base: MemoryVaultSource,
    private readonly store: SimulatorStore,
  ) {}

  /**
   * Loads the store's overlay and replays it onto `base` before returning —
   * a `PersistentVaultSource` is never handed back mid-restore.
   */
  static async create(
    base: MemoryVaultSource,
    store: SimulatorStore,
  ): Promise<PersistentVaultSource> {
    const overlay = await store.loadOverlay();
    for (const [path, value] of overlay) {
      if ('tombstoned' in value) {
        await base.delete(path);
      } else {
        await base.write(path, decoder.decode(value.bytes));
      }
    }
    return new PersistentVaultSource(base, store);
  }

  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return this.base.list(options);
  }

  read(path: VaultPath): Promise<string> {
    return this.base.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.base.readBinary(path);
  }

  async write(path: VaultPath, content: string): Promise<void> {
    await this.store.putOverlay(path, { bytes: encoder.encode(content) });
    await this.base.write(path, content);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.base.exists(path);
  }

  async delete(path: VaultPath): Promise<void> {
    await this.store.putOverlay(path, { tombstoned: true });
    await this.base.delete(path);
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.base.watch(handler);
  }
}
