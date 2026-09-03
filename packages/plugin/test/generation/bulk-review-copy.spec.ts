/**
 * `sourceMarkerText` tests (`[D-216]` / `ol-egov.105`). The ruling's own
 * wording constraints, made mechanical: a plain pointer, never citation
 * punctuation, and the origin is named — never claimed as support for the
 * draft.
 */
import { describe, expect, it } from 'vitest';
import { sourceMarkerText } from '../../src/generation/bulk-review-copy.js';

describe('sourceMarkerText', () => {
  it('names the note title as a plain "from your reading on X" pointer', () => {
    expect(sourceMarkerText('Week 2')).toBe('From your reading on Week 2.');
  });

  it('carries no citation punctuation — no brackets, no footnote marks', () => {
    const text = sourceMarkerText('Week 2');
    expect(text).not.toMatch(/[[\]^*]/);
  });

  it('never claims the draft is supported by the source — names it, does not vouch', () => {
    const text = sourceMarkerText('Week 2').toLowerCase();
    for (const vouchingWord of ['support', 'accurate', 'verified', 'confirmed']) {
      expect(text).not.toContain(vouchingWord);
    }
  });
});
