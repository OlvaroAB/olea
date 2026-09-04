/**
 * Keeps the grove view's rules in `packages/plugin/styles.css` from
 * drifting away from `grove/view.ts`, the same drift guard `today/
 * styles.spec.ts` and `test/gap/styles.spec.ts` run for their own panes
 * (`ol-l5og.18.2`).
 *
 * `view.ts` emits two dynamic `cls:` expressions rather than one string per
 * `cls: '...'` literal — a two-way ternary for a cell's card modifier
 * (`olea-grove-cell-ground`/`olea-grove-cell-planted`) and a two-way
 * ternary for a papers tick's fill (`is-asked`). Both are enumerated
 * explicitly below rather than parsed from a template, since neither is a
 * sweep over an `olea-core` vocabulary the way `gap/styles.spec.ts`'s three
 * dynamic suffixes are — Grove has no `GapClass`-shaped enum to read.
 *
 * **Appended LAST in `styles.css`** (this bead's own append): this slice
 * reads from its own banner to the END of the file, with no upper bound.
 * `today/styles.spec.ts`'s own header names the exact failure mode that
 * creates for a FUTURE lane that appends a further section after this
 * one — if that happens, this file's slice needs the same fix Today's did
 * (an explicit `NEXT_SECTION_MARKER`), not a rewrite of the approach.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/grove/view.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** The view with its prose removed — comments must not satisfy a check about them. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const GROVE_SECTION_MARKER = '---- Grove: course scope surface';

/** Just the grove section of `styles.css` — from its own banner to end of file (see module doc). */
function groveSection(): string {
  const at = fullCss.indexOf(GROVE_SECTION_MARKER);
  expect(at, `styles.css contains a "${GROVE_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the grove-section banner is inside a comment block').toBeGreaterThanOrEqual(
    0,
  );
  return fullCss.slice(commentStart);
}

const css = groveSection();

/** Every static `cls: '...'` literal, plus the two dynamic ternaries this view emits. */
function classesEmittedByView(): readonly string[] {
  const found = new Set<string>();

  for (const match of viewCode.matchAll(/cls:\s*'([^']+)'/g)) {
    for (const cls of (match[1] ?? '').split(/\s+/)) if (cls !== '') found.add(cls);
  }
  for (const match of viewCode.matchAll(/addClass\('([^']+)'\)/g)) {
    const cls = match[1];
    if (cls !== undefined && cls !== '') found.add(cls);
  }

  // `renderDeclared`'s cell-modifier ternary.
  expect(
    viewCode.includes("'olea-grove-cell olea-grove-cell-ground'"),
    'view.ts still spells out the ground cell modifier this test enumerates',
  ).toBe(true);
  found.add('olea-grove-cell');
  found.add('olea-grove-cell-ground');
  found.add('olea-grove-cell-planted');

  // `renderPapers`'s fill ternary.
  expect(
    viewCode.includes("'olea-grove-papers-tick is-asked'"),
    'view.ts still spells out the papers-tick fill modifier this test enumerates',
  ).toBe(true);
  found.add('olea-grove-papers-tick');
  found.add('is-asked');

  return [...found].sort();
}

/** Every class selector the grove section of the stylesheet defines a rule for. */
function classesStyled(): ReadonlySet<string> {
  const found = new Set<string>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the grove view', () => {
  it('finds the classes the view emits, static and dynamic alike', () => {
    const emitted = classesEmittedByView();
    expect(emitted).toContain('olea-grove-root');
    expect(emitted).toContain('olea-grove-cell-ground');
    expect(emitted).toContain('olea-grove-cell-planted');
    expect(emitted).toContain('is-asked');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });
});

describe('the grove section of styles.css is a main-pane tab, host-adaptive like Today/Gap, not the forced-dark review view', () => {
  it('carries no theme-dark class and no dark floor layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(css).not.toContain('@layer');
    expect(css).not.toContain('--olea-dark-');
  });

  it('reads the host for every ground, text, border and font role, on its own (self-contained) root', () => {
    for (const hostVar of [
      '--background-primary',
      '--text-normal',
      '--text-muted',
      '--text-faint',
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(css).toContain(`var(${hostVar}`);
    }
  });

  it("supplies its own neutral floor for the host reads, never the review root's dark one", () => {
    for (const role of ['bg', 'text', 'muted', 'faint', 'line']) {
      expect(css).toMatch(new RegExp(`--olea-host-${role}-floor\\s*:\\s*#[0-9a-f]{6}`, 'i'));
    }
  });

  it('never reads --olea-host-faint as text colour — only as a border/hatch tint (ol-nrrm)', () => {
    // Every plain `color: var(--olea-host-faint...` read would paint TEXT
    // with the sub-floor-contrast role this file's own header (near the
    // shared host-reads block) documents as unsafe for text. The negative
    // lookbehind excludes `border-color:`, which this section legitimately
    // reads (a border is not text) and would otherwise false-positive on,
    // since "border-color:" itself ends in the substring "color:".
    expect(css).not.toMatch(/(?<![\w-])color:\s*var\(--olea-host-faint/);
  });
});
