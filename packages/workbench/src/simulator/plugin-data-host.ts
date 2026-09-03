/**
 * `createPluginDataHost` — the WBX-2 wiring point named in
 * `docs/dev/simulator-design.md` §3: "Supply an IndexedDB plugin-data store
 * as a module for WBX-2 to wire into the shim's `Plugin.loadData/saveData`
 * (WBX-2 owns the shim)."
 *
 * `ObsidianDataHost` is reproduced here structurally rather than imported —
 * it is the narrow `{ loadData, saveData }` shape `packages/plugin/src/
 * keyword-index/store.ts` already names, and importing that file (or
 * `packages/plugin/src/device/device-id.ts`, whose `ensureDeviceId` takes the
 * same shape) would reach past this bead's `owns` into WBX-2's territory for
 * a two-method interface that has no logic of its own to share. Any object
 * satisfying it — this one included — is interchangeable with a real
 * `Plugin` at both call sites.
 *
 * **How WBX-2 wires this in:** the shim's `Plugin` class should hold one
 * `ObsidianDataHost` (built once, from the same `SimulatorStore` the
 * persisted vault uses) and forward `loadData`/`saveData` straight to it.
 * Because `SimulatorStore.resetAll` clears the plugin-data row in the same
 * transaction as the vault overlay and the clock offset, a reset can never
 * leave the device id pointing at a review log that no longer exists.
 */

import type { SimulatorStore } from './store.js';

/** The shape a real Obsidian `Plugin` — and the shim's double — exposes for `data.json`. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export function createPluginDataHost(store: SimulatorStore): ObsidianDataHost {
  return {
    loadData: () => store.loadPluginData(),
    saveData: (data) => store.savePluginData(data),
  };
}
