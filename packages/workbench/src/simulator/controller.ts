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
import {
  OLEA_COMMAND_EXPLAIN_BACK,
  OLEA_COMMAND_PROCESS_NOTE_NOW,
  OLEA_COMMAND_REGISTRY_OPEN,
} from '../../../plugin/src/commands/ids.js';
import {
  EXPLAIN_BACK_ACCEPT_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
} from '../../../plugin/src/explain-back/copy.js';
import { VIEW_TYPE_OLEA_HOME } from '../../../plugin/src/home/view.js';
import OleaPlugin from '../../../plugin/src/main.js';
import { VIEW_TYPE_OLEA_REGISTRY } from '../../../plugin/src/registry/view.js';
import { ObsidianWorkerConfigStore } from '../../../plugin/src/worker/config-store.js';
import type { HttpRequestFn } from '../../../plugin/src/worker/transport.js';
import type { App, ShimVaultSource, WorkspaceLeaf } from '../obsidian-shim/index.js';
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
import { EmbedShardStore } from '../transport/embed-shards.js';
import {
  createSimulatorTransport,
  type SimulatorTransportMiss,
  type SimulatorTransportMode,
} from '../transport/index.js';
import { loadFixtureVault } from '../vault/fixture-vault.js';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import { createSimulatorClock, type SimulatorClock } from './clock.js';
import {
  type CourseSetupSeenBridge,
  installCourseSetupSeenBridge,
  loadCourseSetupSeenCodes,
} from './course-setup-bridge.js';
import { loadLiveDueQueue } from './live-queue.js';
import { PersistentVaultSource } from './persistent-vault.js';
import { createPluginDataHost, type ObsidianDataHost } from './plugin-data-host.js';
import { renderProvenanceBadge, type SimulatorTransport } from './provenance-badge.js';
import {
  loadSimulatorSeedEvents,
  personaDeviceId,
  writeSeedEventsIntoVault,
} from './seed-events.js';
import { renderRibbonViews, type SimulatorShellElements } from './shell.js';
import { DEFAULT_SIMULATOR_DB_NAME, openSimulatorStore, type SimulatorStore } from './store.js';
import { renderTermScrubber, scrubberDateAt } from './term-scrubber.js';
import { loadSimulatorWorld, parseWorldAsOf, type SimulatorWorldDescriptor } from './world.js';

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

  // WBX-16d: the real world's embedding cassette is bundled as shards under Pages' per-file cap
  // (`dist/simulator-embeddings/`); replay and direct answer `retrieval.embed.v1` from them
  // before treating the call as a miss. Built over the ORIGINAL fetch for the same reason the
  // cassette load is (see this module's doc); an absent index is "nothing bundled", never a throw.
  const embedShards =
    options.mode === 'replay' || options.mode === 'direct'
      ? new EmbedShardStore({ fetchFn: originalFetch })
      : undefined;

  const transport = createSimulatorTransport({
    mode: options.mode,
    ...(cassette !== undefined ? { cassette } : {}),
    ...(embedShards !== undefined ? { embedShards } : {}),
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

export interface SimulatorControllerOptions {
  /**
   * The Obsidian-shaped shell's elements (`ol-3ux7.64.14` [WBX-12],
   * `./shell.js`'s `createSimulatorShell`) — `elements.root` is the stable
   * wrapper around every other element, never emptied or replaced by
   * `remountPane()`. It carries `[data-wb-remount]` (`ol-3ux7.64.11`
   * [WBX-9]): a counter bumped once per `remountPane()` call, after the
   * mount (and, for the whole-plugin path, Home landing in `main` and Today
   * revealing in `right`) has fully resolved. `e2e/simulator/helpers.ts`'s
   * `waitForRemount` is the one settle signal every control helper needs,
   * replacing the necessarily-approximate content waits (a badge date
   * changing, a notice appearing) used before WBX-9.
   */
  readonly elements: SimulatorShellElements;
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

/** The seeded-world marker's identity — see `store.ts`'s `loadSeededWorldMarker` doc: a world/build identity, not a bare boolean, so a rebuild that swaps which persona this dist carries reseeds even in a browser profile that never called Reset. */
function worldSeedMarker(descriptor: SimulatorWorldDescriptor): string {
  return `${descriptor.world}@${descriptor.asOf}`;
}

/**
 * The seed-events half of this bead (`ol-3ux7.64.16` [WBX-13], consuming
 * `ol-3ux7.64.15` [WBX-14]'s contract — see `seed-events.ts`'s own doc).
 * Called from `SimulatorController.create()` and again from `reset()` —
 * both are the "first open or after Reset" moments the persona-worlds
 * README names, and both start from a fresh `PersistentVaultSource` whose
 * overlay this lane must plant history into BEFORE the plugin's first mount
 * reads it. Idempotent via `store`'s seeded-world marker (not via checking
 * "is the overlay empty", which the plugin's own cold-start ingestion writes
 * into regardless — see `store.ts`'s own doc on why this needs its own
 * marker): a world with no seed file at all (the fixture and real worlds,
 * every persona world built before WBX-14) marks itself seeded on the first
 * check and never fetches again until the next reset.
 */
async function seedPersonaHistoryIfNeeded(
  descriptor: SimulatorWorldDescriptor,
  vault: PersistentVaultSource,
  store: SimulatorStore,
  fetchFn: typeof fetch,
): Promise<void> {
  const deviceId = personaDeviceId(descriptor.streamSpec);
  if (deviceId === undefined) return;
  const marker = worldSeedMarker(descriptor);
  if ((await store.loadSeededWorldMarker()) === marker) return;

  const seedLoad = await loadSimulatorSeedEvents(fetchFn);
  if (seedLoad.available && seedLoad.records.length > 0) {
    await writeSeedEventsIntoVault(vault, seedLoad.records, deviceId);
  }
  await store.saveSeededWorldMarker(marker);
}

/**
 * Opens `viewType` if no leaf of that type exists anywhere, or reveals the
 * one that already does — the identical "or create one" shape every
 * `revealXxxView` in `packages/plugin/src/main.ts` uses (`existing[0] ??
 * workspace.getLeaf(...)`), used here for two callers that cannot reach
 * those PRIVATE methods directly: {@link SimulatorController.remountPane}'s
 * own Home landing (`revealHomeView` puts Home in the right sidebar in real
 * Obsidian — this bead's own ask is the main pane instead, design doc §4/§7,
 * F9.S3) and the ribbon's per-view buttons (`shell.ts`'s `renderRibbonViews`)
 * — a ribbon icon opens/reveals its view via the real workspace primitives
 * `Plugin.registerView` already wired, never a command id this lane would
 * otherwise have to hand-map per view type.
 *
 * New leaves always land in the MAIN pool (`getLeaf('tab')`): that is the
 * only choice available to a caller outside the plugin's own private reveal
 * methods, and it is also what happens if the view already lives in the
 * RIGHT pool — `getLeavesOfType` searches both, so an existing leaf is
 * revealed wherever it actually is rather than being duplicated into main.
 */
async function openOrRevealView(app: App, viewType: string): Promise<void> {
  const { workspace } = app;
  const existing = workspace.getLeavesOfType(viewType);
  const leaf = existing[0] ?? workspace.getLeaf('tab');
  if (leaf === null || leaf === undefined) return;
  if (existing.length === 0) await leaf.setViewState({ type: viewType, active: true });
  await workspace.revealLeaf(leaf);
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
 *
 * **WBX-16c's four additions below** (`explain`, `contest`, `openRegistry`,
 * `runCommand`) take exactly the path a real click takes — the plugin's own
 * command registry (`Plugin.invokeCommand`, `obsidian-shim/index.ts`) and,
 * for `explain`/`contest`, the actual rendered DOM the modal/view puts up —
 * never a shortcut that calls a port or a capability object directly. See
 * each function's own doc for the exact `file:line` sequence.
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
  /** See {@link driverExplain}'s own doc for the exact sequence. */
  explain(text: string, conceptRef?: string): Promise<ExplainDriverOutcome>;
  /** See {@link driverContest}'s own doc for the exact sequence. */
  contest(target: 'review' | 'today'): Promise<ContestDriverOutcome>;
  /** See {@link driverOpenRegistry}'s own doc for the exact sequence. */
  openRegistry(): Promise<void>;
  /**
   * Invokes any command id the plugin's own `onload()` registered, through
   * the identical `Plugin.invokeCommand` check-then-execute path every other
   * entry here uses (`obsidian-shim/index.ts:1235`) — for the walk script's
   * capability probe, so it never needs a bespoke driver entry per command
   * id it wants to smoke-test. `Plugin.invokeCommand` already refuses (returns
   * `false`, never throws) an id this plugin never registered, because its
   * lookup is `this.commands.get(id)` against a map only `addCommand` ever
   * populates — there is no separate allowlist to keep in sync.
   */
  runCommand(id: string): boolean;
}

/** {@link driverExplain}'s result — deliberately narrower than `ExplainBackModal`'s own three refusal reasons (`unavailable`/`check-failed`/`insufficient-notes`, `modal.ts`'s `ModalState`): all three read as `'unavailable'` here, with `reason` carrying whichever refusal sentence the modal actually rendered. */
export interface ExplainDriverOutcome {
  /**
   * Never surfaced by `PendingExplainBackGrading`/`GroundedGrading`
   * (`olea-core`'s `gradingPipeline.ts`) up to the modal, so this is always
   * `undefined` today — kept in the shape for a caller that wants to log
   * one once the pipeline threads a real id through, never fabricated here.
   */
  readonly taskId?: string;
  /**
   * `'graded'`: she reached "Keep this" and `renderAcceptedPhase` drew the
   * SOLO depth heading (`modal.ts:576`, `.olea-explain-back-outcome`) — a
   * level came back from `recordSoloGradeAndReview`. `'degraded'`: she still
   * reached and clicked "Keep this", but no depth heading rendered — the
   * correctness accept went through with no SOLO level (the common case in
   * production today, per that dep's own doc). `'unavailable'`: the command
   * itself was not invokable, or the modal refused at either the topic or
   * the answer step.
   */
  readonly outcome: 'graded' | 'degraded' | 'unavailable';
  /** The refusal paragraph's own text (`.olea-explain-back-refusal`), or a wiring-failure reason — never fabricated. */
  readonly reason?: string;
}

/** {@link driverContest}'s result. */
export interface ContestDriverOutcome {
  /** `'recorded'`: the gesture was clicked through to a written dispute record, exactly as her own tap would. `'unavailable'`: no gesture (or, for `'today'`, no record button on an open sheet) was rendered to click. */
  readonly outcome: 'recorded' | 'unavailable';
  readonly reason?: string;
}

/** `document`-safe: this package's own Vitest suite runs under plain Node with no DOM at all (`obsidian-shim-whole-plugin.spec.ts`'s own doc) — reading back "no such element" here is the honest answer in that environment, and it is ALSO the honest answer in a real browser where the element genuinely never rendered. Never a thrown `ReferenceError` either way. Scoped to the modal host's own document (the TOP document — see `Modal`'s own doc in `obsidian-shim/index.ts` on why modals render there, never into the simulator's iframe). */
function queryModalDom<T extends Element>(selector: string): T | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<T>(selector);
}

/**
 * The simulator's OWN workspace/views render inside the iframe `shell.ts`'s
 * `createSimulatorShell(host)` builds (`main.ts`'s `[data-wb-surface]`) —
 * `controller.ts`'s own module doc: this script's DOM nodes are built
 * against the top document's `document.createElement` and then ADOPTED into
 * that iframe on `appendChild` (`elements.main.appendChild(mounted.hostEl)`
 * in `remountPane`), so `TodayView`/`ReviewView`'s rendered contest gestures
 * live in the IFRAME's document, never the top one `queryModalDom` above
 * reads. `shellRoot` is `SimulatorControllerOptions.elements.root` — stable
 * across every remount — and `.ownerDocument` is exactly that iframe
 * document, however this controller is hosted. Same no-DOM safety as
 * `queryModalDom`: a `null`/`undefined` `ownerDocument` (the Node test
 * environment's mocked `shellRoot`) reads as "no such element", never a
 * throw.
 */
function queryShellDom<T extends Element>(shellRoot: HTMLElement, selector: string): T | null {
  const doc = shellRoot.ownerDocument;
  if (doc === null || doc === undefined) return null;
  return doc.querySelector<T>(selector);
}

function findButtonByLabel(root: ParentNode, label: string): HTMLButtonElement | null {
  for (const button of root.querySelectorAll('button')) {
    if (button.textContent?.trim() === label) return button;
  }
  return null;
}

/** How long any one of these driver entries waits for the plugin's own async work (a Worker round trip, a vault read) to land in the DOM before giving up loudly rather than hanging the walk script forever. */
const DRIVER_POLL_TIMEOUT_MS = 20_000;

/** Polls `check()` once per macrotask tick (the same `settle()` this module's own remount code already uses) until it returns non-`null` or `timeoutMs` elapses. */
async function pollForDriver<T>(check: () => T | null, timeoutMs: number): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const result = check();
    if (result !== null) return result;
    if (Date.now() - start >= timeoutMs) return null;
    await settle();
  }
}

