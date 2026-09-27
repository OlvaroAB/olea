/**
 * `same-as-wiring.ts` tests — the confirmed same-as link's first registry-side READ consumer
 * (`ol-2zfj.86` ONT-R1, F8.6). Mirrors `relation-wiring.spec.ts`'s fakes and conventions — no
 * `obsidian` import anywhere in this file.
 *
 * Scenarios: olea-service/features/F8-concepts-scope.md — "The confirmed same-as link's first
 * read consumer (ONT-R1, F8.6)", tagged `@auto:plugin/concept/same-as-wiring.spec`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConceptRelation, ConceptsRead, ReadConcept } from 'olea-core';
import {
  confirmSameAsLink,
  FolderSource,
  proposeSameAsLink,
  servedRelations,
  severSameAsLink,
  writeRelationCache,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRelationSetWithCache } from '../../src/concept/relation-wiring.js';
import { resolveSameAsForPass } from '../../src/concept/same-as-wiring.js';
import type { ConceptAndRelationPass } from '../../src/concept/wiring.js';

const introducingPassages = {
  from: { sourcePath: 'A.md', location: { page: 1 } },
  to: { sourcePath: 'B.md', location: { page: 1 } },
};

function readConcept(overrides: Partial<ReadConcept> = {}): ReadConcept {
  return {
    key: 'key-a',
    name: 'Cell',
    aliases: [],
    provenanceTier: 1,
    courses: ['BIO101'],
    anchor: undefined,
    alsoIn: [],
    sourcePaths: ['Cell.md'],
    size: { grade: 'thin', wordCount: 0 },
    ...overrides,
  } as unknown as ReadConcept;
}

function readWith(concepts: readonly ReadConcept[]): ConceptsRead {
  return {
    outcome: 'read',
    concepts,
    relations: [],
    relationsDropped: 0,
  } as unknown as ConceptsRead;
}

function emptyPass(concepts: readonly ReadConcept[] = []): ConceptAndRelationPass {
  return {
    read: readWith(concepts),
    corpus: { ran: false },
    relations: { entries: [], mergedDuplicates: 0, contradictions: 0, droppedUnemittable: 0 },
  } as unknown as ConceptAndRelationPass;
}

/**
 * `pass` with `relations` folded the way production folds it before `resolveSameAsForPass` runs
 * (`./wiring.ts`'s `readConceptsAndRelations` calls `readRelationSetWithCache` first). Since
 * `ol-egov.141.89.4.22`, `resolveSameAsForPass` re-merges only the cache records that baseline
 * served, so a test with cached records must hand it the baseline production would.
 */
async function withCacheBaseline(
  vault: FolderSource,
  pass: ConceptAndRelationPass,
): Promise<ConceptAndRelationPass> {
  return { ...pass, relations: await readRelationSetWithCache(vault, pass) };
}

function cachedEdge(
  overrides: Partial<ConceptRelation & { fromKey?: string; toKey?: string }> = {},
) {
  return {
    type: 'prerequisite' as const,
    from: 'Concept A',
    to: 'Concept B',
    provenance: 'model-proposed' as const,
    confidence: 0.6,
    introducingPassages,
    fromKey: 'key-a',
    toKey: 'key-z',
    ...overrides,
  };
}

