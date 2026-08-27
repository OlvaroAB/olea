/**
 * `features/F1-sources.md`'s "kinship is asked once" / "kinship is never
 * inferred from names" scenarios, and `features/F8-concepts-scope.md`'s F8.7
 * scenario "the kinship question at the same moment is about the course, not
 * about the recognition" — retargeted onto this file from its original
 * forward-declared id `plugin/scope/copy.spec` (a module this build never
 * used, same correction `RECOG-1` already made for the sibling recognition
 * scenario). See `ol-0r92.5`'s report.
 */
import { describe, expect, it } from 'vitest';
import {
  allKinshipStrings,
  KINSHIP_NO_LABEL,
  KINSHIP_YES_LABEL,
  kinshipQuestion,
} from '../../src/course-setup/kinship-copy.js';

const strings = allKinshipStrings();
const corpus = strings.join(' \n ').toLowerCase();

describe('the kinship control never reads as F8.7 recognition vocabulary', () => {
  it('names no concept-level word — this is a question about the two courses only', () => {
    const forbidden = ['concept', 'recognition', 'claim', 'merge'];
    for (const word of forbidden) {
      expect(corpus, `"${word}" belongs to F8.7's recognition surface, not kinship`).not.toContain(
        word,
      );
    }
  });
});

describe('kinshipQuestion', () => {
  it('asks about the given course, never computing or comparing a name itself', () => {
    expect(kinshipQuestion('EXAMPLE101')).toBe('Is this a continuation of EXAMPLE101?');
    expect(kinshipQuestion('OTHER202')).toBe('Is this a continuation of OTHER202?');
  });

  it('is phrased as a real question — unlike F8.7 recognition, kinship IS asked', () => {
    expect(kinshipQuestion('EXAMPLE101')).toMatch(/\?$/);
  });
});

describe('KINSHIP_YES_LABEL / KINSHIP_NO_LABEL', () => {
  it('answer the course question only, in plain terms', () => {
    expect(KINSHIP_YES_LABEL.toLowerCase()).toContain('continues');
    expect(KINSHIP_NO_LABEL.toLowerCase()).not.toContain('continues');
  });
});
