// Scenarios: features/F1-sources.md "C3.6 / T10 - Uncertain evidence is handled per claim"
// (ol-egov.141.89.1.64; D-465). Test id: @auto:core/transcript/flags.ol-egov.141.89.1.64.spec
// All text is the synthetic fixtures in fixtures/transcripts/.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimEligibility, flagTranscriptPart } from './transcript-flags.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/transcripts/${name}`, import.meta.url), 'utf8');

const SLIDE_TERMS = ['neighbour threshold', 'stacking rule', 'lattice'];

describe('one flag per kind', () => {
  it('flags a caption uncertainty marker', () => {
    for (const marker of ['[inaudible]', '[unclear]', '[Inaudible 00:12]', '(?)']) {
      const text = `We then apply the rule ${marker} to the sample.`;
      expect(flagTranscriptPart(text).flags).toEqual(['inaudible']);
    }
  });

  it('flags a deictic visual reference', () => {
    for (const phrase of ['this graph', 'the second equation', 'as you can see', 'as shown here']) {
      const out = flagTranscriptPart(`Notice ${phrase} for the result.`);
      expect(out.flags).toEqual(['visual-reference']);
    }
    expect(flagTranscriptPart('The graph of a function is a set of pairs.').flags).toEqual([]);
  });

  it('flags the fixture with both caption and visual kinds', () => {
    const out = flagTranscriptPart(fixture('deictic-and-inaudible.txt'));
    expect(out.flags).toEqual(['inaudible', 'visual-reference']);
  });

  it('records a near-match term as a candidate, never a correction', () => {
    const text = fixture('near-match-slide-term.txt');
    const out = flagTranscriptPart(text, { bundleTerms: SLIDE_TERMS });
    expect(out.flags).toEqual(['term-discrepancy']);
    const hit = out.spans[0];
    expect(text.slice(hit?.start, hit?.end)).toBe('neighbor');
    expect(hit?.candidateOf).toBe('neighbour');
    // The text is untouched: nothing is corrected.
    expect(text).toContain('neighbor cutoff');
  });

  it('runs no term check without bundle terms, and ignores plural forms and exact words', () => {
    expect(flagTranscriptPart(fixture('near-match-slide-term.txt')).flags).toEqual([]);
    const plain = flagTranscriptPart(
      'Each lattice has neighbours; the neighbour threshold holds.',
      {
        bundleTerms: SLIDE_TERMS,
      },
    );
    expect(plain.flags).toEqual([]);
  });
});

describe('per-claim eligibility', () => {
  it('withholds only the claim that depends on the unseen graph', () => {
    const text =
      'The lattice has six neighbours per cell. As you can see on this graph, the rise flattens. Each cell holds one value.';
    const claims = claimEligibility(text);
    expect(claims.map((c) => c.usableForGrounding)).toEqual([true, false, true]);
    expect(claims.map((c) => c.usableForAnswerKey)).toEqual([true, false, true]);
    expect(claims.map((c) => c.usableForGradingBasis)).toEqual([true, false, true]);
    expect(claims[1]?.needsModelJudgement).toBe(true);
    expect(claims[1]?.flags).toEqual(['visual-reference']);
    expect(claims[0]?.needsModelJudgement).toBe(false);
  });

  it('never reconstructs: each claim is the exact slice of the part', () => {
    const text = fixture('deictic-and-inaudible.txt');
    for (const c of claimEligibility(text)) expect(text.slice(c.start, c.end)).toBe(c.text);
    const second = claimEligibility(text).find((c) => c.flags.includes('inaudible'));
    expect(second?.text).toContain('[inaudible]');
  });

  it('withholds each claim that uses the spoken variant of a candidate term', () => {
    const text = fixture('near-match-slide-term.txt');
    const claims = claimEligibility(text, flagTranscriptPart(text, { bundleTerms: SLIDE_TERMS }));
    const withheld = claims.filter((c) => !c.usableForGrounding);
    expect(withheld.length).toBeGreaterThan(0);
    expect(withheld.every((c) => c.flags.includes('term-discrepancy'))).toBe(true);
  });

  it('keeps a self-contained sentence beside a candidate-term sentence usable', () => {
    const text = 'The neighbor cutoff ends the run. The lattice is a regular grid.';
    const claims = claimEligibility(text, flagTranscriptPart(text, { bundleTerms: SLIDE_TERMS }));
    expect(claims.map((c) => c.usableForGrounding)).toEqual([false, true]);
  });

  it('an unflagged part is fully usable', () => {
    const claims = claimEligibility(
      'Entropy never decreases in an isolated system. It is additive.',
    );
    expect(claims.every((c) => c.usableForGrounding && !c.needsModelJudgement)).toBe(true);
  });
});
