/**
 * F2.22 / F6.4 (`ol-egov.141.89.10.19`): `home/view.ts`'s own half of "the
 * composition sentence, the same in both places" — the review session's
 * half is pinned in `../review/composition-sentence.spec.ts`, and the
 * shared wording itself in `./copy.spec.ts`'s `sessionCompositionSentence`
 * block.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `../review/view.spec.ts` documents at length: `view.ts`
 * imports `ItemView` from `obsidian`, whose `package.json` `main` is `""`,
 * so it cannot be loaded under Vitest at all — no `test/home/view.spec.ts`
 * existed before this bead for exactly this reason.
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

const VIEW = codeOf('src/home/view.ts');

const RENDER_OFFER_START = VIEW.indexOf('private renderOffer(');
if (RENDER_OFFER_START === -1) {
  throw new Error('view.spec.ts: renderOffer marker moved in home/view.ts');
}
const RENDER_OFFER_BODY = VIEW.slice(RENDER_OFFER_START, RENDER_OFFER_START + 3600);

describe('HomeView — imports sessionCompositionSentence (F2.22, F6.4)', () => {
  it('imports it from ./copy.js — the same function review/view.ts imports from ../home/copy.js', () => {
    expect(VIEW).toMatch(/sessionCompositionSentence,?\s*\n?\} from '\.\/copy\.js';/);
  });
});

describe('HomeView.render — threads HomeViewState.focusReason into renderOffer', () => {
  it('passes state.focusReason as renderOffer’s third argument', () => {
    expect(VIEW).toMatch(/this\.renderOffer\(root, state\.session, state\.focusReason\);/);
  });
});

describe('HomeView.renderOffer — the composition sentence, said once (F2.22)', () => {
  it('accepts focusReason as an explicit parameter', () => {
    const signature = VIEW.slice(RENDER_OFFER_START, VIEW.indexOf('): void {', RENDER_OFFER_START));
    expect(signature).toMatch(/focusReason: string \| undefined/);
  });

  it('renders through sessionCompositionSentence exactly once — never a hand-typed paraphrase', () => {
    const calls = RENDER_OFFER_BODY.match(/sessionCompositionSentence\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("is gated on session.kind === 'model' and focusReason !== undefined — honest absence otherwise", () => {
    const guard = RENDER_OFFER_BODY.slice(
      0,
      RENDER_OFFER_BODY.indexOf('sessionCompositionSentence('),
    );
    expect(guard).toMatch(/if \(session\.kind === 'model' && focusReason !== undefined\) \{/);
  });

  it('renders only once per call — the sentence sits beside the headline, not repeated per left-out or by-source line', () => {
    // `allLines`/`leftOutLines`/`newMaterialLines` render in their own loop
    // further down this method; the composition sentence's own `createDiv`
    // call is a single, separate statement, not inside that loop.
    const ownCallIndex = RENDER_OFFER_BODY.indexOf('sessionCompositionSentence(');
    const loopIndex = RENDER_OFFER_BODY.indexOf('for (const line of allLines)');
    expect(loopIndex).toBeGreaterThan(-1);
    expect(ownCallIndex).toBeLessThan(loopIndex);
  });
});

describe('HomeViewState — dashboard variant carries an optional focusReason (F2.22, F6.4)', () => {
  it('declares the field', () => {
    expect(VIEW).toMatch(/readonly focusReason\?: string;/);
  });
});
