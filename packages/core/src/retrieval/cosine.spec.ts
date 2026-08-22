import { describe, expect, it } from 'vitest';
import { cosineSimilarity, topKByCosine } from './cosine.js';

describe('cosineSimilarity (D-004)', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('is 0 for a zero-length vector rather than NaN or a throw', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('is 0 for a dimension mismatch rather than a throw', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('topKByCosine (D-004: brute-force cosine)', () => {
  it('ranks candidates by similarity to the query, highest first', () => {
    const candidates = new Map<string, readonly number[]>([
      ['far', [0, 1]],
      ['near', [0.99, 0.14]],
      ['exact', [1, 0]],
    ]);
    const hits = topKByCosine([1, 0], candidates);
    expect(hits.map((h) => h.contentHash)).toEqual(['exact', 'near', 'far']);
  });

  it('caps results to k when supplied', () => {
    const candidates = new Map<string, readonly number[]>([
      ['a', [1, 0]],
      ['b', [0.9, 0.1]],
      ['c', [0, 1]],
    ]);
    expect(topKByCosine([1, 0], candidates, 2)).toHaveLength(2);
  });

  it('breaks ties deterministically by content hash', () => {
    const candidates = new Map<string, readonly number[]>([
      ['zzz', [1, 0]],
      ['aaa', [1, 0]],
    ]);
    const hits = topKByCosine([1, 0], candidates);
    expect(hits.map((h) => h.contentHash)).toEqual(['aaa', 'zzz']);
  });

  it('an empty candidate set returns no hits', () => {
    expect(topKByCosine([1, 0], new Map())).toEqual([]);
  });
});
