/**
 * The host pane, as its own document (`ol-mioe`).
 *
 * ## Why an iframe, and why it is structural rather than cosmetic
 *
 * A community theme is loaded **document-wide**, because that is how Obsidian
 * loads one: its variables are scoped under `.theme-dark`/`.theme-light`, but
 * its component rules sit on bare element selectors that reach everything in the
 * document. In WB-1 that document was the whole workbench, so the theme also
 * restyled the sidebar, the inspector and the notices. `workbench.css`
 * neutralised the common cases with a zero-specificity `:where(*)` reset, and a
 * theme rule at higher specificity still won — Things' `body:not(.default-font-color) strong`
 * is (0,2,1), which no chrome rule can out-declare without an `!important` war.
 * The workaround was to stop using `<strong>` in the chrome, which does not
 * generalise to the second vendored theme.
 *
 * The reason to fix it properly is **WB-2** (`ol-z6x2`), not tidiness. WB-2
 * takes per-state × per-variable-set screenshots as Q6.1 evidence, and evidence
 * contaminated by the harness's own chrome is weak evidence. `[data-wb-surface]`
 * was already the intended screenshot target; putting the product in its own
 * document makes that boundary **real rather than conventional** — the theme
 * stylesheet, the plugin stylesheet and the view's DOM are all inside it, and
 * nothing the harness declares can reach in. It is also a more faithful model of
 * the thing being tested: the view really does live inside someone else's
 * application.
 *
 * ## What this costs, stated rather than discovered later
 *
 * 1. **The DOM helpers must exist in the frame's realm.** Elements created by
 *    `document.createElement` inside the frame get *that* realm's
 *    `Element.prototype`, so Obsidian's `createDiv`/`empty`/`addClass` have to
 *    be installed there too. `installObsidianDomHelpers` takes a window for
 *    exactly this reason, and `createEl` now creates through
 *    `this.ownerDocument` rather than the ambient global — which is strictly
 *    more correct in any realm.
 * 2. **Keystroke dispatch crosses a document boundary.** It still works, and
 *    the mechanism is unchanged: `main.ts` dispatches a real `KeyboardEvent` at
 *    `view.contentEl`, resolved by the real `keymap.ts`. The event is now
 *    constructed with the *frame's* `KeyboardEvent` constructor so the whole
 *    dispatch happens in one realm. Nothing about how a state is reached
 *    changed: no state is poked into existence, and a state unreachable by a
 *    binding the resolver accepts is still unreachable here.
 * 3. **One fidelity loss, and it is a finding rather than a cost.** `view.ts`
 *    reads the *ambient global* `document.activeElement` to decide whether to
 *    restore focus after a re-render. With the view in another document that
 *    read is answered by the top document, so it now says "no". The workbench
 *    never depended on it — keys are dispatched at `contentEl` directly, and
 *    the very first render already evaluated it as `false` — but it means the
 *    focus ring is not restored for a human clicking around inside the frame.
 *    Worth knowing that this is not an artefact of the harness: **Obsidian pops
 *    tabs out into separate windows**, where the same code has the same problem
 *    for the same reason, which is why Obsidian exposes `activeDocument` /
 *    `el.win` at all. Filed rather than worked around, because the fix belongs
 *    in `packages/plugin` (`el.ownerDocument`, not `document`) and this lane
 *    does not own that file.
 * 4. **WB-2 needs `frameLocator`.** `[data-wb-surface]` is the `<iframe>`
 *    element, so a screenshot of it is exactly the product's pixels; assertions
 *    about the DOM inside it go through Playwright's `frameLocator`.
 *
 * ## Same-origin, no `srcdoc`
 *
 * The frame is left at `about:blank` and built through the DOM rather than
 * given a `srcdoc`: a `srcdoc` document's base URL is `about:srcdoc`, against
 * which the relative stylesheet paths this page serves would not resolve.
 * Stylesheet URLs are therefore resolved to absolute against the page's own
 * location, which also keeps this working under any base path Pages serves it
 * from.
 */

import type { Realm } from './obsidian-shim/dom.js';

/**
 * Obsidian's own app shell lays these out; inside the frame the harness has
 * to. The walkthrough-only rules below (`.wb-gap-card`, `.wb-illustrative-
 * label`, `.wb-note*`) live here rather than in `workbench.css` for the SAME
 * reason `.wb-detached` already does: everything a screenshot of
 * `[data-wb-surface]` can show has to be styled inside THIS document, not the
 * chrome's — see this file's own module doc.
 */
