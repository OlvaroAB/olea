/**
 * Regression guard for `ol-p6t03` (Q6.1/Q6.5), scoped to exactly what that bead
 * touched. Unlike `test/today/styles.spec.ts` and `test/gap/styles.spec.ts`, this
 * is NOT a drift guard over the whole surface — `bulk-review-view.ts` ships with no
 * authored styling at all (see `styles.css`'s "Bulk review triage" section header
 * for the argument), so there is no class-coverage set to check here. The one thing
 * that DOES need a permanent check is the one rule that section adds: without it,
 * the view's four buttons keep native Tab reachability but lose a visible ring the
 * moment the host resets a plain button's default outline — exactly the gap
 * `.olea-review-root :focus-visible` exists to close on the review tab, restated
 * here for a view with no other CSS to carry it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(
  new URL('../../src/generation/bulk-review-view.ts', import.meta.url),
);

const css = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');

describe('the bulk-review triage view restores a visible keyboard focus ring (ol-p6t03)', () => {
  it('addClasses .olea-bulk-review-root on its content element, matching the CSS below', () => {
    expect(view).toContain("addClass('olea-bulk-review-root'");
  });

  it('declares :focus-visible on that root', () => {
    expect(css).toMatch(/\.olea-bulk-review-root\s+:focus-visible\s*\{/);
  });

  it('paints the ring with the branch-invariant accent, with a real fallback', () => {
    const m = /\.olea-bulk-review-root\s+:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(m, 'the :focus-visible rule from the test above').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toMatch(/outline:\s*2px solid var\(--interactive-accent,\s*#[0-9a-f]{6}\)/);
  });

  it('every button the view builds is a real <button>, not a click-only div (native Tab reachability)', () => {
    const buttonSites = view.match(/createEl\('button'/g) ?? [];
    // remainderBtn, acceptBtn, editBtn, rejectBtn — one call site each.
    expect(buttonSites.length).toBeGreaterThanOrEqual(4);
  });
});
