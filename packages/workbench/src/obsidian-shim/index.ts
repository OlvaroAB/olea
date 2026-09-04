/**
 * The `obsidian` module, for the workbench only.
 *
 * `tsconfig.json`'s `paths` and `build.mjs`'s esbuild alias both point the
 * specifier `obsidian` at this file, so the REAL view sources under
 * `packages/plugin` compile and bundle unchanged. Nothing in
 * `packages/workbench` imports `obsidian` itself — INV-1 holds here the same
 * way it holds in core, and `scripts/check-inv1.mjs` scans this package.
 *
 * ## The shim rule (WB-1, ol-with)
 *
 * **This shim covers the chrome layer and nothing else.** A view that needs more
 * than what is below is a view holding logic that belongs in `olea-core`, and
 * the correct response is a core-ward refactor bead — never another method here.
 * The README's shim ledger records every time that judgement was made and which
 * way it went.
 *
 * What "chrome" means concretely, and why each member below qualifies:
 *
 * - `ItemView` — a workspace tab's lifecycle and its two elements. It answers
 *   "where do I paint and when am I open", never "what do I paint".
 * - `WorkspaceLeaf.detach()` — closing the tab. Host window management.
 * - `registerDomEvent` — listener bookkeeping tied to that lifecycle.
 * - `Notice` — the host's transient toast.
 *
 * Every one of those is a fact about the window, not about review. The moment a
 * member here would have to know what a card, a rating or a queue is, the shim
 * has stopped being chrome.
 *
 * These are hand-written declarations, not a copy of Obsidian's typings: the
 * plugin package keeps the real `obsidian` devDependency and typechecks against
 * it, so the two are cross-checked by `packages/plugin`'s own `typecheck` script.
 * If a plugin view starts using an Obsidian member this file does not declare,
 * the WORKBENCH build breaks — loudly, at the seam, which is the point.
 */

import type {
  EventRef,
  PluginDataStore,
  PluginManifest,
  ShimVaultSource,
  TFile,
} from './vault-shim.js';
import {
  createInMemoryPluginDataStore,
  DEFAULT_MANIFEST,
  MetadataCache,
  Vault,
} from './vault-shim.js';

/** Everything in `./vault-shim.ts` is part of the `obsidian` surface this file aliases to — re-exported here rather than duplicated, per this file's own "one alias target" rule (see `tsconfig.json`/`build.mjs`, cited above). */
export * from './vault-shim.js';

/**
 * ## Whole-plugin mount (`ol-3ux7.64.3` [WBX-2], `docs/dev/simulator-design.md`
 * §4 in olea-service)
 *
 * The section above is WB-1/WB-2's original "chrome only" shim, unchanged.
 * This tranche adds what `packages/plugin/src/main.ts` and
 * `commands/register-commands.ts` need to mount the WHOLE plugin — commands
 * and a palette, view registration and leaves, a settings route,
 * `register`/`registerEvent`/`registerInterval` lifecycle bookkeeping,
 * `loadData`/`saveData`, and a `Vault`/`TFile`/`TFolder`/`Platform`/
 * `apiVersion` layer over an injected vault source (`./vault-shim.ts`).
 * `../plugin-bridge.ts`'s `mountPlugin` is the one new entry point that
 * exercises all of it — see that file's own doc for the exact call a host
 * (WBX-1's `simulator/`/`main.ts`) makes.
 *
 * **What stays `@manual` here — named once, at the head of the file, per
 * this bead's own instruction, and matching `docs/dev/simulator-design.md`
 * §4's table exactly:**
 *
 * - Hotkey **binding** through Obsidian's real keymap (the palette below
 *   renders a hotkey's label; it never listens for the chord).
 * - Split panes, drag, pinning — every leaf here is a single-pane tab strip.
 * - Obsidian's real right-click context menu (`Workspace.trigger('file-menu',
 *   ...)` below is wired and recorded; nothing renders a native menu).
 * - Rename events (`Vault.on('rename', ...)` is declared, for typecheck
 *   parity with `ObsidianSource.watch`, but never fires — see
 *   `./vault-shim.ts`'s `ShimVaultEvent` doc).
 * - Sync races and INV-2 byte-identical round-trips through a REAL vault —
 *   this shim's frontmatter reader is a reduced, read-only scalar scanner,
 *   never the round-trip engine (see `./vault-shim.ts`'s `MetadataCache`
 *   doc).
 * - Mobile chrome (`Platform.isMobile` is always `false`).
 * - `Bases` rendering and live metadata-cache invalidation beyond
 *   create/modify/delete.
 *
 * `features/F9-simulator.md`'s F9.S3 `@manual` scenario cites this exact
 * list.
 */

/** Obsidian's `IconName` is a string alias; the view only ever returns a literal. */
export type IconName = string;

/**
 * The host tab a view is mounted in. `detach()` is the only member any mounted
 * view uses, so it is the only one declared.
 */
export interface WorkspaceLeaf {
  detach(): void;
}

type DomEventListener<K extends keyof HTMLElementEventMap> = (
  event: HTMLElementEventMap[K],
) => unknown;

interface RegisteredListener {
  readonly target: HTMLElement;
  readonly type: string;
  readonly listener: EventListener;
}

/**
 * Obsidian's `Component`, reduced to the one method the review view uses.
 * `registerDomEvent` exists so a listener dies with the component; the workbench
 * honours that by calling `unloadComponent()` when it swaps views.
 */
export class Component {
  private readonly registered: RegisteredListener[] = [];
  private readonly teardownCallbacks: Array<() => void> = [];
  private readonly intervalIds: number[] = [];

