/**
 * Concept size (`[D-066]`, component register row 1.3, `./size.ts`).
 *
 * INV-3: every string here is coined. No course code, note title or wording
 * comes from any real vault (N-015: synthetic never tunes a threshold — these
 * fixtures fix the derivation's *behaviour*, they never fit its constant).
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  COARSE_EXTENT_FLOOR,
  conceptRecordExtent,
  conceptRecordSize,
  deriveConceptSize,
  readConceptExtent,
  readConceptSize,
} from './size.js';

function anchor(sourcePath: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

describe('deriveConceptSize', () => {
  it('is fine at the declared floor, on either measure', () => {
    expect(
      deriveConceptSize({ noteCount: COARSE_EXTENT_FLOOR, structureCorroborated: false }).band,
    ).toBe('fine');
    expect(
      deriveConceptSize({
        noteCount: COARSE_EXTENT_FLOOR,
        passageCount: COARSE_EXTENT_FLOOR,
        structureCorroborated: false,
      }).band,
    ).toBe('fine');
  });

  it('crosses to coarse only strictly above the floor', () => {
    expect(
      deriveConceptSize({ noteCount: COARSE_EXTENT_FLOOR + 1, structureCorroborated: false }).band,
    ).toBe('coarse');
  });

  it('prefers passageCount over noteCount when both are present', () => {
    // Cited from many notes (breadth of citation) but explained in exactly
    // one passage — not thereby broader. See the module doc's reasoning.
    const size = deriveConceptSize({
      noteCount: 10,
      passageCount: 1,
      structureCorroborated: false,
    });
    expect(size.band).toBe('fine');
  });

  it('falls back to noteCount when passageCount is not tracked (undefined, not 0)', () => {
    const size = deriveConceptSize({ noteCount: 5, structureCorroborated: false });
    expect(size.band).toBe('coarse');
  });

  it('a genuine zero passageCount is not the same as "not tracked" — it is honestly measured and defaults fine, C7.9', () => {
    const size = deriveConceptSize({ noteCount: 1, passageCount: 0, structureCorroborated: false });
    expect(size.band).toBe('fine');
    expect(size.extent.passageCount).toBe(0);
  });

  it('never lets structureCorroborated alone move the band — never required of her', () => {
    const withoutStructure = deriveConceptSize({
      noteCount: COARSE_EXTENT_FLOOR + 1,
      structureCorroborated: false,
    });
    const withStructure = deriveConceptSize({
      noteCount: COARSE_EXTENT_FLOOR + 1,
      structureCorroborated: true,
    });
    expect(withoutStructure.band).toBe(withStructure.band);
  });

  it('carries the extent it was computed from, so a consumer never has to trust the label alone', () => {
    const extent = { noteCount: 3, passageCount: 4, structureCorroborated: true };
    expect(deriveConceptSize(extent)).toEqual({ band: 'coarse', extent });
  });

  // [REL-1] — is-a / part-of's named reader: `containmentEvidence` folds an
  // edge into the size verdict, only ever pushing toward 'coarse' (C7.9's
  // merge-upward asymmetry).
  describe('containmentEvidence (is-a / part-of, C7.10)', () => {
    it('pushes a thin concept from fine to coarse', () => {
      const size = deriveConceptSize({
        noteCount: 1,
        structureCorroborated: false,
        containmentEvidence: true,
      });
      expect(size.band).toBe('coarse');
    });

    it('never downgrades a concept the measured extent already put at coarse', () => {
      const size = deriveConceptSize({
        noteCount: COARSE_EXTENT_FLOOR + 1,
        structureCorroborated: false,
        containmentEvidence: false,
      });
      expect(size.band).toBe('coarse');
    });

    it('absent containmentEvidence never moves the band — undefined is "no relation data", not "no evidence"', () => {
      const withField = deriveConceptSize({ noteCount: 1, structureCorroborated: false });
      expect(withField.extent.containmentEvidence).toBeUndefined();
      expect(withField.band).toBe('fine');
    });

    it('containmentEvidence: false is distinguishable from undefined but behaves identically on the band', () => {
      const size = deriveConceptSize({
        noteCount: 1,
        structureCorroborated: false,
        containmentEvidence: false,
      });
      expect(size.band).toBe('fine');
      expect(size.extent.containmentEvidence).toBe(false);
    });
  });
});

describe('conceptRecordExtent / conceptRecordSize — the extract.ts proxy (whole-note grounding)', () => {
  it('counts distinct notes named as the extent, with no passage grain', () => {
    const extent = conceptRecordExtent({
      sourcePaths: ['Notes/A.md', 'Notes/B.md'],
      boundNotePath: undefined,
    });
    expect(extent).toEqual({ noteCount: 2, structureCorroborated: false });
    expect(extent.passageCount).toBeUndefined();
  });

  it('a concept named by one note only is fine — nothing else in her material to make it broader', () => {
    expect(conceptRecordSize({ sourcePaths: ['Notes/A.md'], boundNotePath: undefined }).band).toBe(
      'fine',
    );
  });

  it('a concept spanning more notes than the declared floor is coarse', () => {
    const many = Array.from(
      { length: COARSE_EXTENT_FLOOR + 2 },
      (_, i) => `Notes/${i}.md` as VaultPath,
    );
    expect(conceptRecordSize({ sourcePaths: many, boundNotePath: undefined }).band).toBe('coarse');
  });

  it('structureCorroborated reflects a tier-1 binding, backing rather than requiring the grain', () => {
    const extent = conceptRecordExtent({
      sourcePaths: ['05 Zettelkasten/Something.md'],
      boundNotePath: '05 Zettelkasten/Something.md',
    });
    expect(extent.structureCorroborated).toBe(true);
  });
});

describe('readConceptExtent / readConceptSize — the read.ts proxy (passage grain)', () => {
  it('counts anchor plus alsoIn as the passage extent', () => {
    const extent = readConceptExtent({
      anchor: anchor('Lecture 1.md', 0, 20),
      alsoIn: [anchor('Lecture 1.md', 30, 40), anchor('Lecture 2.md')],
      sourcePaths: [],
    });
    expect(extent.passageCount).toBe(3);
    // Two distinct notes even though one contributed two passages.
    expect(extent.noteCount).toBe(2);
  });

  it('an un-anchored, convention-only concept has zero passage evidence, not undefined', () => {
    const extent = readConceptExtent({
      anchor: undefined,
      alsoIn: [],
      sourcePaths: ['Her Note.md'],
    });
    expect(extent.passageCount).toBe(0);
    expect(extent.noteCount).toBe(1);
    expect(
      readConceptSize({ anchor: undefined, alsoIn: [], sourcePaths: ['Her Note.md'] }).band,
    ).toBe('fine');
  });

  it('unions passage-anchor notes with topic-tagged sourcePaths rather than under-counting', () => {
    const extent = readConceptExtent({
      anchor: anchor('Lecture 1.md'),
      alsoIn: [],
      sourcePaths: ['Her Topic Note.md'],
    });
    expect(extent.noteCount).toBe(2);
  });

  it('a concept explained across many passages is coarse', () => {
    const alsoIn = Array.from({ length: COARSE_EXTENT_FLOOR + 5 }, (_, i) =>
      anchor(`Lecture ${i}.md`),
    );
    const size = readConceptSize({ anchor: anchor('Lecture 0.md'), alsoIn, sourcePaths: [] });
    expect(size.band).toBe('coarse');
  });

  it('a concept confined to one passage is fine even when her filing spans several notes', () => {
    // Extent's node-count for a passage-tracked source still prefers
    // passageCount (the module doc's reasoning) — breadth of citation is not
    // breadth of explanation.
    const size = readConceptSize({
      anchor: anchor('Lecture 1.md'),
      alsoIn: [],
      sourcePaths: ['Note A.md', 'Note B.md', 'Note C.md', 'Note D.md'],
    });
    expect(size.band).toBe('fine');
  });

  it('threads containmentEvidence through to the extent and the band', () => {
    const size = readConceptSize({
      anchor: anchor('Lecture 1.md'),
      alsoIn: [],
      sourcePaths: [],
      containmentEvidence: true,
    });
    expect(size.band).toBe('coarse');
    expect(size.extent.containmentEvidence).toBe(true);
  });
});
