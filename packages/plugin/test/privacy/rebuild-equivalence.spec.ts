/**
 * D-006's standing requirement, proven at the level `ol-p6t01`'s acceptance
 * criterion names: "a delete-then-rebuild test proves the cache is a pure
 * derivation." `packages/core/src/keyword-index/rebuild-equivalence.spec.ts`
 * already proves this for `KeywordIndexEngine` in isolation
 * (incremental-vs-rebuilt equivalence); this file proves the SAME property
 * one layer up, through `purgeCache` itself — the actual function the
 * settings-pane "Delete everything" button calls — against two real,
 * production engines (`KeywordIndexEngine`, `EmbeddingCacheEngine`) reading
 * from a real filesystem `FolderSource`, not a hand-rolled fake.
 *
 * The shape: build the cache once against a fixture vault, snapshot its
 * exact persisted state, purge it through `purgeCache`, rebuild from
 * scratch against the identical vault content, and assert byte-for-byte
 * equality of the two persisted snapshots. If `purgeCache` ever left a
 * stray key half-cleared, or a store's `load()` failed to treat "key
 * absent" the same as "nothing persisted," this is the test that would
 * catch it — a weaker "purge doesn't throw" test would not.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmbeddingProvider, EmbedRequest, EmbedResult } from 'olea-core';
import {
  EmbeddingCacheEngine,
  FolderSource,
  hashText,
  KeywordIndexEngine,
  type RetrievalChunk,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianKeywordIndexStore } from '../../src/keyword-index/store.js';
import { purgeCache } from '../../src/privacy/cache-purge.js';
import { ObsidianEmbeddingCacheStore } from '../../src/retrieval/embedding-cache-store.js';
import { FakeDataHost } from './fakes.js';

/** No real timer — same reasoning as `keyword-index/rebuild-equivalence.spec.ts`'s own `immediateScheduler`. */
const immediateScheduler = { yield: () => Promise.resolve() };

/** Deterministic: one fixed-length vector per distinct input text, so two calls over the same text always embed identically — the property that makes the rebuild comparison meaningful rather than coincidental. */
class DeterministicEmbeddingProvider implements EmbeddingProvider {
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        let seed = 0;
        for (let i = 0; i < text.length; i += 1) seed = (seed * 31 + text.charCodeAt(i)) % 997;
        return Array.from({ length: 8 }, (_, i) => ((seed + i) % 97) / 97);
      }),
    };
  }
}

/**
 * Asserts `FolderSource.delete` is never called in this test — `purgeCache`
 * only reaches `.olea/drafts/`, which this fixture vault never creates.
 * Throwing (rather than silently no-op'ing) makes that assumption an
 * assertion, not a guess. Was a separate `VaultDeletePort` mock before
 * `ol-ppxj.15` promoted `delete` onto `VaultSource` itself; now it is a spy
 * on the real vault's own method.
 */
function guardAgainstUnexpectedDelete(vault: FolderSource): void {
  vi.spyOn(vault, 'delete').mockImplementation(async (path) => {
    throw new Error(`unexpected vault delete during rebuild-equivalence test: ${path}`);
  });
}