  registerDomEvent<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: DomEventListener<K>,
  ): void {
    const bound = listener as EventListener;
    target.addEventListener(type, bound);
    this.registered.push({ target, type, listener: bound });
  }

  /**
   * Obsidian's `Component.register` (§4 gap table: `main.ts`'s vault-watch
   * and keyword-index-unsubscribe calls). Runs `callback` exactly once, at
   * teardown (`unloadComponent()`), same as every other `register*` member.
   */
  register(callback: () => void): void {
    this.teardownCallbacks.push(callback);
  }

  /**
   * Obsidian's `Component.registerEvent` (§4 gap table: `main.ts`'s
   * `workspace.on('file-menu', ...)` registration). Takes the `EventRef`
   * `Workspace.on`/`Vault.on` (`./vault-shim.ts`) both return and unsubscribes
   * it at teardown.
   */
  registerEvent(ref: { unsubscribe(): void }): void {
    this.teardownCallbacks.push(() => ref.unsubscribe());
  }

  /**
   * Obsidian's `Component.registerInterval` (§4 gap table: `main.ts`'s
   * ingestion-tick interval). Returns `id` unchanged, matching Obsidian's own
   * convention that callers may still hold and clear it themselves; this
   * class clears it too, at teardown, so a forgotten `clearInterval` is not a
   * leak.
   */
  registerInterval(id: number): number {
    this.intervalIds.push(id);
    return id;
  }

  /**
   * Obsidian's `Component.onload` — concrete (never abstract) on the real
   * class, which is what lets `main.ts`'s `override async onload(): Promise<void> { ... }`
   * compile. A no-op by default; `../plugin-bridge.ts`'s `mountPlugin` is
   * what actually calls this, once, after the vault is warm.
   */
  onload(): void | Promise<void> {}

  /**
   * Obsidian's `Component.onunload` — concrete (never abstract) on the real
   * class, which is what lets `main.ts`'s `override onunload(): void { ... }`
   * compile. A no-op by default: chrome has nothing of its own to tear down.
   */
  onunload(): void {}

  /**
   * Not an Obsidian API name — the workbench's own teardown hook, called by
   * the workbench's own view-swap code (`main.ts:901`, pre-existing) and now
   * also by `../plugin-bridge.ts`'s `mountPlugin().unmount()` for a whole
   * `Plugin`. Runs `onunload()` first (so a subclass's own teardown logic
   * fires before this class reclaims anything under it), then drains every
   * `register`/`registerEvent`/`registerInterval` cleanup, then the DOM-event
   * cleanup this method always had.
   */
  unloadComponent(): void {
    this.onunload();
    for (const cleanup of this.teardownCallbacks.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        console.error('[obsidian-shim] Component teardown callback threw', error);
      }
    }
    for (const id of this.intervalIds.splice(0)) {
      // The bare global, not `window.clearInterval`: `main.ts` mints the id via
      // the browser's `window.setInterval` (a global this shim does not wrap —
      // see this file's head-of-file note), but clearing it needs no `window`
      // reference, which keeps this class usable under plain Node (this
      // package's own vitest config has no `window` at all).
      clearInterval(id);
    }
    for (const { target, type, listener } of this.registered) {
      target.removeEventListener(type, listener);
    }
    this.registered.length = 0;
  }
}

/**
 * A workspace tab. `containerEl`/`contentEl` mirror Obsidian's split: the outer
 * element the host owns, and the inner one the view is free to empty and rebuild.
 */
export abstract class ItemView extends Component {
  readonly leaf: WorkspaceLeaf;
  readonly containerEl: HTMLElement;
  readonly contentEl: HTMLElement;
  /** Whether the tab participates in back/forward navigation. Settable — `ReviewView` turns it off. */
  navigation = true;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'view-content';
    this.containerEl.appendChild(this.contentEl);
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;

  getIcon(): IconName {
    return 'document';
  }

