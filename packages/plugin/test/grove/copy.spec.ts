/**
 * `grove/copy.ts` honesty tests (F8.1, F8.2, F8.3, `ol-0r92.17`, `ol-o8eo`) —
 * same pattern `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their
 * own `allXStrings()` sweep, plus `gap/copy.ts#coverageScopeStatement`'s own
 * convention of sweeping a TEMPLATED function's output across representative
 * fixtures, since `allGroveStrings()` alone cannot enumerate one.
 */
import type { GroveCourseSummary } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  allGroveStrings,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_MATERIAL_GAP_LABEL,
  GROVE_VIEW_TITLE,
  groveStateLabel,
  groveSummaryLine,
} from '../../src/grove/copy.js';

const SUMMARIES: readonly GroveCourseSummary[] = [
  { builtCount: 0, denominatorCount: 0, denominatorSourcePaths: [] },
  {
    builtCount: 1,
    denominatorCount: 1,
    denominatorSourcePaths: ['03 Research/Objectives.md'],
  },
  {
    builtCount: 3,
    denominatorCount: 7,
    denominatorSourcePaths: ['03 Research/Objectives.md', '03 Research/Past Paper 2024.md'],
  },
];

/** Every string this module can put in front of her, across representative summaries — the sweep target for F8.3's ban, matching `gap/copy.ts`'s own convention. */
function everyProducibleString(): readonly string[] {
  return [...allGroveStrings(), ...SUMMARIES.map(groveSummaryLine)];
}

describe('grove copy — F8.3 no scalar', () => {
  it('never contains a percentage, ratio or fraction, across every producible string', () => {
    for (const text of everyProducibleString()) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('exposes a real, non-empty title', () => {
    expect(GROVE_VIEW_TITLE.length).toBeGreaterThan(0);
  });

  it('every string is non-empty', () => {
    for (const text of everyProducibleString()) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('labels an Olea-inferred count as a guess, per F8.1’s own escape hatch', () => {
    // F8.1: "scope Olea inferred alone is a guess and must be labelled one."
    expect(GROVE_INFERRED_DISCLAIMER.toLowerCase()).toContain('not yet');
  });

  it('the summary line names the count and the source separately — never their quotient', () => {
    const line = groveSummaryLine(SUMMARIES[2] as GroveCourseSummary);
    expect(line).toContain('3 of 7 built');
    expect(line).toContain('2 registered sources');
  });
});

describe('grove copy — vocabulary registry §6 discipline', () => {
  it('never coins a fourth olive noun for a material gap — it is plain language', () => {
    expect(GROVE_MATERIAL_GAP_LABEL.toLowerCase()).not.toContain('ground');
    expect(GROVE_MATERIAL_GAP_LABEL.toLowerCase()).not.toContain('grove');
  });

  it('never says "not worth building" for a stalled ground reading — F4.5, [D-063]', () => {
    for (const text of everyProducibleString()) {
      expect(text.toLowerCase()).not.toContain('not worth building');
      expect(text.toLowerCase()).not.toContain('olea decided');
    }
  });

  it('reads the four growth-stage words verbatim from olea-core, never re-wording them', () => {
    expect(groveStateLabel('seed')).toBe('seed');
    expect(groveStateLabel('sprout')).toBe('sprout');
    expect(groveStateLabel('sapling')).toBe('sapling');
    expect(groveStateLabel('tree')).toBe('tree');
    expect(groveStateLabel('ground')).toBe('ground');
  });
});