const HOST_DOCUMENT_CSS = `
html, body { margin: 0; height: 100%; }
/* ol-7kyo (WBF-5): \`flex-direction: column\`, not the flex default of row. \`body\`
   sometimes holds TWO children at once — a \`.wb-illustrative-label\` (or the D-041
   fixture-oracle one) rendered as a banner ABOVE the view, then \`.workspace-leaf-
   content\` appended after it (\`main.ts\`'s \`mountSession\`/\`mountTrends\`/
   \`mountFixtureOracle\`). Left at the flex default of row, those two became side-
   by-side flex items competing for body's WIDTH: the label has no width of its
   own (flex-basis: auto), so its hypothetical main size is its own content's
   fit-content width, which for a wrapping text banner is close to the full row —
   leaving \`.workspace-leaf-content\`'s \`flex: 1\` almost nothing to grow into. That
   is the whole defect: \`.olea-session-root\` measuring 32px (its own left+right
   padding, with 0px of content width inside), \`.olea-session-item\` at 0px, and
   the reused \`TodayView\` 'Start review' button at 12px on the trends surface —
   all downstream of the SAME \`.workspace-leaf-content\` collapse, and the same
   family as \`.olea-gap-coverage\`'s collapse on the fixture-oracle steps (WBF-3).
   Column stacks the banner above the view instead, and the view still gets the
   full width via \`align-items: stretch\` (the default cross-axis behaviour of a
   column flex container), which is what a screenshot banner over a product pane
   should look like regardless. The \`margin: auto\` centering \`.wb-detached\`,
   \`.wb-gap-card\` and \`.wb-note\` rely on when they are body's ONLY child is
   unaffected: flexbox's auto-margin centering absorbs free space on both axes
   independent of the container's main-axis direction.

   SECOND-ORDER FIX THE COLUMN SWITCH REQUIRES: \`min-height: 0\`, alongside the
   \`min-width: 0\` these two rules already carried. Height is now the MAIN axis
   for \`.workspace-leaf-content\`/\`.view-content\` (it was the cross axis under
   row), so their flex item's automatic minimum size — "auto" by default, which
   resolves to the item's CONTENT-based min size when not overridden — now
   applies to height instead of width. Without \`min-height: 0\` a tall review
   card (measured on \`cloze-reveal\`/\`mcq-answered-*\`, the two states closest to
   \`pane-fit.spec.ts\`'s height ceiling) refused to shrink below its own content
   height, overflowed the pane by exactly that difference, and shifted every
   pixel below the header down by it — the same "automatic minimum size" trap
   \`min-width: 0\` already exists to defeat on the other axis, just met here for
   the first time because nothing before this fix put height on a main axis. */
body { display: flex; flex-direction: column; min-width: 0; background: var(--background-primary, #1e1e1e); color: var(--text-normal, #dadada); }
body > .workspace-leaf-content { display: flex; flex: 1; min-width: 0; min-height: 0; }
body .view-content { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.wb-detached { color: var(--text-muted, #9e9e9e); margin: auto; padding: 24px; text-align: center; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

/* Walkthrough gap card (rule 2, ol-c48c): renders where a product screen
   would have, never a mock — states what's missing in product language, the
   bead in small type underneath. */
.wb-gap-card { margin: auto; max-width: 52ch; padding: 32px 24px; text-align: center; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wb-gap-card-heading { color: var(--text-muted, #9e9e9e); font-size: 13px; font-weight: 600; letter-spacing: 0.06em; margin: 0 0 12px; text-transform: uppercase; }
.wb-gap-card-what { color: var(--text-normal, #dadada); line-height: 1.55; margin: 0 0 10px; }
.wb-gap-card-bead { color: var(--text-muted, #9e9e9e); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; margin: 0; }

/* D-041's illustrative label (ol-st9i) — inside the host pane, adjacent to
   the numbers it caveats, never in the chrome. Placement is the whole point
   (see \`oracle/fixture-oracle.ts\` and \`walkthrough.ts\`'s module docs). */
.wb-illustrative-label { background: rgba(211, 169, 74, 0.12); border: 1px solid rgba(211, 169, 74, 0.4); border-radius: 4px; color: var(--text-normal, #dadada); font-size: 12px; line-height: 1.5; margin: 12px 12px 0; padding: 8px 12px; }

/* Walkthrough step 1's note view: her fixture note's own markdown, rendered
   with no Olea code involved — see \`main.ts\`'s \`renderNoteView\`. */
.wb-note { margin: 0 auto; max-width: 70ch; padding: 24px; }
.wb-note-frontmatter { color: var(--text-muted, #9e9e9e); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; margin-bottom: 16px; }
.wb-note-heading { margin: 20px 0 8px; }
.wb-note-paragraph { line-height: 1.6; margin: 0 0 12px; }
.wb-note-list { line-height: 1.6; margin: 0 0 12px; padding-left: 22px; }
.wb-note-checkbox { margin-right: 6px; }
.wb-note-link { background: rgba(127, 127, 127, 0.16); border-radius: 3px; padding: 0 3px; }

/* RHY-3's multicourse composition (ol-i0zw), drawn directly into the host
   pane — no product view exists yet, same "no product renderer" posture as
   \`.wb-detached\` above (see \`rhythm-scenarios.ts\`'s module doc). One fixed-
   footprint panel regardless of row count (§4.3's own footprint-invariance
   rule), never a card per course. */
.wb-rhythm-panel { margin: 12px; max-width: 72ch; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wb-rhythm-fact { color: var(--text-normal, #dadada); font-size: 14px; font-weight: 600; line-height: 1.5; margin: 0 0 6px; }
.wb-rhythm-consequence, .wb-rhythm-mitigation { color: var(--text-muted, #9e9e9e); font-size: 13px; line-height: 1.5; margin: 0 0 6px; }
.wb-rhythm-rows { border-top: 1px solid rgba(127, 127, 127, 0.25); margin: 10px 0; }
/* flex-wrap rather than a fixed two-line DOM split: the marker/course/
   status/badge line and the actions line share one flex container so a
   narrower panel wraps the SAME markup instead of needing a second layout. */
.wb-rhythm-row { align-items: center; border-bottom: 1px solid rgba(127, 127, 127, 0.16); display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 10px 0; }
.wb-rhythm-row-marker { background: var(--text-muted, #9e9e9e); border-radius: 50%; flex: none; height: 6px; width: 6px; }
.wb-rhythm-row-course { color: var(--text-normal, #dadada); flex: none; font-weight: 600; }
.wb-rhythm-row-status { color: var(--text-muted, #9e9e9e); flex: 1 1 240px; font-size: 13px; min-width: 240px; }
.wb-rhythm-row-badge { background: rgba(127, 127, 127, 0.16); border-radius: 3px; color: var(--text-muted, #9e9e9e); flex: none; font-size: 11px; padding: 2px 6px; text-transform: uppercase; }
.wb-rhythm-row-actions { display: flex; flex: 0 0 100%; gap: 6px; padding-left: 14px; }
.wb-rhythm-footer { color: var(--text-muted, #9e9e9e); font-size: 12px; line-height: 1.5; margin-top: 4px; }
`;

