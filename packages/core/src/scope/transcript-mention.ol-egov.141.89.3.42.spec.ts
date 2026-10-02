import { describe, expect, it } from 'vitest';
import { declaredScopeNamesFrom } from '../source/transcript-scope.js';
import { isVolunteer } from './coverage.js';

describe('a mention is not scope (ol-egov.141.89.3.42)', () => {
  it('a concept only a transcript mentions is volunteer, never assessed scope', () => {
    const declared = declaredScopeNamesFrom([
      { conceptName: 'Concept A', origin: 'examiner' },
      { conceptName: 'Concept B', origin: 'transcript' },
    ]);
    expect(declared.has('Concept B')).toBe(false);
    expect(isVolunteer('Concept B', declared)).toBe(true);
    expect(isVolunteer('Concept A', declared)).toBe(false);
  });
});
