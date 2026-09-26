/**
 * `[D-378]`'s canonical lookup, read side (`ol-egov.141.89.9.56`): every core reader keyed on
 * concept identity in the relation cache, the same-as link store and the same-as consumer resolves
 * a superseded same-anchor duplicate's key to its canonical key, rewrites no stored record, and
 * never joins two concepts that share only an introducing passage.
 *
 * The fixture store holds one same-anchor pair (`CANONICAL`, minted first, and `DUPLICATE`, minted
 * later) and one pair that shares an introducing note but not an anchor (`PASSAGE_A` and
 * `PASSAGE_B`). Every fixture string is invented (INV-3).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  type TopicAnchor,
} from './key-store.js';
import {
  type KeyedConceptRelation,
  propositionKey,
  type RelationCacheRecord,
  relationCacheRecordPath,
  relationCacheRecordsAsConceptRelations,
  writeRelationCache,
} from './relation-cache.js';
import {
  checkSameAsClosureCompatibility,
  listSameAsLinkRecords,
  proposeSameAsLink,
  type SameAsLinkRecord,
  type SameAsLinkStatus,
  sameAsLinkRecordPath,
} from './same-as.js';
import {
  buildSameAsKeyRedirect,
  resolveConceptsWithSameAsLinks,
  resolveRelationCacheRecordsWithSameAsLinks,
} from './same-as-consumer.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';
const OTHER = 'concept-key1:xxxx';
const THIRD = 'concept-key1:yyyy';

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

const CONCEPT_RECORDS: readonly ConceptKeyRecord[] = [
  conceptRecord(CANONICAL, topic('Widget theory'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Widget theory'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Gadget theory', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Gadget Theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
  conceptRecord(OTHER, topic('Flange theory'), '2026-09-04'),
  conceptRecord(THIRD, topic('Gasket theory'), '2026-09-04'),
];

function canonicalIndex(): ConceptKeyCanonicalIndex {
  return buildConceptKeyCanonicalIndex(CONCEPT_RECORDS);
}

const introducingPassages = {
  from: { sourcePath: 'Notes/from.md', location: { page: 1, section: 'H1' } },
  to: { sourcePath: 'Notes/to.md', location: { page: 1, section: 'H2' } },
};

function cacheRecord(
  fromKey: string,
  toKey: string,
  fromName: string,
  confidence: number,
): RelationCacheRecord {
  return {
    propositionKey: propositionKey('prerequisite', fromKey, toKey),
    type: 'prerequisite',
    fromKey,
    toKey,
    attestations: [
      {
        provenance: 'model-proposed',
        confidence,
        introducingPassages,
        fromName,
        toName: 'Flange theory',
        recordedAt: '2026-09-06T00:00:00.000Z',
      },
    ],
    mintedAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    schemaVersion: 1,
  };
}

function linkRecord(keyA: string, keyB: string, status: SameAsLinkStatus): SameAsLinkRecord {
  const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return {
    keyA: a,
    keyB: b,
    status,
    reason: 'normalisation-collision',
    proposedAt: '2026-09-06T00:00:00.000Z',
    schemaVersion: 1,
  };
}

describe('core readers keyed on concept identity resolve through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  let root: string;
  let vault: FolderSource;

  async function seed(path: string, value: unknown): Promise<void> {
    await vault.write(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function raw(path: string): Promise<string> {
    return readFile(join(root, ...path.split('/')), 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-canonical-key-readers-'));
    vault = new FolderSource(root);
    for (const record of CONCEPT_RECORDS) await seed(conceptKeyRecordPath(record.key), record);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('the fixture store: the same-anchor pair is one identity, the shared-passage pair is two', () => {
    const index = canonicalIndex();
    expect(index.canonicalOf(DUPLICATE)).toBe(CANONICAL);
    expect(index.canonicalOf(PASSAGE_A)).toBe(PASSAGE_A);
    expect(index.canonicalOf(PASSAGE_B)).toBe(PASSAGE_B);
  });

  describe('relation cache read-back (relationCacheRecordsAsConceptRelations)', () => {
    it('serves an edge cached under a superseded duplicate and one under its canonical key as one edge, and a shared-passage pair as two', async () => {
      const records = [
        cacheRecord(DUPLICATE, OTHER, 'Widget theory', 0.9),
        cacheRecord(CANONICAL, OTHER, 'Widget theory', 0.6),
        cacheRecord(PASSAGE_A, OTHER, 'Gadget theory', 0.5),
        cacheRecord(PASSAGE_B, OTHER, 'Gadget Theory', 0.4),
      ];
      for (const record of records) {
        await seed(relationCacheRecordPath(record.propositionKey), record);
      }
      const before = await Promise.all(
        records.map((record) => raw(relationCacheRecordPath(record.propositionKey))),
      );

      const relations = await relationCacheRecordsAsConceptRelations(vault);

      const widget = relations.filter((relation) => relation.from === 'Widget theory');
      expect(widget).toHaveLength(1);
      expect(widget[0]?.confidence).toBe(0.9);
      expect(relations.filter((relation) => relation.from === 'Gadget theory')).toHaveLength(1);
      expect(relations.filter((relation) => relation.from === 'Gadget Theory')).toHaveLength(1);
      expect(relations).toHaveLength(3);
      // Nothing already written is rewritten.
      expect(
        await Promise.all(
          records.map((record) => raw(relationCacheRecordPath(record.propositionKey))),
        ),
      ).toEqual(before);
    });

    it('a disposition recorded under a superseded key excludes the canonical edge; one recorded for a shared-passage partner does not', async () => {
      const records = [
        cacheRecord(CANONICAL, OTHER, 'Widget theory', 0.6),
        cacheRecord(PASSAGE_B, OTHER, 'Gadget Theory', 0.4),
      ];
      for (const record of records) {
        await seed(relationCacheRecordPath(record.propositionKey), record);
      }

      const relations = await relationCacheRecordsAsConceptRelations(vault, {
        excludePropositionKeys: new Set([
          propositionKey('prerequisite', DUPLICATE, OTHER),
          propositionKey('prerequisite', PASSAGE_A, OTHER),
        ]),
      });

      expect(relations.map((relation) => relation.from)).toEqual(['Gadget Theory']);
    });
  });

  describe('relation cache write (writeRelationCache)', () => {
    it('an edge arriving with a superseded key is written under the canonical key and the duplicate record is left byte-identical; a shared-passage key stays its own', async () => {
      const prior = cacheRecord(DUPLICATE, OTHER, 'Widget theory', 0.9);
      await seed(relationCacheRecordPath(prior.propositionKey), prior);
      const priorBytes = await raw(relationCacheRecordPath(prior.propositionKey));

      const edge = (fromKey: string, from: string, confidence: number): KeyedConceptRelation => ({
        type: 'prerequisite',
        from,
        to: 'Flange theory',
        provenance: 'model-proposed',
        confidence,
        introducingPassages,
        fromKey,
        toKey: OTHER,
      });
      await writeRelationCache(
        vault,
        [edge(DUPLICATE, 'Widget theory', 0.7), edge(PASSAGE_B, 'Gadget Theory', 0.4)],
        { now: () => '2026-09-07T00:00:00.000Z' },
      );

      const canonicalPath = relationCacheRecordPath(
        propositionKey('prerequisite', CANONICAL, OTHER),
      );
      const written = JSON.parse(await raw(canonicalPath)) as RelationCacheRecord;
      expect(written.fromKey).toBe(CANONICAL);
      // The proposition's history carries the duplicate's attestation too, best first.
      expect(written.attestations.map((attestation) => attestation.confidence)).toEqual([0.9, 0.7]);
      expect(await raw(relationCacheRecordPath(prior.propositionKey))).toBe(priorBytes);

      expect(
        await vault.exists(
          relationCacheRecordPath(propositionKey('prerequisite', PASSAGE_B, OTHER)),
        ),
      ).toBe(true);
      expect(
        await vault.exists(
          relationCacheRecordPath(propositionKey('prerequisite', PASSAGE_A, OTHER)),
        ),
      ).toBe(false);
    });
  });

  describe('same-as closure check (checkSameAsClosureCompatibility)', () => {
    it('a pair declined under a superseded key blocks the canonical key joining that class; a pair declined for a shared-passage partner does not', async () => {
      await seed(sameAsLinkRecordPath(OTHER, THIRD), linkRecord(OTHER, THIRD, 'confirmed'));
      await seed(sameAsLinkRecordPath(DUPLICATE, THIRD), linkRecord(DUPLICATE, THIRD, 'declined'));
      await seed(sameAsLinkRecordPath(PASSAGE_B, THIRD), linkRecord(PASSAGE_B, THIRD, 'declined'));

      const canonical = await checkSameAsClosureCompatibility(vault, CANONICAL, OTHER);
      expect(canonical.compatible).toBe(false);
      expect(canonical.conflict).toEqual({ keyA: CANONICAL, keyB: THIRD, status: 'declined' });
      expect(canonical.resultingClass).toEqual([CANONICAL, OTHER, THIRD]);

      const passage = await checkSameAsClosureCompatibility(vault, PASSAGE_A, OTHER);
      expect(passage.compatible).toBe(true);
    });
  });

  describe('same-as proposal lookup (proposeSameAsLink)', () => {
    it('proposing the canonical key finds the decision already recorded under its duplicate and writes nothing; a shared-passage partner gets its own proposal', async () => {
      await seed(sameAsLinkRecordPath(DUPLICATE, THIRD), linkRecord(DUPLICATE, THIRD, 'declined'));
      await seed(sameAsLinkRecordPath(PASSAGE_B, THIRD), linkRecord(PASSAGE_B, THIRD, 'declined'));
      const declinedBytes = await raw(sameAsLinkRecordPath(DUPLICATE, THIRD));

      const canonical = await proposeSameAsLink(vault, CANONICAL, THIRD);
      expect(canonical.status).toBe('declined');
      expect(await listSameAsLinkRecords(vault)).toHaveLength(2);
      expect(await raw(sameAsLinkRecordPath(DUPLICATE, THIRD))).toBe(declinedBytes);

      const passage = await proposeSameAsLink(vault, PASSAGE_A, THIRD);
      expect(passage.status).toBe('proposed');
      expect(await listSameAsLinkRecords(vault)).toHaveLength(3);
    });
  });

  describe('same-as consumer (pure)', () => {
    it('resolveConceptsWithSameAsLinks folds a same-anchor pair to its canonical key, and a confirmed link recorded under a superseded key still folds; a shared-passage pair stays two', () => {
      const concepts = [
        { key: CANONICAL, courses: ['TESTC1'] },
        { key: DUPLICATE, courses: ['TESTC2'] },
        { key: PASSAGE_A, courses: ['TESTC1'] },
        { key: PASSAGE_B, courses: ['TESTC1'] },
      ];
      const folded = resolveConceptsWithSameAsLinks(concepts, [], canonicalIndex());
      expect(folded.concepts.map((concept) => concept.key)).toEqual([
        CANONICAL,
        PASSAGE_A,
        PASSAGE_B,
      ]);
      expect(folded.concepts[0]?.courses).toEqual(['TESTC1', 'TESTC2']);
      expect(folded.merged).toBe(1);

      const linked = resolveConceptsWithSameAsLinks(
        [
          { key: CANONICAL, courses: ['TESTC1'] },
          { key: THIRD, courses: ['TESTC1'] },
        ],
        [linkRecord(DUPLICATE, THIRD, 'confirmed')],
        canonicalIndex(),
      );
      expect(linked.concepts.map((concept) => concept.key)).toEqual([CANONICAL]);
    });

    it('resolveRelationCacheRecordsWithSameAsLinks folds records cached under a same-anchor pair to one proposition; a shared-passage pair stays two', () => {
      const resolved = resolveRelationCacheRecordsWithSameAsLinks(
        [
          cacheRecord(DUPLICATE, OTHER, 'Widget theory', 0.9),
          cacheRecord(CANONICAL, OTHER, 'Widget theory', 0.6),
          cacheRecord(PASSAGE_A, OTHER, 'Gadget theory', 0.5),
          cacheRecord(PASSAGE_B, OTHER, 'Gadget Theory', 0.4),
        ],
        [],
        canonicalIndex(),
      );
      expect(resolved.map((record) => record.propositionKey)).toEqual([
        propositionKey('prerequisite', CANONICAL, OTHER),
        propositionKey('prerequisite', PASSAGE_A, OTHER),
        propositionKey('prerequisite', PASSAGE_B, OTHER),
      ]);
      expect(resolved[0]?.attestations.map((attestation) => attestation.confidence)).toEqual([
        0.9, 0.6,
      ]);
    });

    it('buildSameAsKeyRedirect sends a superseded duplicate to its canonical key and leaves a shared-passage partner alone', () => {
      const redirect = buildSameAsKeyRedirect([], canonicalIndex());
      expect(redirect.get(DUPLICATE)).toBe(CANONICAL);
      expect(redirect.has(PASSAGE_A)).toBe(false);
      expect(redirect.has(PASSAGE_B)).toBe(false);
    });

    it('with no index given, the consumer reads exactly as before', () => {
      const concepts = [
        { key: CANONICAL, courses: ['TESTC1'] },
        { key: DUPLICATE, courses: ['TESTC2'] },
      ];
      const result = resolveConceptsWithSameAsLinks(concepts, []);
      expect(result.concepts).toBe(concepts);
      expect(result.merged).toBe(0);
    });
  });
});