  onOpen(): Promise<void> {
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Obsidian's transient toast. The workbench renders it into a corner region so a
 * notice that the product would show is visible rather than swallowed — several
 * honest-placeholder paths (e.g. `scenarios.ts`'s edit port, which has no
 * workbench editor to open) communicate only through one.
 */
export class Notice {
  constructor(message: string, timeoutMs = 4000) {
    const host = document.querySelector('[data-wb-notices]');
    if (host === null) {
      console.info('[obsidian-shim] Notice:', message);
      return;
    }
    const el = document.createElement('div');
    el.className = 'wb-notice';
    el.setAttribute('data-wb-notice', 'true');
    el.textContent = message;
    host.appendChild(el);
    if (timeoutMs > 0) {
      window.setTimeout(() => {
        el.remove();
      }, timeoutMs);
    }
  }
}

/**
 * `App`/`Workspace`/the richer `WorkspaceLeaf` shape — `ol-z6x2` [WB-2]'s F5
 * tranche adds these for `ExplainBackModal`'s one Obsidian-`App`-shaped
 * dependency: the `[D-171]` "See in registry" hand-off
 * (`registry/obsidian-ports.ts`'s `openRegistryEntryFor`) reaches through
 * `app.workspace` to find-or-open the registry tab and reveal it. Still
 * chrome, not product logic — a workspace-tab lookup/creation is exactly the
 * "where do I paint, not what do I paint" fact `ItemView`'s own doc above
 * draws the line at.
 *
 * `WorkspaceLeaf` therefore gains `view`/`setViewState` as REAL (non-optional)
 * members here, a richer shape than `ItemView`'s own minimal chrome needs —
 * both types share this one exported name because `registry/obsidian-ports.ts`
 * imports `WorkspaceLeaf` from `'obsidian'` (this module) directly, so there
 * is only one symbol it could mean. `main.ts`'s `makeLeaf()` (every
 * ItemView-based flat-surface mount) was updated to supply harmless stub
 * implementations of both new members — see that function's own comment.
 *
 * **What this does NOT do (disclosed, not hidden — DF-20).** `Workspace`
 * tracks leaves and records `revealLeaf` calls; it never registers a real
 * view factory, so a leaf's `view` stays `null` forever and
 * `openRegistryEntryFor`'s own `view instanceof RegistryView` branch (the
 * scroll-and-highlight half) never fires here. The explain-back bridge
 * (`../explain-back-bridge.ts`) asserts that the REAL function ran end to end
 * without throwing and recorded the real hand-off target — not that a second
 * registry screen actually painted. Wiring a genuine cross-surface mount is
 * real, larger follow-up work, not a gap in this shim's own scope.
 */
export interface WorkspaceLeaf {
  detach(): void;
  view: unknown;
  setViewState(state: unknown): Promise<void>;
}

/** A registered view's factory — `Plugin.registerView`'s second argument, matching real Obsidian's own signature exactly. */
export type ViewFactory = (leaf: WorkspaceLeaf) => ItemView;

/**
 * Which single-pane pool a leaf belongs to (`ol-3ux7.64.14` [WBX-12]). Before
 * this bead there was exactly one pool — `getRightLeaf` minted from the same
 * pool `getLeaf('tab')` did (this file's own `git log` shows the alias) — and
 * the simulator's Obsidian-shaped shell is what needed that to stop being
 * true: `revealHomeView`'s main-pane landing and `revealTodayView`'s
 * right-sidebar one only read as two different PLACES if the shim actually
 * has two. `'main'` backs `Workspace.containerEl` (`getLeaf`); `'right'`
 * backs `Workspace.rightContainerEl` (`getRightLeaf`) — see both getters'
 * own docs. Never a THIRD pool: no split panes within either side (`@manual`,
 * unchanged from before this bead).
 */
type LeafPool = 'main' | 'right';

class RecordingWorkspaceLeaf implements WorkspaceLeaf {
  viewType: string | null = null;
  view: ItemView | null = null;

  constructor(
    private readonly workspace: Workspace,
    readonly pool: LeafPool,
  ) {}

  detach(): void {
    this.closeCurrentView();
    this.workspace.forgetLeaf(this);
  }

  private closeCurrentView(): void {
    const closing = this.view;
    if (closing === null) return;
    this.view = null;
    void closing.onClose();
    closing.unloadComponent();
    closing.containerEl.remove();
  }

  /**
   * §4 gap table: real Obsidian instantiates the registered view factory and
   * mounts it here — `revealReviewView`/`revealTodayView`/etc in `main.ts`
   * all depend on this actually doing that, not just recording the type
   * string the old (pre-WBX-2) stub did.
   */
  async setViewState(state: unknown): Promise<void> {
    const type = (state as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== 'string') return;
    if (this.viewType === type && this.view !== null) return;
    this.closeCurrentView();
    this.viewType = type;
    const factory = this.workspace.viewFactoryFor(type);
    if (factory === undefined) {
      console.info(`[obsidian-shim] setViewState: no view registered for type "${type}"`);
      return;
    }
    const view = factory(this);
    this.view = view;
    await view.onOpen();
    this.workspace.onLeafViewMounted(this);
  }
}

/** One pool's DOM (`Workspace.dom`/`rightDom`) — a tab strip over whichever leaf in that pool was last revealed, plus the pane it paints into. */
interface PoolDom {
  readonly containerEl: HTMLElement;
  readonly tabStripEl: HTMLElement;
  readonly paneEl: HTMLElement;
}

/** Builds one pool's `PoolDom` — the same three-element shape `getLeaf`'s main pool and `getRightLeaf`'s right pool each get their own copy of (WBX-12). */
function buildPoolDom(containerAttr: string, tabStripAttr: string, paneAttr: string): PoolDom {
  const containerEl = document.createElement('div');
  containerEl.setAttribute(containerAttr, 'true');
  const tabStripEl = document.createElement('div');
  tabStripEl.setAttribute(tabStripAttr, 'true');
  const paneEl = document.createElement('div');
  paneEl.setAttribute(paneAttr, 'true');
  containerEl.append(tabStripEl, paneEl);
  return { containerEl, tabStripEl, paneEl };
}

/**
 * Obsidian's `Workspace`, reduced to the members `registry/obsidian-ports.ts`
 * reads off it — not just `openRegistryEntryFor`'s three (find an existing
 * leaf of a view type, mint a new tab if none exists, reveal one): that same
 * file's `createObsidianEditInstrumentPort`/`createObsidianOpenSourceLocationPort`
 * (a DIFFERENT surface's own hand-off, never reached by the explain-back →
 * registry path this shim was built for) call `openLinkText` too, and the
 * whole module typechecks regardless of which export a given bridge actually
 * imports — so `openLinkText` is declared here as a harmless no-op stub, not
 * because anything in this package's build calls it.
 *
 * **§4 gap-table addition (WBX-2): `getLeavesOfType`/`getLeaf`/`getRightLeaf`/
 * `revealLeaf`/`detachLeavesOfType` now back a real single-pane DOM —
 * `containerEl` is a `[data-wb-tab-strip]` + `[data-wb-pane]` pair, mounted
 * by whichever leaf is revealed.** No split panes (`@manual`, see `index.ts`'s
 * head-of-file note): each of the two pools below (`getLeaf`'s main pool,
 * `getRightLeaf`'s right one) is its own single pane.
 *
 * **WBX-12 addition: `getRightLeaf` mints into a REAL second pool.** Before
 * this bead `getRightLeaf(_split)` was a one-line `return this.getLeaf('tab')`
 * — every "or create one" call in `packages/plugin/src/main.ts`
 * (`revealTodayView`, `revealHomeView`, `revealGapView`, ...) landed in the
 * SAME pane `getLeaf('tab')` did, so "Today opens in the right sidebar" and
 * "Review opens as a main-pane tab" were indistinguishable here — both just
 * meant "the one pane". The simulator's Obsidian-shaped shell
 * (`docs/dev/simulator-design.md`, `simulator/shell.ts`) needed the two to be
 * actually different DOM subtrees so Home (main pane) and Today (right
 * sidebar) can sit on screen at once; `rightContainerEl` below is that second
 * subtree. `getLeavesOfType`/`detachLeavesOfType` still search across BOTH
 * pools (a leaf's pool is bookkeeping the plugin never asks about — every
 * `revealXxxView` only ever asks "does a leaf of this TYPE exist anywhere"),
 * so reusing an already-open leaf still works regardless of which pool
 * created it.
 */
export class Workspace {
  private readonly leaves: RecordingWorkspaceLeaf[] = [];
  private readonly revealed: WorkspaceLeaf[] = [];
  private readonly viewFactories = new Map<string, ViewFactory>();
  private readonly eventHandlers = new Map<string, Set<(...args: never[]) => void>>();
  private activeLeaf: RecordingWorkspaceLeaf | null = null;
  private activeRightLeaf: RecordingWorkspaceLeaf | null = null;
  private activeFile: TFile | null = null;

  private dom: PoolDom | null = null;
  private rightDom: PoolDom | null = null;

  /**
   * The single-pane host DOM: a tab strip over whichever leaf was last
   * revealed, plus the pane it paints into. `../plugin-bridge.ts`'s
   * `mountPlugin` folds this into `Plugin`'s own `hostEl` — see that file's
   * doc for the exact element a host appends.
   *
   * **Built lazily, on first access.** This package's vitest config runs
   * under plain Node (no jsdom — verified: nothing in `packages/workbench`
   * exercises `document` under `pnpm test` today), so every method that only
   * touches leaf/view-registry BOOKKEEPING (`getLeaf`, `getLeavesOfType`,
   * `registerViewType`, `on`/`trigger`, `getActiveFile`) stays unit-testable
   * with no DOM at all; only actually asking for `containerEl` (a real host
   * rendering the workspace) requires one.
   */
  get containerEl(): HTMLElement {
    return this.ensureDom().containerEl;
  }

  /**
   * WBX-12: the right sidebar's own single-pane host DOM — a SEPARATE
   * `[data-wb-right-tab-strip]` + `[data-wb-right-pane]` pair from
   * `containerEl`'s main-pool one, mounted wherever the simulator's right
   * sidebar region lives (`simulator/shell.ts`). Lazily built, same reasoning
   * as `containerEl`'s own doc.
   */
  get rightContainerEl(): HTMLElement {
    return this.ensureRightDom().containerEl;
  }

  private ensureDom(): PoolDom {
    if (this.dom === null) {
      this.dom = buildPoolDom('data-wb-workspace', 'data-wb-tab-strip', 'data-wb-pane');
    }
    return this.dom;
  }

  private ensureRightDom(): PoolDom {
    if (this.rightDom === null) {
      this.rightDom = buildPoolDom(
        'data-wb-right-workspace',
        'data-wb-right-tab-strip',
        'data-wb-right-pane',
      );
    }
    return this.rightDom;
  }

  private domFor(pool: LeafPool): PoolDom | null {
    return pool === 'right' ? this.rightDom : this.dom;
  }

  private activeLeafFor(pool: LeafPool): RecordingWorkspaceLeaf | null {
    return pool === 'right' ? this.activeRightLeaf : this.activeLeaf;
  }

  private setActiveLeafFor(pool: LeafPool, leaf: RecordingWorkspaceLeaf | null): void {
    if (pool === 'right') this.activeRightLeaf = leaf;
    else this.activeLeaf = leaf;
  }

  /** Not an Obsidian API name — `Plugin.registerView` (`index.ts`) delegates here. */
  registerViewType(viewType: string, factory: ViewFactory): void {
    this.viewFactories.set(viewType, factory);
  }

  /** Not an Obsidian API name — `RecordingWorkspaceLeaf.setViewState` reads the factory registry through here. */
  viewFactoryFor(viewType: string): ViewFactory | undefined {
    return this.viewFactories.get(viewType);
  }

  /**
   * WBX-12: every view type `Plugin.registerView` has registered so far, in
   * registration order — the simulator's left ribbon's own enumeration door
   * (`simulator/shell.ts`'s module doc: "never a hand list"). Pure
   * bookkeeping, no DOM.
   */
  registeredViewTypes(): readonly string[] {
    return [...this.viewFactories.keys()];
  }

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.viewType === viewType);
  }