/** Every driver entry below that needs the whole plugin throws this — clearly, never silently — the moment `mounted` is `null` (WBX-16c's own brief), rather than letting a `TypeError` on `mounted.plugin`/`mounted.app` stand in for it. */
function requireMountedForDriver(
  mounted: MountedPlugin<OleaPlugin> | null,
  method: string,
): MountedPlugin<OleaPlugin> {
  if (mounted === null) {
    throw new Error(
      `__oleaSimulatorDriver.${method}(): the whole plugin is not mounted (degraded fallback ` +
        'mode) — the real command registry/views this method drives through do not exist in ' +
        'the single-view fallback mount (see this module\'s "Degraded fallback" doc).',
    );
  }
  return mounted;
}

/**
 * `conceptRef`'s fallback when {@link driverExplain} is called without one:
 * the vault's own first file stands in for "the first available" thing to
 * explain — matching {@link SimulatorWalkDriver.listFilePaths}'s own
 * "unfiltered, caller picks" posture. Never returned in a driver result
 * (INV-3: no vault content echoed back to a caller that might log it).
 */
function defaultExplainTopic(mounted: MountedPlugin<OleaPlugin>): string {
  const [first] = mounted.app.vault.getFiles();
  if (first === undefined) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): conceptRef was omitted and the vault has no files to ' +
        'pick a default topic from.',
    );
  }
  const base = first.path.split('/').pop() ?? first.path;
  return base.replace(/\.[^./]+$/, '');
}

