/**
 * `relation-wiring.ts` tests — the persisted relation cache's plugin-side composition
 * (`[D-119]`, ol-2zfj.14). Mirrors `corpusRelationWiring.spec.ts`'s fakes and conventions — no
 * `obsidian` import anywhere in this file.
 *
 * Scenarios: olea-service/features/F8-concepts-scope.md — "Persisted relation cache
 * ([D-119], ONT-R1, ONT-R8)", tagged `@auto:plugin/concept/relation-wiring.spec`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConceptRelation, ConceptsRead } from 'olea-core';
import { appendEdgeDisposition, FolderSource, propositionKey, servedRelations } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  excludedEdgeDispositionSummary,
  persistRelationCacheFromPass,
  readRelationSetWithCache,
  relationCacheRecordsExcludingDisposed,
  syncRelationCacheAndDerive,
} from '../../src/concept/relation-wiring.js';
import type { ConceptAndRelationPass } from '../../src/concept/wiring.js';

const introducingPassages = {
  from: { sourcePath: 'A.md', location: { page: 1 } },
  to: { sourcePath: 'B.md', location: { page: 1 } },
};

function corpusEdge(
  overrides: Partial<ConceptRelation & { fromKey?: string; toKey?: string }> = {},
) {
  return {
    type: 'prerequisite' as const,
    from: 'Concept A',
    to: 'Concept B',
    provenance: 'hers' as const,
    confidence: 0.8,
    introducingPassages,
    fromKey: 'key-a',
    toKey: 'key-b',
    ...overrides,
  };
}

function emptyRead(): ConceptsRead {
  return {
    outcome: 'read',
    concepts: [],
    relations: [],
    relationsDropped: 0,
  } as unknown as ConceptsRead;
}

function passWith(
  corpusRelations: readonly (ConceptRelation & { fromKey?: string; toKey?: string })[] | undefined,
): ConceptAndRelationPass {
  return {
    read: emptyRead(),
    corpus:
      corpusRelations === undefined ? { ran: false } : { ran: true, relations: corpusRelations },
    relations: { entries: [], mergedDuplicates: 0, contradictions: 0, droppedUnemittable: 0 },
  } as unknown as ConceptAndRelationPass;
}

describe('persistRelationCacheFromPass', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-relation-wiring-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes nothing and returns null on an un-triggered tick (corpus.relations undefined)', async () => {
    const result = await persistRelationCacheFromPass(vault, passWith(undefined));
    expect(result).toBeNull();
  });

  it("persists the corpus stage's key-bearing edges", async () => {
    const result = await persistRelationCacheFromPass(vault, passWith([corpusEdge()]));
    expect(result).toEqual({ written: 1, droppedNoKey: 0, droppedUnemittable: 0 });
  });
});

describe('readRelationSetWithCache', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-relation-wiring-read-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('serves a persisted edge from a PRIOR pass even when the current tick did not trigger the corpus batch', async () => {
    await persistRelationCacheFromPass(vault, passWith([corpusEdge()]));

    const laterPass = passWith(undefined); // this tick's own trigger did not fire
    const relations = await readRelationSetWithCache(vault, laterPass);

    const served = servedRelations(relations);
    expect(served).toHaveLength(1);
    expect(served[0]?.from).toBe('Concept A');
  });

  it('a declined disposition excludes the edge from the served fold at read time (INV-6)', async () => {
    await persistRelationCacheFromPass(vault, passWith([corpusEdge()]));
    const key = propositionKey('prerequisite', 'key-a', 'key-b');
    await appendEdgeDisposition(vault, key, 'declined');

    const relations = await readRelationSetWithCache(vault, passWith(undefined));
    expect(servedRelations(relations)).toHaveLength(0);
  });

  it("syncRelationCacheAndDerive reflects an edge minted THIS tick in the SAME tick's result", async () => {
    const { write, relations } = await syncRelationCacheAndDerive(vault, passWith([corpusEdge()]));
    expect(write).toEqual({ written: 1, droppedNoKey: 0, droppedUnemittable: 0 });
    expect(servedRelations(relations)).toHaveLength(1);
  });
});

describe('excludedEdgeDispositionSummary / relationCacheRecordsExcludingDisposed', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-relation-wiring-summary-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('counts only currently-excluded propositions, and the record listing agrees', async () => {
    await persistRelationCacheFromPass(vault, passWith([corpusEdge()]));
    const key = propositionKey('prerequisite', 'key-a', 'key-b');
    await appendEdgeDisposition(vault, key, 'expired');

    const summary = await excludedEdgeDispositionSummary(vault);
    expect(summary.excludedCount).toBe(1);

    const remaining = await relationCacheRecordsExcludingDisposed(vault);
    expect(remaining).toHaveLength(0);
  });
});
