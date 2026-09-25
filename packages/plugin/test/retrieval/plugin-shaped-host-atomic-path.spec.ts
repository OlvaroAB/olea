/**
 * `ol-ppxj.52` — proves the fix `main.ts`'s `readModifyWrite` passthrough
 * makes, in production, is real: a store built with a host shaped exactly
 * like the plugin instance's own `loadData`/`saveData`/`readModifyWrite`
 * trio now takes the atomic path, not the honest non-atomic fallback.
 *
 * `main.ts` cannot be loaded under Vitest — it imports `obsidian`, whose
 * `package.json` `main` is `""` (`test/main-wiring.spec.ts`'s own module
 * doc). `main-wiring.spec.ts`'s new describe block for this bead pins the
 * new `readModifyWrite` method's source text and its position relative to
 * `override loadData`/`saveData`, but a source-level regex cannot prove the
 * method actually DELEGATES to a real, queued host rather than, say, a
 * no-op stub with the right signature — that behavioural half is this file.
 *
 * "Plugin-shaped host": after this bead, `main.ts`'s `OleaPlugin` exposes
 * three methods that all route to the SAME `this.dataFileHost`
 * (`SerializingDataHost`) instance — `loadData`/`saveData` (pre-existing,
 * `[JEV-11]`) and now `readModifyWrite` (this bead). This file builds that
 * identical three-method shape over a real `SerializingDataHost`, rather
 * than importing `main.ts` (which cannot load) or re-declaring a fourth,
 * independent fake host shape — see `ol-ppxj.46`'s own regression test
 * (`store-interleaving-regression.spec.ts`) for the sibling technique this
 * follows.
 */
import { describe, expect, it, vi } from 'vitest';
import { ObsidianGroveGroundStreakStore } from '../../src/grove/ground-streak-store.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';

/**
 * Builds the exact three-method shape `main.ts`'s `OleaPlugin` exposes as
 * `this` after this bead: `loadData`/`saveData`/`readModifyWrite`, all
 * routed through one `SerializingDataHost` — never a bespoke fourth fake.
 * Spies wrap the OUTER methods (the ones a store would call directly) so a
 * test can tell whether a store took the atomic path (only
 * `readModifyWrite` called) or the fallback (`loadData` then `saveData`
 * called as two separate calls).
 */
function buildPluginShapedHost() {
  let blob: Record<string, unknown> = {};
  const serializing = new SerializingDataHost({
    loadData: async () => ({ ...blob }),
    saveData: async (data) => {
      blob = { ...(data as Record<string, unknown>) };
    },
  });

  const loadData = vi.fn(() => serializing.loadData());
  const saveData = vi.fn((data: unknown) => serializing.saveData(data));
  const readModifyWrite = vi.fn((mutate: (current: unknown) => unknown | Promise<unknown>) =>
    serializing.readModifyWrite(mutate),
  );

  return { loadData, saveData, readModifyWrite };
}

describe('a store constructed with the plugin-shaped host takes the atomic path (ol-ppxj.52)', () => {
  it('calls readModifyWrite exactly once and never calls the plain loadData/saveData pair on write', async () => {
    const host = buildPluginShapedHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.save(new Map([['concept-a', 3]]));

    expect(host.readModifyWrite).toHaveBeenCalledTimes(1);
    // The atomic branch in `ground-streak-store.ts`'s `save` never falls
    // through to the plain pair when `hasReadModifyWrite` is true — this is
    // the reachability half `ol-ppxj.46`'s report named as not yet closed
    // in production (every one of the ~19 sites still saw `hasReadModifyWrite(this)`
    // as false before this bead's `main.ts` fix).
    expect(host.loadData).not.toHaveBeenCalled();
    expect(host.saveData).not.toHaveBeenCalled();

    const loaded = await store.load();
    expect(loaded.get('concept-a')).toBe(3);
  });

  it('a second save through the same plugin-shaped host also survives — the honest fallback is never exercised by this host shape', async () => {
    // Regression companion to `ol-ppxj.46`'s cross-store interleaving test:
    // that file proves two DIFFERENT store classes surviving one shared
    // atomic host. This proves the plugin-shaped delegate itself (the exact
    // object main.ts's OleaPlugin now presents as `this`) is what a store
    // sees as atomic-capable — not merely that a bare SerializingDataHost is.
    const host = buildPluginShapedHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.save(new Map([['concept-a', 1]]));
    await store.save(
      new Map([
        ['concept-a', 1],
        ['concept-b', 2],
      ]),
    );

    expect(host.readModifyWrite).toHaveBeenCalledTimes(2);
    expect(host.loadData).not.toHaveBeenCalled();
    expect(host.saveData).not.toHaveBeenCalled();

    const loaded = await store.load();
    expect(loaded.get('concept-a')).toBe(1);
    expect(loaded.get('concept-b')).toBe(2);
  });
});

describe('the shared queue does not deadlock when readModifyWrite calls back into the raw host (ol-ppxj.52)', () => {
  // The concern this bead's brief names directly: `SerializingDataHost.
  // readModifyWrite` enqueues ONE operation that itself calls
  // `this.raw.loadData()`/`this.raw.saveData()` — see
  // `../../src/retrieval/serializing-data-host.ts`'s `readModifyWrite`
  // method. Those two calls go straight to `raw`, never back through
  // `this.loadData()`/`this.saveData()` (the OUTER, queued methods), so the
  // atomic unit never re-enters `this.enqueue` from inside an
  // already-running queued operation — there is no cycle for the queue's
  // own `this.chain` promise to deadlock on. This test proves it
  // empirically: a readModifyWrite call is issued while an ordinary,
  // slow `loadData()` is already queued ahead of it, and it still resolves.

  it('a queued plain loadData ahead of it does not block readModifyWrite from ever resolving', async () => {
    let blob: Record<string, unknown> = { seed: 1 };
    const host = new SerializingDataHost({
      loadData: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ...blob };
      },
      saveData: async (data) => {
        blob = { ...(data as Record<string, unknown>) };
      },
    });

    const firstLoad = host.loadData();
    const rmw = host.readModifyWrite((current) => ({
      ...(current as Record<string, unknown>),
      touched: true,
    }));

    await expect(
      Promise.race([
        Promise.all([firstLoad, rmw]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('deadlocked: did not resolve within 500ms')), 500),
        ),
      ]),
    ).resolves.toBeDefined();

    const finalBlob = await host.loadData();
    expect(finalBlob).toMatchObject({ seed: 1, touched: true });
  });
});