/**
 * `explain(text, conceptRef?)` — the ON-DEMAND door onto `ExplainBackModal`
 * (F5.1, `[D-163]`), driven exactly the way her own palette invocation and
 * typing would:
 *
 * 1. `mounted.plugin.invokeCommand(OLEA_COMMAND_EXPLAIN_BACK)`
 *    (`obsidian-shim/index.ts:1235`) — the same check-then-execute call the
 *    palette's own click makes (`index.ts:1218`). Its registered `callback`
 *    is `main.ts`'s `openExplainBack` handler (`main.ts:769`), which calls
 *    the plugin's one construction point, `openExplainBackModal` (`main.ts:2369`),
 *    with `{ kind: 'freeform' }` — the same seed every on-demand invocation
 *    gets; there is no other seed this command can produce.
 * 2. That seed opens on `ExplainBackModal`'s topic picker
 *    (`explain-back/modal.ts:242` sets phase `'topic'`; `renderTopicPhase`,
 *    `modal.ts:446-456`) — its `.olea-explain-back-topic` input is set to
 *    `conceptRef` (or {@link defaultExplainTopic} when omitted) and its
 *    `"${EXPLAIN_BACK_TOPIC_CONTINUE_LABEL}"` button is clicked, calling
 *    `resolveTopicPrompt` (`modal.ts:273`) exactly as her own click would.
 * 3. Waits for that to resolve into either the answer box
 *    (`renderAnsweringPhase`, `modal.ts:463-474`) or an
 *    `insufficient-notes` refusal (`modal.ts:279-296`) — both are real
 *    outcomes of the SAME vault-backed retrieval her own click triggers.
 * 4. On the answer box: sets `text` into `.olea-explain-back-answer` and
 *    clicks `"${EXPLAIN_BACK_SUBMIT_LABEL}"`, calling `submitAnswer`
 *    (`modal.ts:318`) — the real grading round trip
 *    (`deps.grade`/`gradeExplainBackAttempt`, `main.ts:2234`).
 * 5. On a graded verdict (`renderGradedPhase`, `modal.ts:476-544`): clicks
 *    `"${EXPLAIN_BACK_ACCEPT_LABEL}"`, calling `acceptGrading`
 *    (`modal.ts:351`) — the real accept/observe/SOLO-depth chain
 *    (`acceptExplainBackGradingWithObservation`, `recordSoloGradeAndReview`).
 * 6. Reads the outcome off `renderAcceptedPhase`'s own rendering
 *    (`modal.ts:566-586`) and clicks "Done" to close — the same close her
 *    own click would make.
 *
 * Every refusal along the way (command unavailable, topic refusal, grading
 * refusal) short-circuits into `{ outcome: 'unavailable', reason }` rather
 * than continuing to click through a state that was never reached.
 */
