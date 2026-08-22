import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { hashText } from '../ingestion/hash.js';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import type { EmbeddingCacheStore, PersistedEmbeddingCache, RetrievalChunk } from './types.js';
import {
  RETRIEVAL_EMBED_CONTRACT_VERSION,
  RETRIEVAL_EMBED_TASK_ID,
  WorkerEmbeddingError,
  WorkerEmbeddingProvider,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from './workerProvider.js';

const MODEL = '@cf/baai/bge-m3';

/** Records what the provider sent and answers with whatever the test scripted. */
class RecordingTransport implements WorkerTaskTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function chunksOf(request: WorkerTaskRequest): readonly { contentHash: string; text: string }[] {
  return (request.payload as { chunks: { contentHash: string; text: string }[] }).chunks;
}

/** A well-formed success envelope: one vector per chunk, in the order sent. */
function successFor(
  request: WorkerTaskRequest,
  vectorFor: (index: number) => readonly number[],
  modelId = MODEL,
): unknown {
  return {
    ok: true,
    stamp: { contractVersion: CONTRACT_VERSION, promptVersion: '1.0.0', modelId },
    result: {
      embeddings: chunksOf(request).map((chunk, index) => ({
        contentHash: chunk.contentHash,
        vector: vectorFor(index),
      })),
    },
  };
}

describe('WorkerEmbeddingProvider — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value (its
  // `main` points at TypeScript source, which a plain Node process running
  // core's dist cannot load). This test is what stops the mirror drifting.
  it('sends the task id the frozen catalogue reserves for Slot E', () => {
    expect(RETRIEVAL_EMBED_TASK_ID).toBe(TASK_IDS.RETRIEVAL_EMBED);
  });

  it('sends the current contract version', () => {
    expect(RETRIEVAL_EMBED_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});

describe('WorkerEmbeddingProvider — the request it builds', () => {
  it('sends one chunk per text, content-hash-keyed, in the frozen envelope', async () => {
    const transport = new RecordingTransport((request) => successFor(request, () => [1, 0, 0]));
    const provider = new WorkerEmbeddingProvider({ transport });

    await provider.embed({ model: MODEL, texts: ['alpha', 'beta'] });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe(TASK_IDS.RETRIEVAL_EMBED);
    expect(request?.contractVersion).toBe(CONTRACT_VERSION);
    expect(chunksOf(request as WorkerTaskRequest)).toEqual([
      { contentHash: await hashText('alpha'), text: 'alpha' },
      { contentHash: await hashText('beta'), text: 'beta' },
    ]);
  });

  it('makes no request at all for an empty batch', async () => {
    const transport = new RecordingTransport(() => {
      throw new Error('should not be called');
    });
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: [] })).resolves.toEqual({ vectors: [] });
    expect(transport.sent).toHaveLength(0);
  });

  it('refuses a blank text before sending, naming the index', async () => {
    const transport = new RecordingTransport((request) => successFor(request, () => [1]));
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha', '   '] })).rejects.toThrow(
      /index 1 is empty/,
    );
    // The point of the pre-check: one blank chunk must not 400 the batch.
    expect(transport.sent).toHaveLength(0);
  });
});

