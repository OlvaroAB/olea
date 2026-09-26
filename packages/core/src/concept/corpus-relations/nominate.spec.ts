/**
 * Candidate nomination (`[EXT-5]`, `ol-2zfj.7`) — cheap signals nominate;
 * the material decides. This suite proves the SELECTION discipline only —
 * no relation, type or confidence is ever produced here.
 *
 * INV-3: every string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { VaultPath } from '../../vault/types.js';
import { nominateCorpusRelationCandidates } from './nominate.js';
import type { CorpusConcept, NominationSignal } from './types.js';

function anchor(sourcePath: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function concept(
  name: string,
  sourcePath: VaultPath = 'Lecture 1.md',
  courses?: readonly string[],
  key?: string,
): CorpusConcept {
  return {
    name,
    aliases: [],
    anchor: anchor(sourcePath),
    ...(courses !== undefined ? { courses } : {}),
    ...(key !== undefined ? { key } : {}),
  };
}

function signal(kind: NominationSignal['kind'], a: string, b: string): NominationSignal {
  return { kind, a, b };
}

describe('nominateCorpusRelationCandidates', () => {
  it('nominates a pair backed by a co-occurrence signal', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis'), concept('Membrane transport')],
      [signal('assessment-cooccurrence', 'Osmosis', 'Membrane transport')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.a.name).toBe('Osmosis');
    expect(result[0]?.b.name).toBe('Membrane transport');
    expect(result[0]?.signals).toEqual(['assessment-cooccurrence']);
  });

  it('folds multiple signal kinds nominating the same pair into one candidate', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis'), concept('Membrane transport')],
      [
        signal('assessment-cooccurrence', 'Osmosis', 'Membrane transport'),
        signal('embedding-proximity', 'Osmosis', 'Membrane transport'),
        signal('her-link', 'Membrane transport', 'Osmosis'), // reversed order, same pair
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.signals).toEqual([
      'assessment-cooccurrence',
      'embedding-proximity',
      'her-link',
    ]);
  });

  it('SCOPE: drops a pair where neither endpoint is new (never full recomputation)', () => {
    const result = nominateCorpusRelationCandidates(
      [], // nothing new this run
      [concept('Osmosis'), concept('Membrane transport')],
      [signal('embedding-proximity', 'Osmosis', 'Membrane transport')],
    );
    expect(result).toHaveLength(0);
  });

  it('SCOPE: keeps a pair where only one endpoint is new — new-concept x all-concepts', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Newly seen concept')],
      [concept('Osmosis'), concept('Newly seen concept')],
      [signal('embedding-proximity', 'Osmosis', 'Newly seen concept')],
    );
    expect(result).toHaveLength(1);
  });

  it('drops a signal naming a concept this run does not recognise at all', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis')],
      [signal('embedding-proximity', 'Osmosis', 'Never seen anywhere')],
    );
    expect(result).toHaveLength(0);
  });

  it('drops a self-pair', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis')],
      [signal('embedding-proximity', 'Osmosis', 'Osmosis')],
    );
    expect(result).toHaveLength(0);
  });

  it('never assigns a type, direction or confidence — nomination only', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis'), concept('Membrane transport')],
      [signal('her-link', 'Osmosis', 'Membrane transport')],
    );
    expect(result[0]).not.toHaveProperty('type');
    expect(result[0]).not.toHaveProperty('confidence');
  });

  it('an empty signal list nominates nothing', () => {
    const result = nominateCorpusRelationCandidates(
      [concept('Osmosis')],
      [concept('Osmosis'), concept('Membrane transport')],
      [],
    );
    expect(result).toEqual([]);
  });

  describe("COURSE SCOPE (C7.10 / [D-082], ol-x3qg): the corpus stage runs over a course's concept set", () => {
    it('nominates a pair that shares a course', () => {
      const result = nominateCorpusRelationCandidates(
        [concept('Osmosis', 'Lecture 1.md', ['BIO101'])],
        [
          concept('Osmosis', 'Lecture 1.md', ['BIO101']),
          concept('Membrane transport', 'Lecture 2.md', ['BIO101']),
        ],
        [signal('embedding-proximity', 'Osmosis', 'Membrane transport')],
      );
      expect(result).toHaveLength(1);
    });

    it('drops a pair whose two concepts share no course', () => {
      const result = nominateCorpusRelationCandidates(
        [concept('Osmosis', 'Lecture 1.md', ['BIO101'])],
        [
          concept('Osmosis', 'Lecture 1.md', ['BIO101']),
          concept('Colonialism', 'Lecture 2.md', ['HIST201']),
        ],
        [signal('embedding-proximity', 'Osmosis', 'Colonialism')],
      );
      expect(result).toHaveLength(0);
    });

    it("drops a pair where one endpoint belongs to no course at all (`courses: []`) — C7.10 read literally, in no course's set", () => {
      const result = nominateCorpusRelationCandidates(
        [concept('Osmosis', 'Lecture 1.md', ['BIO101'])],
        [concept('Osmosis', 'Lecture 1.md', ['BIO101']), concept('Orphan note', 'Zettel.md', [])],
        [signal('embedding-proximity', 'Osmosis', 'Orphan note')],
      );
      expect(result).toHaveLength(0);
    });

    it('nominates a pair via a concept that bridges two courses (her real cross-course linking behaviour)', () => {
      const bridge = concept('Research methods', 'Zettel.md', ['BIO101', 'PSYCH200']);
      const result = nominateCorpusRelationCandidates(
        [bridge],
        [
          bridge,
          concept('Osmosis', 'Lecture 1.md', ['BIO101']),
          concept('Confounding variable', 'Lecture 3.md', ['PSYCH200']),
        ],
        [
          signal('embedding-proximity', 'Research methods', 'Osmosis'),
          signal('embedding-proximity', 'Research methods', 'Confounding variable'),
        ],
      );
      expect(result).toHaveLength(2);
    });

    it('stays permissive when a caller has not threaded course data through yet (`courses: undefined` on either side)', () => {
      const result = nominateCorpusRelationCandidates(
        [concept('Osmosis')], // no `courses` argument — undefined, the pre-migration caller shape
        [concept('Osmosis'), concept('Membrane transport')],
        [signal('embedding-proximity', 'Osmosis', 'Membrane transport')],
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('KEY IDENTITY (ol-egov.141.89.4.16, [ONT-R8]): two distinct concepts sharing a name never hide each other', () => {
    // Same shape as dev scenario REL-a09fac8ff10e5736 (coined names): two
    // distinct, differently-keyed concepts named "Loam" in two courses that
    // do not overlap, each paired by a signal with a partner unique to its
    // own course. Before the fix, `byName`'s index kept only the
    // first-seen "Loam" — every signal mentioning "Loam" resolved to that
    // ONE concept, so the second course's true pair was silently dropped
    // (its resolved endpoint failed the course-overlap check instead of
    // ever reaching the right concept) and could nominate nothing.
    const loamCeramics = concept('Loam', 'Ceramics 1.md', ['course-ceramics'], 'ck-loam-ceramics');
    const loamGarden = concept('Loam', 'Garden 1.md', ['course-gardening'], 'ck-loam-garden');
    const grog = concept('Grog', 'Ceramics 1.md', ['course-ceramics'], 'ck-grog');
    const compost = concept('Compost', 'Garden 1.md', ['course-gardening'], 'ck-compost');

    it('nominates BOTH same-named concepts against their own course partner', () => {
      const result = nominateCorpusRelationCandidates(
        [loamCeramics, loamGarden, grog, compost],
        [loamCeramics, loamGarden, grog, compost],
        [
          signal('assessment-cooccurrence', 'Loam', 'Grog'),
          signal('assessment-cooccurrence', 'Loam', 'Compost'),
        ],
      );
      expect(result).toHaveLength(2);
      const byPartnerKey = new Map(
        result.map((c) => [c.a.key === 'ck-grog' || c.b.key === 'ck-grog' ? 'Grog' : 'Compost', c]),
      );
      const ceramicsPair = byPartnerKey.get('Grog');
      expect(ceramicsPair?.a.key ?? ceramicsPair?.b.key).toBe('ck-loam-ceramics');
      const gardenPair = byPartnerKey.get('Compost');
      expect(gardenPair?.a.key ?? gardenPair?.b.key).toBe('ck-loam-garden');
    });

    it('does not treat two distinct, differently-keyed same-named concepts as a self-pair', () => {
      // Neither concept is new-relative-to-neither here; both are new, and a
      // signal literally names "Loam" on both sides (after an upstream key
      // round-trip resolved to the same wording twice, e.g. embedding
      // proximity naming two distinct passages that both introduce "Loam").
      // Name equality alone must never be read as identity once a key is
      // present, or the two real concepts collapse into a no-op.
      const result = nominateCorpusRelationCandidates(
        [loamCeramics, loamGarden],
        [loamCeramics, loamGarden],
        [signal('embedding-proximity', 'Loam', 'Loam')],
      );
      // The two "Loam"s share no course, so this is correctly dropped by
      // the course check, not by a name-based self-pair check — proven by
      // the companion case below, which shares a course and DOES nominate.
      expect(result).toHaveLength(0);
    });

    it('nominates two differently-keyed same-named concepts that DO share a course', () => {
      const loamCeramicsToo = concept(
        'Loam',
        'Ceramics 2.md',
        ['course-ceramics'],
        'ck-loam-ceramics-2',
      );
      const result = nominateCorpusRelationCandidates(
        [loamCeramics, loamCeramicsToo],
        [loamCeramics, loamCeramicsToo],
        [signal('embedding-proximity', 'Loam', 'Loam')],
      );
      expect(result).toHaveLength(1);
      expect([result[0]?.a.key, result[0]?.b.key].sort()).toEqual(
        ['ck-loam-ceramics', 'ck-loam-ceramics-2'].sort(),
      );
    });

    it('falls back to name identity for keyless concepts — a same-name self-pair with no key is still dropped', () => {
      const keylessA = concept('Loam', 'Ceramics 1.md', ['course-ceramics']);
      const keylessB = concept('Loam', 'Ceramics 2.md', ['course-ceramics']);
      const result = nominateCorpusRelationCandidates(
        [keylessA, keylessB],
        [keylessA, keylessB],
        [signal('embedding-proximity', 'Loam', 'Loam')],
      );
      // No key on either side: this stage cannot tell the two apart, and the
      // pre-`[ONT-R8]` degraded behaviour — collapse to one node — is the
      // correct posture for a keyless concept, per this bead's brief ("name
      // as the fallback only for keyless concepts").
      expect(result).toHaveLength(0);
    });
  });
});
