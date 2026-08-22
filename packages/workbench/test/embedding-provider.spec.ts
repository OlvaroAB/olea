// embedding-provider.spec.ts — `CassetteEmbeddingProvider` never calls a
// network and never invents a vector (`olea-service`'s `ol-opmb.2` [TB-2]).

import { describe, expect, it } from 'vitest';
import { CassetteEmbeddingProvider } from '../src/oracle/embedding-provider.js';
import { hashText } from '../src/oracle-bridge.js';
import type { EmbeddingCassette } from '../src/synthetic-bridge.js';

async function cassetteFor(
  texts: readonly string[],
  model = 'test-model',
): Promise<EmbeddingCassette> {
  const entries = await Promise.all(
    texts.map(async (text, i) => ({
      contentHash: await hashText(text),
      vector: [i, i + 1, i + 2],
    })),
  );
  return { version: 1, model, datasetVersion: 1, entries };
}

describe('CassetteEmbeddingProvider', () => {
  it('replays exactly the cached vector for a known text, in request order', async () => {
    const cassette = await cassetteFor(['alpha', 'beta']);
    const provider = new CassetteEmbeddingProvider({ cassette });
    const result = await provider.embed({ model: 'test-model', texts: ['beta', 'alpha'] });
    expect(result.vectors).toEqual([
      [1, 2, 3],
      [0, 1, 2],
    ]);
  });

  it('refuses (throws) rather than inventing a vector for an unknown text', async () => {
    const cassette = await cassetteFor(['alpha']);
    const provider = new CassetteEmbeddingProvider({ cassette });
    await expect(
      provider.embed({ model: 'test-model', texts: ['never embedded'] }),
    ).rejects.toThrow(/no cached vector/);
  });

  it('refuses (throws) on a model mismatch rather than comparing vector spaces', async () => {
    const cassette = await cassetteFor(['alpha']);
    const provider = new CassetteEmbeddingProvider({ cassette });
    await expect(provider.embed({ model: 'a-different-model', texts: ['alpha'] })).rejects.toThrow(
      /pinned to/,
    );
  });

  it('never calls fetch/network — a pure in-memory lookup', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('CassetteEmbeddingProvider must never call fetch');
    };
    try {
      const cassette = await cassetteFor(['alpha']);
      const provider = new CassetteEmbeddingProvider({ cassette });
      await expect(provider.embed({ model: 'test-model', texts: ['alpha'] })).resolves.toEqual({
        vectors: [[0, 1, 2]],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
