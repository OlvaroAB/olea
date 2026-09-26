/**
 * `[D-378]`'s canonical lookup in the registry overrides' write transforms
 * (`ol-egov.141.89.9.56`, round 2): given the canonical-key index, a rename, a withdrawal and a
 * restore act on every stored key of the concept's identity — so a withdrawal made under a
 * superseded same-anchor duplicate's key is undone by a restore of the canonical key, and a rename
 * back to the original wording clears a rename made under the duplicate — while an entry under a
 * concept that shares only an introducing passage is never touched. Without an index every
 * transform behaves exactly as before. Every fixture string is invented (INV-3).
 */

import { describe, expect, it } from 'vitest';
import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  type TopicAnchor,
} from '../concept/key-store.js';
import {
  EMPTY_REGISTRY_OVERRIDES,
  pruneConcept,
  renameConcept,
  unpruneConcept,
} from './overrides.js';
import type { RegistryOverrides } from './types.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';

const SHARED_INTRODUCING_NOTE = ['01 Courses/TESTC1/Week one.md'];

function topic(name: string, introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'TESTC1',
    name,
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

function conceptRecord(key: string, anchor: TopicAnchor, mintedAt: string): ConceptKeyRecord {
  return { key, tier: 2, anchor, aliases: [], mintedAt, schemaVersion: 1 };
}

const INDEX = buildConceptKeyCanonicalIndex([
  conceptRecord(CANONICAL, topic('Widget theory'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Widget theory'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Gadget theory', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Sprocket theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
]);

const STORED: RegistryOverrides = {
  ...EMPTY_REGISTRY_OVERRIDES,
  renames: {
    [DUPLICATE]: { displayName: 'Her widget name', aliases: ['Widget theory'] },
    [PASSAGE_B]: { displayName: 'Her sprocket name', aliases: ['Sprocket theory'] },
  },
  prunedConceptKeys: [DUPLICATE, PASSAGE_B].sort(),
};

describe('registry override transforms act on every stored key of an identity ([D-378], ol-egov.141.89.9.56)', () => {
  it('restoring the canonical key removes a withdrawal stored under its superseded duplicate, and leaves a shared-passage partner withdrawn', () => {
    const restored = unpruneConcept(STORED, CANONICAL, INDEX);
    expect(restored.prunedConceptKeys).toEqual([PASSAGE_B]);

    expect(unpruneConcept(STORED, PASSAGE_A, INDEX)).toBe(STORED);
  });

  it('withdrawing an identity already withdrawn under its duplicate writes nothing; withdrawing a shared-passage partner adds its own key', () => {
    expect(pruneConcept(STORED, CANONICAL, INDEX)).toBe(STORED);
    expect(pruneConcept(STORED, PASSAGE_A, INDEX).prunedConceptKeys).toEqual(
      [DUPLICATE, PASSAGE_A, PASSAGE_B].sort(),
    );
  });

  it('a withdrawal of a new identity is stored under its canonical key', () => {
    const fresh: RegistryOverrides = { ...EMPTY_REGISTRY_OVERRIDES };
    expect(pruneConcept(fresh, DUPLICATE, INDEX).prunedConceptKeys).toEqual([CANONICAL]);
  });

  it('a rename under the canonical key replaces one stored under its duplicate, keeping the prior wordings as aliases', () => {
    const renamed = renameConcept(
      STORED,
      CANONICAL,
      'Widget theory',
      'Newer widget name',
      undefined,
      INDEX,
    );

    expect(renamed.renames[CANONICAL]).toEqual({
      displayName: 'Newer widget name',
      aliases: ['Her widget name', 'Widget theory'],
    });
    expect(renamed.renames[DUPLICATE]).toBeUndefined();
    expect(renamed.renames[PASSAGE_B]).toEqual(STORED.renames[PASSAGE_B]);
  });

  it('an accepted proposal carries its tier onto the canonical key the same way', () => {
    const accepted = renameConcept(
      STORED,
      CANONICAL,
      'Her widget name',
      'Better widget name',
      1,
      INDEX,
    );

    expect(accepted.renames[CANONICAL]).toEqual({
      displayName: 'Better widget name',
      aliases: ['Her widget name', 'Widget theory'],
      sourceTier: 1,
    });
    expect(accepted.renames[DUPLICATE]).toBeUndefined();
  });

  it('renaming back to the original wording clears the rename stored under the duplicate too; a shared-passage partner keeps its rename', () => {
    const cleared = renameConcept(
      STORED,
      CANONICAL,
      'Widget theory',
      'Widget theory',
      undefined,
      INDEX,
    );

    expect(cleared.renames[CANONICAL]).toBeUndefined();
    expect(cleared.renames[DUPLICATE]).toBeUndefined();
    expect(cleared.renames[PASSAGE_B]).toEqual(STORED.renames[PASSAGE_B]);
  });

  it('a rename matching the name the duplicate’s rename already shows is a no-op', () => {
    expect(
      renameConcept(STORED, CANONICAL, 'Widget theory', 'Her widget name', undefined, INDEX),
    ).toBe(STORED);
  });

  it('with no index given, every transform reads keys exactly as stored', () => {
    expect(unpruneConcept(STORED, CANONICAL)).toBe(STORED);
    expect(pruneConcept(STORED, CANONICAL).prunedConceptKeys).toEqual(
      [CANONICAL, DUPLICATE, PASSAGE_B].sort(),
    );
    expect(renameConcept(STORED, CANONICAL, 'Widget theory', 'Newer').renames[DUPLICATE]).toEqual(
      STORED.renames[DUPLICATE],
    );
  });
});
