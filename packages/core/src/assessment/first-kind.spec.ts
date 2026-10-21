import { describe, expect, it } from 'vitest';
import { FIRST_KIND_BY_FORMAT_CLASS, firstKindForFormatClass } from './first-kind.js';

describe('first-kind: the one format-class-to-kind mapping (F4.8, [D-550])', () => {
  it('recall-style asks for multiple choice; written and practical for the card', () => {
    expect(firstKindForFormatClass('recall-style')).toBe('mcq');
    expect(firstKindForFormatClass('written')).toBe('qa');
    expect(firstKindForFormatClass('practical')).toBe('qa');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FIRST_KIND_BY_FORMAT_CLASS)).toBe(true);
  });
});
