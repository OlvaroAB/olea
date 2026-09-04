/**
 * `ol-l5og.18` [STY-5] drift guard: `--font-text` and `--font-interface` must
 * stay independently declared in the baseline variable set.
 *
 * THE DEFECT THIS GUARDS. `src/themes/obsidian-default.css` used to declare
 * `--font-text: var(--font-interface);` in both `.theme-light` and
 * `.theme-dark` — an unconditional alias. Obsidian's own published CSS
 * variable reference documents `--font-interface-theme` ("Font used for UI
 * elements") and `--font-text-theme` ("Font used for text in the editor") as
 * two independently-settable roles, and it is a common real installation to
 * give the editor its own reading face. The alias meant
 * `packages/plugin/styles.css`'s `--olea-host-question-font: var(--font-text,
 * Georgia, serif)` could never reach its serif fallback under any variable
 * set this workbench offers — the kit-fidelity sweep's second judgement
 * found the serif hero absent from every captured golden (Home,
 * session-builder, retrospective, gap) for exactly this reason.
 *
 * This does not assert a literal font value — the file's own header already
 * disclaims that as an unverified approximation of Obsidian's real defaults.
 * It asserts the one thing that must never regress silently: `--font-text` is
 * its own declaration, not a `var()` reference to `--font-interface`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../src/themes/obsidian-default.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/** Each branch block, so a check can run per-branch rather than once over the whole file. */
function branchBlock(selector: '.theme-light' | '.theme-dark'): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `obsidian-default.css declares a "${selector}" rule`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  expect(close, `the ${selector} rule is terminated`).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

describe('obsidian-default.css keeps --font-text independent of --font-interface (ol-l5og.18 STY-5)', () => {
  for (const branch of ['.theme-light', '.theme-dark'] as const) {
    it(`${branch}: --font-text is not var(--font-interface, ...)`, () => {
      const block = branchBlock(branch);
      const declaration = /--font-text:\s*([^;]+);/.exec(block);
      expect(declaration, `${branch} declares --font-text`).not.toBeNull();
      const value = declaration?.[1] ?? '';
      expect(value).not.toMatch(/var\(\s*--font-interface/);
    });

    it(`${branch}: --font-interface and --font-text still both resolve (neither reads the other)`, () => {
      const block = branchBlock(branch);
      expect(block).toMatch(/--font-interface:\s*[^;]+;/);
      expect(block).toMatch(/--font-text:\s*[^;]+;/);
    });
  }
});
