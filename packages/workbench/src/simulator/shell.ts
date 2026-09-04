/**
 * The simulator's Obsidian-shaped shell (`ol-3ux7.64.14` [WBX-12],
 * `docs/dev/simulator-design.md`, F9.S3/F9.S6).
 *
 * David, opening the deployed simulator (2026-09-04): the `#/simulator` route
 * showed the public workbench's own dev chrome (a left rail of fixture-world
 * prose, a mode list, a bottom scenario caption — all built for the OTHER
 * fifteen routes this package serves) wrapped around a bare Today panel with
 * unstyled controls, because every element `main.ts`'s old `mountSimulator`
 * built (`wb-sim-controls`, `wb-sim-badge-host`, ...) lives INSIDE the host
 * iframe (`host-frame.ts`), which never loads `public/workbench.css` — that
 * stylesheet is the outer document's, by design (`host-frame.ts`'s own
 * module doc: the isolation is the whole point of the iframe boundary). So
 * `.wb-nav-item` styling those old elements borrowed had never applied to
 * them at all; this module is what actually styles this route, from inside
 * the same document the plugin's own chrome renders into — the exact pattern
 * `host-frame.ts`'s `HOST_DOCUMENT_CSS` already uses for the walkthrough's
 * host-pane-only rules, followed here because `host-frame.ts` is outside this
 * bead's `owns` (WBX-9/WBX-1's file, not WBX-12's).
 *
 * **What this module owns.** Building the shell's static DOM (a slim left
 * ribbon, a main pane, a right sidebar, one bottom strip) and injecting its
 * CSS once. It knows nothing about the plugin, the clock, or the vault —
 * `controller.ts` populates the ribbon's per-view buttons and moves the
 * plugin's own palette toggle into it on every remount, since only it has
 * `MountedPlugin` in hand.
 *
 * **No workbench prose or mode list on this route** — `main.ts`'s
 * `mountSimulator` hides the outer document's `.wb-sidebar` and `.wb-inspector`
 * for the simulator surface and restores them on the way out; nothing in
 * THIS module touches the outer document at all (it never has a reference to
 * it — `host` below is always inside the iframe).
 */

const SHELL_STYLE_ID = 'wb-sim-shell-style';

/**
 * Obsidian-like dark neutrals, self-contained (no new dependency, no
 * `@import`) — the same "declare a small role layer over CSS custom
 * properties, with a literal fallback" shape `host-frame.ts`'s own
 * `HOST_DOCUMENT_CSS` uses, so a real theme loaded via `setThemeSheets` (not
 * exercised on the simulator route today, but the mechanism is shared) would
 * still tint these through the `--background-*`/`--text-*`/`--interactive-*`
 * variables Obsidian itself declares, and the literal fallback is what the
 * simulator actually renders with (no theme is loaded on this route).
 */
