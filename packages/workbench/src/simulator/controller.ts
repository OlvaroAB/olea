/**
 * `SimulatorController` — wires the modules in this folder into one mountable
 * surface for `main.ts`'s `simulator` route (`docs/dev/simulator-design.md`
 * §3/§4, F9.S2/F9.S3, `ol-3ux7.64.10` [WBX-1b]).
 *
 * **What this mounts.** WBX-2 (`ol-3ux7.64.3`) landed the shim's whole-plugin
 * mount (`Plugin.addCommand`/`registerView`/`addSettingTab`/`loadData`/
 * `saveData`, `mountPlugin` in `../plugin-bridge.ts`), so this controller
 * mounts the real `OleaPlugin` (`packages/plugin/src/main.ts`) whole — over
 * the LIVE, persisted `PersistentVaultSource` (§3) and the LIVE simulator
 * clock — rather than hand-wiring `TodayView`'s own `deps` the way the
 * pre-WBX-2 version of this file did. The plugin's own `onload()` registers
 * every view, command and the settings tab; this controller opens the Today
 * panel once, right after mount, so the pane never starts blank — the same
 * first screen the old single-view mount always gave. Day-advance, jump and
 * reset all do a full `onunload`/`onload` remount (`unmount()` then a fresh
 * `mountPlugin` call), matching what a real Obsidian host does on reload.
 *
 * **The plugin class is imported directly from `packages/plugin/src/main.js`,
 * not through `../plugin-bridge.ts`.** That file's own doc carves out exactly
 * this exception: `mountPlugin` is a mechanism, generic over the plugin
 * class, and "naming the one production plugin class is a one-line call at
 * the actual mount site" — this file, per `docs/dev/simulator-design.md` §4's
 * own worked example.
 *
 * **Degraded fallback.** `OleaPlugin.onload()` reads two globals directly
 * rather than through the shim — `navigator.onLine` (`main.ts:1148`) and
 * `window.setInterval` (`main.ts:1343`, `registerInterval`'s argument) — a
 * gap `test/obsidian-shim-whole-plugin.spec.ts`'s own module doc already
 * names ("an environment gap between plain Node and a real browser, not a
 * gap in this shim"). Every real browser has both; this package's own Vitest
 * suite (plain Node, no jsdom/happy-dom dependency) does not, so
 * {@link missingWholePluginGlobals} is checked before every mount attempt —
 * missing either degrades to the single-view `TodayView` mount this file
 * used before WBX-2, with a notice naming exactly which global is absent,
 * rather than letting `onload()` throw partway through and leave a half-
 * registered plugin behind.
 *
 * **Reachability.** `packages/workbench/src/main.ts`'s `simulator` route
 * (`RouteSurface`, `readRoute`, and the `route.surface === 'simulator'`
 * branch in `render()`) is this controller's only caller.
 */

import type { Rating } from 'olea-contracts';
import type { Scheduler } from 'olea-core';
import { appendReviewLogRecord, createFsrsScheduler } from 'olea-core';
import OleaPlugin from '../../../plugin/src/main.js';
import { WORKBENCH_NOW } from '../clock.js';
import type { ShimVaultSource, WorkspaceLeaf } from '../obsidian-shim/index.js';
import {
  createVaultInstrumentSource,
  ensureDeviceId,
  loadTodayPanel,
  type MountedPlugin,
  mountPlugin,
  OLEA_COMMAND_TODAY_OPEN,
  TodayView,
  type TodayViewDeps,
} from '../plugin-bridge.js';
import { isoWithLocalOffset } from '../scenarios.js';
import { loadFixtureVault } from '../vault/fixture-vault.js';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import { createSimulatorClock, type SimulatorClock } from './clock.js';
import { loadLiveDueQueue } from './live-queue.js';
import { PersistentVaultSource } from './persistent-vault.js';
import { createPluginDataHost, type ObsidianDataHost } from './plugin-data-host.js';
import { renderProvenanceBadge, type SimulatorTransport } from './provenance-badge.js';
import { DEFAULT_SIMULATOR_DB_NAME, openSimulatorStore, type SimulatorStore } from './store.js';

/**
 * The fixture world's snapshot instant — the same fixed instant every other
 * fixture-vault surface in this package treats as "now" for the un-lived
 * (scripted) states. Reset returns the simulator's clock to this instant
 * rather than to real wall time, so a reset-then-look-around always shows
 * the same due set a scripted `today-due` state would.
 */
const FIXTURE_WORLD_ASOF = WORKBENCH_NOW;

