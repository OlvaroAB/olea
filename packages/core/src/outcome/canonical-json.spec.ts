import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('gives one text for two equal values built in different key orders', () => {
    const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } };
    const b = { a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('keeps array order, since order in an array is meaning', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined members the way JSON.stringify does, so an absent field and an undefined one agree', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('tells a null member from an absent one', () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it('refuses a cycle and a bigint rather than hashing something else', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalJson({ n: 1n })).toThrow(/bigint/);
  });

  it('is not fooled by a shared (non-cyclic) reference', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});
