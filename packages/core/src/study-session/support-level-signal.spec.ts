import { describe, expect, it } from 'vitest';
import { deriveFailureShape, type GradedReviewEvidence } from './support-level-signal.js';

describe('deriveFailureShape — explain-back, genuinely finer than card-level correctness', () => {
  it('maps a clean integrated answer to none', () => {
    expect(
      deriveFailureShape({
        instrumentType: 'explain-back',
        rating: 'good',
        soloLevel: 'relational',
      }),
    ).toBe('none');
    expect(
      deriveFailureShape({
        instrumentType: 'explain-back',
        rating: 'easy',
        soloLevel: 'extended-abstract',
      }),
    ).toBe('none');
  });

  it('maps a partial, unintegrated answer to minor-slip, not an escalation trigger', () => {
    expect(
      deriveFailureShape({
        instrumentType: 'explain-back',
        rating: 'hard',
        soloLevel: 'unistructural',
      }),
    ).toBe('minor-slip');
    expect(
      deriveFailureShape({
        instrumentType: 'explain-back',
        rating: 'hard',
        soloLevel: 'multistructural',
      }),
    ).toBe('minor-slip');
  });

  it('maps a response that misses the point to wrong-concept', () => {
    expect(
      deriveFailureShape({
        instrumentType: 'explain-back',
        rating: 'again',
        soloLevel: 'prestructural',
      }),
    ).toBe('wrong-concept');
  });

  it('two different real gradings that would both read as a bare "wrong" under card-level correctness produce different failure shapes', () => {
    const shallow = deriveFailureShape({
      instrumentType: 'explain-back',
      rating: 'again',
      soloLevel: 'multistructural',
    });
    const missedThePoint = deriveFailureShape({
      instrumentType: 'explain-back',
      rating: 'again',
      soloLevel: 'prestructural',
    });
    // Same FSRS rating on both ('again' — the only card-level signal FSRS has)
    // and yet the shapes differ, because the signal reads the SOLO texture
    // rather than the rating.
    expect(shallow).not.toBe(missedThePoint);
    expect(shallow).toBe('minor-slip');
    expect(missedThePoint).toBe('wrong-concept');
  });

  it('throws on an explain-back review with no soloLevel rather than guessing', () => {
    const evidence: GradedReviewEvidence = { instrumentType: 'explain-back', rating: 'again' };
    expect(() => deriveFailureShape(evidence)).toThrow(/soloLevel/);
  });
});

describe("deriveFailureShape — recall (qa/cloze): the honest limit of today's data", () => {
  it('maps every non-again rating to none — hard/good/easy are all "she recalled it"', () => {
    for (const rating of ['hard', 'good', 'easy'] as const) {
      expect(deriveFailureShape({ instrumentType: 'qa', rating })).toBe('none');
      expect(deriveFailureShape({ instrumentType: 'cloze', rating })).toBe('none');
    }
  });

  it('maps again to wrong-concept — erring toward offering, never toward minor-slip, on an irreducibly coarse signal', () => {
    expect(deriveFailureShape({ instrumentType: 'qa', rating: 'again' })).toBe('wrong-concept');
    expect(deriveFailureShape({ instrumentType: 'cloze', rating: 'again' })).toBe('wrong-concept');
  });

  it('ignores a soloLevel if one were passed for a recall instrument — recall has no SOLO texture', () => {
    expect(
      deriveFailureShape({
        instrumentType: 'qa',
        rating: 'again',
        soloLevel: 'extended-abstract',
      }),
    ).toBe('wrong-concept');
  });
});

describe('deriveFailureShape — recognition (mcq) is out of scope, structurally', () => {
  it('throws rather than returning a plausible-looking value', () => {
    expect(() => deriveFailureShape({ instrumentType: 'mcq', rating: 'again' })).toThrow(/mcq/);
  });
});
