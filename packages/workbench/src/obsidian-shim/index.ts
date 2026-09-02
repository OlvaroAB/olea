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

  registerDomEvent<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: DomEventListener<K>,
  ): void {
    const bound = listener as EventListener;
    target.addEventListener(type, bound);
    this.registered.push({ target, type, listener: bound });
  }

  /** Not an Obsidian API name — the workbench's own teardown hook. */
  unloadComponent(): void {
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

class RecordingWorkspaceLeaf implements WorkspaceLeaf {
  viewType: string | null = null;
  view: unknown = null;

  detach(): void {
    this.viewType = null;
    this.view = null;
  }

  async setViewState(state: unknown): Promise<void> {
    const type = (state as { type?: unknown } | null | undefined)?.type;
    if (typeof type === 'string') this.viewType = type;
  }
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
 * because anything in this package's build calls it. No real pane management
 * anywhere below — see this file's module doc above for what is and is not
 * exercised.
 */
export class Workspace {
  private readonly leaves: RecordingWorkspaceLeaf[] = [];
  private readonly revealed: WorkspaceLeaf[] = [];

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.viewType === viewType);
  }

  getLeaf(_kind: 'tab' | 'split' = 'tab'): WorkspaceLeaf {
    const leaf = new RecordingWorkspaceLeaf();
    this.leaves.push(leaf);
    return leaf;
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.revealed.push(leaf);
  }

  /** Unused by this shim's own explain-back → registry path — see this class's own doc. */
  async openLinkText(_linktext: string, _sourcePath: string, _newLeaf?: unknown): Promise<void> {}

  /** Workbench-only inspection hook — never an Obsidian API name. */
  get revealedCount(): number {
    return this.revealed.length;
  }
}

/**
 * Obsidian's `App`, reduced to the one member `ExplainBackModal`'s
 * constructor and the `[D-171]` hand-off actually read: `workspace`.
 */
export class App {
  readonly workspace = new Workspace();
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

  open(): void {
    const host = document.querySelector('[data-wb-modal-host]');
    if (host === null) {
      console.info('[obsidian-shim] Modal.open(): no [data-wb-modal-host] in this document');
      return;
    }
    host.appendChild(this.containerEl);
    host.setAttribute('data-wb-modal-open', 'true');
    void this.onOpen();
  }

  close(): void {
    this.containerEl.remove();
    const host = document.querySelector('[data-wb-modal-host]');
    if (host !== null) host.removeAttribute('data-wb-modal-open');
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
