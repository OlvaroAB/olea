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
 *
 * **The transport bridge (`ol-3ux7.64.7` [WBX-6]).** `OleaPlugin.onload()`
 * builds its own `WorkerHttpTransport` internally (`main.ts:492-495`,
 * `createRecordingTransport`) with no injection seam, and neither
 * `MountPluginDeps` (`obsidian-shim/mount-plugin.ts`, WBX-2's file) nor
 * `packages/plugin/src/main.ts` (no WBX bead owns it) is on this lane's owns
 * list — so `createSimulatorTransport` (`../transport/index.ts`, WBX-4)
 * cannot be handed to the plugin directly the way that factory's own module
 * doc suggests. Instead, {@link installTransportBridge} does for `fetch`
 * exactly what `SimulatorClock.install` (`./clock.ts`) already does for
 * `Date`: a page-level override, installed once at `create()` and restored
 * in {@link SimulatorController.dispose}, so every real seam this class was
 * told to leave alone stays untouched. Every plugin HTTP call is a `POST` to
 * `<baseUrl>/v1/task` (`worker/transport.ts`'s `buildTaskUrl`,
 * `olea-contracts`' `TASK_ENDPOINT_PATH`) with `JSON.stringify(request)` as
 * the body — so the bridge does not need to guess a `WorkerTaskRequest`'s
 * shape, only re-parse what `sendWorkerTask` already serialised. A hit
 * resolves with a real `Response` wrapping `transport.send(request)`'s
 * result; a miss (or any other failure `transport.send` throws) rejects the
 * patched `fetch` the same way a genuine network failure would, which is
 * exactly what `sendWorkerTask`'s own `catch` turns into the plugin's real
 * `WorkerTransportError` — so the bridge never needs to fabricate that class
 * or its message itself. The one thing the bridge must get right that
 * `Date` did not: the `record`/`direct` transports' OWN outbound call (to
 * the proxy or to staging) is also a `fetch`, so it is built with a plain
 * adapter over the ORIGINAL, pre-patch `fetch` — using `globalThis.fetch` at
 * call time would recurse into the very interceptor that call is trying to
 * make (the proxy's own path, `/__olea/v1/task`, also ends in `/v1/task`).
 */

import { type Rating, TASK_ENDPOINT_PATH } from 'olea-contracts';
import {
  appendReviewLogRecord,
  createFsrsScheduler,
  type Scheduler,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import { OLEA_COMMAND_PROCESS_NOTE_NOW } from '../../../plugin/src/commands/ids.js';
import OleaPlugin from '../../../plugin/src/main.js';
import { ObsidianWorkerConfigStore } from '../../../plugin/src/worker/config-store.js';
import type { HttpRequestFn } from '../../../plugin/src/worker/transport.js';
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
import { GENERATION_CASSETTE_VERSION, type GenerationCassette } from '../synthetic-bridge.js';
import {
  createSimulatorTransport,
  type SimulatorTransportMiss,
  type SimulatorTransportMode,
} from '../transport/index.js';
import { loadFixtureVault } from '../vault/fixture-vault.js';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import { createSimulatorClock, type SimulatorClock } from './clock.js';
import { loadLiveDueQueue } from './live-queue.js';
import { PersistentVaultSource } from './persistent-vault.js';
import { createPluginDataHost, type ObsidianDataHost } from './plugin-data-host.js';
import { renderProvenanceBadge, type SimulatorTransport } from './provenance-badge.js';
import { DEFAULT_SIMULATOR_DB_NAME, openSimulatorStore, type SimulatorStore } from './store.js';

/**
 * Best-effort, never-throwing load of a bundled replay cassette from a plain
 * static path (`simulator-serve.mjs`'s existing static file serving — no
 * server change needed: anything under `dist/` is already served this way).
 * Nothing in this lane's owns list builds that file into `dist/` yet (that
 * is `scripts/simulator-build.mjs`, WBX-3's file), so today this always
 * falls through to the empty cassette — an honest "no recording available"
 * default, never a fabricated hit, and never a real network call beyond the
 * one static GET. `fetchFn` is the caller's captured ORIGINAL `fetch` (see
 * this module's doc on why the bridge must not use `globalThis.fetch` for
 * its own outbound calls).
 */
async function loadReplayCassette(fetchFn: typeof fetch): Promise<GenerationCassette> {
  const empty: GenerationCassette = {
    version: GENERATION_CASSETTE_VERSION,
    datasetVersion: 0,
    entries: [],
  };
  try {
    const response = await fetchFn('/simulator-cassette.json');
    if (!response.ok) return empty;
    const raw: unknown = await response.json();
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw as { version?: unknown }).version === GENERATION_CASSETTE_VERSION &&
      Array.isArray((raw as { entries?: unknown }).entries)
    ) {
      return raw as GenerationCassette;
    }
    return empty;
  } catch {
    return empty;
  }
}

/** Resolves the URL a `fetch(input, init)` call was made with, whatever shape `input` took. */
function fetchRequestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Installs the page-level `fetch` override described in this module's own
 * doc, and returns the restore function. `transport` is whatever
 * `createSimulatorTransport` built for the active mode — this function's
 * only job is routing the plugin's one HTTP call shape (`POST .../v1/task`)
 * to it.
 */
function installTransportBridge(
  transport: WorkerTaskTransport,
  originalFetch: typeof fetch,
): () => void {
  const patched: typeof fetch = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'POST') return originalFetch(input, init);
    let pathname: string;
    try {
      pathname = new URL(fetchRequestUrl(input), window.location.origin).pathname;
    } catch {
      return originalFetch(input, init);
    }
    if (!pathname.endsWith(TASK_ENDPOINT_PATH)) return originalFetch(input, init);

    let request: WorkerTaskRequest;
    try {
      request = JSON.parse(String(init?.body ?? '')) as WorkerTaskRequest;
    } catch {
      // Not a task envelope we can forward to `transport` — fall back to a
      // real network call rather than guessing.
      return originalFetch(input, init);
    }
    const result = await transport.send(request);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  globalThis.fetch = patched;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * Builds the mode-appropriate `WorkerTaskTransport` (WBX-4's factory) and
 * installs the bridge above so the mounted plugin's own, unmodified HTTP
 * call reaches it. D-005/INV-3: `onMiss` only ever receives a task id and a
 * payload hash (`SimulatorTransportMiss`'s own contract) — never logged with
 * anything else, never the payload.
 */
async function createTransportBridge(options: {
  readonly mode: SimulatorTransportMode;
  readonly baseUrl: string | undefined;
  readonly token: string | undefined;
}): Promise<() => void> {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const rawHttpRequest: HttpRequestFn = async (params) => {
    const response = await originalFetch(params.url, {
      method: params.method,
      headers: params.headers,
      body: params.body,
    });
    return { status: response.status, text: await response.text() };
  };

  // `exactOptionalPropertyTypes`: `createSimulatorTransport` distinguishes "field omitted" from
  // "field explicitly undefined", so each optional below is spread in only when it has a value.
  const cassette =
    options.mode === 'replay' || options.mode === 'direct'
      ? await loadReplayCassette(originalFetch)
      : undefined;

  const transport = createSimulatorTransport({
    mode: options.mode,
    ...(cassette !== undefined ? { cassette } : {}),
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.token !== undefined ? { token: options.token } : {}),
    httpRequest: rawHttpRequest,
    onMiss: (miss: SimulatorTransportMiss) => {
      console.info(`simulator: transport miss — ${miss.taskId} (${miss.payloadHash})`);
    },
  });

  return installTransportBridge(transport, originalFetch);
}

/**
 * A placeholder `PersistedWorkerConfig` — never the real staging URL or a real token, and never
 * read by anything (the fetch bridge above matches by PATH suffix, `TASK_ENDPOINT_PATH`, so the
 * literal origin here is irrelevant to where a call actually goes). Its only job is making
 * `isWorkerConfigured` (`config-store.ts`) read `true`, because several product surfaces —
 * F7.8's grey-out, the materiality judge, the F3.3 generation trigger — check that BEFORE
 * attempting a call at all and skip it silently otherwise (discovered live: a first-read walk
 * with no seeded config triggered zero `/__olea/v1/*` requests, since every one of those call
 * sites believed no Worker was configured). Written directly into the plugin's own persisted
 * `data.json` shape, bypassing the settings tab UI entirely — there is no student-facing
 * affordance here, just the same storage key F7.1's real paste-a-token flow writes to.
 */
const SIMULATOR_WORKER_CONFIG_PLACEHOLDER = {
  version: 1 as const,
  baseUrl: 'https://simulator.invalid',
  token: 'simulator-walk',
};

/** See {@link SIMULATOR_WORKER_CONFIG_PLACEHOLDER}'s own doc — called once per mount lifetime and again after every `reset()`, since `SimulatorStore.resetAll` clears the plugin-data store this lives in. */
async function seedSimulatorWorkerConfig(pluginDataHost: ObsidianDataHost): Promise<void> {
  await new ObsidianWorkerConfigStore(pluginDataHost).save(SIMULATOR_WORKER_CONFIG_PLACEHOLDER);
}

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
  /**
   * The transport mode the mounted plugin's Worker calls go through (WBX-6,
   * `ol-3ux7.64.7`) — `'replay'` (cassette-only, zero real network, the
   * default), `'record'` (via `simulator-serve.mjs`'s same-origin `/__olea`
   * proxy, `baseUrl` required) or `'direct'` (a real Worker, `baseUrl`
   * required). Also the badge's own displayed value. Injectable for tests;
   * production reads it from the route (`main.ts`'s `?transport=` query
   * param).
   */
  readonly transport?: SimulatorTransport;
  /** `record`/`direct` only — see {@link transport}. Ignored by `replay`. */
  readonly transportBaseUrl?: string;
  /** `direct` only — the pasted F7.1 token. Ignored by `replay`/`record` (the proxy never reads it). */
  readonly transportToken?: string;
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

declare global {
  interface Window {
    __oleaSimulatorDriver?: SimulatorWalkDriver;
  }
}

/**
 * A non-visual automation seam for `scripts/simulator-walk.mjs` (WBX-6,
 * `ol-3ux7.64.7`) — never rendered, never a control a student can see or
 * click, so CLAUDE.md's "no user-visible affordance without a clause" rule
 * does not govern it. It exists because no file-list UI renders yet to click
 * a "Process this note now" context-menu item through
 * (`obsidian-shim/index.ts`'s own doc on `Workspace.setActiveFile`: "Set by
 * whichever host renders the simulator's file list" — nothing does, yet),
 * and building that UI is not this lane's job. Set only while the whole
 * plugin is mounted ({@link installSimulatorWalkDriver}, from
 * {@link SimulatorController.remountPane}); cleared on every teardown
 * ({@link clearSimulatorWalkDriver}, from
 * {@link SimulatorController.closeCurrent}) — the same lifecycle
 * `mountedPlugin` already gets.
 */
export interface SimulatorWalkDriver {
  /** Every note/PDF path currently in the vault (`Vault.getFiles()`, unfiltered — the caller picks which folder). */
  listFilePaths(): readonly string[];
  /**
   * Sets `path` as the active file and invokes `OLEA_COMMAND_PROCESS_NOTE_NOW`
   * — the identical check-then-execute path a real palette invocation takes
   * (`main.ts`'s `processNoteNowCheckCallback`). Returns `false` (a no-op,
   * never a throw) for a path outside the vault or a file type
   * `isProcessNowSupported` excludes, exactly as a real invocation with no
   * supported active file would.
   */
  processNoteNow(path: string): boolean;
  /** The `[data-sim-advance]` button's own action, awaitable — see {@link SimulatorController.advanceOneDay}. */
  advanceOneDay(): Promise<void>;
  /** The `[data-sim-rate]` button's own action, awaitable — see {@link SimulatorController.rateNextDue}. */
  rateNextDue(): Promise<boolean>;
  /** The `[data-sim-reset]` button's own action, awaitable — see {@link SimulatorController.reset}. */
  reset(): Promise<void>;
}

function installSimulatorWalkDriver(
  controller: SimulatorController,
  mounted: MountedPlugin<OleaPlugin>,
): void {
  if (typeof window === 'undefined') return;
  window.__oleaSimulatorDriver = {
    listFilePaths: () => mounted.app.vault.getFiles().map((file) => file.path),
    processNoteNow: (path: string): boolean => {
      const file = mounted.app.vault.getFileByPath(path);
      if (file === null) return false;
      mounted.app.workspace.setActiveFile(file);
      return mounted.plugin.invokeCommand(OLEA_COMMAND_PROCESS_NOTE_NOW);
    },
    advanceOneDay: () => controller.advanceOneDay(),
    rateNextDue: () => controller.rateNextDue(),
    reset: () => controller.reset(),
  };
}

function clearSimulatorWalkDriver(): void {
  if (typeof window === 'undefined') return;
  // `exactOptionalPropertyTypes`: `delete`, never an explicit `undefined` assignment.
  delete window.__oleaSimulatorDriver;
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
    private readonly uninstallTransportBridge: () => void,
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
    await seedSimulatorWorkerConfig(pluginDataHost);
    const transportMode = options.transport ?? 'replay';
    const uninstallTransportBridge = await createTransportBridge({
      mode: transportMode,
      baseUrl: options.transportBaseUrl,
      token: options.transportToken,
    });

    const controller = new SimulatorController(
      options.elements,
      scheduler,
      store,
      vault,
      clock,
      uninstallClock,
      pluginDataHost,
      deviceId,
      transportMode,
      uninstallTransportBridge,
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
    this.uninstallTransportBridge();
    await this.closeCurrent();
  }

  private async closeCurrent(): Promise<void> {
    clearSimulatorWalkDriver();
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
      installSimulatorWalkDriver(this, mounted);
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
  /**
   * Returns whether an item was actually rated — added for
   * {@link SimulatorWalkDriver} (WBX-6), which needs an awaitable,
   * unambiguous result rather than polling the notice element's text for
   * "Nothing is due" vs. "Rated 1 item…". The button's own click handler
   * (`renderControls`) already discards the return value, so this is a
   * strictly additive change.
   */
  async rateNextDue(): Promise<boolean> {
    const now = this.clock.now();
    const queue = await loadLiveDueQueue({ vault: this.vault, scheduler: this.scheduler, now });
    const item = queue.items[0];
    if (item === undefined) {
      this.setNotice('Nothing is due right now — nothing was rated.');
      return false;
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
    return true;
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
    // `resetAll` clears the plugin-data store this lives in — see its own doc.
    await seedSimulatorWorkerConfig(this.pluginDataHost);
    this.setNotice('Reset to the fixture snapshot.');
    await this.remountPane();
  }
}
