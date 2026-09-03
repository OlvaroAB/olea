/**
 * `SimulatorController` — wires the modules in this folder into one mountable
 * surface for `main.ts`'s `simulator` route (`docs/dev/simulator-design.md`
 * §3, F9.S2).
 *
 * **What this mounts, and why not the whole plugin.** WBX-2 (`ol-3ux7.64.3`)
 * has not landed yet — the shim has no `Plugin.registerView`/`addCommand`,
 * so there is no `ReviewView`/whole-`OleaPlugin` to mount here. Per the
 * design doc's own lane note ("mount what the existing routes mount, through
 * your store"), this controller mounts the same real `TodayView` the
 * `#/today/*` route mounts, but wires its `deps` to the LIVE, persisted
 * vault and the LIVE simulator clock instead of a scripted fixture state —
 * and adds a "rate the next due item" affordance (over the real due queue,
 * `live-queue.ts`) so F9.S2's write scenarios are reachable without a full
 * review session. Once WBX-2 lands, `main.ts` can swap this for a whole-
 * plugin mount without touching anything in this file's public surface
 * beyond how it is invoked.
 *
 * **Reachability.** `packages/workbench/src/main.ts`'s `simulator` route
 * (`RouteSurface`, `readRoute`, and the `route.surface === 'simulator'`
 * branch in `render()`) is this controller's only caller.
 */

import type { Rating } from 'olea-contracts';
import type { Scheduler } from 'olea-core';
import { appendReviewLogRecord, createFsrsScheduler } from 'olea-core';
import { WORKBENCH_NOW } from '../clock.js';
import type { WorkspaceLeaf } from '../obsidian-shim/index.js';
import {
  createVaultInstrumentSource,
  loadTodayPanel,
  TodayView,
  type TodayViewDeps,
} from '../plugin-bridge.js';
import { isoWithLocalOffset } from '../scenarios.js';
import { loadFixtureVault } from '../vault/fixture-vault.js';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import { createSimulatorClock, type SimulatorClock } from './clock.js';
import { ensureSimulatorDeviceId } from './device-id.js';
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

export interface SimulatorMountElements {
  /** Where the real `TodayView` mounts — analogous to `main.ts`'s `host`. */
  readonly pane: HTMLElement;
  /** Where the day-advance/jump/reset/rate controls render. */
  readonly controls: HTMLElement;
  /** Where the always-on provenance badge renders. */
  readonly badge: HTMLElement;
  /** Where free-text notices ("rated X", "nothing due") render. */
  readonly notice: HTMLElement;
}

export interface SimulatorControllerOptions {
  readonly elements: SimulatorMountElements;
  readonly scheduler?: Scheduler;
  readonly dbName?: string;
  /**
   * Called every time the mounted `TodayView` changes (a fresh mount, a
   * remount on day-advance, or `null` on unmount) — the caller's hook for
   * keeping its own `mounted` bookkeeping (`main.ts`'s generic
   * onClose/unloadComponent lifecycle) in step with remounts this
   * controller triggers on its own, outside `main.ts`'s `render()` cycle.
   */
  readonly onViewChange?: (view: TodayView | null) => void;
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

export class SimulatorController {
  private currentView: TodayView | null = null;

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
    private readonly onViewChange: (view: TodayView | null) => void,
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
    const deviceId = await ensureSimulatorDeviceId(pluginDataHost);

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
      options.onViewChange ?? (() => {}),
    );
    controller.renderControls();
    await controller.remountPane();
    return controller;
  }

  /** The mounted `TodayView`, or `null` before the first `create()`/`reset()` settles. */
  getView(): TodayView | null {
    return this.currentView;
  }

  /**
   * Uninstalls the page-level `Date` override — **must** be called when
   * navigating away from `#/simulator`, or the override keeps shifting every
   * OTHER surface's `WORKBENCH_NOW`-fixed clock too. `main.ts` calls this
   * from `render()`'s preamble, right after its own generic `mounted !==
   * null` cleanup, whenever the next route is not `'simulator'`.
   *
   * **Does not itself close the mounted view.** `onViewChange` keeps
   * `main.ts`'s own `mounted` in step with whatever this controller last
   * mounted, so that generic `onClose`/`unloadComponent` cleanup — which
   * runs before this is called — already closed it; calling `onClose` a
   * second time here would double-close the same `TodayView`.
   */
  dispose(): void {
    this.currentView = null;
    this.uninstallClock();
  }

  private buildDeps(): TodayViewDeps {
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
          'The simulator has no review session yet (WBX-2/whole-plugin mount) — use "Rate next due item" below.',
        );
      },
    };
  }

  /** Closes whatever `TodayView` is mounted (if any) and mounts a fresh one over the live vault/clock. */
  private async remountPane(): Promise<void> {
    if (this.currentView !== null) {
      await this.currentView.onClose();
      this.currentView.unloadComponent();
      this.currentView = null;
      this.onViewChange(null);
    }
    this.elements.pane.empty();

    const deps = this.buildDeps();
    const view = new TodayView(makeSimpleLeaf(this.elements.pane), deps);
    this.elements.pane.appendChild(view.containerEl);
    this.currentView = view;
    this.onViewChange(view);

    void view.onOpen();
    await settle();

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
    this.elements.notice.createDiv({ cls: 'wb-sim-notice', text });
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
   * fabricates behaviour").
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
   * id — F9.S2: "a fresh device id is minted on the next mount."
   */
  async reset(): Promise<void> {
    await this.store.resetAll();
    await this.clock.jumpTo(FIXTURE_WORLD_ASOF);
    const freshBase = await loadFixtureVault();
    this.vault = await PersistentVaultSource.create(freshBase, this.store);
    this.deviceId = await ensureSimulatorDeviceId(this.pluginDataHost);
    this.setNotice('Reset to the fixture snapshot.');
    await this.remountPane();
  }
}
