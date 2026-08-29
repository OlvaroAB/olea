/**
 * `home/copy.ts` honesty tests (F8.3, F8.8, `ol-0r92.17`) — same pattern
 * `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their own
 * `allXStrings()` sweep.
 */
import { describe, expect, it } from 'vitest';
import { allHomeStrings, HOME_VIEW_TITLE } from '../../src/home/copy.js';

describe('home copy — F8.3 no scalar', () => {
  it('never contains a percentage, ratio or fraction', () => {
    for (const text of allHomeStrings()) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('exposes a real, non-empty title', () => {
    expect(HOME_VIEW_TITLE.length).toBeGreaterThan(0);
  });

  it('every string is non-empty', () => {
    for (const text of allHomeStrings()) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
