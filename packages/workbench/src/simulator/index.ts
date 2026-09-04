/**
 * The simulator package's public surface — what `main.ts` (and, per
 * `docs/dev/simulator-design.md` §8, WBX-2/WBX-4/WBX-5) import from this
 * folder. Kept as one barrel for the same reason `plugin-bridge.ts` is one
 * file: "what does the simulator route need" should be answerable by
 * reading one short list.
 */

export { createSimulatorClock, type SimulatorClock } from './clock.js';
export { SimulatorController, type SimulatorControllerOptions } from './controller.js';
export { ensureSimulatorDeviceId } from './device-id.js';
export { type LiveDueQueue, loadLiveDueQueue } from './live-queue.js';
export { PersistentVaultSource } from './persistent-vault.js';
// WBX-2's wiring point (see `plugin-data-host.ts`'s own doc): the shim's
// `Plugin.loadData`/`Plugin.saveData` should delegate to a host built here.
export { createPluginDataHost, type ObsidianDataHost } from './plugin-data-host.js';
export {
  type ProvenanceBadgeState,
  renderProvenanceBadge,
  SIMULATOR_BADGE_SELECTOR,
  type SimulatorTransport,
} from './provenance-badge.js';
export {
  createSimulatorShell,
  renderRibbonViews,
  ribbonLabel,
  type SimulatorShellElements,
} from './shell.js';
export {
  createMemoryStore,
  DEFAULT_SIMULATOR_DB_NAME,
  type OverlayValue,
  openIndexedDbStore,
  openSimulatorStore,
  type SimulatorStore,
} from './store.js';
export {
  loadSimulatorWorld,
  parseWorldAsOf,
  type SimulatorWorldDescriptor,
  type SimulatorWorldLoadResult,
} from './world.js';