const SHELL_CSS = `
.wb-sim-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--background-primary, #1e1e1e);
  color: var(--text-normal, #dadada);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
}

.wb-sim-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ---- ribbon ---- */

.wb-sim-ribbon {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 56px;
  flex: none;
  background: var(--background-secondary, #202020);
  border-right: 1px solid var(--background-modifier-border, #303030);
  overflow-y: auto;
}

.wb-sim-ribbon-views {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 4px;
}

.wb-sim-ribbon-spacer {
  flex: 1;
}

.wb-sim-ribbon-btn {
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text-muted, #9e9e9e);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  line-height: 1.3;
  padding: 8px 2px;
  text-align: center;
  word-break: break-word;
}

.wb-sim-ribbon-btn:hover {
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-normal, #dadada);
}

/* The plugin's own real [data-wb-palette-toggle] button, relocated here by
   controller.ts on every remount — not a simulator-invented button, so it
   gets the same visual treatment as the view buttons above it. */
.wb-sim-ribbon [data-wb-palette-toggle] {
  background: transparent;
  border: 0;
  border-top: 1px solid var(--background-modifier-border, #303030);
  color: var(--text-muted, #9e9e9e);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  padding: 10px 2px;
  text-align: center;
}

.wb-sim-ribbon [data-wb-palette-toggle]:hover {
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-normal, #dadada);
}

/* ---- main pane / right sidebar ---- */

.wb-sim-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.wb-sim-right {
  width: 300px;
  flex: none;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--background-modifier-border, #303030);
  background: var(--background-secondary, #202020);
  display: flex;
  flex-direction: column;
}

/* The plugin's own [data-wb-plugin-root] (obsidian-shim's Plugin.rootEl,
   controller.ts's mounted.hostEl) — a plain, unstyled div by construction
   (the shim's own chrome-only rule stops at "where do I paint", never "how
   big"). Without this rule it sizes to its own content's natural height
   instead of filling .wb-sim-main, and every element inside it (the tab
   strip, the pane, the views they hold) inherits that collapse — found by
   measuring computed layout rects, not by eye (a short pane still LOOKS
   populated; only its actual height gives the bug away). display: flex;
   flex-direction: column here is what lets its own child
   [data-wb-workspace] use flex: 1 meaningfully in turn (that rule already
   existed below; the missing link was THIS element having no flex context
   of its own to grow within, or to BE, at all). */
[data-wb-plugin-root] {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* The single-pane workspace DOM obsidian-shim/index.ts's Workspace builds
   for each pool — a tab strip over whichever pane it paints into. Both pools
   share this rule; the right-pool and main-pool attribute names differ only
   in which region they are appended into (controller.ts). */
[data-wb-workspace],
[data-wb-right-workspace] {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

[data-wb-tab-strip],
[data-wb-right-tab-strip] {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--background-modifier-border, #303030);
  flex: none;
}

[data-wb-tab-strip]:empty,
[data-wb-right-tab-strip]:empty {
  display: none;
}

[data-wb-tab-strip] [data-wb-tab],
[data-wb-right-tab-strip] [data-wb-tab] {
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text-muted, #9e9e9e);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
}

[data-wb-tab-strip] [data-wb-tab]:hover,
[data-wb-right-tab-strip] [data-wb-tab]:hover {
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
}

[data-wb-tab-strip] [data-wb-tab][data-wb-tab-active],
[data-wb-right-tab-strip] [data-wb-tab][data-wb-tab-active] {
  background: var(--background-modifier-active-hover, rgba(255, 255, 255, 0.1));
  color: var(--text-normal, #dadada);
}

[data-wb-pane],
[data-wb-right-pane] {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ---- palette overlay ---- */
/* position: fixed so it overlays the whole shell regardless of where in
   the DOM the real [data-wb-palette] node happens to sit (it stays inside
   the plugin's own rootEl, mounted in the main pane — only its TOGGLE
   button is relocated into the ribbon; see this file's own doc). */
[data-wb-palette] {
  position: fixed;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 80vw);
  max-height: 60vh;
  overflow: auto;
  background: var(--background-primary, #1e1e1e);
  border: 1px solid var(--background-modifier-border, #303030);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  padding: 8px;
  z-index: 50;
}

[data-wb-palette-input] {
  width: 100%;
  box-sizing: border-box;
  background: var(--background-secondary, #202020);
  border: 1px solid var(--background-modifier-border, #303030);
  border-radius: 4px;
  color: var(--text-normal, #dadada);
  font: inherit;
  padding: 6px 8px;
  margin-bottom: 6px;
}

[data-wb-palette-list] {
  list-style: none;
  margin: 0;
  padding: 0;
}

[data-wb-command] {
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text-normal, #dadada);
  cursor: pointer;
  display: block;
  font: inherit;
  padding: 6px 8px;
  text-align: left;
  width: 100%;
}

[data-wb-command]:hover {
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
}

/* ---- bottom strip ---- */

.wb-sim-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 8px 12px;
  border-top: 1px solid var(--background-modifier-border, #303030);
  background: var(--background-secondary, #202020);
}

.wb-sim-strip-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-sim-strip-controls button {
  background: var(--interactive-normal, #2a2a2a);
  border: 1px solid var(--background-modifier-border, #3a3a3a);
  border-radius: 4px;
  color: var(--text-normal, #dadada);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
}

.wb-sim-strip-controls button:hover {
  background: var(--interactive-hover, #343434);
}

.wb-sim-jump-label {
  color: var(--text-muted, #9e9e9e);
  font-size: 12px;
}

.wb-sim-strip-controls input[type="date"] {
  background: var(--background-primary, #1e1e1e);
  border: 1px solid var(--background-modifier-border, #3a3a3a);
  border-radius: 4px;
  color: var(--text-normal, #dadada);
  font: inherit;
  padding: 4px 6px;
}

.wb-sim-notice-host {
  flex-basis: 100%;
  order: 3;
}

.wb-sim-notice {
  color: var(--text-muted, #9e9e9e);
  font-size: 12px;
  padding-top: 4px;
}

.wb-sim-notice-degraded {
  color: var(--text-warning, #d3a94a);
}

.wb-sim-strip-badge {
  margin-left: auto;
  order: 2;
}

.wb-sim-badge {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-muted, #9e9e9e);
  border: 1px solid var(--background-modifier-border, #3a3a3a);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}

.wb-sim-badge-world {
  color: var(--text-accent, #8a9a63);
  font-weight: 600;
}

.wb-detached {
  color: var(--text-muted, #9e9e9e);
  margin: auto;
  padding: 24px;
  text-align: center;
}
`;

