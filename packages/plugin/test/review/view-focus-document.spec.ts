/**
 * The regression guard for `ol-rq23` (Q6.5).
 *
 * **What the bug was.** `view.ts`'s post-re-render focus check and its
 * up/down focus-move handler both read `document.activeElement` — the
 * AMBIENT GLOBAL `document`, not the document the view is actually mounted
 * in. Obsidian pops tabs out into separate windows, and a popped-out
 * review tab's `contentEl.ownerDocument` is that window's document, not the
 * main window's. Reading the ambient global there is always answered by the
 * *main* window's `activeElement` — never anything inside the popped-out
 * view — so `hadFocus` was always `false` and `controls[0]?.focus()` never
 * ran, and `moveFocus` could never find the currently-active control either.
 * WB-1e's iframe-isolated workbench pane hit the identical shape (`ol-mioe`):
 * an iframe's `contentDocument` is exactly as separate from the ambient
 * global as a popped-out window's document is.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `main-wiring.spec.ts` documents: `view.ts` imports `ItemView`
 * from `obsidian`, whose `package.json` `main` is `""`, so it cannot be
 * loaded under Vitest at all — no fake, no shim, no import. A real
 * popped-out-window repro needs an actual second `Document`, which is
 * exactly what building this view requires the un-loadable `obsidian`
 * module for. The invariant below is a pure property of this file's text,
 * and it is the property that regresses silently: any reintroduced bare
 * `document.activeElement` (or a bare `window.` read) answers from the
 * wrong document the instant this view is mounted anywhere but the first
 * window, exactly like the instance this bead found.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the fix must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/review/view.ts');

describe('ReviewView reads its own document, not the ambient global (ol-rq23, Q6.5)', () => {
  it('the re-render focus check reads contentEl/root.ownerDocument.activeElement', () => {
    expect(VIEW).toMatch(/root\.contains\(root\.ownerDocument\.activeElement\)/);
  });

  it('moveFocus locates the active control via this.contentEl.ownerDocument.activeElement', () => {
    expect(VIEW).toMatch(
      /controls\.indexOf\(\s*this\.contentEl\.ownerDocument\.activeElement as HTMLElement,?\s*\)/,
    );
  });

  it('never reads the bare ambient `document.activeElement` — every read is qualified by an ownerDocument', () => {
    // Matches `document.activeElement` NOT immediately preceded by
    // `ownerDocument.` (case: `foo.ownerDocument.activeElement` is fine,
    // `document.activeElement` on its own is the bug this bead fixed).
    const bareDocumentActiveElement = /(?<!ownerDocument)\bdocument\.activeElement\b/;
    expect(VIEW).not.toMatch(bareDocumentActiveElement);
  });

  it('never reads any other bare `document.` or `window.` global in this file', () => {
    // Excludes identifiers that merely contain "document"/"window" as a
    // substring (ownerDocument, WorkspaceLeaf's `.win`, etc.) by requiring a
    // non-identifier character (or start-of-file) immediately before.
    const bareDocument = /(?<![.\w])document\./g;
    const bareWindow = /(?<![.\w])window\./g;
    expect(VIEW.match(bareDocument)).toBeNull();
    expect(VIEW.match(bareWindow)).toBeNull();
  });
});