describe('purgeCache — delete-then-rebuild is a pure derivation (D-006, ol-p6t01)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-privacy-rebuild-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixture(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('the keyword index rebuilt after purgeCache equals the index before it', async () => {
    await writeFixture(
      'Alpha.md',
      '---\ncourse: SYN101\n---\n\n# Alpha\nsynthetic prose about alpha\n',
    );
    await writeFixture(
      'Beta.md',
      '---\ncourse: SYN101\n---\n\n# Beta\nsynthetic prose about beta\n',
    );
    const vault = new FolderSource(root);
    guardAgainstUnexpectedDelete(vault);
    const dataHost = new FakeDataHost();

    const before = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(dataHost),
      scheduler: immediateScheduler,
    });
    await before.rebuild();
    const beforeSnapshot = before.toPersisted();
    expect(beforeSnapshot.documents.map((d) => d.path)).toEqual(['Alpha.md', 'Beta.md']);

    await purgeCache({ dataHost, vault });
    expect((dataHost.blob as Record<string, unknown>).keywordIndex).toBeUndefined();

    const after = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(dataHost),
      scheduler: immediateScheduler,
    });
    await after.rebuild();
    const afterSnapshot = after.toPersisted();

    expect(afterSnapshot).toEqual(beforeSnapshot);
  });

  it('the embedding cache rebuilt after purgeCache equals the cache before it', async () => {
    await writeFixture('Alpha.md', 'synthetic prose about alpha\n');
    await writeFixture('Beta.md', 'synthetic prose about beta\n');
    const vault = new FolderSource(root);
    guardAgainstUnexpectedDelete(vault);
    const dataHost = new FakeDataHost();
    const provider = new DeterministicEmbeddingProvider();

    const chunks: RetrievalChunk[] = await Promise.all(
      ['Alpha.md', 'Beta.md'].map(async (path) => {
        const text = await vault.read(path);
        return {
          path,
          blockIndex: 0,
          kind: 'paragraph' as const,
          text,
          contentHash: await hashText(text),
        };
      }),
    );

    const before = await EmbeddingCacheEngine.create({
      store: new ObsidianEmbeddingCacheStore(dataHost),
      provider,
      model: 'synthetic-embed-v1',
    });
    await before.ensureEmbeddings(chunks);
    const beforeSnapshot = before.toPersisted();
    expect(beforeSnapshot.entries).toHaveLength(2);

    await purgeCache({ dataHost, vault });
    expect((dataHost.blob as Record<string, unknown>).embeddingCache).toBeUndefined();

    const after = await EmbeddingCacheEngine.create({
      store: new ObsidianEmbeddingCacheStore(dataHost),
      provider,
      model: 'synthetic-embed-v1',
    });
    await after.ensureEmbeddings(chunks);
    const afterSnapshot = after.toPersisted();

    expect(afterSnapshot).toEqual(beforeSnapshot);
  });

  it('purging BOTH caches together (the real "Delete everything" call shape) still lets each rebuild independently to its pre-purge state', async () => {
    await writeFixture(
      'Gamma.md',
      '---\ncourse: SYN101\n---\n\n# Gamma\nsynthetic prose about gamma\n',
    );
    const vault = new FolderSource(root);
    guardAgainstUnexpectedDelete(vault);
    const dataHost = new FakeDataHost();
    const provider = new DeterministicEmbeddingProvider();

    const keywordEngine = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(dataHost),
      scheduler: immediateScheduler,
    });
    await keywordEngine.rebuild();
    const keywordBefore = keywordEngine.toPersisted();

    const text = await vault.read('Gamma.md');
    const chunks: RetrievalChunk[] = [
      {
        path: 'Gamma.md',
        blockIndex: 0,
        kind: 'paragraph',
        text,
        contentHash: await hashText(text),
      },
    ];
    const embeddingEngine = await EmbeddingCacheEngine.create({
      store: new ObsidianEmbeddingCacheStore(dataHost),
      provider,
      model: 'synthetic-embed-v1',
    });
    await embeddingEngine.ensureEmbeddings(chunks);
    const embeddingBefore = embeddingEngine.toPersisted();

    // The one purge call a real "Delete everything" click makes — both
    // caches at once, not called out separately per engine.
    const purgeResult = await purgeCache({ dataHost, vault });
    expect(purgeResult.clearedDataJsonKeys).toContain('keywordIndex');
    expect(purgeResult.clearedDataJsonKeys).toContain('embeddingCache');

    const keywordAfter = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(dataHost),
      scheduler: immediateScheduler,
    });
    await keywordAfter.rebuild();
    expect(keywordAfter.toPersisted()).toEqual(keywordBefore);

    const embeddingAfter = await EmbeddingCacheEngine.create({
      store: new ObsidianEmbeddingCacheStore(dataHost),
      provider,
      model: 'synthetic-embed-v1',
    });
    await embeddingAfter.ensureEmbeddings(chunks);
    expect(embeddingAfter.toPersisted()).toEqual(embeddingBefore);
  });
});
