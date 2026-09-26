/**
 * `[D-378]`'s canonical lookup in `resolveSameAsForPass` (`ol-egov.141.89.9.56`, round 2): the
 * pass's concepts, the relation-cache records and the edge dispositions are all read through the
 * canonical-key index, so a same-anchor pair folds to its canonical key and a disposition recorded
 * under a superseded duplicate's proposition applies to the canonical edge, while a pair that
 * shares only an introducing passage stays two concepts with their own dispositions.
 *
 * Every fixture string is invented (INV-3).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEdgeDisposition,
  type ConceptKeyRecord,
  type ConceptsRead,
  conceptKeyRecordPath,
  FolderSource,
  propositionKey,
  type ReadConcept,
  servedRelations,
  type TopicAnchor,
  writeRelationCache,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSameAsForPass } from '../../src/concept/same-as-wiring.js';
import type { ConceptAndRelationPass } from '../../src/concept/wiring.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';
const OTHER = 'concept-key1:xxxx';

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
  conceptRecord(PASSAGE_B, topic('Sprocket theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
  conceptRecord(OTHER, topic('Flange theory'), '2026-09-04'),
];

function readConcept(key: string, name: string, courses: readonly string[]): ReadConcept {
  return {
    key,
    name,
    aliases: [],
    provenanceTier: 2,
    courses,
    anchor: undefined,
    alsoIn: [],
    sourcePaths: ['01 Courses/TESTC1/Week one.md'],
    size: { grade: 'thin', wordCount: 0 },
  } as unknown as ReadConcept;
}

function passWith(concepts: readonly ReadConcept[]): ConceptAndRelationPass {
  return {
    read: {
      outcome: 'read',
      concepts,
      relations: [],
      relationsDropped: 0,
    } as unknown as ConceptsRead,
    corpus: { ran: false },
    relations: { entries: [], mergedDuplicates: 0, contradictions: 0, droppedUnemittable: 0 },
  } as unknown as ConceptAndRelationPass;
}

describe('resolveSameAsForPass reads through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-wiring-canonical-'));
    vault = new FolderSource(root);
    for (const record of CONCEPT_RECORDS) {
      await vault.write(conceptKeyRecordPath(record.key), `${JSON.stringify(record, null, 2)}\n`);
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('folds a same-anchor pair of concepts to the canonical key; a shared-passage pair stays two', async () => {
    const result = await resolveSameAsForPass(
      vault,
      passWith([
        readConcept(CANONICAL, 'Widget theory', ['TESTC1']),
        readConcept(DUPLICATE, 'Widget theory', ['TESTC2']),
        readConcept(PASSAGE_A, 'Gadget theory', ['TESTC1']),
        readConcept(PASSAGE_B, 'Sprocket theory', ['TESTC1']),
      ]),
    );

    expect(result.concepts.map((concept) => concept.key)).toEqual([
      CANONICAL,
      PASSAGE_A,
      PASSAGE_B,
    ]);
    expect(result.concepts[0]?.courses).toEqual(['TESTC1', 'TESTC2']);
    expect(result.conceptsMerged).toBe(1);
  });

  it('a decline recorded under the duplicate’s proposition withholds the canonical edge; one recorded for a shared-passage partner does not', async () => {
    const edge = (fromKey: string, from: string) => ({
      type: 'prerequisite' as const,
      from,
      to: 'Flange theory',
      provenance: 'model-proposed' as const,
      confidence: 0.6,
      introducingPassages: {
        from: { sourcePath: 'Notes/from.md', location: { page: 1 } },
        to: { sourcePath: 'Notes/to.md', location: { page: 1 } },
      },
      fromKey,
      toKey: OTHER,
    });
    await writeRelationCache(vault, [
      edge(CANONICAL, 'Widget theory'),
      edge(PASSAGE_B, 'Sprocket theory'),
    ]);
    await appendEdgeDisposition(
      vault,
      propositionKey('prerequisite', DUPLICATE, OTHER),
      'declined',
    );
    await appendEdgeDisposition(
      vault,
      propositionKey('prerequisite', PASSAGE_A, OTHER),
      'declined',
    );

    const result = await resolveSameAsForPass(vault, passWith([]));

    expect(servedRelations(result.relations).map((relation) => relation.from)).toEqual([
      'Sprocket theory',
    ]);
  });
});
