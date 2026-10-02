import { describe, expect, it } from 'vitest';
import {
  claimsUsableFor,
  type EndorsedClaim,
  endorsementAllowsUse,
} from '../source/transcript-attribution.js';

const X: EndorsedClaim = { claim: 'Claim X (widely held)', endorsement: 'quoted-and-rejected' };
const Y: EndorsedClaim = { claim: 'Account Y', endorsement: 'asserted' };
const Z: EndorsedClaim = { claim: 'Claim Z', endorsement: 'ambiguous' };

describe('transcript endorsement (ol-egov.141.89.3.42)', () => {
  it('a quoted-and-rejected claim is never correct, an answer key or a grading basis', () => {
    for (const use of ['correct-account', 'answer-key', 'grading-basis'] as const) {
      expect(claimsUsableFor([X, Y], use)).toEqual([Y]);
    }
    expect(endorsementAllowsUse('quoted-and-rejected', 'ordinary-context')).toBe(false);
  });

  it('an unresolved endorsement is not an answer key or grading basis, and stays ordinary context', () => {
    expect(claimsUsableFor([Z], 'answer-key')).toEqual([]);
    expect(claimsUsableFor([Z], 'grading-basis')).toEqual([]);
    expect(claimsUsableFor([Z], 'ordinary-context')).toEqual([Z]);
  });

  it('a question is never an answer key', () => {
    expect(endorsementAllowsUse('question', 'answer-key')).toBe(false);
  });
});