  getLeaf(_kind: 'tab' | 'split' = 'tab'): WorkspaceLeaf {
    const leaf = new RecordingWorkspaceLeaf(this, 'main');
    this.leaves.push(leaf);
    return leaf;
  }

  /**
   * Obsidian's sidebar-leaf minting (§4 gap table: `main.ts`'s
   * `revealTodayView`/`revealGapView`/etc all call this for their "or create
   * one" half). WBX-12: now mints into the REAL right-sidebar pool
   * (`rightContainerEl`) — see this class's own doc for why that stopped
   * being an alias of `getLeaf('tab')`. `_split` is still accepted for
   * signature fidelity only: there is no split WITHIN the right sidebar
   * either (no split panes, `@manual`, unchanged).
   */
  getRightLeaf(_split: boolean): WorkspaceLeaf | null {
    const leaf = new RecordingWorkspaceLeaf(this, 'right');
    this.leaves.push(leaf);
    return leaf;
  }

  /** §4 gap table. Detaches every leaf of `viewType` — each `detach()` closes its view and forgets the leaf, same teardown `WorkspaceLeaf.detach()` always does. */
  detachLeavesOfType(viewType: string): void {
    for (const leaf of this.leaves.filter((candidate) => candidate.viewType === viewType)) {
      leaf.detach();
    }
  }

  /** Not an Obsidian API name — `RecordingWorkspaceLeaf.detach()` calls this to drop itself from the tracked pool. */
  forgetLeaf(leaf: RecordingWorkspaceLeaf): void {
    const index = this.leaves.indexOf(leaf);
    if (index !== -1) this.leaves.splice(index, 1);
    if (this.activeLeafFor(leaf.pool) === leaf) this.setActiveLeafFor(leaf.pool, null);
    this.renderTabStrip(leaf.pool);
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.revealed.push(leaf);
    if (!(leaf instanceof RecordingWorkspaceLeaf)) return;
    this.setActiveLeafFor(leaf.pool, leaf);
    this.mountActiveLeaf(leaf.pool);
  }

  /** Not an Obsidian API name — `RecordingWorkspaceLeaf.setViewState` calls this once its view has mounted, so an already-revealed leaf's pane updates without a second `revealLeaf` call. */
  onLeafViewMounted(leaf: RecordingWorkspaceLeaf): void {
    this.renderTabStrip(leaf.pool);
    if (this.activeLeafFor(leaf.pool) === leaf) this.mountActiveLeaf(leaf.pool);
  }

  /** No-op until something has actually asked for that pool's `containerEl`/`rightContainerEl` — see those getters' docs. Rendering into a pane nobody will ever look at is wasted DOM work, and (more importantly for this package) lets pure leaf bookkeeping run with no `document` at all. */
  private mountActiveLeaf(pool: LeafPool): void {
    const dom = this.domFor(pool);
    if (dom === null) return;
    this.renderTabStrip(pool);
    const active = this.activeLeafFor(pool);
    const { paneEl } = dom;
    paneEl.replaceChildren();
    if (active?.view != null) paneEl.appendChild(active.view.containerEl);
    paneEl.setAttribute('data-wb-active-view-type', active?.viewType ?? '');
  }