const RATE_GOOD: Rating = 'good';
const EXCLUDE_PATHS = ['README.md'];

/**
 * Exactly the two globals `OleaPlugin.onload()` touches directly, bypassing
 * the shim — see this module's doc. Returns the missing ones, in the order
 * `onload()` would reach them, so a caller can report precisely what a real
 * host is missing rather than a generic "could not mount" notice.
 */
function missingWholePluginGlobals(): readonly string[] {
  const missing: string[] = [];
  if (typeof navigator === 'undefined') missing.push('navigator');
  if (typeof window === 'undefined') missing.push('window');
  return missing;
}

export interface SimulatorMountElements {
  /** Where the whole plugin's chrome mounts — analogous to `main.ts`'s `host`. */
  readonly pane: HTMLElement;
  /** Where the day-advance/jump/reset/rate controls render. */
  readonly controls: HTMLElement;
  /** Where the always-on provenance badge renders. */
  readonly badge: HTMLElement;
  /** Where free-text notices ("rated X", "nothing due", a degraded-mount reason) render. */
  readonly notice: HTMLElement;
}

export interface SimulatorControllerOptions {
  readonly elements: SimulatorMountElements;
  readonly scheduler?: Scheduler;
  readonly dbName?: string;
  /** Injectable for tests; production always replays real time. */
  readonly transport?: SimulatorTransport;
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function makeSimpleLeaf(host: HTMLElement): WorkspaceLeaf {
  return {
    view: null,
    async setViewState() {},
    detach() {
      host.empty();
      host.createDiv({
        cls: 'wb-detached',
        text: 'The view detached its tab. In Obsidian this closes the review tab.',
      });
      host.setAttr('data-wb-detached', 'true');
    },
  };
}

function formatSimulatedDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * `PersistentVaultSource implements VaultSource` (`olea-core`), whose
 * `VaultEvent.kind` includes `'rename'`; `ShimVaultSource` (`obsidian-shim/
 * vault-shim.ts`) deliberately has no `'rename'` member — its own module doc:
 * "rename stays `@manual`... neither `MemoryVaultSource` nor the shape this
 * type mirrors can produce one today." So this is a type-level narrowing
 * only, never a real filter: the persisted vault's base is a
 * `MemoryVaultSource` and has no code path that emits `'rename'`, but the
 * mount site still has to satisfy the shim's narrower event type to compile.
 */
function toShimVaultSource(source: PersistentVaultSource): ShimVaultSource {
  return {
    list: (options) => source.list(options),
    read: (path) => source.read(path),
    readBinary: (path) => source.readBinary(path),
    write: (path, content) => source.write(path, content),
    exists: (path) => source.exists(path),
    delete: (path) => source.delete(path),
    watch: (handler) =>
      source.watch((event) => {
        if (event.kind === 'create' || event.kind === 'modify' || event.kind === 'delete') {
          handler({ kind: event.kind, path: event.path });
        }
      }),
  };
}

export class SimulatorController {
  /** Set when the whole plugin is mounted (the normal path — see this class's module doc). */
  private mountedPlugin: MountedPlugin<OleaPlugin> | null = null;
  /** Set instead of {@link mountedPlugin} when {@link missingWholePluginGlobals} is non-empty. */
  private fallbackView: TodayView | null = null;

  private constructor(
    private readonly elements: SimulatorMountElements,
    private readonly scheduler: Scheduler,
    private store: SimulatorStore,
    private vault: PersistentVaultSource,
    private clock: SimulatorClock,
    private readonly uninstallClock: () => void,
    private pluginDataHost: ObsidianDataHost,
    private deviceId: string,
    private readonly transport: SimulatorTransport,
  ) {}

  static async create(options: SimulatorControllerOptions): Promise<SimulatorController> {
    const dbName = options.dbName ?? DEFAULT_SIMULATOR_DB_NAME;
    const scheduler = options.scheduler ?? createFsrsScheduler();
    const store = await openSimulatorStore(dbName);
    const base: MemoryVaultSource = await loadFixtureVault();
    const vault = await PersistentVaultSource.create(base, store);
    const clock = await createSimulatorClock(store);
    const uninstallClock = clock.install();
    const pluginDataHost = createPluginDataHost(store);
    const deviceId = await ensureDeviceId(pluginDataHost);

    const controller = new SimulatorController(
      options.elements,
      scheduler,
      store,
      vault,
      clock,
      uninstallClock,
      pluginDataHost,
      deviceId,
      options.transport ?? 'replay',
    );
    controller.renderControls();
    await controller.remountPane();
    return controller;
  }

