/**
 * Production wiring of the one-teaching-event guard (`ol-egov.141.89.8.60`, D-465): the relation path
 * built by `buildCorpusRelationWiring` and run by `runCorpusRelationBatchIfDue` receives the resolver,
 * so a same-event transcript restatement raises no proximity signal and nothing reaches the verdict
 * port. Synthetic data only.
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
import { ObsidianCorpusRelationStateStore } from '../../src/concept/corpusRelationStateStore.js';
import {
  buildCorpusRelationWiring,
  runCorpusRelationBatchIfDue,
} from '../../src/concept/wiring.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

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

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

async function run(teachingEventOf: ((p: VaultPath) => string | undefined) | undefined) {
  const calls: unknown[] = [];
  const host = new FakeDataHost();
  host.blob = {
    [WORKER_CONFIG_STORAGE_KEY]: { version: 1, baseUrl: 'https://worker.example', token: 't' },
  };
  const wiring = await buildCorpusRelationWiring({
    dataHost: host,
    createTransport: () => ({
      send: async (request: unknown) => {
        calls.push(request);
        return { ok: true, result: { verdicts: [] } };
      },
    }),
  });
  const outcome = await runCorpusRelationBatchIfDue(
    wiring,
    new ObsidianCorpusRelationStateStore(new FakeDataHost()),
    {
      vault: new MemoryVault(files),
      ingestionSessionClosed: true,
      allConcepts: [slideConcept, talkConcept('Water crossing', TALK, TEXT_TALK)],
      embeddingProximity: { cache: await cache(), threshold: 0.9 },
      ...(teachingEventOf !== undefined ? { teachingEventOf } : {}),
    },
  );
  return { outcome, calls };
}

describe('corpus relation batch through the production wiring honours one teaching event', () => {
  it('a same-event transcript restatement nominates no candidate and sends nothing to the Worker', async () => {
    const { outcome, calls } = await run(eventOf);
    expect(outcome.candidatesNominated).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('without the resolver the same pair is nominated and sent', async () => {
    const { outcome, calls } = await run(undefined);
    expect(outcome.candidatesNominated).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
