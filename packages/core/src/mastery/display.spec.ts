import { masteryState } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { MASTERY_DISPLAY, MASTERY_ORDER, masteryTitle } from './display.js';

describe('mastery display vocabulary (F2.11, D-049)', () => {
  // The Record<MasteryState, ...> type already makes a missing key a compile
  // error, so this asserts the thing the type cannot: that the *order* array
  // and the enum have not drifted apart, in either direction. A new state
  // added to the schema and forgotten here would otherwise only surface as a
  // gap in a distribution strip nobody is looking at.
  it('covers exactly the ratified enum, in evidence order', () => {
    expect([...MASTERY_ORDER]).toEqual(masteryState.options);
    expect(Object.keys(MASTERY_DISPLAY).sort()).toEqual([...masteryState.options].sort());
  });

  it('uses F2.11 words verbatim as the labels', () => {
    // The spec's vocabulary, hardcoded here on purpose: this is the one test
    // that fails if someone "improves" the copy without going through D-049.
    expect(MASTERY_ORDER.map((s) => MASTERY_DISPLAY[s].label)).toEqual([
      'seed',
      'sprout',
      'sapling',
      'tree',
    ]);
  });

  it('maps the four stages to the ratified sprig geometry — 0, 1, 3 leaves, fruit only at the top', () => {
    // Never a fourth leaf: `tree` adds fruit to the same three leaves
    // `sapling` already draws (docs/design MasteryAxes.jsx `StageSprig`).
    expect(MASTERY_ORDER.map((s) => MASTERY_DISPLAY[s].leaves)).toEqual([0, 1, 3, 3]);
    expect(MASTERY_ORDER.map((s) => MASTERY_DISPLAY[s].fruit)).toEqual([false, false, false, true]);
  });

  it('sentence-cases without keeping a second copy of the words', () => {
    expect(masteryTitle('sapling')).toBe('Sapling');
    expect(masteryTitle('tree')).toBe('Tree');
  });
});
