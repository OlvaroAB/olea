/**
 * The regression guard for `ol-63xn` (Q6.5, F2.6).
 *
 * **What the bug was.** `keymap.ts`'s `resolveReviewKey`/`hintsFor` already
 * refuse E/S on the `note-missing` screen (ol-09kf moved the header's keycaps
 * onto that resolver) — there is nothing to edit or suspend once the source
 * note is gone, and the screen already offers skip/remove instead. But
 * `view.ts`'s `renderHeader` kept building the "Edit note" and "Suspend"
 * **buttons** unconditionally, so the pointer path still offered two actions
 * the keyboard path had already refused: clicking "Edit note" opened a dead
 * link, and "Suspend" suspended an item the screen was already offering to
 * remove.
 *
 * **The fix, and what this guards against regressing.** `renderHeader` now
 * returns before building either button when `keymap.ts`'s exported
 * `hasGlobalBindings(screen)` is `false` — the same predicate that already
 * decides whether E/S mean anything. The failure mode this suite exists to
 * catch is a *second* hand-typed screen-kind check (e.g. a literal
 * `screen.kind !== 'note-missing'`) replacing that call: it would look
 * identical today, and drift the next time a screen with no current item is
 * added, exactly the way the keycaps and the buttons already drifted once.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `view-focus-document.spec.ts` documents: `view.ts` imports
 * `ItemView` from `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all. The invariant below is a pure
 * property of this file's text: the header's button-building code is gated
 * by a call to the exported keymap predicate, not by a re-typed literal.
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

/** The body of `renderHeader`, isolated so assertions about it can't be satisfied by unrelated code elsewhere in the file. */
const RENDER_HEADER_START = VIEW.indexOf('private renderHeader(');
const RENDER_HEADER_END = VIEW.indexOf('private actionButton(');
if (RENDER_HEADER_START === -1 || RENDER_HEADER_END === -1) {
  throw new Error(
    'note-missing-header.spec.ts: renderHeader/actionButton markers moved in view.ts',
  );
}
const RENDER_HEADER_BODY = VIEW.slice(RENDER_HEADER_START, RENDER_HEADER_END);

describe('ReviewView header — pointer affordances agree with the keymap (ol-63xn, Q6.5)', () => {
  it('imports hasGlobalBindings from keymap.ts rather than reimplementing it', () => {
    expect(VIEW).toMatch(/hasGlobalBindings[\s\S]{0,120}from '\.\/keymap\.js'/);
  });

  it('renderHeader gates the button-building code on hasGlobalBindings(screen), before building either button', () => {
    const gateMatch = /if\s*\(\s*!hasGlobalBindings\(screen\)\s*\)\s*return;/.exec(
      RENDER_HEADER_BODY,
    );
    expect(gateMatch, 'expected an early-return gate on !hasGlobalBindings(screen)').not.toBeNull();

    const editIndex = RENDER_HEADER_BODY.indexOf("'Edit note'");
    const suspendIndex = RENDER_HEADER_BODY.indexOf("'Suspend'");
    expect(editIndex).toBeGreaterThan(-1);
    expect(suspendIndex).toBeGreaterThan(-1);

    const gateIndex = gateMatch?.index ?? -1;
    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(editIndex);
    expect(gateIndex).toBeLessThan(suspendIndex);
  });

  it('does not gate those buttons on a hand-typed screen-kind literal instead — the whole point is one source of truth', () => {
    expect(RENDER_HEADER_BODY).not.toMatch(/screen\.kind\s*[!=]==\s*'note-missing'/);
  });
});
