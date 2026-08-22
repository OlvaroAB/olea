/**
 * Keeps the Today panel's rules in `packages/plugin/styles.css` from
 * drifting away from the view that emits its classes.
 *
 * Originally this guarded a separate, unloaded `today.css` while it waited
 * to be merged into `styles.css` (another lane owned that file for
 * `ol-ro57`'s cascade-layer repair). That repair landed (`a3c49f1`) and the
 * merge happened; this file now reads `styles.css` — the file Obsidian
 * actually loads — so a class the view emits with no rule fails a real
 * build, not a staged one.
 *
 * It also asserts the theme decision that this pane is *not* the review
 * view. `ol-ro57`'s failure needs a root that forces one theme branch while
 * the body is in the other; a sidebar pane forces nothing, so it has no
 * mixed-palette exposure and correctly carries no `olea-host-fallback`
 * layer of its own. Because `styles.css` also holds the review view's rules
 * — which legitimately DO use `@layer` and `--olea-dark-*` — these checks
 * run against the Today section specifically (from its
 * "---- Today panel ----" banner to the next section's banner), not the
 * whole stylesheet. Today used to be appended last in `styles.css`; the gap
 * view (`ol-2tyj`) is now appended after it, which is exactly why this slice
 * needs an upper bound rather than running "to end of file" — that stale
 * assumption is what silently pulled the gap section's own two `--olea-host-
 * attention`/`--olea-host-brand` declarations into this file's "exactly two
 * colours" and "no unused rules" checks the first time this drifted.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/today/view.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** The view with its prose removed — comments explain the theme decision and must not satisfy a check about it. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TODAY_SECTION_MARKER = '---- Today panel';
/** The next section appended after Today's — the upper bound this slice needs now that Today is no longer last. */
const NEXT_SECTION_MARKER = '---- Gap and coverage views';

/** Just the Today section of `styles.css` — the rest of the file is the review view's and the gap view's, on purpose. */
function todaySection(): string {
  const at = fullCss.indexOf(TODAY_SECTION_MARKER);
  expect(at, `styles.css contains a "${TODAY_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  // Back up to the banner comment's own opening `/*`, not just the marker text inside it —
  // otherwise the slice starts mid-comment, `classesStyled()`'s comment-stripping regex has
  // no opening delimiter to match, and the header's own prose (`.theme-dark`, `.css`, ...)
  // gets scanned as if it were CSS and produces false "unreachable rule" matches.
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the Today banner is inside a comment block').toBeGreaterThanOrEqual(0);

  const nextAt = fullCss.indexOf(NEXT_SECTION_MARKER, at);
  expect(
    nextAt,
    `styles.css contains a "${NEXT_SECTION_MARKER}" banner after Today's`,
  ).toBeGreaterThanOrEqual(0);
  const nextCommentStart = fullCss.lastIndexOf('/*', nextAt);
  return fullCss.slice(commentStart, nextCommentStart);
}

const css = todaySection();

/** Every `cls:`/`addClass(...)` string literal the view hands Obsidian. */
function classesEmittedByView(): readonly string[] {
  const found = new Set<string>();
  for (const match of viewCode.matchAll(/cls:\s*'([^']+)'/g)) {
    for (const cls of (match[1] ?? '').split(/\s+/)) if (cls !== '') found.add(cls);
  }
  for (const match of viewCode.matchAll(/addClass\('([^']+)'\)/g)) {
    const cls = match[1];
    if (cls !== undefined && cls !== '') found.add(cls);
  }
  return [...found].sort();
}

/** Every class selector the Today section of the stylesheet defines a rule for. */
function classesStyled(): ReadonlySet<string> {
  const found = new Set<string>();
  // Strip comments first so the prose in the header cannot satisfy a lookup.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // A class name starts with a letter — `.5px` and `.15em` are decimals.
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the Today view', () => {
  it('finds the classes the view emits', () => {
    const emitted = classesEmittedByView();
    expect(emitted.length).toBeGreaterThan(10);
    expect(emitted).toContain('olea-today-root');
    expect(emitted).toContain('olea-today-week-mark');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });

  it('every rule in the Today section is reachable from the view', () => {
    const emitted = new Set(classesEmittedByView());
    const unused = [...classesStyled()].filter((cls) => !emitted.has(cls));
    expect(unused).toEqual([]);
  });
});

describe('the Today section of styles.css is a sidebar pane, not a second review view', () => {
  it('carries no theme-dark class and no dark floor layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(css).not.toContain('@layer');
    expect(css).not.toContain('--olea-dark-');
  });

  it('owns exactly the two colours DP-1 puts on this surface', () => {
    const owned = [...css.matchAll(/--olea-host-(attention|brand):\s*(#[0-9a-f]{6})/gi)];
    expect(owned.map((m) => `${m[1]}:${m[2]}`)).toEqual(['attention:#e0a94e', 'brand:#8a9a63']);
  });

  it('reads the host for every ground, text, border and font role', () => {
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

  it('reads no host variable a theme is likely to declare in only one branch', () => {
    // The ol-ro57 class of variable. This pane would survive them (it does not
    // force a branch), but not reading them at all keeps that survival from
    // depending on an argument.
    expect(css).not.toContain('--background-modifier-hover');
    expect(css).not.toContain('--background-modifier-border-hover');
  });
});
