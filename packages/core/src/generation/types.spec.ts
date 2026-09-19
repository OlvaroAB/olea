import { describe, expect, it } from 'vitest';
import { isGenerationJobPayload } from './types.js';

describe('isGenerationJobPayload', () => {
  it('accepts a well-formed generation payload', () => {
    expect(
      isGenerationJobPayload({
        kind: 'generation',
        courseCode: 'A',
        conceptKey: 'ck-1',
        conceptName: 'Osmosis',
        instrumentKind: 'mcq',
        trigger: 'arrival',
      }),
    ).toBe(true);
  });

  it('rejects a non-generation payload kind', () => {
    expect(isGenerationJobPayload({ kind: 'source', sourcePath: 'x.pdf', format: 'pdf' })).toBe(
      false,
    );
  });

  it('rejects null, undefined and non-objects', () => {
    expect(isGenerationJobPayload(null)).toBe(false);
    expect(isGenerationJobPayload(undefined)).toBe(false);
    expect(isGenerationJobPayload('generation')).toBe(false);
  });

  it('rejects a generation payload missing a required field', () => {
    expect(
      isGenerationJobPayload({
        kind: 'generation',
        courseCode: 'A',
        conceptKey: 'ck-1',
        // conceptName missing
        instrumentKind: 'mcq',
        trigger: 'arrival',
      }),
    ).toBe(false);
  });

  it('rejects empty-string identity fields', () => {
    expect(
      isGenerationJobPayload({
        kind: 'generation',
        courseCode: '',
        conceptKey: 'ck-1',
        conceptName: 'Osmosis',
        instrumentKind: 'mcq',
        trigger: 'arrival',
      }),
    ).toBe(false);
  });
});