export async function driverExplain(
  mounted: MountedPlugin<OleaPlugin> | null,
  text: string,
  conceptRef?: string,
): Promise<ExplainDriverOutcome> {
  const live = requireMountedForDriver(mounted, 'explain');

  if (!live.plugin.invokeCommand(OLEA_COMMAND_EXPLAIN_BACK)) {
    return {
      outcome: 'unavailable',
      reason: `${OLEA_COMMAND_EXPLAIN_BACK} is not registered (or hidden) right now`,
    };
  }

  const root = await pollForDriver(
    () => queryModalDom<HTMLElement>('.olea-explain-back'),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (root === null) {
    throw new Error(
      `__oleaSimulatorDriver.explain(): ${OLEA_COMMAND_EXPLAIN_BACK} was invoked but no ` +
        '.olea-explain-back modal ever rendered (explain-back/modal.ts render(), ~L409).',
    );
  }

  const topicInput = root.querySelector<HTMLInputElement>('.olea-explain-back-topic');
  const continueButton = findButtonByLabel(root, EXPLAIN_BACK_TOPIC_CONTINUE_LABEL);
  if (topicInput === null || continueButton === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): the freeform seed did not render its topic picker ' +
        '(explain-back/modal.ts renderTopicPhase, ~L446).',
    );
  }
  topicInput.value = conceptRef ?? defaultExplainTopic(live);
  continueButton.click();

  const afterTopic = await pollForDriver(
    () =>
      root.querySelector<HTMLElement>('.olea-explain-back-answer') ??
      root.querySelector<HTMLElement>('.olea-explain-back-refusal'),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (afterTopic === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): timed out waiting for the topic to resolve into an ' +
        'answer box or a refusal (explain-back/modal.ts resolveTopicPrompt, ~L273).',
    );
  }
  if (afterTopic.matches('.olea-explain-back-refusal')) {
    return { outcome: 'unavailable', reason: afterTopic.textContent ?? undefined };
  }

  const textarea = afterTopic as HTMLTextAreaElement;
  textarea.value = text;
  const submitButton = findButtonByLabel(root, EXPLAIN_BACK_SUBMIT_LABEL);
  if (submitButton === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): the answer box rendered with no submit button ' +
        '(explain-back/modal.ts renderAnsweringPhase, ~L463).',
    );
  }
  submitButton.click();

  const afterSubmit = await pollForDriver(
    () =>
      root.querySelector<HTMLElement>('.olea-explain-back-actions') ??
      root.querySelector<HTMLElement>('.olea-explain-back-refusal'),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (afterSubmit === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): timed out waiting for a grading verdict or a refusal ' +
        '(explain-back/modal.ts submitAnswer, ~L318).',
    );
  }
  if (afterSubmit.matches('.olea-explain-back-refusal')) {
    return { outcome: 'unavailable', reason: afterSubmit.textContent ?? undefined };
  }

  const acceptButton = findButtonByLabel(afterSubmit, EXPLAIN_BACK_ACCEPT_LABEL);
  if (acceptButton === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): the graded phase rendered with no accept button ' +
        '(explain-back/modal.ts renderGradedPhase, ~L536).',
    );
  }
  acceptButton.click();

  // `'Done'` is `renderAcceptedPhase`'s own inline literal (`modal.ts:584`),
  // not one of `./copy.ts`'s exported labels — matched by text for the same
  // reason `EXPLAIN_BACK_ACCEPT_LABEL` etc. are imported rather than
  // retyped: never invent a string the modal itself does not render.
  const doneButton = await pollForDriver(
    () => findButtonByLabel(root, 'Done'),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (doneButton === null) {
    throw new Error(
      '__oleaSimulatorDriver.explain(): timed out waiting for the accepted phase\'s "Done" ' +
        'button (explain-back/modal.ts renderAcceptedPhase, ~L566).',
    );
  }
  const outcome = root.querySelector('.olea-explain-back-outcome') !== null ? 'graded' : 'degraded';
  doneButton.click();
  return { outcome };
}