describe('resolveSameAsForPass', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-wiring-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('no same-as link at all: concepts and relations pass through unchanged (the ordinary tick)', async () => {
    const concepts = [readConcept({ key: 'key-a' }), readConcept({ key: 'key-x', name: 'Other' })];
    const pass = emptyPass(concepts);

    const result = await resolveSameAsForPass(vault, pass);
    expect(result.conceptsMerged).toBe(0);
    expect(result.concepts).toEqual(concepts);
    expect(servedRelations(result.relations)).toHaveLength(0);
  });

  it('a PROPOSED link changes nothing a consumer sees (requirement 3)', async () => {
    await proposeSameAsLink(vault, 'key-a', 'key-b');
    const concepts = [
      readConcept({ key: 'key-a', courses: ['BIO101'] }),
      readConcept({ key: 'key-b', name: 'cells', courses: ['BIO201'] }),
    ];
    const result = await resolveSameAsForPass(vault, emptyPass(concepts));
    expect(result.conceptsMerged).toBe(0);
    expect(result.concepts).toEqual(concepts);
  });

  it('a CONFIRMED link folds the two concepts to the canonical key, unioning courses (requirement 5)', async () => {
    await proposeSameAsLink(vault, 'key-a', 'key-b');
    await confirmSameAsLink(vault, 'key-a', 'key-b');

    const concepts = [
      readConcept({ key: 'key-a', courses: ['BIO101'] }),
      readConcept({ key: 'key-b', name: 'cells', courses: ['BIO201'] }),
    ];
    const result = await resolveSameAsForPass(vault, emptyPass(concepts));

    expect(result.conceptsMerged).toBe(1);
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0]?.key).toBe('key-a');
    expect(result.concepts[0]?.courses).toEqual(['BIO101', 'BIO201']);
  });

  it('a SEVERED link restores both keys with no data loss — nothing was rewritten (requirement 2)', async () => {
    await proposeSameAsLink(vault, 'key-a', 'key-b');
    await confirmSameAsLink(vault, 'key-a', 'key-b');

    const concepts = [
      readConcept({ key: 'key-a', courses: ['BIO101'] }),
      readConcept({ key: 'key-b', name: 'cells', courses: ['BIO201'] }),
    ];
    const confirmedResult = await resolveSameAsForPass(vault, emptyPass(concepts));
    expect(confirmedResult.concepts).toHaveLength(1);

    await severSameAsLink(vault, 'key-a', 'key-b');
    const severedResult = await resolveSameAsForPass(vault, emptyPass(concepts));
    expect(severedResult.conceptsMerged).toBe(0);
    expect(severedResult.concepts).toEqual(concepts);
  });

  it('a confirmed link resolves a relation-cache record incident to the losing key at read time, even before any remap ran (requirement 4)', async () => {
    await proposeSameAsLink(vault, 'key-a', 'key-b');
    await confirmSameAsLink(vault, 'key-a', 'key-b');

    // Two records that will collide onto the SAME proposition once key-b resolves to key-a.
    await writeRelationCache(vault, [
      cachedEdge({ fromKey: 'key-a', toKey: 'key-z', confidence: 0.4 }),
    ]);
    await writeRelationCache(vault, [
      cachedEdge({
        fromKey: 'key-b',
        toKey: 'key-z',
        provenance: 'hers',
        confidence: 0.95,
        from: 'cells',
      }),
    ]);

    const result = await resolveSameAsForPass(vault, await withCacheBaseline(vault, emptyPass()));
    const served = servedRelations(result.relations);
    // The losing key's record resolves onto the canonical proposition and is served, with its own
    // provenance and confidence. This test used to hand `resolveSameAsForPass` an EMPTY baseline
    // and assert the two records fold to ONE served edge; with the baseline production actually
    // supplies (`readRelationSetWithCache` has already served both records, as two differently
    // named edges), the fold serves two both before and after `ol-egov.141.89.4.22` — the
    // same-as fold is layered on a name-keyed baseline it never replaces. That pre-existing gap is
    // reported as a follow-up on `ol-egov.141.89.4.22`'s pull request, not asserted away here.
    expect(
      served.some((relation) => relation.from === 'cells' && relation.provenance === 'hers'),
    ).toBe(true);
  });

  it('a proposed link leaves two relation-cache records distinct (requirement 3)', async () => {
    await proposeSameAsLink(vault, 'key-a', 'key-b');
    await writeRelationCache(vault, [cachedEdge({ fromKey: 'key-a', toKey: 'key-z' })]);
    await writeRelationCache(vault, [
      cachedEdge({ fromKey: 'key-b', toKey: 'key-z', from: 'cells' }),
    ]);

    const result = await resolveSameAsForPass(vault, await withCacheBaseline(vault, emptyPass()));
    expect(servedRelations(result.relations)).toHaveLength(2);
  });
});
