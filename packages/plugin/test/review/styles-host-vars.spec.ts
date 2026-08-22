/**
 * The regression guard for `ol-ro57` (F2.4, Q6.1, Q6.5).
 *
 * **What the bug was.** `view.ts` puts Obsidian's `theme-dark` class on the
 * review view's own root so `styles.css`'s `var(--background-primary, …)`
 * reads resolve through the *dark* branch of her installed theme. That only
 * works for variables the theme declares in its `.theme-dark` block. A
 * variable it declares in *only* its light branch has no declaration on this
 * root at all, so the root — a `.theme-dark` element inside a `.theme-light`
 * body — **inherits the light value**, while everything declared in both
 * resolves dark. Things 2.2.4 declares `--background-modifier-hover` only
 * under `.theme-light`, and `.olea-review-keycap` paints that as its
 * background with `--text-muted` (declared in both, so dark) as its text:
 * light-grey glyph on a light-grey chip, 1.37:1, every keyboard hint and
 * rating digit and MCQ option letter.
 *
 * **Why a unit test can catch this class at all, having failed to catch the
 * instance.** The *instance* is a pixel fact and needed a browser and a real
 * theme to find — no assertion here would have produced it. But the fix
 * establishes an invariant that is purely a property of this stylesheet's
 * text, and it is that invariant which regresses silently:
 *
 *   > Every host variable `styles.css` reads either has an Olea-owned dark
 *   > value declared on `.olea-review-root` in the `olea-host-fallback`
 *   > cascade layer, or is branch-invariant and listed as such below.
 *
 * A host variable read with no floor under it is exactly the defect, whether
 * or not any theme we have happens to expose it. The next role someone adds
 * — `var(--background-secondary, …)`, say — reintroduces it, in a file with
 * no other test, and nothing downstream would notice until a user with the
 * wrong theme could not read a control. That is what this asserts.
 *
 * What it deliberately does **not** assert: that the floor's values are
 * legible. Contrast is pixels; it belongs to the workbench's per-state ×
 * per-variable-set pass (`ol-z6x2`), not here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');

const LAYER_NAME = 'olea-host-fallback';

/**
 * Host variables that carry the *same* value in a theme's light and dark
 * branches, so hosts declare them once (on `body`) rather than per branch.
 * These must stay **out** of the layer: a declaration on the review root
 * beats an inherited one whether it is layered or not, so flooring them
 * would silently override her real typeface and her real accent colour.
 * Neither can make anything illegible — a typeface has no contrast, and the
 * accent is only ever drawn as a focus outline.
 */
const BRANCH_INVARIANT = new Set([
  '--font-interface',
  '--font-text',
  '--font-monospace',
  '--interactive-accent',
]);

/** Returns the text inside the outermost braces of the `@layer <name> { … }` rule. */
function extractLayerBody(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name}`);
  expect(start, `styles.css declares an @layer ${name} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated @layer ${name} block`);
}

function removeRange(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(0, start) + css.slice(i + 1);
    }
  }
  throw new Error(`unterminated @layer ${name} block`);
}

const layerBody = extractLayerBody(CSS, LAYER_NAME);
const outsideLayer = removeRange(CSS, LAYER_NAME);

/** Custom properties the layer declares — the floor. */
const floored = new Set(
  Array.from(layerBody.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1] as string),
);

/**
 * Every `var(--x…)` read outside the layer whose name is not Olea's own.
 * Comments are stripped first so prose in the header cannot register as a read.
 */
const hostReads = new Set(
  Array.from(
    outsideLayer.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/var\(\s*(--[a-z0-9-]+)/g),
    (m) => m[1] as string,
  ).filter((name) => !name.startsWith('--olea-')),
);

describe('styles.css host-variable floor (ol-ro57)', () => {
  it('reads at least one host variable, so the checks below are not vacuous', () => {
    expect(hostReads.size).toBeGreaterThan(0);
    expect(floored.size).toBeGreaterThan(0);
  });

  it('floors every branch-varying host variable it reads', () => {
    const unfloored = [...hostReads].filter(
      (name) => !floored.has(name) && !BRANCH_INVARIANT.has(name),
    );
    expect(
      unfloored,
      `these host variables are read with no dark value declared on .olea-review-root, so a theme ` +
        `that declares them only in its .theme-light branch will leak a light value into the dark ` +
        `review view (ol-ro57). Add them to the @layer ${LAYER_NAME} block, or to BRANCH_INVARIANT ` +
        `with the argument for why a wrong-branch value there cannot hurt.`,
    ).toEqual([]);
  });

  it('keeps branch-invariant host variables out of the floor', () => {
    const wronglyFloored = [...BRANCH_INVARIANT].filter((name) => floored.has(name));
    expect(
      wronglyFloored,
      'flooring a branch-invariant variable overrides the real value the host declares on <body>, ' +
        'because a declaration on this element beats an inherited one even from inside a layer.',
    ).toEqual([]);
  });

  it('gives every branch-invariant read an inline fallback instead', () => {
    const withoutFallback = [...BRANCH_INVARIANT].filter((name) => {
      if (!hostReads.has(name)) return false;
      return !new RegExp(`var\\(\\s*${name}\\s*,`).test(outsideLayer);
    });
    expect(withoutFallback).toEqual([]);
  });

  it('keeps one home for the floor values: the layer declares only --olea-dark-* references', () => {
    const values = Array.from(layerBody.matchAll(/--[a-z0-9-]+\s*:\s*([^;]+);/g), (m) =>
      (m[1] as string).trim(),
    );
    expect(values.length).toBe(floored.size);
    for (const value of values) {
      expect(value, 'floor values are declared once, as --olea-dark-* tokens').toMatch(
        /^var\(--olea-dark-[a-z-]+\)$/,
      );
    }
  });

  it('declares every --olea-dark-* token the layer references, exactly once', () => {
    const referenced = new Set(
      Array.from(layerBody.matchAll(/var\((--olea-dark-[a-z-]+)\)/g), (m) => m[1] as string),
    );
    for (const token of referenced) {
      const declarations = outsideLayer.match(new RegExp(`^\\s*${token}\\s*:`, 'gm')) ?? [];
      expect(declarations.length, `${token} is declared exactly once`).toBe(1);
    }
  });

  it('still reaches the host first: no floor token is painted directly', () => {
    // The floor is a fallback, never a palette. Every painted rule goes through
    // an --olea-host-* role, which reads the host variable and only then the floor.
    const painted = outsideLayer
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .match(/(?:background|color|border[a-z-]*)\s*:[^;]*var\(--olea-dark-[a-z-]+\)/g);
    expect(painted ?? []).toEqual([]);
  });
});