  private renderTabStrip(pool: LeafPool): void {
    const dom = this.domFor(pool);
    if (dom === null) return;
    const { tabStripEl } = dom;
    tabStripEl.replaceChildren();
    const active = this.activeLeafFor(pool);
    for (const leaf of this.leaves.filter((candidate) => candidate.pool === pool)) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.setAttribute('data-wb-tab', 'true');
      tab.setAttribute('data-wb-view-type', leaf.viewType ?? '');
      tab.textContent = leaf.view?.getDisplayText() ?? leaf.viewType ?? '(empty)';
      if (leaf === active) tab.setAttribute('data-wb-tab-active', 'true');
      tab.addEventListener('click', () => {
        void this.revealLeaf(leaf);
      });
      tabStripEl.appendChild(tab);
    }
  }

  /** Unused by this shim's own explain-back → registry path — see this class's own doc. */
  async openLinkText(_linktext: string, _sourcePath: string, _newLeaf?: unknown): Promise<void> {}

  /** §4 gap table: `main.ts:759`'s `processNoteNowCheckCallback` reads this. Set by whichever host renders the simulator's file list — see `setActiveFile` below. */
  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  /** Not an Obsidian API name — the simulator's file-list door onto `getActiveFile()` above (design §4: "the simulator's selected file"). */
  setActiveFile(file: TFile | null): void {
    this.activeFile = file;
  }

  /**
   * §4 gap table's `Workspace.on('file-menu')` — real Obsidian's `Workspace`
   * inherits a generic `Events.on`/`.trigger` pair; this shim declares only
   * the one name `main.ts` actually registers (`file-menu`) plus a generic
   * fallback so an unlisted name still typechecks and records rather than
   * throwing. Nothing in this package fires `'file-menu'` on its own — see
   * `Menu`/`MenuItem` below and this file's head-of-file note: the real
   * context menu stays `@manual`, and firing this is the simulator's file
   * list's job (WBX-1), via `trigger('file-menu', menu, file)`.
   */
  on(eventName: 'file-menu', callback: (menu: Menu, file: TFile) => void): EventRef;
  on(eventName: string, callback: (...args: never[]) => void): EventRef {
    let set = this.eventHandlers.get(eventName);
    if (set === undefined) {
      set = new Set();
      this.eventHandlers.set(eventName, set);
    }
    set.add(callback);
    return { unsubscribe: () => set?.delete(callback) };
  }

  offref(ref: EventRef): void {
    ref.unsubscribe();
  }

  /** Not an Obsidian API name on `Workspace` itself (real Obsidian inherits it from `Events`) — fires every handler registered under `eventName`. */
  trigger(eventName: string, ...args: unknown[]): void {
    for (const callback of this.eventHandlers.get(eventName) ?? []) {
      (callback as (...callArgs: unknown[]) => void)(...args);
    }
  }

  /** Workbench-only inspection hook — never an Obsidian API name. */
  get revealedCount(): number {
    return this.revealed.length;
  }
}

/**
 * Obsidian's context-menu item, reduced to the three chained setters
 * `main.ts`'s one `menu.addItem((item) => item.setTitle(...).setIcon(...).onClick(...))`
 * call needs. No real menu ever paints — see this file's head-of-file note.
 */
export class MenuItem {
  private clickHandler: (() => void) | null = null;
  private titleText = '';
  private iconName = '';

  setTitle(title: string): this {
    this.titleText = title;
    return this;
  }

  setIcon(icon: string): this {
    this.iconName = icon;
    return this;
  }

  onClick(callback: () => void): this {
    this.clickHandler = callback;
    return this;
  }

  /** Workbench-only inspection hooks — never Obsidian API names. */
  get title(): string {
    return this.titleText;
  }

  get icon(): string {
    return this.iconName;
  }

  /** Not an Obsidian API name — invokes the handler `onClick` registered, same as a real click would. */
  invoke(): void {
    this.clickHandler?.();
  }
}

/**
 * Obsidian's context menu, reduced to `addItem` — the one member
 * `main.ts`'s `workspace.on('file-menu', ...)` handler calls. `items` is a
 * workbench-only inspection hook so a caller (WBX-1's file list) can render
 * whatever `main.ts` populated without this shim knowing what a menu looks
 * like.
 */
export class Menu {
  readonly items: MenuItem[] = [];

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

/**
 * Obsidian's `App` — `workspace` is the original (WB-2 F5) member
 * `ExplainBackModal`'s constructor reads; `vault`/`metadataCache` are the §4
 * gap-table addition whole-plugin mount needs.
 *
 * **`vault` starts cold.** `Vault.ready()` (`./vault-shim.ts`) must be
 * awaited before anything reads `app.vault.getFileByPath`/`.getFiles` —
 * `../plugin-bridge.ts`'s `mountPlugin` does this before constructing the
 * plugin, matching a real Obsidian host, whose vault is already scanned
 * before any plugin's `onload` runs. The two pre-existing zero-arg
 * `new App()` call sites (`plugin-surface-scenarios.ts`,
 * `explain-back-scenarios.ts`) never call `ready()` and never read
 * `app.vault` — both are unaffected, over an empty source that answers every
 * read with "no such file" (`./vault-shim.ts`'s `createEmptyVaultSource`).
 */
export class App {
  readonly workspace = new Workspace();
  readonly vault: Vault;
  readonly metadataCache: MetadataCache;

  constructor(deps: { readonly vault?: ShimVaultSource } = {}) {
    this.vault = new Vault(deps.vault);
    this.metadataCache = new MetadataCache(this.vault);
  }
}

/**
 * Obsidian's overlay `Modal` (`ol-z6x2` [WB-2] F5 tranche). Real Obsidian
 * mounts a modal above the WHOLE app window, not inside any one workspace
 * leaf/pane — so, like `Notice` above, this renders into a top-document host
 * the workbench provides (`[data-wb-modal-host]`), never into the host
 * iframe a flat surface's `ItemView` mounts into. `installObsidianDomHelpers`
 * already patches the top window's `Element`/`HTMLElement` prototypes before
 * any view is constructed (`main.ts`), so `contentEl.createDiv(...)` etc.
 * work here exactly as they do on any other chrome element in this document.
 *
 * Reduced to exactly what `ExplainBackModal` reads or calls: `app`,
 * `titleEl`, `contentEl`, `open`/`close`, `onOpen`/`onClose` — the WB-1 shim
 * rule again: a member is added only once a real view needs it.
 */
export class Modal {
  readonly app: App;
  readonly containerEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  private backdropHandler: ((event: MouseEvent) => void) | null = null;

  constructor(app: App) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'modal-container';
    const modalEl = document.createElement('div');
    modalEl.className = 'modal';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'modal-title';
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'modal-content';
    modalEl.appendChild(this.titleEl);
    modalEl.appendChild(this.contentEl);
    this.containerEl.appendChild(modalEl);
  }

