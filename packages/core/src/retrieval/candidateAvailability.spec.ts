import { describe, expect, it } from 'vitest';
import { resolveCandidateAvailability, withVerifiedAnchor } from './candidateAvailability.js';

describe('resolveCandidateAvailability (`[ILB-EVD-4]`, evd.md §2)', () => {
  it('is never degraded when the embedding call succeeded, regardless of keyword hits or an anchor', () => {
    expect(
      resolveCandidateAvailability({
        embeddingAvailable: true,
        keywordHitCount: 0,
        hasVerifiedAnchor: false,
      }),
    ).toEqual({ kind: 'available', degraded: false });

    expect(
      resolveCandidateAvailability({
        embeddingAvailable: true,
        keywordHitCount: 5,
        hasVerifiedAnchor: true,
      }),
    ).toEqual({ kind: 'available', degraded: false });
  });

  it('continues, degraded, on an embedding failure with keyword hits alone', () => {
    expect(
      resolveCandidateAvailability({
        embeddingAvailable: false,
        keywordHitCount: 3,
        hasVerifiedAnchor: false,
      }),
    ).toEqual({ kind: 'available', degraded: true });
  });

  it('continues, degraded, on an embedding failure with a verified anchor alone (no keyword hits)', () => {
    expect(
      resolveCandidateAvailability({
        embeddingAvailable: false,
        keywordHitCount: 0,
        hasVerifiedAnchor: true,
      }),
    ).toEqual({ kind: 'available', degraded: true });
  });

  it('continues, degraded, on an embedding failure with both a verified anchor and keyword hits', () => {
    expect(
      resolveCandidateAvailability({
        embeddingAvailable: false,
        keywordHitCount: 2,
        hasVerifiedAnchor: true,
      }),
    ).toEqual({ kind: 'available', degraded: true });
  });

  it('ends unavailable — never insufficient — on an embedding failure with neither anchor nor keyword hits', () => {
    expect(
      resolveCandidateAvailability({
        embeddingAvailable: false,
        keywordHitCount: 0,
        hasVerifiedAnchor: false,
      }),
    ).toEqual({ kind: 'unavailable' });
  });
});

interface Ref {
  readonly path: string;
  readonly blockIndex: number;
  readonly tag?: string;
}

const ref = (path: string, blockIndex: number, tag?: string): Ref =>
  tag === undefined ? { path, blockIndex } : { path, blockIndex, tag };

describe('withVerifiedAnchor (`[ILB-EVD-4]`, evd.md §2)', () => {
  it('returns candidates unchanged (same reference) when anchor is null', () => {
    const candidates = [ref('a.md', 0)];
    expect(withVerifiedAnchor(candidates, null)).toBe(candidates);
  });

  it('prepends the anchor when it is not already among the candidates', () => {
    const candidates = [ref('a.md', 0), ref('b.md', 1)];
    const anchor = ref('c.md', 2);
    expect(withVerifiedAnchor(candidates, anchor)).toEqual([anchor, ...candidates]);
  });

  it('does not duplicate the anchor when it is already present by path + blockIndex', () => {
    const already = ref('a.md', 0, 'from-keyword-search');
    const candidates = [already, ref('b.md', 1)];
    const anchor = ref('a.md', 0, 'from-anchor-lookup');
    // Identity is (path, blockIndex) only — the existing candidate (whatever carried it, e.g.
    // a keyword hit) is kept as-is, not replaced by the anchor's own copy of the same chunk.
    expect(withVerifiedAnchor(candidates, anchor)).toEqual(candidates);
  });

  it('produces a singleton list from an anchor alone when there were no other candidates', () => {
    const anchor = ref('a.md', 0);
    expect(withVerifiedAnchor([], anchor)).toEqual([anchor]);
  });
});
