import { describe, expect, it } from 'vitest';
import { normalizeAssessmentWeight } from './weight.js';

describe('normalizeAssessmentWeight — [D-143] canonical fraction basis', () => {
  it('takes a value at or below 1 as a fraction, unchanged', () => {
    for (const raw of [0, 0.01, 0.05, 0.5, 1]) {
      expect(normalizeAssessmentWeight(raw)).toEqual({ value: raw, basis: 'fraction' });
    }
  });

  it('takes a value above 1 as a percentage and divides by 100', () => {
    expect(normalizeAssessmentWeight(5)).toEqual({ value: 0.05, basis: 'percentage' });
    expect(normalizeAssessmentWeight(100)).toEqual({ value: 1, basis: 'percentage' });
    // Just past the boundary — the rule is a threshold, not a judgement, so
    // this is a percentage however unlikely a 1.01% assessment is.
    expect(normalizeAssessmentWeight(1.01).basis).toBe('percentage');
  });

  it('reports an absent or unreadable value as absent — never a fabricated zero', () => {
    for (const raw of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeAssessmentWeight(raw)).toEqual({ value: undefined, basis: undefined });
    }
  });

  it('is idempotent over every realistic weight, so a second pass at a consumer cannot corrupt a normalized record', () => {
    for (const raw of [0, 0.01, 0.5, 1, 5, 20, 35, 50, 100]) {
      const once = normalizeAssessmentWeight(raw).value;
      const twice = normalizeAssessmentWeight(once).value;
      expect(twice).toBeCloseTo(once ?? Number.NaN, 12);
    }
  });

  it('does NOT clamp a negative into zero — the basis is this function’s job, and hiding a bad value at ingest would cost the consumer its own honest report', () => {
    expect(normalizeAssessmentWeight(-0.2)).toEqual({ value: -0.2, basis: 'fraction' });
  });
});