  /**
   * Escape-to-close and click-outside-to-close (`ol-3ux7.64.10` [WBX-1b]) —
   * real Obsidian's `Modal` offers both regardless of what the subclass's
   * own content renders, and at least one caller relies on exactly that:
   * `packages/plugin/src/course-setup/setup-modal.ts`'s own module doc names
   * "the Escape key, clicking outside" as how its modal closes WITHOUT
   * confirming, and its confirmation view renders only a Confirm button —
   * no cancel affordance of its own. Found via the simulator's whole-plugin
   * mount: a fixture vault with course-shaped folders opens
   * `CourseSetupModal` on cold start (`main.ts`'s `checkForCourseSetupProposals`),
   * and with neither of these this shim had NO way to dismiss it — the very
   * first real mount got stuck behind a permanently open, unclosable overlay
   * blocking the whole app, `Notice`-and-everything-else included.
   */
  open(): void {
    const host = document.querySelector<HTMLElement>('[data-wb-modal-host]');
    if (host === null) {
      console.info('[obsidian-shim] Modal.open(): no [data-wb-modal-host] in this document');
      return;
    }
    host.appendChild(this.containerEl);
    host.setAttribute('data-wb-modal-open', 'true');
    // Moves keyboard focus into the modal (real Obsidian modals do this too,
    // for the same accessibility reason) — load-bearing here for a second
    // reason specific to this shim's two-document layout: whatever surface
    // was focused before the modal opened is very likely inside the
    // `[data-wb-surface]` IFRAME (every flat/whole-plugin view mounts
    // there), and a `keydown` dispatched to a focused element inside a
    // same-origin iframe does NOT bubble into this (the parent) document.
    // Without moving focus here first, Escape would only ever reach this
    // listener if the browser's focus already happened to sit in the top
    // document — true by luck, not by construction.
    this.containerEl.tabIndex = -1;
    this.containerEl.focus();
    this.escapeHandler = (event) => {
      if (event.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);
    this.backdropHandler = (event) => {
      // Only the host itself counts as "outside" — a click anywhere inside
      // `containerEl` (the modal box) must never close it.
      if (event.target === host) this.close();
    };
    host.addEventListener('click', this.backdropHandler);
    void this.onOpen();
  }

  close(): void {
    this.containerEl.remove();
    const host = document.querySelector<HTMLElement>('[data-wb-modal-host]');
    if (host !== null) host.removeAttribute('data-wb-modal-open');
    if (this.escapeHandler !== null) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    if (this.backdropHandler !== null) {
      host?.removeEventListener('click', this.backdropHandler);
      this.backdropHandler = null;
    }
    this.onClose();
  }

  onOpen(): void | Promise<void> {}
  onClose(): void {}

  setTitle(title: string): this {
    this.titleEl.textContent = title;
    return this;
  }

  setContent(content: string): this {
    this.contentEl.textContent = content;
    return this;
  }
}

/**
 * `Setting`/`PluginSettingTab`/`Plugin`/`TextComponent`/`ButtonComponent`
 * (`ol-z6x2` [WB-2] F7 tranche). `OleaSettingTab`
 * (`packages/plugin/src/settings/settings-tab.ts`) is F7's real settings
 * pane; mounting it for real needs Obsidian's own form-building API, which
 * is chrome by the WB-1 rule at the top of this file: `Setting` lays out a
 * name/description/control row and nothing more, `TextComponent`/
 * `ButtonComponent` wrap a plain `<input>`/`<button>`, and none of them know
 * what a token, a term date or a usage figure is — every piece of THAT
 * logic already lives in `settings-tab.ts`'s own DOM-free sibling modules
 * (`token-field-copy.ts`, `usage/aggregate.ts`, etc.), which is the whole
 * argument that file's own module doc makes for why it itself is "kept
 * thin on purpose."
 *
 * Reduced to exactly what `settings-tab.ts`, `usage/settings-section.ts`
 * and `privacy/settings-section.ts` call — verified by grep before writing
 * this (see the package README's shim ledger, row 7): `setName`, `setDesc`,
 * `setHeading`, `setDisabled` on `Setting`; `addText`/`addButton`/
 * `addToggle`; `setPlaceholder`, `getValue`/`setValue`, `onChange`,
 * `inputEl`, `setDisabled` on `TextComponent`; `setButtonText`, `onClick`,
 * `setDisabled` on `ButtonComponent`; `getValue`/`setValue`, `onChange` on
 * `ToggleComponent` (`ol-0r92.29`'s F2.10 toggle — the one boolean control
 * `settings-tab.ts` renders). No `addDropdown`, `setTooltip`, `setCta` or
 * anything else Obsidian's real `Setting` offers — none of the F7 surfaces
 * this bead mounts use them.
 */
export class TextComponent {
  readonly inputEl: HTMLInputElement;
  private changeHandler: ((value: string) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    this.inputEl = containerEl.createEl('input', { attr: { type: 'text' } });
    this.inputEl.addEventListener('input', () => {
      this.changeHandler?.(this.inputEl.value);
    });
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }
}

/**
 * The one boolean control `settings-tab.ts` renders (`ol-0r92.29`'s F2.10
 * toggle) — a checkbox `<input>`, same reduced shape `TextComponent` above
 * takes for a text `<input>`: `setValue`/`getValue` and `onChange`, nothing
 * Obsidian's real `ToggleComponent` offers beyond that (`setTooltip`,
 * `setDisabled` included) because no F7 surface this shim mounts uses them.
 */
export class ToggleComponent {
  readonly toggleEl: HTMLInputElement;
  private changeHandler: ((value: boolean) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = containerEl.createEl('input', { attr: { type: 'checkbox' } });
    this.toggleEl.addEventListener('change', () => {
      this.changeHandler?.(this.toggleEl.checked);
    });
  }

  getValue(): boolean {
    return this.toggleEl.checked;
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeHandler = callback;
    return this;
  }
}

export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;
  private clickHandler: ((evt: MouseEvent) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = containerEl.createEl('button', { attr: { type: 'button' } });
    this.buttonEl.addEventListener('click', (evt) => {
      if (!this.buttonEl.disabled) this.clickHandler?.(evt);
    });
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.clickHandler = callback;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    this.buttonEl.toggleClass('is-disabled', disabled);
    return this;
  }
}

