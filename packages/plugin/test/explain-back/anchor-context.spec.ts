/**
 * `ol-egov.141.89.6.71` (`[D-453]`, `[D-452]`): the ranked own-note judge context. Synthetic text
 * only. No `obsidian` import (INV-1). The proof against the harness variant is
 * `olea-service`'s `client-port-check.mjs`; this file is the unit contract and the held-switch pin.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type AnchorChunk,
  composeAnchoredSourceBlocks,
} from '../../src/explain-back/anchor-context.js';
import {
  retrieveAnchoredExplainBackSourceBlocks,
  retrieveExplainBackSourceBlocks,
} from '../../src/explain-back/request.js';

const chunk = (path: string, blockIndex: number, text = `${path} passage ${blockIndex}`) =>
  ({ path, blockIndex, text }) satisfies AnchorChunk;
const ids = (blocks: readonly { path: string; blockIndex: number }[]) =>
  blocks.map((b) => `${b.path}:${b.blockIndex}`);

describe('composeAnchoredSourceBlocks', () => {
  const own = [chunk('own.md', 0), chunk('own.md', 1), chunk('own.md', 2), chunk('own.md', 3)];

  it('own-note passages come first: ranked ones in ranking order, the rest in document order', () => {
    const ranked = [
      chunk('other.md', 0),
      own[2] as AnchorChunk,
      chunk('other.md', 1),
      own[0] as AnchorChunk,
    ];
    const blocks = composeAnchoredSourceBlocks({ ownNoteChunks: own, ranked });
    expect(ids(blocks).slice(0, 4)).toEqual(['own.md:2', 'own.md:0', 'own.md:1', 'own.md:3']);
  });

  it('retrieval fills the remaining slots to eight, in ranking order, skipping own passages', () => {
    const ranked = [
      chunk('other.md', 0),
      own[1] as AnchorChunk,
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => chunk('other.md', i)),
    ];
    const blocks = composeAnchoredSourceBlocks({ ownNoteChunks: own, ranked });
    expect(blocks).toHaveLength(8);
    expect(ids(blocks)).toEqual([
      'own.md:1',
      'own.md:0',
      'own.md:2',
      'own.md:3',
      'other.md:0',
      'other.md:1',
      'other.md:2',
      'other.md:3',
    ]);
  });

  it('cuts a long own note at eight, and fills nothing', () => {
    const long = Array.from({ length: 11 }, (_, i) => chunk('own.md', i));
    const blocks = composeAnchoredSourceBlocks({
      ownNoteChunks: long,
      ranked: [chunk('other.md', 0)],
    });
    expect(ids(blocks)).toEqual(Array.from({ length: 8 }, (_, i) => `own.md:${i}`));
  });

  it('does not repeat a ranked passage whose letters and digits equal an own-note passage', () => {
    const blocks = composeAnchoredSourceBlocks({
      ownNoteChunks: [chunk('own.md', 0, 'Alpha beta, gamma.')],
      ranked: [chunk('copy.md', 4, '- alpha BETA gamma'), chunk('other.md', 1)],
    });
    expect(ids(blocks)).toEqual(['own.md:0', 'other.md:1']);
  });

  it('with no own note it is the ranking first eight untouched, ids minted by position', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => chunk('r.md', i));
    const blocks = composeAnchoredSourceBlocks({ ownNoteChunks: [], ranked });
    expect(ids(blocks)).toEqual(ids(ranked.slice(0, 8)));
    expect(blocks.map((b) => b.block.blockId)).toEqual(
      ranked.slice(0, 8).map((c, i) => `${c.path}#${c.blockIndex}#${i}`),
    );
  });
});

class RejectingEmbeddingProvider implements EmbeddingProvider {
  embed(): Promise<EmbedResult> {
    return Promise.reject(new Error('no embedding provider wired'));
  }
}
class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}
function index(files: Record<string, readonly string[]>): PersistedKeywordIndex {
  return {
    version: 1,
    documents: Object.entries(files).map(([path, blocks]) => ({
      path,
      courses: [],
      contentHash: 'unused',
      blocks: blocks.map((text, blockIndex) => ({ blockIndex, kind: 'paragraph' as const, text })),
    })),
  };
}
async function deps(keywordIndex: PersistedKeywordIndex) {
  const embeddingProvider = new RejectingEmbeddingProvider();
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: embeddingProvider,
    model: 'fake-model-v1',
  });
  return { retrieve: { keywordIndex, embeddingCache, embeddingProvider } };
}

describe('retrieveAnchoredExplainBackSourceBlocks', () => {
  const corpus = index({
    'own.md': ['zephyr intro line', 'unrelated own filler', 'zephyr detail line'],
    'other.md': ['zephyr elsewhere line', 'another zephyr line'],
  });

  it('leads with the own note and fills from the same retrieval', async () => {
    const blocks = await retrieveAnchoredExplainBackSourceBlocks(
      await deps(corpus),
      'zephyr',
      'own.md',
    );
    expect(ids(blocks).slice(0, 3).sort()).toEqual(['own.md:0', 'own.md:1', 'own.md:2']);
    expect(ids(blocks).slice(3).sort()).toEqual(['other.md:0', 'other.md:1']);
    expect(blocks.map((b) => b.block.blockId)).toEqual(
      blocks.map((b, i) => `${b.path}#${b.blockIndex}#${i}`),
    );
  });

  it('with no known own note it is exactly the shipped retrieval', async () => {
    const d = await deps(corpus);
    expect(await retrieveAnchoredExplainBackSourceBlocks(d, 'zephyr', undefined)).toEqual(
      await retrieveExplainBackSourceBlocks(d, 'zephyr'),
    );
  });

  it('an empty index is [], never a throw', async () => {
    expect(
      await retrieveAnchoredExplainBackSourceBlocks(
        await deps(index({ 'own.md': [] })),
        'zephyr',
        'own.md',
      ),
    ).toEqual([]);
  });
});

describe('not the shipped path yet', () => {
  it('no production source reaches the anchored composition', () => {
    const src = join(__dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(src);
    const callers = files
      .filter((f) =>
        /composeAnchoredSourceBlocks|retrieveAnchoredExplainBackSourceBlocks/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(src.length + 1))
      .sort();
    expect(callers).toEqual(['explain-back/anchor-context.ts', 'explain-back/request.ts']);
  });
});
