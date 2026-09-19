import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIMARY_KIND_FLOOR, primaryKindFor } from './primary-kind.js';

describe('primaryKindFor — D-238/F3.3 primary-kind decision', () => {
  it('prefers the F4.8 format match when known', () => {
    expect(primaryKindFor({ formatMatch: 'qa', recordedPreference: ['mcq', 'cloze'] })).toBe('qa');
  });

  it('falls to F2.14 recorded preference, most-preferred first, when no format is known', () => {
    expect(primaryKindFor({ formatMatch: null, recordedPreference: ['cloze', 'mcq'] })).toBe(
      'cloze',
    );
  });

  it('falls to the declared floor when neither a format nor a preference is known', () => {
    expect(primaryKindFor({ formatMatch: null, recordedPreference: [] })).toBe(
      DEFAULT_PRIMARY_KIND_FLOOR,
    );
  });

  it("never returns nothing — D-238 narrows [D-063]'s unbounded rule, never skips a concept", () => {
    const result = primaryKindFor({ formatMatch: null, recordedPreference: [] });
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });
});