/**
 * `contest(target)` — clicks the identical rendered gesture her own tap
 * would, never `contestClaim`/`GradeContestPort.contestGrade` directly:
 *
 * - `'today'`: `.olea-today-contest-gesture` (`today/view.ts:452`,
 *   `renderContestGesture`) opens the dispute sheet
 *   (`openDisputeSheet`, `today/view.ts:462`); its own
 *   `.olea-today-contest-record` button (`today/view.ts:496`, present only
 *   when `DisputeSheet.gestureLabel` is non-`null`) is then clicked, calling
 *   `recordDispute` (`today/view.ts:502`) — the real
 *   `TodayContestSupport.contest` write (`today/contest.ts`).
 * - `'review'`: `.olea-review-contest` (`review/view.ts:1268`) is clicked
 *   directly — no sheet, one gesture — calling `handleContestGrade`
 *   (`review/view.ts:833`), the real `ReviewSession.contestGrade`
 *   (`review/session.ts:557`, which only fires in the `mcq-answered`
 *   phase) and its `GradeContestPort.contestGrade` write (`review/contest.ts`).
 *
 * Both surfaces render inside the simulator's OWN iframe
 * (`queryShellDom`'s own doc), never the modal's top-document host.
 * `'unavailable'` (never a throw) is the honest outcome whenever the
 * gesture — or, for `'today'`, the sheet's own record button — was never
 * rendered to click; that is a real, walkable state (nothing due to
 * contest right now), not a wiring failure.
 */
