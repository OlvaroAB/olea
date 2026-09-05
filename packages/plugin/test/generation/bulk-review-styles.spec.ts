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

/**
 * `[STY-6]` (`ol-l5og.18.15`) — the kit's three densities and the document
 * header, guarded the same way the focus ring above is: against the view's
 * own source and the stylesheet, because `bulk-review-view.ts` has no DOM to
 * run in outside a real host (that file's own module doc). The behavioural
 * half — that a click still resolves the row it was aimed at once the tiers
 * exist — is the workbench e2e spec's, in a real browser.
 */
describe('the clearing list renders three densities, not one (ol-l5og.18.15)', () => {
  it('marks exactly one row focused and every other pending, from the view model', () => {
    expect(view).toContain('const focused = item.draftId === this.focusedDraft;');
    expect(view).toContain(
      "focused ? 'olea-bulk-review-item--focused' : 'olea-bulk-review-item--pending'",
    );
  });

  it('collapses the pool and the concept line on a pending row, and nothing else', () => {
    const rule =
      /\.olea-bulk-review-item--pending \.olea-bulk-review-item-concept,\s*\.olea-bulk-review-item--pending \.olea-bulk-review-item-pool \{\s*display: none;/;
    expect(css).toMatch(rule);
  });

  it('never hides a pending row’s source marker or its controls ([D-216] clause 2; the mouse path)', () => {
    // A `display: none` on either would take `[D-216]`'s always-visible named
    // origin off the row, or make a control unclickable until she focuses it.
    const pendingRules = css.match(/\.olea-bulk-review-item--pending[^{]*\{[^}]*\}/g) ?? [];
    const hidden = pendingRules.filter((r) => /display: none/.test(r));
    for (const rule of hidden) {
      expect(rule).not.toMatch(/-item-source|-item-actions|-bulk-review-action/);
    }
  });

  it('gives the focused row the kit’s olive draft gutter and raised ground', () => {
    const m = /\.olea-bulk-review-item--focused \{([^}]*)\}/.exec(css);
    expect(m, 'the --focused rule').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toMatch(/border-left: 2px solid var\(--olea-host-brand\)/);
    expect(body).toMatch(/background: var\(--olea-host-elev\)/);
  });

  it('moves the tier by toggling a class, never by re-rendering (the click path)', () => {
    const m = /private applyFocusedTier\(\): void \{([\s\S]*?)\n {2}\}/.exec(view);
    expect(m, 'applyFocusedTier').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toContain('toggleClass');
    expect(body).not.toContain('this.render()');
    // The `focusin` handler calls it, and calls nothing that rebuilds the DOM.
    expect(view).toContain('this.applyFocusedTier();');
  });

  it('the move-down key is what moves the tier — no second control is introduced', () => {
    const m = /private moveFocusDown\(\): void \{([\s\S]*?)\n {2}\}/.exec(view);
    const body = m?.[1] ?? '';
    expect(body).toContain('this.focusedDraft = next;');
    expect(body).toContain('this.applyFocusedTier();');
  });

  it('keeps a settled row for every draft resolved this sitting, with its stem and outcome', () => {
    expect(view).toContain("cls: 'olea-bulk-review-settled-row'");
    expect(view).toContain("cls: 'olea-bulk-review-settled-stem'");
    expect(view).toMatch(/olea-bulk-review-settled-state--\$\{row\.outcome\}/);
    expect(css).toMatch(/\.olea-bulk-review-settled \{[^}]*opacity: 0\.5;/);
  });

  it('keeps a finished document’s record on screen, under its own class', () => {
    // Without this, clearing one document takes its own history off the
    // screen while a half-cleared sibling keeps hers — the record would be
    // inconsistent about the same act. It is not a `-group`: nothing there
    // is awaiting review any more, and the batch action is absent with it.
    expect(view).toContain(
      "cls: items.length === 0 ? 'olea-bulk-review-cleared' : 'olea-bulk-review-group',",
    );
    expect(view).toContain('items.length === 0\n        ? null');
    expect(css).toMatch(/\.olea-bulk-review-cleared \{/);
  });

  it('renders no settled block at all for a document she has not touched', () => {
    const m = /private renderSettled\([\s\S]*?\n {2}\}/.exec(view);
    const body = m?.[0] ?? '';
    expect(body).toContain('if (rows.length === 0) return;');
  });
});

describe('the document header names the document and reports only what she resolved (F6.7)', () => {
  it('stacks the course eyebrow over the document title in its own identity block', () => {
    expect(view).toContain("cls: 'olea-bulk-review-group-identity'");
    expect(css).toMatch(/\.olea-bulk-review-group-identity \{[^}]*flex-direction: column;/);
  });

  it('states F3.3’s own guarantee before anything has been resolved', () => {
    expect(view).toContain('BULK_REVIEW_DECK_REASSURANCE');
    expect(view).toContain('settledHere.length === 0');
  });

  it('reports the resolved tally, and names no total, remainder or denominator', () => {
    const m = /cls: 'olea-bulk-review-group-progress',([\s\S]*?)\}\);/.exec(view);
    expect(m, 'the progress slot').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toContain('bulkReviewCompletionTally(this.tally(settledHere))');
    // The kit's `12 of 34`: a denominator of material she has built and not
    // yet met is exactly what F6.7 forbids, so no join of two counts here.
    expect(body).not.toMatch(/\bof\b\s*\$\{/);
    expect(body).not.toMatch(/\.items\.length|remaining/);
  });

  it('the batch action still carries no count (F6.7, unchanged by this bead)', () => {
    expect(view).toContain("text: 'Accept the rest',");
    // Only rendered labels — the module doc names the kit's `Accept
    // remaining 22` in order to say why it is not built.
    const labels = view.match(/text: '[^']*'/g) ?? [];
    expect(labels.filter((l) => /Accept remaining|Accept the rest \$\{/.test(l))).toEqual([]);
  });
});
