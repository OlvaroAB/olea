/**
 * `sprigPlan`'s two load-bearing properties (`ol-t1hc`): leaf count comes from
 * `MASTERY_DISPLAY` — never a second, retyped table — and an empty leaf is always drawn as one
 * of five positions, outline only, never left out.
 *
 * `renderSprig` itself (the DOM-building half) is not exercised here — see `render-sprig.ts`'s
 * own module doc for why: this workspace has no DOM test environment (no `jsdom`/`happy-dom`
 * dependency), and adding one mid-task would touch the shared lockfile. `sprigPlan` carries every
 * decision `renderSprig` turns into markup, so it is what is worth asserting on.
 */

import { MASTERY_DISPLAY } from 'olea-core';
import { afterEach, describe, expect, it } from 'vitest';
import { sprigPlan } from '../../src/sprig/render-sprig.js';

// Restores whatever `MASTERY_DISPLAY[state].leaves` looked like before each mutating test —
// `MASTERY_DISPLAY` is `Readonly` only at the type level, not frozen at runtime, which is exactly
// what lets this test prove `sprigPlan` reads it live rather than caching a copy.
type MutableDisplay = { leaves: number };
const mutableDisplay = MASTERY_DISPLAY as unknown as Record<string, MutableDisplay>;

const ORIGINAL_LEAVES = Object.fromEntries(
  Object.entries(MASTERY_DISPLAY).map(([state, display]) => [state, display.leaves]),
);

afterEach(() => {
  for (const [state, leaves] of Object.entries(ORIGINAL_LEAVES)) {
    const display = mutableDisplay[state];
    if (display !== undefined) display.leaves = leaves;
  }
});

describe('sprigPlan', () => {
  it('always plans exactly 5 leaf positions, whatever the state', () => {
    for (const state of Object.keys(MASTERY_DISPLAY) as (keyof typeof MASTERY_DISPLAY)[]) {
      expect(sprigPlan(state).leaves).toHaveLength(5);
    }
  });

  it('fills exactly MASTERY_DISPLAY[state].leaves positions, from the bottom of the stem up', () => {
    const plan = sprigPlan('coming'); // 3 leaves
    expect(plan.leaves.map((l) => l.filled)).toEqual([true, true, true, false, false]);
  });

  it('an empty leaf is planned as an outline position, never omitted', () => {
    const plan = sprigPlan('new'); // 1 leaf
    const empties = plan.leaves.filter((l) => !l.filled);
    expect(empties).toHaveLength(4);
    // Still real geometry — a position, not a gap in the array.
    for (const leaf of empties) {
      expect(typeof leaf.cx).toBe('number');
      expect(typeof leaf.cy).toBe('number');
    }
  });

  it('carries the mastery word as the accessible label, unchanged from MASTERY_DISPLAY', () => {
    expect(sprigPlan('shaky').label).toBe(MASTERY_DISPLAY.shaky.label);
    expect(sprigPlan('yours').label).toBe(MASTERY_DISPLAY.yours.label);
  });

  it('reads MASTERY_DISPLAY live — leaf count follows a mutation, never a retyped table', () => {
    expect(sprigPlan('shaky').leaves.filter((l) => l.filled)).toHaveLength(2);

    const shaky = mutableDisplay.shaky;
    expect(shaky).toBeDefined();
    if (shaky !== undefined) shaky.leaves = 4;

    expect(sprigPlan('shaky').leaves.filter((l) => l.filled)).toHaveLength(4);
  });
});
