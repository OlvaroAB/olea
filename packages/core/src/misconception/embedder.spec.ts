import { describe, expect, it } from 'vitest';
import { type TextEmbeddingBackend, WorkerMisconceptionEmbedder } from './embedder.js';

class FakeBackend implements TextEmbeddingBackend {
  readonly requests: { model: string; texts: readonly string[] }[] = [];
  private failNext = false;

  scriptFailure(): void {
    this.failNext = true;
  }

  async embed(request: { model: string; texts: readonly string[] }) {
    this.requests.push(request);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('backend unavailable');
    }
    return { vectors: request.texts.map((text) => [text.length, 1, 0]) };
  }
}

describe('WorkerMisconceptionEmbedder (ol-nagi)', () => {
  it('short-circuits to an empty array without calling the backend when texts is empty', async () => {
    const backend = new FakeBackend();
    const embedder = new WorkerMisconceptionEmbedder({ backend, model: 'test-model' });

    const result = await embedder.embed([]);

    expect(result).toEqual([]);
    expect(backend.requests).toHaveLength(0);
  });

  it('passes texts and the configured model straight through to the backend', async () => {
    const backend = new FakeBackend();
    const embedder = new WorkerMisconceptionEmbedder({ backend, model: 'test-model' });

    const result = await embedder.embed(['Believes X implies Y.', 'Confuses A with B.']);

    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toEqual({
      model: 'test-model',
      texts: ['Believes X implies Y.', 'Confuses A with B.'],
    });
    expect(result).toEqual([
      ['Believes X implies Y.'.length, 1, 0],
      ['Confuses A with B.'.length, 1, 0],
    ]);
  });

  it('propagates a backend failure rather than swallowing it — this class makes no reliability decision of its own', async () => {
    const backend = new FakeBackend();
    backend.scriptFailure();
    const embedder = new WorkerMisconceptionEmbedder({ backend, model: 'test-model' });

    await expect(embedder.embed(['some statement'])).rejects.toThrow('backend unavailable');
  });

  it('a real WorkerEmbeddingProvider satisfies TextEmbeddingBackend with no adapter code (structural reuse, ol-nagi)', async () => {
    // This is the load-bearing claim of this bead's mirror-shape decision:
    // the production `WorkerEmbeddingProvider` (retrieval's port
    // implementation) can be handed to `WorkerMisconceptionEmbedder`
    // directly, because `TextEmbeddingBackend` is structurally identical to
    // `EmbeddingProvider`. Importing the real class here (not re-declaring
    // a fake) is the proof.
    const { WorkerEmbeddingProvider } = await import('../retrieval/workerProvider.js');
    const transport = {
      send: async () => ({
        ok: true,
        stamp: { modelId: 'test-model' },
        result: { embeddings: [{ contentHash: await hashOf('hello'), vector: [1, 2, 3] }] },
      }),
    };
    const provider = new WorkerEmbeddingProvider({ transport });
    const embedder = new WorkerMisconceptionEmbedder({ backend: provider, model: 'test-model' });

    const result = await embedder.embed(['hello']);

    expect(result).toEqual([[1, 2, 3]]);
  });
});

async function hashOf(text: string): Promise<string> {
  const { hashText } = await import('../ingestion/hash.js');
  return hashText(text);
}