/**
 * Obsidian's settings-row builder, reduced per this class's own doc above.
 * `settingEl`/`infoEl`/`nameEl`/`descEl`/`controlEl` mirror the real class's
 * field names exactly, because `settings-tab.ts` never reads them directly
 * — only `Setting`'s own methods are called — but keeping the names aligned
 * is what makes a future grep against the real `obsidian.d.ts` trustworthy.
 */
export class Setting {
  readonly settingEl: HTMLElement;
  readonly infoEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly descEl: HTMLElement;
  readonly controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }

  setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.setText(desc);
    return this;
  }

  setHeading(): this {
    this.settingEl.addClass('setting-item-heading');
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.toggleClass('is-disabled', disabled);
    return this;
  }

  addText(cb: (component: TextComponent) => unknown): this {
    cb(new TextComponent(this.controlEl));
    return this;
  }

  addButton(cb: (component: ButtonComponent) => unknown): this {
    cb(new ButtonComponent(this.controlEl));
    return this;
  }

  addToggle(cb: (component: ToggleComponent) => unknown): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }
}

/**
 * Obsidian's `PluginSettingTab` (via `SettingTab`), reduced to `app` and
 * `containerEl` — the two fields `OleaSettingTab`'s constructor and
 * `display()` override actually touch — plus the `display()`/`hide()`
 * methods real Obsidian declares as concrete (never abstract) on the base
 * class, which is what lets `OleaSettingTab` write `override display()`.
 */
export class PluginSettingTab {
  readonly app: App;
  readonly containerEl: HTMLElement;

  constructor(app: App, _plugin: Plugin) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'vertical-tab-content';
  }

  display(): void {}

  hide(): void {}
}

/** Obsidian's `Command`/`Hotkey`, matching `commands/types.ts`'s own `OleaCommandSpec`/`OleaHotkey` structurally (never imported from `packages/plugin` — same "small local mirror" reason `vault-shim.ts`'s module doc gives). */
export interface Hotkey {
  modifiers: string[];
  key: string;
}

export interface Command {
  readonly id: string;
  readonly name: string;
  readonly callback?: () => void;
  readonly checkCallback?: (checking: boolean) => boolean;
  readonly hotkeys?: Hotkey[];
}

function hotkeyLabel(hotkey: Hotkey): string {
  return [...hotkey.modifiers, hotkey.key].join('+');
}

/**
 * Obsidian's `Plugin` (via `Component`) — the §4 gap table's whole-plugin
 * mount. `app` is the original (WB-2 F7) field `OleaSettingTab`'s
 * constructor reads; everything else below is this bead's addition:
 * `addCommand` + a palette, `registerView`, `addSettingTab` + a settings
 * route, `loadData`/`saveData`. `register`/`registerEvent`/`registerInterval`
 * live on `Component` above (real Obsidian's own inheritance shape).
 *
 * **`manifest`/`dataStore` are optional, defaulting to the real production
 * manifest and an in-memory store** — so the one pre-existing call site with
 * no second/third argument (`plugin-surface-scenarios.ts`'s
 * `new Plugin(app)`) still compiles unchanged. Real Obsidian only ever passes
 * `(app, manifest)`; `dataStore` is this shim's own injection seam (this
 * bead's brief: "define the shim's constructor/injection interface") for
 * `../plugin-bridge.ts`'s `mountPlugin` to thread WBX-1's persisted
 * `PluginDataStore` through — see that file's doc for the exact call.
 */
export class Plugin extends Component {
  readonly app: App;
  readonly manifest: PluginManifest;
  private readonly dataStore: PluginDataStore;
  private readonly commands = new Map<string, Command>();
  private settingTab: PluginSettingTab | null = null;

  private dom: {
    rootEl: HTMLElement;
    paletteEl: HTMLElement;
    paletteInputEl: HTMLInputElement;
    paletteListEl: HTMLElement;
    settingsRouteEl: HTMLElement;
  } | null = null;

