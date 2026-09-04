/**
 * Regression guard for `ol-p6t03` (Q6.1/Q6.5) — the one rule the original,
 * deliberately-unstyled section added: without it, the view's buttons keep
 * native Tab reachability but lose a visible ring the moment the host resets
 * a plain button's default outline. `[STY-0e]` (`ol-l5og.18.5`) gave the
 * surface a real stylesheet, but this rule's own requirement — a visible
 * ring on the branch-invariant accent, with a real fallback — is unchanged,
 * so the check stays; only its accent read moved from an inline
 * `var(--interactive-accent, #hex)` literal to the root's own
 * `--olea-host-accent` indirection, matching every other one-off root in
 * this file. A full class-coverage drift guard (`test/today/styles.spec.ts`'s
 * shape) is a separate piece of work this bead did not add.
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

  it("paints the ring with the root's own accent variable", () => {
    const m = /\.olea-bulk-review-root\s+:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(m, 'the :focus-visible rule from the test above').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toMatch(/outline:\s*2px solid var\(--olea-host-accent\)/);
  });

  it('declares --olea-host-accent on the root as the branch-invariant accent, with a real fallback', () => {
    expect(css).toMatch(
      /\.olea-bulk-review-root\s*\{[^}]*--olea-host-accent:\s*var\(--interactive-accent,\s*#[0-9a-f]{6}\)/,
    );
  });

  it('every button the view builds is a real <button>, not a click-only div (native Tab reachability)', () => {
    const buttonSites = view.match(/createEl\('button'/g) ?? [];
    // remainderBtn, acceptBtn, editBtn, rejectBtn — one call site each.
    expect(buttonSites.length).toBeGreaterThanOrEqual(4);
  });
});
