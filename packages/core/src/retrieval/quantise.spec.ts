import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './cosine.js';
import {
  decodeQuantisedVector,
  encodeQuantisedVector,
  encodeVectorForCache,
  QUANTISED_CODE_MAX,
  quantiseVector,
} from './quantise.js';

describe('quantiseVector (ol-l1qz)', () => {
  it('codes the largest-magnitude component at the top of the range', () => {
    expect(quantiseVector([1, 0, 0])).toEqual(Int8Array.from([QUANTISED_CODE_MAX, 0, 0]));
    expect(quantiseVector([-1, 0, 0])).toEqual(Int8Array.from([-QUANTISED_CODE_MAX, 0, 0]));
  });

  it('keeps direction and discards scale — cosine cannot tell the two apart, so neither does the cache', () => {
    const small = quantiseVector([0.03, -0.01, 0.02]);
    const large = quantiseVector([30, -10, 20]);
    expect(small).toEqual(large);
  });

  it('is symmetric about zero: negating a vector negates every code exactly', () => {
    const vector = [0.4, -0.1, 0.9, -0.9, 0.02];
    const positive = quantiseVector(vector);
    const negative = quantiseVector(vector.map((v) => -v));
    for (let i = 0; i < positive.length; i++) {
      expect(negative[i]).toBe(-(positive[i] ?? 0));
    }
  });

  it('never emits -128, so the grid has no asymmetric bottom code', () => {
    const codes = quantiseVector([-1, -0.999, -0.5, 1]);
    for (const code of codes) expect(code).toBeGreaterThanOrEqual(-QUANTISED_CODE_MAX);
  });

  it('codes a zero vector, an empty vector, and an all-non-finite vector as all zeros rather than throwing', () => {
    expect(quantiseVector([0, 0, 0])).toEqual(Int8Array.from([0, 0, 0]));
    expect(quantiseVector([])).toEqual(new Int8Array(0));
    expect(quantiseVector([Number.NaN, Number.POSITIVE_INFINITY])).toEqual(Int8Array.from([0, 0]));
  });

  it('zeroes a non-finite component inside an otherwise usable vector rather than poisoning every later comparison', () => {
    const codes = quantiseVector([1, Number.NaN, 0.5]);
    expect(codes).toEqual(Int8Array.from([127, 0, 64]));
    expect(cosineSimilarity([1, 0, 0.5], codes)).not.toBeNaN();
  });
});

describe('base64 codec round trip', () => {
  it('round-trips every byte value', () => {
    const codes = new Int8Array(256);
    for (let i = 0; i < 256; i++) codes[i] = i - 128;
    expect(decodeQuantisedVector(encodeQuantisedVector(codes))).toEqual(codes);
  });

  it('round-trips every length modulo 3, so padding is right in all three cases', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 6, 1023, 1024, 1025]) {
      const codes = new Int8Array(length);
      for (let i = 0; i < length; i++) codes[i] = ((i * 37) % 255) - 127;
      const encoded = encodeQuantisedVector(codes);
      expect(decodeQuantisedVector(encoded), `length ${length}`).toEqual(codes);
    }
  });

  it('encodes a 1024-dimension vector in 1368 characters — the number the mobile budget is built on', () => {
    expect(encodeQuantisedVector(new Int8Array(1024))).toHaveLength(1368);
  });

  it('produces only base64 characters, so it survives JSON without escaping', () => {
    const codes = new Int8Array(300);
    for (let i = 0; i < codes.length; i++) codes[i] = ((i * 91) % 255) - 127;
    expect(encodeQuantisedVector(codes)).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(JSON.stringify({ codes: encodeQuantisedVector(codes) })).toContain(
      encodeQuantisedVector(codes),
    );
  });

  it('returns null rather than throwing for anything malformed — a corrupt cache row costs one re-embed, not a crash', () => {
    expect(decodeQuantisedVector('abc')).toBeNull(); // length not a multiple of 4
    expect(decodeQuantisedVector('ab*d')).toBeNull(); // character outside the alphabet
    expect(decodeQuantisedVector('a=cd')).toBeNull(); // padding in a non-final slot
    expect(decodeQuantisedVector('AAAA====')).toBeNull(); // padding in a non-final quartet
    expect(decodeQuantisedVector('not!valid!base64')).toBeNull();
  });

  it('treats the empty string as an empty vector, not as corruption', () => {
    expect(decodeQuantisedVector('')).toEqual(new Int8Array(0));
  });
});

describe('encodeVectorForCache', () => {
  it('is quantise-then-encode, and its output decodes back to the codes', () => {
    const vector = [0.4, -0.1, 0.9, -0.9, 0.02];
    expect(decodeQuantisedVector(encodeVectorForCache(vector))).toEqual(quantiseVector(vector));
  });
});

describe('cosine over mixed representations (asymmetric quantisation)', () => {
  it('a full-precision query against quantised codes still scores ~1 for the same direction', () => {
    const vector = [0.31, -0.12, 0.88, 0.04, -0.55];
    expect(cosineSimilarity(vector, quantiseVector(vector))).toBeGreaterThan(0.999);
  });

  it('opposite directions still score ~-1', () => {
    const vector = [0.31, -0.12, 0.88, 0.04, -0.55];
    const opposite = vector.map((v) => -v);
    expect(cosineSimilarity(vector, quantiseVector(opposite))).toBeLessThan(-0.999);
  });

  it('a zero vector on the cached side scores 0, the same "no signal" the float vector carried', () => {
    expect(cosineSimilarity([1, 2, 3], quantiseVector([0, 0, 0]))).toBe(0);
  });
});