  constructor(
    app: App,
    manifest: PluginManifest = DEFAULT_MANIFEST,
    dataStore: PluginDataStore = createInMemoryPluginDataStore(),
  ) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.dataStore = dataStore;
  }

  /**
   * The plugin's whole mounted chrome — palette trigger, palette overlay,
   * the workspace's tab strip + pane, and the settings route.
   * `../plugin-bridge.ts`'s `mountPlugin` returns this as `hostEl`; a host
   * appends it wherever the simulator's visible surface lives.
   *
   * **Built lazily, on first access** — same reasoning `Workspace.containerEl`
   * states: `addCommand`/`registerView`/`addSettingTab`/`loadData`/`saveData`/
   * `invokeCommand` all stay unit-testable with no `document` at all (this
   * package's vitest config has none), and a real `onload()` that calls
   * `addSettingTab` never touches DOM either UNLESS something has already
   * asked for `rootEl`.
   */
  get rootEl(): HTMLElement {
    return this.ensureDom().rootEl;
  }

  private ensureDom(): {
    rootEl: HTMLElement;
    paletteEl: HTMLElement;
    paletteInputEl: HTMLInputElement;
    paletteListEl: HTMLElement;
    settingsRouteEl: HTMLElement;
  } {
    if (this.dom !== null) return this.dom;

    const paletteToggle = document.createElement('button');
    paletteToggle.type = 'button';
    paletteToggle.setAttribute('data-wb-palette-toggle', 'true');
    paletteToggle.textContent = 'Command palette';
    paletteToggle.addEventListener('click', () => this.togglePalette());

    const paletteInputEl = document.createElement('input');
    paletteInputEl.type = 'text';
    paletteInputEl.setAttribute('data-wb-palette-input', 'true');
    paletteInputEl.placeholder = 'Type a command…';
    paletteInputEl.addEventListener('input', () => this.renderPalette());

    const paletteListEl = document.createElement('ul');
    paletteListEl.setAttribute('data-wb-palette-list', 'true');

    const paletteEl = document.createElement('div');
    paletteEl.setAttribute('data-wb-palette', 'true');
    paletteEl.hidden = true;
    paletteEl.append(paletteInputEl, paletteListEl);

    const settingsRouteEl = document.createElement('div');
    settingsRouteEl.setAttribute('data-wb-settings-route', 'true');
    settingsRouteEl.hidden = true;

    const rootEl = document.createElement('div');
    rootEl.setAttribute('data-wb-plugin-root', 'true');
    rootEl.append(paletteToggle, paletteEl, this.app.workspace.containerEl, settingsRouteEl);

    this.dom = { rootEl, paletteEl, paletteInputEl, paletteListEl, settingsRouteEl };
    if (this.settingTab !== null) this.renderSettingsRoute();
    return this.dom;
  }

  /**
   * §4 gap table. Stores the command and re-renders the palette list —
   * matches `register-commands.ts`'s `registerOleaCommands`, which calls
   * this once per `buildOleaCommands` entry during `onload`.
   */
  addCommand(command: Command): Command {
    this.commands.set(command.id, command);
    if (this.dom !== null && !this.dom.paletteEl.hidden) this.renderPalette();
    return command;
  }

  private togglePalette(): void {
    const dom = this.ensureDom();
    dom.paletteEl.hidden = !dom.paletteEl.hidden;
    if (dom.paletteEl.hidden) return;
    dom.paletteInputEl.value = '';
    this.renderPalette();
    dom.paletteInputEl.focus();
  }

  /**
   * Case-insensitive substring match — a reduction of Obsidian's real fuzzy
   * matcher (§4 gap table: "a palette overlay ... with fuzzy match"). A
   * command whose `checkCallback(true)` returns `false` right now is
   * excluded, same as a real palette hiding an inapplicable command.
   */
  private renderPalette(): void {
    if (this.dom === null) return;
    const { paletteInputEl, paletteListEl } = this.dom;
    const query = paletteInputEl.value.trim().toLowerCase();
    paletteListEl.replaceChildren();
    for (const command of this.commands.values()) {
      if (command.checkCallback !== undefined && !command.checkCallback(true)) continue;
      if (query !== '' && !command.name.toLowerCase().includes(query)) continue;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-wb-command', 'true');
      button.setAttribute('data-wb-command-id', command.id);
      const hotkey = command.hotkeys?.[0];
      if (hotkey !== undefined) button.setAttribute('data-wb-command-hotkey', hotkeyLabel(hotkey));
      button.textContent = command.name;
      button.addEventListener('click', () => {
        this.invokeCommand(command.id);
        if (this.dom !== null) this.dom.paletteEl.hidden = true;
      });
      item.appendChild(button);
      paletteListEl.appendChild(item);
    }
  }

  /**
   * Not an Obsidian API name — the Playwright rig's door onto a command by
   * id (this bead's brief: "invoke by command id"), without simulating a
   * click on `[data-wb-command]`. Runs the same check-then-execute path a
   * real invocation takes: `false` from `checkCallback(true)` means "hidden,"
   * matching what the palette itself already enforces in `renderPalette`.
   * Pure bookkeeping — never touches DOM, so a command's `callback`/
   * `checkCallback` is unit-testable with no `document` at all.
   */
  invokeCommand(id: string): boolean {
    const command = this.commands.get(id);
    if (command === undefined) return false;
    if (command.checkCallback !== undefined) {
      if (!command.checkCallback(true)) return false;
      command.checkCallback(false);
      return true;
    }
    command.callback?.();
    return true;
  }

  /** §4 gap table. Delegates to `Workspace.registerViewType` — `Plugin` never holds its own view-type registry, since `WorkspaceLeaf.setViewState` (in `Workspace`'s own file section) is what actually needs it. Pure bookkeeping, no DOM. */
  registerView(viewType: string, factory: ViewFactory): void {
    this.app.workspace.registerViewType(viewType, factory);
  }

  /** §4 gap table. Stores the one settings tab a plugin registers (real Obsidian supports more than one via `openTabById`; this plugin registers exactly one, `OleaSettingTab`). Renders into the settings route only once something has actually asked for DOM (`ensureDom`'s own "if a tab is already registered" branch covers the reverse order). */
  addSettingTab(tab: PluginSettingTab): void {
    this.settingTab = tab;
    if (this.dom !== null) this.renderSettingsRoute();
  }

  /**
   * Not an Obsidian API name — the simulator's settings-route door (F9.S3:
   * "the settings route is opened"). Un-hides the route and (re-)renders the
   * registered tab's `display()` output.
   */
  openSettingsRoute(): void {
    const dom = this.ensureDom();
    dom.settingsRouteEl.hidden = false;
    this.renderSettingsRoute();
  }

  private renderSettingsRoute(): void {
    if (this.dom === null || this.settingTab === null) return;
    this.dom.settingsRouteEl.replaceChildren(this.settingTab.containerEl);
    this.settingTab.display();
  }

  /** §4 gap table. Delegates to the injected `PluginDataStore` — `device/id.ts`'s `ensureDeviceId` and every `Obsidian*Store` in `packages/plugin` call these two. No DOM. */
  async loadData(): Promise<unknown> {
    return this.dataStore.loadData();
  }

  async saveData(data: unknown): Promise<void> {
    return this.dataStore.saveData(data);
  }
}

/** Obsidian's `requestUrl` param/response shapes, reduced to the fields `privacy/obsidian-adapters.ts`'s `obsidianDeleteHttpRequest` reads or sets. */
export interface RequestUrlParam {
  readonly url: string;
  readonly method?: string;
  readonly contentType?: string;
  readonly body?: string | ArrayBuffer;
  readonly headers?: Record<string, string>;
  readonly throw?: boolean;
}

export interface RequestUrlResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly arrayBuffer: ArrayBuffer;
  readonly json: unknown;
  readonly text: string;
}

/**
 * Obsidian's `requestUrl` (`ol-z6x2` [WB-2] F7 tranche) — real chrome (an
 * HTTP call that bypasses the renderer's own CORS restrictions), reduced to
 * the type shape `privacy/obsidian-adapters.ts`'s `obsidianDeleteHttpRequest`
 * needs. That adapter is pulled in transitively by `OleaSettingTab.display()`
 * rendering its F7.4 privacy section, even though this bead's own fixture
 * states never press "Delete everything" — see
 * `plugin-surface-scenarios.ts`'s module doc for why. Backed by a real
 * `fetch()` rather than a throw, so the type seam is honest rather than a
 * landmine for whichever later tranche's fixture does click that button.
 */
export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
  const params: RequestUrlParam = typeof request === 'string' ? { url: request } : request;
  const response = await fetch(params.url, {
    method: params.method ?? 'GET',
    headers: params.headers ?? {},
    body: params.body ?? null,
  });
  const buffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(buffer);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, headers, arrayBuffer: buffer, json, text };
}
