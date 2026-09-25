/**
 * F2.22 / F6.4 (`ol-egov.141.89.10.19`): `review/view.ts`'s own half of "the
 * composition sentence, the same in both places" — Home's half is pinned in
 * `test/home/view.spec.ts` and the shared wording itself in
 * `test/home/copy.spec.ts`'s `sessionCompositionSentence` block. Together
 * the three files prove: one function
 * (`home/copy.ts#sessionCompositionSentence`), called by both surfaces,
 * fed a value each surface reads fresh — so the text cannot drift between
 * them by construction, never by convention.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `view.spec.ts` documents at length: `view.ts` imports
 * `ItemView` from `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph must not satisfy an assertion about real code. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/review/view.ts');
const HOME_VIEW = codeOf('src/home/view.ts');

const RENDER_HEADER_START = VIEW.indexOf('private renderHeader(');
if (RENDER_HEADER_START === -1) {
  throw new Error('composition-sentence.spec.ts: renderHeader marker moved in view.ts');
}
// `renderHeader`'s own body runs to the next `private ` method — the method
// immediately after it is `actionButton` as of this bead; slice generously
// (2000 chars comfortably covers the whole method) rather than pin a second
// marker that would need updating every time a later bead edits this method.
const RENDER_HEADER_BODY = VIEW.slice(RENDER_HEADER_START, RENDER_HEADER_START + 2000);

describe('ReviewView — imports the same sessionCompositionSentence Home imports (F2.22, F6.4)', () => {
  it('review/view.ts imports sessionCompositionSentence from ../home/copy.js', () => {
    expect(VIEW).toMatch(/import \{ sessionCompositionSentence \} from '\.\.\/home\/copy\.js';/);
  });

  it('home/view.ts imports the identical function from its own ./copy.js — the same module, both ways', () => {
    expect(HOME_VIEW).toMatch(/sessionCompositionSentence/);
  });
});

describe('ReviewView.renderHeader — the composition sentence, said once (F2.22)', () => {
  it('is gated on progress.position === 1 — never repeated as she advances through the session', () => {
    const guard = RENDER_HEADER_BODY.slice(
      0,
      RENDER_HEADER_BODY.indexOf('sessionCompositionSentence'),
    );
    expect(guard).toMatch(/if \(progress\.position === 1\) \{/);
  });

  it('reads the reason fresh from this.getFocusReason() — never a value captured once', () => {
    expect(RENDER_HEADER_BODY).toMatch(/this\.getFocusReason\?\.\(\)/);
  });

  it('renders through sessionCompositionSentence — never a hand-typed paraphrase', () => {
    const calls = RENDER_HEADER_BODY.match(/sessionCompositionSentence\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('renders nothing when the reason is undefined — honest absence, no placeholder sentence', () => {
    const afterGuard = RENDER_HEADER_BODY.slice(RENDER_HEADER_BODY.indexOf('const focusReason ='));
    expect(afterGuard).toMatch(/if \(focusReason !== undefined\) \{/);
  });

  it('renders directly into contentEl, above every early return the button logic below can take', () => {
    const beforeHeaderDiv = RENDER_HEADER_BODY.slice(
      0,
      RENDER_HEADER_BODY.indexOf("createDiv({ cls: 'olea-review-header' })"),
    );
    expect(beforeHeaderDiv).toMatch(/this\.contentEl\.createDiv\(\{/);
  });
});

describe('ReviewView constructor — getFocusReason is accepted, optional, and stored (F2.22)', () => {
  it('declares an optional getFocusReason parameter', () => {
    expect(VIEW).toMatch(/getFocusReason\?: \(\) => string \| undefined,/);
  });

  it('assigns it to a private field in the constructor body', () => {
    expect(VIEW).toMatch(/this\.getFocusReason = getFocusReason;/);
  });
});