function absolute(url: string): string {
  return new URL(url, window.location.href).href;
}

function loaded(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    if (link.sheet !== null) {
      resolve();
      return;
    }
    const done = (): void => {
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    // An unreachable stylesheet must not hang the ready flag forever; the
    // missing styles are visible in the screenshot, which is the honest signal.
    link.addEventListener('error', done, { once: true });
  });
}

/**
 * `packages/workbench/bundle-single-file.mjs` sets this global — and only that
 * script — to ship every stylesheet's text inline in a page with no other
 * origin to fetch from. It is absent in the ordinary multi-file build, where
 * every `href` below is a real request against `dist/` exactly as before;
 * `inlineCssFor` then always returns `undefined` and `styleNode` always takes
 * the `<link>` branch, so `build.mjs`'s output is byte-for-byte unaffected by
 * this file's shape. Read via `globalThis` rather than a `Window` interface
 * augmentation so this module keeps compiling standalone for both realms.
 */
function inlineCssFor(href: string): string | undefined {
  const map = (globalThis as { __OLEA_WB_INLINE_CSS__?: Readonly<Record<string, string>> })
    .__OLEA_WB_INLINE_CSS__;
  return map?.[href];
}

/**
 * Builds the element that puts `href`'s CSS in the frame's document: an
 * inline `<style>` carrying the single-file bundler's embedded text when one
 * is available, otherwise the normal `<link>` fetched from wherever `dist/`
 * is served. `ready` resolves once the CSS is actually applied — synchronously
 * for `<style>`, on `<link>`'s load/error otherwise — so callers await the
 * same thing regardless of which branch ran.
 */
