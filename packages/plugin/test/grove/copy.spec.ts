/**
 * `grove/copy.ts` honesty tests (F8.1, F8.3, `ol-0r92.17`) — same pattern
 * `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their own
 * `allXStrings()` sweep.
 */
import { describe, expect, it } from 'vitest';
import {
  allGroveStrings,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_VIEW_TITLE,
} from '../../src/grove/copy.js';

describe('grove copy — F8.3 no scalar', () => {
  it('never contains a percentage, ratio or fraction', () => {
    for (const text of allGroveStrings()) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('exposes a real, non-empty title', () => {
    expect(GROVE_VIEW_TITLE.length).toBeGreaterThan(0);
  });

  it('every string is non-empty', () => {
    for (const text of allGroveStrings()) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('labels an Olea-inferred count as a guess, per F8.1’s own escape hatch', () => {
    // F8.1: "scope Olea inferred alone is a guess and must be labelled one."
    expect(GROVE_INFERRED_DISCLAIMER.toLowerCase()).toContain('not yet');
  });
});