  /**
   * Uninstalls the page-level `Date` override and unmounts whatever is
   * currently mounted (the whole plugin, or the degraded fallback view) —
   * **must** be called when navigating away from `#/simulator`, or the clock
   * override keeps shifting every OTHER surface's `WORKBENCH_NOW`-fixed
   * clock too. `main.ts` calls this from `render()`'s preamble whenever the
   * next route is not `'simulator'`.
   *
   * This controller's mounts are never routed through `main.ts`'s own
   * generic `mounted`/`onClose`/`unloadComponent` lifecycle (a whole-plugin
   * mount is not one of the `ItemView` types that lifecycle closes) — this
   * method is the single place teardown happens, for both the normal and
   * the degraded path, so there is exactly one owner and no double-close.
   */
  async dispose(): Promise<void> {
    this.uninstallClock();
    await this.closeCurrent();
  }

  private async closeCurrent(): Promise<void> {
    if (this.mountedPlugin !== null) {
      await this.mountedPlugin.unmount();
      this.mountedPlugin = null;
    }
    if (this.fallbackView !== null) {
      await this.fallbackView.onClose();
      this.fallbackView.unloadComponent();
      this.fallbackView = null;
    }
  }

  private buildFallbackDeps(): TodayViewDeps {
    const vault = this.vault;
    const scheduler = this.scheduler;
    const deviceId = this.deviceId;
    const now = () => this.clock.now();
    return {
      load: () =>
        loadTodayPanel({
          vault,
          deviceId,
          instruments: createVaultInstrumentSource({
            vault,
            scheduler,
            deviceId,
            now,
            excludePaths: EXCLUDE_PATHS,
          }),
          now,
        }),
      startReview: () => {
        this.setNotice(
          'The degraded fallback mount has no review session — use "Rate next due item" below.',
        );
      },
    };
  }

  /**
   * Closes whatever was mounted (if any) and mounts a fresh copy over the
   * live vault/clock — the whole plugin when the host has every global
   * `OleaPlugin.onload()` needs, or the single-view `TodayView` fallback
   * otherwise. Called by `create()` and by every control that moves the
   * clock (`advanceOneDay`, `jumpToDate`, `reset`) or writes through the
   * vault (`rateNextDue`), matching what a real Obsidian host does on
   * reload: a full teardown and re-`onload()`, not a partial refresh.
   */
  private async remountPane(): Promise<void> {
    await this.closeCurrent();
    this.elements.pane.empty();

    const missing = missingWholePluginGlobals();
    if (missing.length === 0) {
      const mounted = await mountPlugin(OleaPlugin, {
        vault: toShimVaultSource(this.vault),
        pluginData: this.pluginDataHost,
      });
      this.mountedPlugin = mounted;
      this.elements.pane.appendChild(mounted.hostEl);
      // Opens the same first screen the pre-WBX-2 single-view mount always
      // gave — the real command, not a hand-built view, so a missing/renamed
      // command surfaces as this throwing rather than a silently blank pane.
      // Deliberately does NOT touch the notice: `rateNextDue`/`reset` call
      // `setNotice(...)` right before this remount, and that message
      // ("Rated 1 item…", "Reset to the fixture snapshot.") must survive it
      // — clearing it here was a real bug caught by the browser smoke test
      // (`ol-3ux7.64.10` [WBX-1b]): every remount wiped the message the
      // action that triggered it had just set.
      mounted.plugin.invokeCommand(OLEA_COMMAND_TODAY_OPEN);
    } else {
      this.setDegradedNotice(missing);
      const deps = this.buildFallbackDeps();
      const view = new TodayView(makeSimpleLeaf(this.elements.pane), deps);
      this.elements.pane.appendChild(view.containerEl);
      this.fallbackView = view;
      void view.onOpen();
      await settle();
    }

    this.renderBadge();
  }

  private renderBadge(): void {
    renderProvenanceBadge(this.elements.badge, {
      world: 'FIXTURE',
      simulatedDate: formatSimulatedDate(this.clock.now()),
      transport: this.transport,
    });
  }

  private setNotice(text: string): void {
    this.elements.notice.empty();
    if (text.length === 0) return;
    this.elements.notice.createDiv({ cls: 'wb-sim-notice', text });
  }

  private setDegradedNotice(missing: readonly string[]): void {
    this.elements.notice.empty();
    this.elements.notice.createDiv({
      cls: 'wb-sim-notice wb-sim-notice-degraded',
      text:
        `Whole-plugin mount unavailable in this host (missing global${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}) — degraded to the Today panel only. ` +
        "Every real browser has both; this happens only in a host with no `window`/`navigator` (e.g. this package's own plain-Node test runner).",
    });
  }