function injectShellStyle(doc: Document): void {
  if (doc.getElementById(SHELL_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = SHELL_STYLE_ID;
  style.textContent = SHELL_CSS;
  doc.head.appendChild(style);
}

export interface SimulatorShellElements {
  /** The stable wrapper — never emptied by a remount. Carries `[data-wb-remount]`, bumped by `SimulatorController.remountPane` (`controller.ts`). */
  readonly root: HTMLElement;
  /** The left ribbon's outer element — stable across remounts. */
  readonly ribbon: HTMLElement;
  /** Cleared and repopulated with one button per registered view type on every remount (`controller.ts`). */
  readonly ribbonViews: HTMLElement;
  /** Where the plugin's own real palette-toggle button is relocated to on every remount — see this file's own doc. */
  readonly ribbonPaletteSlot: HTMLElement;
  /** Where the whole plugin's chrome mounts (`hostEl`) — Home lands here. */
  readonly main: HTMLElement;
  /** Where the right-sidebar workspace pool mounts (`Workspace.rightContainerEl`) — Today lands here. */
  readonly right: HTMLElement;
  /** The bottom strip's control group (advance/jump/rate/reset). */
  readonly controls: HTMLElement;
  /** The bottom strip's provenance-badge host. */
  readonly badge: HTMLElement;
  /** The bottom strip's free-text notice host. */
  readonly notice: HTMLElement;
}

/**
 * Builds the shell's static DOM inside `host` (the iframe body — `main.ts`'s
 * `host = frame.body`) and injects its CSS into `host.ownerDocument` once.
 * Idempotent style injection: calling this more than once in the same
 * document (never happens today — `main.ts` calls it once per `#/simulator`
 * mount, and the whole route is torn down on navigation — see `main.ts`'s
 * `render()` preamble) is still safe.
 */
export function createSimulatorShell(host: HTMLElement): SimulatorShellElements {
  injectShellStyle(host.ownerDocument ?? document);

  const root = host.createDiv({ cls: 'wb-sim-shell', attr: { 'data-wb-remount': '0' } });

  // `.wb-sim-body` is the ROW: ribbon, main, right side by side — all three
  // are its direct children, never siblings of it under `root` (`root`
  // itself is a COLUMN of exactly two rows, this one and the bottom strip;
  // an earlier version of this function put the ribbon at `root`'s top
  // level, which put it ABOVE the body as a second column row instead of
  // beside it — caught by `e2e/simulator/shell.spec.ts`'s own visibility
  // assertions, not by eye).
  const body = root.createDiv({ cls: 'wb-sim-body' });

  const ribbon = body.createDiv({ cls: 'wb-sim-ribbon', attr: { 'data-wb-sim-ribbon': 'true' } });
  const ribbonViews = ribbon.createDiv({ cls: 'wb-sim-ribbon-views' });
  ribbon.createDiv({ cls: 'wb-sim-ribbon-spacer' });
  const ribbonPaletteSlot = ribbon.createDiv({
    attr: { 'data-wb-sim-ribbon-palette-slot': 'true' },
  });

  const main = body.createDiv({ cls: 'wb-sim-main', attr: { 'data-wb-sim-main': 'true' } });
  const right = body.createDiv({ cls: 'wb-sim-right', attr: { 'data-wb-sim-right': 'true' } });

  const strip = root.createDiv({ cls: 'wb-sim-strip' });
  const controls = strip.createDiv({ cls: 'wb-sim-strip-controls' });
  const notice = strip.createDiv({ cls: 'wb-sim-notice-host' });
  const badge = strip.createDiv({ cls: 'wb-sim-strip-badge' });

  return { root, ribbon, ribbonViews, ribbonPaletteSlot, main, right, controls, badge, notice };
}

/** A short, ribbon-sized label derived programmatically from a view type — never a hand list (`obsidian-shim/index.ts`'s `Workspace.registeredViewTypes`' own doc). `'olea-session-builder'` -> `'Session Builder'`, `'olea-today'` -> `'Today'`. */
export function ribbonLabel(viewType: string): string {
  const words = viewType
    .replace(/^olea-/, '')
    .split('-')
    .filter((word) => word.length > 0);
  if (words.length === 0) return viewType;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * (Re)builds the ribbon's per-view buttons from `viewTypes` — called by
 * `controller.ts` on every remount, since the mounted plugin (and therefore
 * its view registry) is a fresh instance each time (§3's "full onunload/
 * onload" remount). `onOpen` is the caller's real workspace open-or-reveal
 * action; this function only builds the buttons and wires the click.
 */
export function renderRibbonViews(
  container: HTMLElement,
  viewTypes: readonly string[],
  onOpen: (viewType: string) => void,
): void {
  container.empty();
  for (const viewType of viewTypes) {
    const button = container.createEl('button', {
      cls: 'wb-sim-ribbon-btn',
      attr: { type: 'button', 'data-wb-sim-ribbon-view': viewType, title: viewType },
      text: ribbonLabel(viewType),
    });
    button.addEventListener('click', () => onOpen(viewType));
  }
}
