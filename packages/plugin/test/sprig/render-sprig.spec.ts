/**
 * `sprigPlan`'s load-bearing properties (`ol-t1hc`, re-geometried for D-049 /
 * `VOC-1` / `ol-7efk`): geometry comes from `SPRIG_GEOMETRY` — never a second,
 * retyped table — and follows the ratified per-stage shape (`seed` no stem/no
 * leaves, `sprout` one leaf, `sapling` three leaves, `tree` the same three
 * leaves plus fruit), never the retired "one leaf filled out of five fixed
 * positions."
 *
 * `renderSprig` itself (the DOM-building half) is not exercised by mounting real DOM here — see
 * `render-sprig.ts`'s own module doc for why: this workspace has no DOM test
 * environment (no `jsdom`/`happy-dom` dependency), and adding one mid-task
 * would touch the shared lockfile. `sprigPlan` carries every decision
 * `renderSprig` turns into markup, so it is what is worth asserting on.
 *
 * **The document-ownership fix (`ol-dth1`) is asserted at the source-text level instead**, same
 * convention as `ol-rq23`'s `view-focus-document.spec.ts`: `render-sprig.ts` imports no
 * `obsidian` symbol, so nothing here stops a real mounted-DOM test on *type* grounds, but the
 * missing DOM environment above rules one out in practice. The bug this regresses is a pure
 * property of the file's text — every node-creating call must read its `Document` off the
 * `container` the caller passed in, never off the ambient global — and that property is exactly
 * as visible in source text as it is at runtime.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTERY_DISPLAY } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { sprigPlan } from '../../src/sprig/render-sprig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the fix must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const RENDER_SPRIG = codeOf('src/sprig/render-sprig.ts');

describe('sprigPlan', () => {
  it('seed draws no stem and no leaves', () => {
    const plan = sprigPlan('seed');
    expect(plan.seed).toBe(true);
    expect(plan.stemTop).toBeNull();
    expect(plan.leaves).toHaveLength(0);
    expect(plan.fruit).toBeNull();
  });

  it('sprout draws a stem and exactly one leaf', () => {
    const plan = sprigPlan('sprout');
    expect(plan.seed).toBe(false);
    expect(plan.stemTop).not.toBeNull();
    expect(plan.leaves).toHaveLength(1);
    expect(plan.fruit).toBeNull();
  });

  it('sapling draws a stem and exactly three leaves, still no fruit', () => {
    const plan = sprigPlan('sapling');
    expect(plan.seed).toBe(false);
    expect(plan.leaves).toHaveLength(3);
    expect(plan.fruit).toBeNull();
  });

  it('tree draws the same three leaves as sapling, plus fruit — never a fourth leaf', () => {
    const sapling = sprigPlan('sapling');
    const tree = sprigPlan('tree');
    expect(tree.leaves).toHaveLength(3);
    expect(tree.leaves).toEqual(sapling.leaves);
    expect(tree.fruit).not.toBeNull();
  });

  it('carries the mastery word as the accessible label, unchanged from MASTERY_DISPLAY', () => {
    expect(sprigPlan('sapling').label).toBe(MASTERY_DISPLAY.sapling.label);
    expect(sprigPlan('tree').label).toBe(MASTERY_DISPLAY.tree.label);
  });
});

describe('renderSprig reads its own document, not the ambient global (ol-dth1)', () => {
  it('derives the document from options.container, never a bare `document`', () => {
    expect(RENDER_SPRIG).toMatch(/const doc = options\.container\.ownerDocument;/);
  });

  it('every createElementNS call is qualified by the derived `doc`, not `document`', () => {
    // Five call sites: the svg root, the seed ellipse, the stem path, the per-leaf ellipse and
    // the fruit circle — all must read `doc.createElementNS`.
    const docCreateElementNS = RENDER_SPRIG.match(/\bdoc\.createElementNS\(/g);
    expect(docCreateElementNS).not.toBeNull();
    expect(docCreateElementNS?.length).toBe(5);
  });

  it('never reads the bare ambient `document.createElementNS`', () => {
    expect(RENDER_SPRIG).not.toMatch(/(?<!\.)\bdocument\.createElementNS\b/);
  });

  it('never reads any other bare `document.` or `window.` global in this file', () => {
    // Excludes identifiers that merely contain "document"/"window" as a substring
    // (ownerDocument, etc.) by requiring a non-identifier character (or start-of-file)
    // immediately before.
    const bareDocument = /(?<![.\w])document\./g;
    const bareWindow = /(?<![.\w])window\./g;
    expect(RENDER_SPRIG.match(bareDocument)).toBeNull();
    expect(RENDER_SPRIG.match(bareWindow)).toBeNull();
  });
});
