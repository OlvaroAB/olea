// CHK-2 (`ol-3ux7.15`). Case ids are opaque placeholders — no query text, no
// chunk text (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): one case includes a single
// confabulation among otherwise-refusing cases — "one confabulation is a
// fail at any sample size," in the register row's own words.
import { describe, expect, it } from 'vitest';
import { checkGroundingRefusalOnAdversarial } from './grounding-refusal-adversarial.js';

describe('checkGroundingRefusalOnAdversarial', () => {
  it('fails on a single confabulation among otherwise-refusing cases', () => {
    const cases = [
      { id: 'no-hits', refused: true },
      { id: 'below-cosine-floor', refused: true },
      { id: 'gibberish-keyword-match', refused: false },
    ];
    const verdict = checkGroundingRefusalOnAdversarial(cases);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.confabulations).toEqual(['gibberish-keyword-match']);
  });

  it('passes 100% refusal', () => {
    const cases = [
      { id: 'no-hits', refused: true },
      { id: 'below-cosine-floor', refused: true },
      { id: 'below-composite-threshold', refused: true },
    ];
    const verdict = checkGroundingRefusalOnAdversarial(cases);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.refusals).toBe(3);
  });

  it('reports zero cases as a failure — a sweep that ran nothing cannot report 100% (N-013)', () => {
    const verdict = checkGroundingRefusalOnAdversarial([]);
    expect(verdict.ok).toBe(false);
  });
});
