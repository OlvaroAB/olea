/**
 * `sprigPlan`'s load-bearing properties (`ol-t1hc`, re-geometried for D-049 /
 * `VOC-1` / `ol-7efk`): geometry comes from `SPRIG_GEOMETRY` — never a second,
 * retyped table — and follows the ratified per-stage shape (`seed` no stem/no
 * leaves, `sprout` one leaf, `sapling` three leaves, `tree` the same three
 * leaves plus fruit), never the retired "one leaf filled out of five fixed
 * positions."
 *
 * `renderSprig` itself (the DOM-building half) is not exercised here — see
 * `render-sprig.ts`'s own module doc for why: this workspace has no DOM test
 * environment (no `jsdom`/`happy-dom` dependency), and adding one mid-task
 * would touch the shared lockfile. `sprigPlan` carries every decision
 * `renderSprig` turns into markup, so it is what is worth asserting on.
 */

import { MASTERY_DISPLAY } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { sprigPlan } from '../../src/sprig/render-sprig.js';

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
