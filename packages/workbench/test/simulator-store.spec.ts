/**
 * `simulator/store.ts`'s adapter contract — run against every `SimulatorStore`
 * backend this package can construct in this environment.
 *
 * `fake-indexeddb` is not a dependency of this package, and Vitest's default
 * `node` environment has no global `indexedDB`, so `openIndexedDbStore`'s own
 * suite is skipped here (guarded on `typeof indexedDB`) and only ever runs in
 * a browser. That is exactly the situation `ol-3ux7.64.2`'s brief calls for:
 * `createMemoryStore` is proven against the SAME contract this file is written
 * against, so a browser swapping in `openIndexedDbStore` gets identical
 * behaviour by construction, not by hoping the two implementations agree.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  type OverlayValue,
  openIndexedDbStore,
  type SimulatorStore,
} from '../src/simulator/store.js';

const BACKENDS: ReadonlyArray<{
  readonly name: string;
  readonly create: () => Promise<SimulatorStore> | SimulatorStore;
}> = [
  { name: 'memory', create: () => createMemoryStore() },
  ...(typeof indexedDB === 'undefined'
    ? []
    : [{ name: 'indexeddb', create: () => openIndexedDbStore(`test-${Math.random()}`) }]),
];

for (const backend of BACKENDS) {
  describe(`SimulatorStore contract — ${backend.name}`, () => {
    let store: SimulatorStore;

    beforeEach(async () => {
      store = await backend.create();
    });

    it('has no overlay entries, no plugin data and an undefined (never-persisted) clock offset before anything is written', async () => {
      // `ol-3ux7.64.14` [WBX-12]: `undefined`, not `0` — `clock.ts`'s
      // `createSimulatorClock` reads this distinction to know whether a
      // fresh mount should fall back to the world's `asOf` (never persisted)
      // or trust a persisted `0` (a real session that jumped back to now).
      expect(await store.loadOverlay()).toEqual(new Map());
      expect(await store.loadPluginData()).toBeUndefined();
      expect(await store.loadClockOffsetMs()).toBeUndefined();
    });

    it('round-trips an overlay write', async () => {
      const value: OverlayValue = { bytes: new TextEncoder().encode('hello') };
      await store.putOverlay('note.md', value);
      const overlay = await store.loadOverlay();
      expect(overlay.size).toBe(1);
      expect(overlay.get('note.md')).toEqual(value);
    });

    it('records a tombstone distinctly from a value', async () => {
      await store.putOverlay('note.md', { bytes: new TextEncoder().encode('x') });
      await store.putOverlay('note.md', { tombstoned: true });
      const overlay = await store.loadOverlay();
      expect(overlay.get('note.md')).toEqual({ tombstoned: true });
    });

    it('round-trips plugin data of any JSON shape', async () => {
      await store.savePluginData({ deviceId: 'olea-abc123', queue: [1, 2, 3] });
      expect(await store.loadPluginData()).toEqual({ deviceId: 'olea-abc123', queue: [1, 2, 3] });
    });

    it('round-trips the clock offset', async () => {
      await store.saveClockOffsetMs(86_400_000);
      expect(await store.loadClockOffsetMs()).toBe(86_400_000);
    });

    it('resetAll clears the overlay, the plugin data and the clock offset together', async () => {
      await store.putOverlay('a.md', { bytes: new TextEncoder().encode('a') });
      await store.savePluginData({ deviceId: 'olea-abc123' });
      await store.saveClockOffsetMs(123_456);

      await store.resetAll();

      expect(await store.loadOverlay()).toEqual(new Map());
      expect(await store.loadPluginData()).toBeUndefined();
      // Back to "never persisted", same as a brand-new store — see the
      // first test's own doc on why that is `undefined`, not `0`.
      expect(await store.loadClockOffsetMs()).toBeUndefined();
    });

    it('loadOverlay returns a fresh snapshot — mutating the returned map never touches the store', async () => {
      await store.putOverlay('a.md', { bytes: new TextEncoder().encode('a') });
      const first = await store.loadOverlay();
      (first as Map<string, OverlayValue>).delete('a.md');
      const second = await store.loadOverlay();
      expect(second.has('a.md')).toBe(true);
    });
  });
}
