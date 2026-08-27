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
 *
 * `ol-bdeb` moved the seven `--olea-host-*` reads this pane shares with
 * `.olea-review-root` (bg, text, muted, faint, line, ui-font, mono) out of
 * this section entirely, onto a `:is(.olea-review-root, .olea-today-root)`
 * block near the top of the file, so they are declared once rather than
 * once per view. That block sits OUTSIDE the Today slice on purpose — it
 * names `.olea-review-root`, and a selector naming a class the Today view
 * never emits would fail this file's own "every rule is reachable from the
 * view" check if it were included. So the positive host-read coverage
 * check below reads the shared block directly, by name, rather than the
 * Today slice; the negative assertions (no `@layer`, no `--olea-dark-*`)
 * stay pointed at the Today slice, which correctly still has none of
 * either — the shared block does not carry them, and only the review root's
 * own section (elsewhere in the file) does.
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

const SHARED_ROOT_SELECTOR = ':is(.olea-review-root, .olea-today-root)';

/**
 * The shared host-reads block both `.olea-review-root` and `.olea-today-root`
 * carry (`ol-bdeb`) — declared once, outside the Today slice above, so it is
 * read here by name rather than by slicing.
 */
function sharedHostReadsBlock(): string {
  const start = fullCss.indexOf(`${SHARED_ROOT_SELECTOR} {`);
  expect(
    start,
    `styles.css declares a "${SHARED_ROOT_SELECTOR}" rule for the shared host reads`,
  ).toBeGreaterThanOrEqual(0);
  const open = fullCss.indexOf('{', start);
  const close = fullCss.indexOf('}', open);
  expect(close, 'the shared host-reads rule is terminated').toBeGreaterThan(open);
  return fullCss.slice(open + 1, close);
}

const sharedCss = sharedHostReadsBlock();

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

  it('reads the host for every ground, text, border and font role, via the shared block it carries with .olea-review-root', () => {
    for (const hostVar of [
      '--background-primary',
      '--text-normal',
      '--text-muted',
      '--text-faint',
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(sharedCss).toContain(`var(${hostVar}`);
    }
  });

  it('declares the --olea-host-* role reads it shares with .olea-review-root once, on the shared block, not locally', () => {
    const SHARED_ROLES = ['bg', 'text', 'muted', 'faint', 'line', 'ui-font', 'mono'];
    for (const role of SHARED_ROLES) {
      const declaration = new RegExp(`--olea-host-${role}\\s*:`, 'g');
      expect(
        sharedCss.match(declaration),
        `--olea-host-${role} is declared on the shared :is(...) block`,
      ).toHaveLength(1);
      expect(
        css,
        `the Today section no longer re-declares --olea-host-${role} locally`,
      ).not.toMatch(declaration);
    }
  });

  it("supplies its own neutral floor for the shared reads, never the review root's dark one", () => {
    for (const role of ['bg', 'text', 'muted', 'faint', 'line']) {
      expect(css).toMatch(new RegExp(`--olea-host-${role}-floor\\s*:\\s*#[0-9a-f]{6}`, 'i'));
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

describe('the Today pane restores a visible keyboard focus ring (ol-p6t03, Q6.1/Q6.5)', () => {
  it('declares :focus-visible on the pane root, not just on .olea-review-root', () => {
    expect(css).toMatch(/\.olea-today-root\s+:focus-visible\s*\{/);
  });

  it('paints the ring with the branch-invariant accent, with a real fallback', () => {
    const m = /\.olea-today-root\s+:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(m, 'the :focus-visible rule from the test above').not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toMatch(/outline:\s*2px solid var\(--interactive-accent,\s*#[0-9a-f]{6}\)/);
  });
});