describe('WorkerEmbeddingProvider — the response it reads', () => {
  it('returns vectors in input order even when the Worker answers out of order', async () => {
    const transport = new RecordingTransport((request) => {
      const body = successFor(request, (index) => [index, 0]) as {
        result: { embeddings: unknown[] };
      };
      body.result.embeddings.reverse();
      return body;
    });
    const provider = new WorkerEmbeddingProvider({ transport });

    const result = await provider.embed({ model: MODEL, texts: ['alpha', 'beta', 'gamma'] });

    expect(result.vectors).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('gives two identical texts the same vector from a single hash', async () => {
    const transport = new RecordingTransport((request) => successFor(request, () => [0.5, 0.5]));
    const provider = new WorkerEmbeddingProvider({ transport });

    const result = await provider.embed({ model: MODEL, texts: ['same', 'other', 'same'] });

    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[0]).toEqual(result.vectors[2]);
  });

  it('surfaces a Worker error response with its code', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'unauthenticated',
      message: 'token missing',
    }));
    const provider = new WorkerEmbeddingProvider({ transport });

    const error = await provider
      .embed({ model: MODEL, texts: ['alpha'] })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkerEmbeddingError);
    expect((error as WorkerEmbeddingError).code).toBe('unauthenticated');
  });

  it('refuses vectors stamped with a model other than the one the cache is keyed to', async () => {
    const transport = new RecordingTransport((request) =>
      successFor(request, () => [1, 0], '@cf/some/other-model'),
    );
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha'] })).rejects.toThrow(
      /not comparable/,
    );
  });

  it('refuses a response with no stamped modelId', async () => {
    const transport = new RecordingTransport(() => ({
      ok: true,
      result: { embeddings: [] },
    }));
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha'] })).rejects.toThrow(/modelId/);
  });

  it('refuses a response missing a vector for one of the inputs', async () => {
    const transport = new RecordingTransport((request) => {
      const body = successFor(request, () => [1, 0]) as { result: { embeddings: unknown[] } };
      body.result.embeddings.pop();
      return body;
    });
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha', 'beta'] })).rejects.toThrow(
      /no vector for input text at index 1/,
    );
  });

  it('refuses a ragged batch rather than letting cosine silently answer zero', async () => {
    const transport = new RecordingTransport((request) =>
      successFor(request, (index) => (index === 0 ? [1, 0] : [1, 0, 0])),
    );
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha', 'beta'] })).rejects.toThrow(
      /inconsistent vector dimensions/,
    );
  });

  it('refuses a vector carrying a non-finite component', async () => {
    const transport = new RecordingTransport((request) =>
      successFor(request, () => [Number.NaN, 0]),
    );
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha'] })).rejects.toThrow(
      /non-finite component/,
    );
  });

  it('refuses a body that is not a Worker response at all', async () => {
    const transport = new RecordingTransport(() => 'not json object');
    const provider = new WorkerEmbeddingProvider({ transport });

    await expect(provider.embed({ model: MODEL, texts: ['alpha'] })).rejects.toThrow(
      /not an object/,
    );
  });
});

describe('WorkerEmbeddingProvider — composed with the cache engine (C2.3, D-004)', () => {
  class MemoryStore implements EmbeddingCacheStore {
    saved: PersistedEmbeddingCache | null = null;
    async load(): Promise<PersistedEmbeddingCache | null> {
      return this.saved;
    }
    async save(cache: PersistedEmbeddingCache): Promise<void> {
      this.saved = cache;
    }
  }

  async function chunk(text: string, blockIndex: number): Promise<RetrievalChunk> {
    return {
      path: 'notes/a.md' as RetrievalChunk['path'],
      blockIndex,
      kind: 'paragraph' as RetrievalChunk['kind'],
      text,
      contentHash: await hashText(text),
    };
  }

  it('fills the cache through the Worker and re-embeds nothing on a second pass', async () => {
    const transport = new RecordingTransport((request) =>
      successFor(request, (index) => [index + 1, 0]),
    );
    const store = new MemoryStore();
    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new WorkerEmbeddingProvider({ transport }),
      model: MODEL,
    });

    const chunks = [await chunk('alpha', 0), await chunk('beta', 1)];
    await engine.ensureEmbeddings(chunks);
    expect(store.saved?.entries).toHaveLength(2);
    expect(transport.sent).toHaveLength(1);

    await engine.ensureEmbeddings(chunks);
    // C2.3's whole point: unchanged text is never re-sent.
    expect(transport.sent).toHaveLength(1);
  });

  it('degrades rather than throwing when the Worker refuses', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'upstream-error',
      message: 'gateway down',
    }));
    const engine = await EmbeddingCacheEngine.create({
      store: new MemoryStore(),
      provider: new WorkerEmbeddingProvider({ transport }),
      model: MODEL,
    });

    const snapshot = await engine.ensureEmbeddings([await chunk('alpha', 0)]);
    expect(snapshot.size).toBe(0);
  });
});
