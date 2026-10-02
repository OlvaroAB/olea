/**
 * Relation nomination counts one teaching event once (`ol-egov.141.89.8.60`, D-465): a transcript
 * restating its own lecture's slides is not independent `embedding-proximity`. Synthetic data only.
 */
import {
  type CorpusConcept,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  hashText,
  type ListOptions,
  type PersistedEmbeddingCache,
  type RetrievalChunk,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { gatherCorpusRelationVaultContext } from '../../src/concept/corpusRelationSignals.js';

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}
  list(_o: ListOptions = {}): Promise<readonly VaultPath[]> {
    return Promise.resolve(Object.keys(this.files).sort());
  }
  read(path: VaultPath): Promise<string> {
    const c = this.files[path];
    return c === undefined ? Promise.reject(new Error(`no ${path}`)) : Promise.resolve(c);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_h: (e: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

class MemoryStore implements EmbeddingCacheStore {
  private data: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.data;
  }
  async save(d: PersistedEmbeddingCache): Promise<void> {
    this.data = d;
  }
}

const TEXT_SLIDE = 'Osmosis moves water across a membrane.';
const TEXT_TALK = 'So, osmosis, again: water crosses the membrane.';
const TEXT_OTHER = 'Diffusion spreads solute through a medium.';
const VECTORS = new Map<string, readonly number[]>([
  [TEXT_SLIDE, [1, 0, 0]],
  [TEXT_TALK, [1, 0.01, 0]],
  [TEXT_OTHER, [1, 0.02, 0]],
]);

async function cache(): Promise<EmbeddingCacheEngine> {
  const provider: EmbeddingProvider = {
    async embed(r: EmbedRequest): Promise<EmbedResult> {
      return { vectors: r.texts.map((t) => [...(VECTORS.get(t) ?? [0, 0, 0])]) };
    },
  };
  const engine = await EmbeddingCacheEngine.create({
    store: new MemoryStore(),
    provider,
    model: 'test-model',
  });
  const chunks: RetrievalChunk[] = await Promise.all(
    [...VECTORS.keys()].map(async (text, i) => ({
      path: `c-${i}.md` as VaultPath,
      blockIndex: 0,
      kind: 'paragraph' as const,
      text,
      contentHash: await hashText(text),
    })),
  );
  await engine.ensureEmbeddings(chunks);
  return engine;
}

const SLIDES = 'Lectures/week-4-slides.md' as VaultPath;
const TALK = 'Lectures/week-4-talk.txt' as VaultPath;
const OTHER_TALK = 'Lectures/week-5-talk.txt' as VaultPath;

const slideConcept: CorpusConcept = {
  name: 'Osmosis',
  aliases: [],
  anchor: {
    sourcePath: SLIDES,
    location: { page: 1, charRange: { start: 0, end: TEXT_SLIDE.length } },
  },
};
const talkConcept = (name: string, path: VaultPath, text: string): CorpusConcept => ({
  name,
  aliases: [],
  anchor: {
    sourcePath: path,
    location: { page: 2, charRange: { start: 0, end: text.length }, transcriptPart: {} },
  },
});
const files = {
  [SLIDES]: TEXT_SLIDE,
  [TALK]: TEXT_TALK,
  [OTHER_TALK]: TEXT_OTHER,
};
const eventOf = (p: VaultPath) => (p === SLIDES || p === TALK ? 'lecture-4' : undefined);

describe('relation nomination: one teaching event counts once', () => {
  it('a transcript restating its own lecture raises no embedding-proximity', async () => {
    const { signals } = await gatherCorpusRelationVaultContext(
      new MemoryVault(files),
      [slideConcept, talkConcept('Water crossing', TALK, TEXT_TALK)],
      { embeddingProximity: { cache: await cache(), threshold: 0.9 }, teachingEventOf: eventOf },
    );
    expect(signals).toEqual([]);
  });

  it('without the resolver the same pair nominates as before', async () => {
    const { signals } = await gatherCorpusRelationVaultContext(
      new MemoryVault(files),
      [slideConcept, talkConcept('Water crossing', TALK, TEXT_TALK)],
      { embeddingProximity: { cache: await cache(), threshold: 0.9 } },
    );
    expect(signals).toEqual([{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Water crossing' }]);
  });

  it('a transcript from a different event is genuinely separate evidence and still nominates', async () => {
    const { signals } = await gatherCorpusRelationVaultContext(
      new MemoryVault(files),
      [slideConcept, talkConcept('Diffusion', OTHER_TALK, TEXT_OTHER)],
      { embeddingProximity: { cache: await cache(), threshold: 0.9 }, teachingEventOf: eventOf },
    );
    expect(signals).toEqual([{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Diffusion' }]);
  });
});