export async function driverContest(
  mounted: MountedPlugin<OleaPlugin> | null,
  shellRoot: HTMLElement,
  target: 'review' | 'today',
): Promise<ContestDriverOutcome> {
  requireMountedForDriver(mounted, 'contest');

  if (target === 'review') {
    const gesture = queryShellDom<HTMLButtonElement>(shellRoot, '.olea-review-contest');
    if (gesture === null) {
      return {
        outcome: 'unavailable',
        reason:
          'no .olea-review-contest gesture is rendered right now (review/session.ts ' +
          'contestGrade() only fires in the mcq-answered phase — review/view.ts:1268)',
      };
    }
    gesture.click();
    const resolved = await pollForDriver(
      () => (queryShellDom(shellRoot, '.olea-review-contest') === null ? true : null),
      DRIVER_POLL_TIMEOUT_MS,
    );
    if (resolved === null) {
      throw new Error(
        "__oleaSimulatorDriver.contest('review'): timed out waiting for the contest gesture " +
          'to resolve into a quarantine badge (review/view.ts handleContestGrade, ~L833).',
      );
    }
    return { outcome: 'recorded' };
  }

  const gesture = queryShellDom<HTMLButtonElement>(shellRoot, '.olea-today-contest-gesture');
  if (gesture === null) {
    return {
      outcome: 'unavailable',
      reason:
        'no .olea-today-contest-gesture is rendered on the Today panel right now ' +
        '(today/view.ts renderContestGesture, ~L445)',
    };
  }
  gesture.click();

  const sheet = await pollForDriver(
    () => queryShellDom<HTMLElement>(shellRoot, '.olea-today-contest-sheet'),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (sheet === null) {
    throw new Error(
      "__oleaSimulatorDriver.contest('today'): timed out waiting for the dispute sheet to " +
        'open after clicking the gesture (today/view.ts openDisputeSheet, ~L462).',
    );
  }
  const record = sheet.querySelector<HTMLButtonElement>('.olea-today-contest-record');
  if (record === null) {
    return {
      outcome: 'unavailable',
      reason:
        'the dispute sheet opened but rendered no record gesture — DisputeSheet.gestureLabel ' +
        'is null for this claim (today/contest.ts)',
    };
  }
  record.click();

  const closed = await pollForDriver(
    () => (queryShellDom(shellRoot, '.olea-today-contest-sheet') === null ? true : null),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (closed === null) {
    throw new Error(
      "__oleaSimulatorDriver.contest('today'): timed out waiting for the dispute sheet to " +
        'close after recording (today/view.ts recordDispute, ~L502).',
    );
  }
  return { outcome: 'recorded' };
}

/**
 * `openRegistry()` — `mounted.plugin.invokeCommand(OLEA_COMMAND_REGISTRY_OPEN)`
 * (`obsidian-shim/index.ts:1235`), whose registered `callback` is `main.ts`'s
 * `openRegistry` handler (`main.ts:731`, `void this.revealRegistryView()`) —
 * fire-and-forget, so this resolves only once
 * `app.workspace.getLeavesOfType(VIEW_TYPE_OLEA_REGISTRY)` actually reports a
 * leaf, the same "or create one" primitive `revealRegistryView`
 * (`main.ts:2668`) itself uses.
 */
export async function driverOpenRegistry(mounted: MountedPlugin<OleaPlugin> | null): Promise<void> {
  const live = requireMountedForDriver(mounted, 'openRegistry');

  if (!live.plugin.invokeCommand(OLEA_COMMAND_REGISTRY_OPEN)) {
    throw new Error(
      `__oleaSimulatorDriver.openRegistry(): ${OLEA_COMMAND_REGISTRY_OPEN} is not registered ` +
        'right now.',
    );
  }
  const opened = await pollForDriver(
    () => (live.app.workspace.getLeavesOfType(VIEW_TYPE_OLEA_REGISTRY).length > 0 ? true : null),
    DRIVER_POLL_TIMEOUT_MS,
  );
  if (opened === null) {
    throw new Error(
      '__oleaSimulatorDriver.openRegistry(): timed out waiting for the registry view leaf ' +
        `(${VIEW_TYPE_OLEA_REGISTRY}) to exist after invoking ${OLEA_COMMAND_REGISTRY_OPEN} ` +
        '(main.ts revealRegistryView, ~L2668).',
    );
  }
}

/** `runCommand(id)` — see {@link SimulatorWalkDriver.runCommand}'s own doc. */
export function driverRunCommand(mounted: MountedPlugin<OleaPlugin> | null, id: string): boolean {
  const live = requireMountedForDriver(mounted, 'runCommand');
  return live.plugin.invokeCommand(id);
}

function installSimulatorWalkDriver(
  controller: SimulatorController,
  mounted: MountedPlugin<OleaPlugin>,
  shellRoot: HTMLElement,
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
    explain: (text, conceptRef) => driverExplain(mounted, text, conceptRef),
    contest: (target) => driverContest(mounted, shellRoot, target),
    openRegistry: () => driverOpenRegistry(mounted),
    runCommand: (id) => driverRunCommand(mounted, id),
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
  /**
   * WBX-9 (`ol-3ux7.64.11`): the course-setup seen-codes recorded in an
   * EARLIER mount, as of the top of the CURRENT `remountPane()` call — the
   * snapshot {@link courseSetupSeenBridge}'s watcher compares an opening
   * modal's code against. Refreshed at the top of every `remountPane()`;
   * empty right after `reset()` clears the shared plugin-data blob (the one
   * legitimate reopen — see `course-setup-bridge.ts`'s own doc).
   */
  private beforeMountCourseSetupSeenCodes: ReadonlySet<string> = new Set();
  /** Installed once, for this controller's whole lifetime — see `course-setup-bridge.ts`'s own doc on why a per-remount poll cannot do this job. */
  private readonly courseSetupSeenBridge: CourseSetupSeenBridge;
  /** Bumped once per `remountPane()` call, written onto `elements.root`'s `[data-wb-remount]` — see {@link SimulatorControllerOptions.elements}'s own doc. */
  private remountCount = 0;

  private constructor(
    private readonly elements: SimulatorShellElements,
    private readonly scheduler: Scheduler,
    private store: SimulatorStore,
    private vault: PersistentVaultSource,
    private clock: SimulatorClock,
    private readonly uninstallClock: () => void,
    private pluginDataHost: ObsidianDataHost,
    private deviceId: string,
    private readonly transport: SimulatorTransport,
    private readonly uninstallTransportBridge: () => void,
    /** The world descriptor's own display label (`world.ts`) — the badge reads this, never a hard-coded `'FIXTURE'` (`ol-3ux7.64.14` [WBX-12], design doc §7). */
    private readonly worldLabel: string,
    /** The world descriptor's `asOf`, parsed — the instant `reset()` and (via `create()`'s clock construction) a never-touched first mount return to, never `WORKBENCH_NOW` by name (WBX-12: the fixture world's `asOf` happens to equal `WORKBENCH_NOW`'s date, but a private/persona world's does not). */
    private readonly worldAsOf: Date,
    /**
     * The FULL world descriptor (`ol-3ux7.64.16` [WBX-13]) — `worldLabel`/
     * `worldAsOf` above are the two fields every pre-WBX-13 caller needed;
     * this bead's own two additions (`seedPersonaHistoryIfNeeded`'s
     * `streamSpec`, and the scrubber's own `asOf` string, kept as the raw
     * `YYYY-MM-DD` rather than re-derived from `worldAsOf`'s parsed `Date` to
     * avoid a needless UTC round-trip) both need the descriptor whole rather
     * than one more scalar field apiece.
     */
    private readonly worldDescriptor: SimulatorWorldDescriptor,
  ) {
    this.courseSetupSeenBridge = installCourseSetupSeenBridge(
      this.pluginDataHost,
      () => this.beforeMountCourseSetupSeenCodes,
    );
  }

  static async create(options: SimulatorControllerOptions): Promise<SimulatorController> {
    const dbName = options.dbName ?? DEFAULT_SIMULATOR_DB_NAME;
    const scheduler = options.scheduler ?? createFsrsScheduler();
    // Read before anything else touches the clock — `worldAsOf` below feeds
    // `createSimulatorClock`'s own fallback (design doc §3/§7, F9.S6: "on
    // first open... the simulated date is the world's asOf, not real
    // today"). Plain `fetch`: the transport bridge (a POST-only interceptor,
    // see `installTransportBridge`'s own doc) is not installed yet, and this
    // is a GET regardless.
    const worldLoad = await loadSimulatorWorld(globalThis.fetch.bind(globalThis));
    const worldAsOf = parseWorldAsOf(worldLoad.descriptor);
    const store = await openSimulatorStore(dbName);
    const base: MemoryVaultSource = await loadFixtureVault();
    const vault = await PersistentVaultSource.create(base, store);
    // Before the clock/mount: "first open" for a persona world's seed
    // events (WBX-13 consuming WBX-14's contract) — see
    // `seedPersonaHistoryIfNeeded`'s own doc.
    await seedPersonaHistoryIfNeeded(
      worldLoad.descriptor,
      vault,
      store,
      globalThis.fetch.bind(globalThis),
    );
    const clock = await createSimulatorClock(store, worldAsOf);
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
      worldLoad.descriptor.label,
      worldAsOf,
      worldLoad.descriptor,
    );
    // The term scrubber's visibility cutoff (`ol-3ux7.64.16` [WBX-13]) starts
    // in step with the clock BEFORE anything mounts — see
    // `syncVisibilityCutoff`'s own doc.
    controller.syncVisibilityCutoff();
    // Set BEFORE `renderControls()`/`remountPane()` below — neither of those
    // touches the notice host on this path (`remountPane`'s own doc: it
    // deliberately never clears a notice a caller just set), so this survives
    // the very first mount, matching every other "set then remount" call in
    // this class (`rateNextDue`, `reset`).
    if (worldLoad.fallback) {
      controller.setNotice(
        '/simulator-world.json could not be read — showing the built-in FIXTURE default.',
      );
    }
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
    this.courseSetupSeenBridge.dispose();
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
    this.elements.main.empty();
    this.elements.right.empty();
    // WBX-9: read BEFORE `mountPlugin` below — the fresh `OleaPlugin`
    // instance's own cold-start scan can start proposing courses during
    // `onload()`, and this snapshot must reflect only what an EARLIER mount
    // recorded, never anything this mount's own scan adds (see
    // `course-setup-bridge.ts`'s own doc on why the watcher needs a thunk
    // rather than reading this field directly).
    this.beforeMountCourseSetupSeenCodes = await loadCourseSetupSeenCodes(this.pluginDataHost);

    const missing = missingWholePluginGlobals();
    if (missing.length === 0) {
      const mounted = await mountPlugin(OleaPlugin, {
        vault: toShimVaultSource(this.vault),
        pluginData: this.pluginDataHost,
      });
      this.mountedPlugin = mounted;
      this.elements.main.appendChild(mounted.hostEl);
      // WBX-12: a REAL second workspace pool, appended into the shell's own
      // right-sidebar region — `obsidian-shim/index.ts`'s `Workspace.
      // rightContainerEl`'s own doc explains why this stopped being the same
      // DOM `mounted.hostEl` already carries (before this bead, `getRightLeaf`
      // aliased `getLeaf('tab')`, so both lived in one pane).
      this.elements.right.appendChild(mounted.app.workspace.rightContainerEl);

      // Home lands in the MAIN pane (this bead's own ask — `revealHomeView`
      // in `packages/plugin/src/main.ts` is PRIVATE and puts Home in the
      // right sidebar in real Obsidian; `openOrRevealView`'s own doc explains
      // why this calls the real workspace primitives directly instead).
      // Today reveals in the RIGHT sidebar the way the plugin's own
      // `revealTodayView` places it — the real command, not a hand-built
      // view, so a missing/renamed command surfaces as this throwing rather
      // than a silently blank pane. Order matters only for which one settles
      // first; both coexist on screen once this finishes.
      await openOrRevealView(mounted.app, VIEW_TYPE_OLEA_HOME);
      // Deliberately does NOT touch the notice: `rateNextDue`/`reset` call
      // `setNotice(...)` right before this remount, and that message
      // ("Rated 1 item…", "Reset to the fixture snapshot.") must survive it
      // — clearing it here was a real bug caught by the browser smoke test
      // (`ol-3ux7.64.10` [WBX-1b]): every remount wiped the message the
      // action that triggered it had just set.
      mounted.plugin.invokeCommand(OLEA_COMMAND_TODAY_OPEN);
      this.populateRibbon(mounted);
      installSimulatorWalkDriver(this, mounted, this.elements.root);
    } else {
      this.setDegradedNotice(missing);
      const deps = this.buildFallbackDeps();
      const view = new TodayView(makeSimpleLeaf(this.elements.main), deps);
      this.elements.main.appendChild(view.containerEl);
      this.fallbackView = view;
      void view.onOpen();
      await settle();
      this.elements.ribbonViews.empty();
    }

    this.renderBadge();
    this.refreshScrubber();
    // WBX-9's remount-complete signal: bumped once mount (and, for the
    // whole-plugin path, Home landing in the main pane and Today revealing
    // in the right sidebar) has fully resolved — the one settle condition
    // `e2e/simulator/helpers.ts`'s `waitForRemount` needs, in place of the
    // approximate content waits used before this bead. See
    // `SimulatorControllerOptions.elements`'s own doc.
    this.remountCount += 1;
    this.elements.root.setAttribute('data-wb-remount', String(this.remountCount));
  }

  /**
   * (Re)builds the ribbon's per-view buttons from whatever THIS mount's
   * plugin has registered so far (`Workspace.registeredViewTypes()` — never
   * a hand list, `shell.ts`'s own doc) and relocates the plugin's own real
   * `[data-wb-palette-toggle]` button into the ribbon's palette slot. Both
   * are rebuilt every remount because `mounted` (and therefore its view
   * registry and its `hostEl`'s own toggle button) is a brand-new instance
   * each time — §3's "full onunload/onload" remount discipline.
   *
   * `ribbonPaletteSlot.empty()` FIRST is load-bearing, not tidiness: the
   * slot is part of `elements.root`, which `remountPane()` never empties
   * (unlike `elements.main`) — a moved-in button therefore survives the
   * `elements.main.empty()` that clears out the REST of the old mount's
   * `hostEl`, and without this line every remount would leave the previous
   * mount's now-orphaned toggle button sitting here forever, accumulating
   * one stale button per remount (caught by `e2e/simulator/shell.spec.ts`
   * and the whole-plugin/goldens specs, which every started resolving
   * `[data-wb-palette-toggle]` to more than one element after a reset or a
   * day-advance).
   */
  private populateRibbon(mounted: MountedPlugin<OleaPlugin>): void {
    renderRibbonViews(
      this.elements.ribbonViews,
      mounted.app.workspace.registeredViewTypes(),
      (viewType) => {
        void openOrRevealView(mounted.app, viewType);
      },
    );
    this.elements.ribbonPaletteSlot.empty();
    const paletteToggle = mounted.hostEl.querySelector<HTMLElement>('[data-wb-palette-toggle]');
    if (paletteToggle !== null) this.elements.ribbonPaletteSlot.appendChild(paletteToggle);
  }

  private renderBadge(): void {
    renderProvenanceBadge(this.elements.badge, {
      world: this.worldLabel,
      simulatedDate: formatSimulatedDate(this.clock.now()),
      transport: this.transport,
    });
  }

  /**
   * Keeps the term scrubber's handle and date label in step with the clock —
   * called on every remount (`remountPane`'s own call site, alongside
   * `renderBadge`) so `[data-sim-advance]` "moves the slider" exactly as this
   * bead's brief asks, and so `[data-sim-reset]`/a committed scrub move the
   * handle back to wherever the clock actually landed. `renderTermScrubber`
   * is idempotent (`term-scrubber.ts`'s own doc) — this never rebuilds the
   * DOM or re-attaches the listeners `renderControls()` wired once.
   */
  private refreshScrubber(): void {
    renderTermScrubber(this.elements.controls, {
      asOf: this.worldDescriptor.asOf,
      current: formatSimulatedDate(this.clock.now()),
    });
  }

  /**
   * Keeps `this.vault`'s term-scrubber visibility cutoff (`persistent-
   * vault.ts`'s own doc) in step with the clock's current day. Called
   * everywhere the clock moves — `create()` (before the first mount),
   * `advanceOneDay`, `jumpToDate` (the scrubber's own mechanism) and
   * `reset()` (against the FRESH vault `reset()` just built) — so a review
   * written today is never accidentally hidden by a cutoff left over from
   * before the clock caught up to it, and so scrubbing back always hides
   * exactly what the design doc calls "the future," never more or less.
   */
  private syncVisibilityCutoff(): void {
    this.vault.setVisibilityCutoff(formatSimulatedDate(this.clock.now()));
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

    // The term scrubber (`ol-3ux7.64.16` [WBX-13], design doc §4b) — replaces
    // the bare `[data-sim-jump]` date input this control used to be. Built
    // once here; `refreshScrubber()` (called from every `remountPane()`,
    // alongside `renderBadge()`) keeps its handle and label in step with the
    // clock without re-attaching these listeners.
    const scrubber = renderTermScrubber(this.elements.controls, {
      asOf: this.worldDescriptor.asOf,
      current: this.worldDescriptor.asOf,
    });
    // Live label update while dragging/keying through the slider — cheap,
    // and gives immediate feedback for the date a release would jump to —
    // but never itself a clock move: only `change` (fired on release, or
    // once per discrete keyboard step) commits to a jump and a remount, the
    // same "settle, don't spam remounts mid-drag" shape `[data-sim-advance]`
    // and the old date input's own `change`-only wiring already used.
    scrubber.input.addEventListener('input', () => {
      scrubber.dateLabel.setText(
        scrubberDateAt(this.worldDescriptor.asOf, Number(scrubber.input.value)),
      );
    });
    scrubber.input.addEventListener('change', () => {
      void this.scrubTo(Number(scrubber.input.value));
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
    this.syncVisibilityCutoff();
    await this.remountPane();
  }

  /**
   * The term scrubber's `change` handler (`ol-3ux7.64.16` [WBX-13]):
   * `days` is whole days past the world's `asOf`, already clamped to
   * `[0, SCRUBBER_MAX_DAYS]` by the native range input itself (its own
   * `min`/`max` — `term-scrubber.ts`'s `renderTermScrubber`). Forward is
   * `advanceOneDay` made continuous, by construction: both bottom out in
   * `jumpToDate`, the same clock-move-then-remount mechanism. Backward
   * relies on {@link syncVisibilityCutoff} (called inside `jumpToDate`)
   * hiding, never deleting, any review-log record dated after the day this
   * lands on — see `persistent-vault.ts`'s own doc.
   */
  async scrubTo(days: number): Promise<void> {
    await this.jumpToDate(scrubberDateAt(this.worldDescriptor.asOf, days));
  }

  /** `jumpToDate`'s own `dateIso` is `YYYY-MM-DD`, interpreted as local midnight — the scrubber's (`scrubTo`) sole caller today, kept as its own method since "jump the clock to an arbitrary day and remount" is the reusable primitive, not the scrubber's slider math. */
  async jumpToDate(dateIso: string): Promise<void> {
    const asOf = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(asOf.getTime())) return;
    await this.clock.jumpTo(asOf);
    this.syncVisibilityCutoff();
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
    await this.clock.jumpTo(this.worldAsOf);
    const freshBase = await loadFixtureVault();
    this.vault = await PersistentVaultSource.create(freshBase, this.store);
    // `resetAll` clears the seeded-world marker along with the overlay
    // (`store.ts`'s own doc) — a persona world's history is replanted here,
    // into the SAME fresh vault this reset just built, before anything reads
    // it (`seedPersonaHistoryIfNeeded`'s own doc: "first open or after
    // Reset").
    await seedPersonaHistoryIfNeeded(
      this.worldDescriptor,
      this.vault,
      this.store,
      globalThis.fetch.bind(globalThis),
    );
    // Back to the world's own asOf — unhides everything, since nothing is
    // dated after the cutoff at asOf itself (the fresh overlay above has, at
    // most, this world's own seed history up to asOf and whatever the
    // plugin's cold-start writes next).
    this.syncVisibilityCutoff();
    this.deviceId = await ensureDeviceId(this.pluginDataHost);
    // `resetAll` clears the plugin-data store this lives in — see its own doc.
    await seedSimulatorWorkerConfig(this.pluginDataHost);
    this.setNotice('Reset to the fixture snapshot.');
    await this.remountPane();
  }
}
