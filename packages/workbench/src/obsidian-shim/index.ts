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
