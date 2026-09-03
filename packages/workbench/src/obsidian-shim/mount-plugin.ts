/**
 * `mountPlugin` — constructs a real plugin class over this package's
 * Obsidian shim, seeds its vault, awaits `onload()`, and hands back a
 * teardown (`ol-3ux7.64.3` [WBX-2], `docs/dev/simulator-design.md` §4).
 *
 * Re-exported through `../plugin-bridge.ts` (that file's own rule: it is the
 * one module that reaches into `packages/plugin`, so the mount site imports
 * `mountPlugin` from there, not from here directly) — see that file's own
 * doc comment for the exact call WBX-1's `simulator/`/`main.ts` code makes.
 *
 * Lives in `obsidian-shim/` rather than in `plugin-bridge.ts` itself because
 * it never imports `packages/plugin` — it only knows `App`/`Plugin`/`Vault`
 * from `./index.js`, generic over whatever plugin CLASS the caller supplies.
 */

import { App, DEFAULT_MANIFEST, type Plugin } from './index.js';
import type { PluginDataStore, PluginManifest, ShimVaultSource } from './vault-shim.js';
import { createInMemoryPluginDataStore } from './vault-shim.js';

/** A plugin constructor shaped like `Plugin`'s own — real Obsidian only ever calls `new Ctor(app, manifest)`; the third argument is this shim's own injection seam (`Plugin`'s own doc explains why). Any class extending `Plugin` with no constructor override (every plugin view class in this repo) satisfies this without change. */
export type PluginConstructor<P extends Plugin> = new (
  app: App,
  manifest: PluginManifest,
  dataStore: PluginDataStore,
) => P;

export interface MountPluginDeps {
  /** §3's persisted `VaultSource`, or `MemoryVaultSource`/any other implementation — omitted mounts over an empty vault (`./vault-shim.ts`'s `createEmptyVaultSource`). */
  readonly vault?: ShimVaultSource;
  /** §3's IndexedDB `plugin-data` store — omitted mounts over a fresh in-memory blob, gone on reload (matches `ensureDeviceId` minting a new device id every time, which is correct for a vault with no persisted plugin data). */
  readonly pluginData?: PluginDataStore;
  /** Defaults to the real `packages/plugin/manifest.json` (`./vault-shim.ts`'s `DEFAULT_MANIFEST`) — override only for a test that needs a different id/version. */
  readonly manifest?: PluginManifest;
}

export interface MountedPlugin<P extends Plugin> {
  readonly app: App;
  readonly plugin: P;
  /** The plugin's whole mounted chrome (`Plugin.rootEl`) — append this wherever the simulator's visible surface lives. */
  readonly hostEl: HTMLElement;
  /**
   * Full teardown, matching what a real Obsidian host does before a plugin
   * reload (§3's day-advance: "full `onunload`/`onload`"): runs the
   * plugin's own `onunload()` and every `register`/`registerEvent`/
   * `registerInterval` cleanup (`Component.unloadComponent()`), then
   * unsubscribes the vault/metadata-cache from the injected source so a
   * REUSED persisted `vault` (the common case across a remount) does not
   * accumulate one listener per generation of `Vault`.
   */
  unmount(): Promise<void>;
}

/**
 * Mounts `PluginClass` whole: builds an `App` over `deps.vault`, awaits its
 * vault index and metadata cache warming (so the very first read inside
 * `onload()` already sees every file — matching a real Obsidian host, whose
 * vault is fully scanned before any plugin loads), constructs the plugin,
 * and awaits `onload()`.
 */
export async function mountPlugin<P extends Plugin>(
  PluginClass: PluginConstructor<P>,
  deps: MountPluginDeps = {},
): Promise<MountedPlugin<P>> {
  const app = new App(deps.vault === undefined ? {} : { vault: deps.vault });
  await app.vault.ready();
  await app.metadataCache.warm();

  const manifest = deps.manifest ?? DEFAULT_MANIFEST;
  const dataStore = deps.pluginData ?? createInMemoryPluginDataStore();
  const plugin = new PluginClass(app, manifest, dataStore);

  await plugin.onload?.();

  return {
    app,
    plugin,
    // A getter, not a plain property: `plugin.rootEl` builds DOM on first
    // touch (`Plugin.ensureDom`'s own doc) — evaluating it eagerly here would
    // force every `mountPlugin` caller through `document.createElement`,
    // including this package's own vitest suite, which runs under plain Node
    // with no DOM at all (see `Workspace.containerEl`'s doc for why that
    // matters).
    get hostEl(): HTMLElement {
      return plugin.rootEl;
    },
    async unmount(): Promise<void> {
      plugin.unloadComponent();
      app.metadataCache.dispose();
      app.vault.dispose();
    },
  };
}