  private renderControls(): void {
    this.elements.controls.empty();

    const advance = this.elements.controls.createEl('button', {
      cls: 'wb-nav-item',
      text: 'Advance one day',
      attr: { type: 'button', 'data-sim-advance': 'true' },
    });
    advance.addEventListener('click', () => {
      void this.advanceOneDay();
    });

    this.elements.controls.createDiv({ cls: 'wb-sim-jump-label', text: 'Jump to date' });
    const jump = this.elements.controls.createEl('input', {
      attr: { type: 'date', 'data-sim-jump': 'true' },
    });
    jump.addEventListener('change', () => {
      if (jump.value.length === 0) return;
      void this.jumpToDate(jump.value);
    });

    const rate = this.elements.controls.createEl('button', {
      cls: 'wb-nav-item',
      text: 'Rate next due item',
      attr: { type: 'button', 'data-sim-rate': 'true' },
    });
    rate.addEventListener('click', () => {
      void this.rateNextDue();
    });

    const reset = this.elements.controls.createEl('button', {
      cls: 'wb-nav-item',
      text: 'Reset to snapshot',
      attr: { type: 'button', 'data-sim-reset': 'true' },
    });
    reset.addEventListener('click', () => {
      void this.reset();
    });
  }

  /** `[data-sim-advance]`'s handler: steps the clock one day and re-mounts — the plugin's own onunload/onload. */
  async advanceOneDay(): Promise<void> {
    await this.clock.advanceDays(1);
    await this.remountPane();
  }

  /** `[data-sim-jump]`'s handler: `dateIso` is `YYYY-MM-DD`, interpreted as local midnight. */
  async jumpToDate(dateIso: string): Promise<void> {
    const asOf = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(asOf.getTime())) return;
    await this.clock.jumpTo(asOf);
    await this.remountPane();
  }

  /**
   * `[data-sim-rate]`'s handler. Writes exactly one real review-log record
   * for the first item the real composer offers right now — the same write
   * path (`appendReviewLogRecord`) `createVaultReviewLogPort` uses in
   * production — then re-mounts so the Today panel's due count reflects it.
   * A day with nothing rated writes nothing (F9.S2: "the simulator never
   * fabricates behaviour"). Kept alongside the whole-plugin mount (rather
   * than retired now that the real `ReviewView` is reachable through the
   * palette) as a one-click shortcut for exercising write scenarios without
   * running a full review session.
   */
  async rateNextDue(): Promise<void> {
    const now = this.clock.now();
    const queue = await loadLiveDueQueue({ vault: this.vault, scheduler: this.scheduler, now });
    const item = queue.items[0];
    if (item === undefined) {
      this.setNotice('Nothing is due right now — nothing was rated.');
      return;
    }
    await appendReviewLogRecord(
      this.vault,
      {
        timestamp: isoWithLocalOffset(now),
        instrumentId: item.instrument.instrumentId,
        instrumentType: item.instrument.type,
        conceptIds: [...item.instrument.conceptIds],
        rating: RATE_GOOD,
        wasUnsure: false,
        durationMs: null,
        selectionContext: item.selectionContext,
      },
      { deviceId: this.deviceId },
    );
    this.setNotice(`Rated 1 item (${item.instrument.instrumentId}).`);
    await this.remountPane();
  }

  /**
   * `[data-sim-reset]`'s handler. Clears the vault overlay, the plugin data
   * and the clock offset in `SimulatorStore.resetAll`'s one transaction,
   * then rebuilds the vault from a fresh fixture fetch (the in-memory base
   * this controller already wrote into cannot be un-written, so "reset" gets
   * a clean one the same way a real reload would) and mints a fresh device
   * id — F9.S2: "a fresh device id is minted on the next mount." The mount
   * that follows (`remountPane`) reads that same freshly-minted id back from
   * the same store, so the plugin's own `onload`-time `ensureDeviceId(this)`
   * call never re-mints a second, different one.
   */
  async reset(): Promise<void> {
    await this.store.resetAll();
    await this.clock.jumpTo(FIXTURE_WORLD_ASOF);
    const freshBase = await loadFixtureVault();
    this.vault = await PersistentVaultSource.create(freshBase, this.store);
    this.deviceId = await ensureDeviceId(this.pluginDataHost);
    this.setNotice('Reset to the fixture snapshot.');
    await this.remountPane();
  }
}
