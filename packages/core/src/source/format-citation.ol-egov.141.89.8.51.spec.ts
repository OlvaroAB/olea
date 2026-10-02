/**
 * The time or part locator (`ol-egov.141.89.8.51`; D-466). The formatter reads `transcriptPart`
 * (`RegistrySourceLocation`). Every string is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { formatSourceCitation } from '../registry/citation.js';
import type { RegistrySourceLocation } from '../registry/types.js';
import type { VaultPath } from '../vault/types.js';

const timed: RegistrySourceLocation = {
  sourcePath: 'Courses/SYNTH101/Lecture 4.vtt' as VaultPath,
  page: 2,
  transcriptPart: { part: 2, startSeconds: 12 * 60 + 4 },
};
const untimed: RegistrySourceLocation = {
  sourcePath: 'Courses/SYNTH101/Lecture 4.txt' as VaultPath,
  page: 3,
  transcriptPart: { part: 3 },
};

describe('the time or part locator (ol-egov.141.89.8.51)', () => {
  it('a timed part is cited by its time', () => {
    expect(formatSourceCitation(timed, { grainOnly: true })).toBe('at 12:04');
    expect(formatSourceCitation(timed)).toBe('Lecture 4 (at 12:04)');
  });

  it('an untimed part is cited by its part number, never a page', () => {
    expect(formatSourceCitation(untimed, { grainOnly: true })).toBe('part 3');
    expect(formatSourceCitation(untimed)).not.toMatch(/p\. ?\d/);
    expect(formatSourceCitation(timed)).not.toMatch(/p\. ?\d/);
  });
});