function styleNode(
  doc: Document,
  href: string,
): { node: HTMLStyleElement | HTMLLinkElement; ready: Promise<void> } {
  const css = inlineCssFor(href);
  if (css !== undefined) {
    const style = doc.createElement('style');
    style.textContent = css;
    return { node: style, ready: Promise.resolve() };
  }
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = absolute(href);
  return { node: link, ready: loaded(link) };
}

export interface HostFrame {
  readonly element: HTMLIFrameElement;
  /** The frame's realm — its own `Element`, `HTMLElement` and `KeyboardEvent` constructors. */
  readonly window: Realm;
  readonly document: Document;
  /** The frame's `<body>` — where the view mounts, and what carries `theme-dark`/`theme-light`. */
  readonly body: HTMLElement;
  /**
   * Loads `hrefs` as the frame's theme stylesheets, **in cascade order**, and
   * resolves once they have all applied. A list rather than one sheet because
   * Obsidian's own load order is a list: `app.css` underneath, a community theme
   * on top of it (`ol-itiu`).
   */
  setThemeSheets(hrefs: readonly string[]): Promise<void>;
}

/**
 * Prepares an existing `<iframe>` as the host document: an empty same-origin
 * document carrying the theme stylesheets, the product's real stylesheet and the
 * Obsidian-shell layout rules, and nothing of the harness.
 */
export async function createHostFrame(
  element: HTMLIFrameElement,
  pluginStylesHref: string,
): Promise<HostFrame> {
  const doc = element.contentDocument;
  // Same-origin `about:blank`, so this really is a full realm — the cast only
  // tells TypeScript what `contentWindow`'s declared type leaves out.
  const win = element.contentWindow as Realm | null;
  if (doc === null || win === null) {
    throw new Error('workbench: the host iframe has no document — it must be in the page already.');
  }

  doc.documentElement.setAttribute('lang', 'en');
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  doc.body.removeAttribute('class');

  // Order matters and mirrors Obsidian's: the theme sheets supply Obsidian's own
  // variables, then the product's stylesheet maps them to its --olea-host-*
  // roles. The workbench never re-declares that role layer. Theme links are
  // inserted *before* this one, so the cascade order is fixed by position
  // rather than by when a switch happened to run.
  const plugin = styleNode(doc, pluginStylesHref);
  doc.head.appendChild(plugin.node);

  const shell = doc.createElement('style');
  shell.textContent = HOST_DOCUMENT_CSS;
  doc.head.appendChild(shell);

  await plugin.ready;

  let themeNodes: (HTMLStyleElement | HTMLLinkElement)[] = [];
  let themeHrefs: readonly string[] = [];

  return {
    element,
    window: win,
    document: doc,
    body: doc.body,
    /**
     * Swaps the theme by loading NEW `<link>`s and removing the old ones only
     * once the new sheets have applied. Mutating `href` in place would leave
     * `link.sheet` pointing at the previous stylesheet for an indeterminate
     * window, which is exactly long enough for a screenshot to catch the wrong
     * theme.
     *
     * The nodes are appended in list order, all before `plugin.node`, so the
     * cascade order in the document is the caller's list order and the plugin's
     * role layer still reads whatever that stack resolved to. Where two sheets
     * declare the same variable at the same specificity — Obsidian's
     * `.theme-dark` and a community theme's `.theme-dark` both being (0,1,0) —
     * source order decides, so **the last href in the list wins**, which is what
     * "a theme overrides the baseline" means.
     */
    async setThemeSheets(hrefs: readonly string[]): Promise<void> {
      const next = [...hrefs];
      if (themeHrefs.length === next.length && themeHrefs.every((href, i) => href === next[i])) {
        return;
      }
      const added = next.map((href) => {
        const { node, ready } = styleNode(doc, href);
        node.dataset.wbThemeSheet = 'true';
        doc.head.insertBefore(node, plugin.node);
        return { node, ready };
      });
      await Promise.all(added.map((entry) => entry.ready));
      for (const node of themeNodes) node.remove();
      themeNodes = added.map((entry) => entry.node);
      themeHrefs = next;
    },
  };
}
