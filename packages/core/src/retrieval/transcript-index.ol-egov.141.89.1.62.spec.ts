/**
 * `ol-egov.141.89.1.62` (D-465): lecture-transcript parts reach the keyword index and so the
 * retrieval chunks (and the embedding path, which keys on the same chunks), beside her notes.
 * Synthetic material only: an invented "course A".
 */

import { describe, expect, it } from 'vitest';
import { MemoryVault } from '../extract/transcript.fixtures.js';
import { buildFullIndex } from '../keyword-index/build.js';
import { KeywordIndexEngine } from '../keyword-index/engine.js';
import type {
  IndexedDocument,
  KeywordIndexStore,
  PersistedKeywordIndex,
} from '../keyword-index/types.js';
import { chunksFromIndex } from './chunks.js';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import { retrieve } from './engine.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from './types.js';

const NOTE = '---\ncourse: course A\n---\n\n# My notes\n\nOsmosis moves water across a membrane.\n';
const TRANSCRIPT_MD =
  '---\nrole: lecture transcript\ncourse: course A\n---\n\n# Week one\n\nToday the lecturer explains how osmosis moves water.\n\nSecond paragraph: tonicity decides the direction.\n';
const TRANSCRIPT_TXT =
  'Welcome to week two of course A.\n\nThe lecturer describes diffusion in a cell.\n';

const WITH_TRANSCRIPTS = {
  'course-a/note.md': NOTE,
  'course-a/lecture-1.md': TRANSCRIPT_MD,
  'course-a/lecture-2.txt': TRANSCRIPT_TXT,
};

class MemoryKeywordStore implements KeywordIndexStore {
  saved: PersistedKeywordIndex | null = null;
  async load() {
    return this.saved;
  }
  async save(index: PersistedKeywordIndex) {
    this.saved = index;
  }
}

class MemoryEmbeddingStore implements EmbeddingCacheStore {
  saved: PersistedEmbeddingCache | null = null;
  async load() {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache) {
    this.saved = cache;
  }
}

/** Every text embeds to the same direction, so retrieval is decided by what is in the index. */
class FlatProvider implements EmbeddingProvider {
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return { vectors: request.texts.map(() => [1, 0, 0]) };
  }
}

async function indexOf(files: Record<string, string>): Promise<PersistedKeywordIndex> {
  const result = await buildFullIndex({
    vault: new MemoryVault(files),
    scheduler: { yield: async () => {} },
  });
  if (result.status !== 'complete') throw new Error('cancelled');
  return result.index;
}

function doc(index: PersistedKeywordIndex, path: string): IndexedDocument {
  const found = index.documents.find((d) => d.path === path);
  if (found === undefined) throw new Error(`no document ${path}`);
  return found;
}

describe('transcript parts in the production retrieval index (ol-egov.141.89.1.62)', () => {
  it('indexes a declared Markdown transcript once, as parts carrying their part locator', async () => {
    const index = await indexOf(WITH_TRANSCRIPTS);
    const md = doc(index, 'course-a/lecture-1.md');
    expect(md.blocks.length).toBeGreaterThan(0);
    expect(md.blocks.map((b) => b.part)).toEqual(md.blocks.map((_, i) => i + 1));
    // Once, as a transcript: no authored-note heading or frontmatter blocks alongside the parts.
    expect(md.blocks.every((b) => b.kind === 'paragraph' && b.part !== undefined)).toBe(true);
    expect(index.documents.filter((d) => d.path === 'course-a/lecture-1.md')).toHaveLength(1);
    expect(md.courses).toEqual(['course A']);
    const txt = doc(index, 'course-a/lecture-2.txt');
    expect(txt.blocks.map((b) => b.part)).toEqual(txt.blocks.map((_, i) => i + 1));
  });

  it('leaves non-transcript indexing unchanged (equality)', async () => {
    const withTranscripts = await indexOf(WITH_TRANSCRIPTS);
    const noteOnly = await indexOf({ 'course-a/note.md': NOTE });
    expect(doc(withTranscripts, 'course-a/note.md')).toEqual(doc(noteOnly, 'course-a/note.md'));
    expect(noteOnly.documents).toHaveLength(1);
    expect(doc(noteOnly, 'course-a/note.md').blocks.some((b) => 'part' in b)).toBe(false);
    // The retrieval chunks of the note carry no part key either.
    const chunks = await chunksFromIndex(noteOnly);
    expect(chunks.some((c) => 'part' in c)).toBe(false);
  });

  it('assembles grounded evidence with a transcript part beside slide evidence', async () => {
    const index = await indexOf(WITH_TRANSCRIPTS);
    const slides: IndexedDocument = {
      path: 'course-a/slides.pdf',
      courses: ['course A'],
      contentHash: 'slides-hash',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'Slide: osmosis and tonicity overview.' }],
    };
    const combined: PersistedKeywordIndex = {
      version: 1,
      documents: [...index.documents, slides].sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
    const provider = new FlatProvider();
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: new MemoryEmbeddingStore(),
      provider,
      model: 'fake-model-v1',
    });
    const result = await retrieve(
      { keywordIndex: combined, embeddingCache, embeddingProvider: provider },
      'osmosis',
      { topK: 8 },
    );
    expect(result.status).toBe('grounded');
    if (result.status !== 'grounded') return;
    const paths = result.chunks.map((c) => c.path);
    expect(paths).toContain('course-a/lecture-1.md');
    expect(paths).toContain('course-a/slides.pdf');
    expect(paths).toContain('course-a/note.md');
    const part = result.chunks.find((c) => c.path === 'course-a/lecture-1.md');
    expect(part?.text).toContain('osmosis');
    // The transcript part is reachable by the embedding path too: its chunk is in the same list.
    const chunks = await chunksFromIndex(combined);
    expect(chunks.filter((c) => c.path === 'course-a/lecture-2.txt').every((c) => c.part)).toBe(
      true,
    );
  });

  it('keeps a transcript through a restart: rebuilt once, then trusted, and incremental events match a rebuild', async () => {
    const vault = new MemoryVault(WITH_TRANSCRIPTS);
    const store = new MemoryKeywordStore();
    const scheduler = { yield: async () => {} };
    const first = await KeywordIndexEngine.create({ vault, store, scheduler });
    await first.rebuild();
    const reloaded = await KeywordIndexEngine.create({ vault, store, scheduler });
    expect(reloaded.toPersisted()).toEqual(first.toPersisted());
    expect(doc(reloaded.toPersisted(), 'course-a/lecture-1.md').blocks[0]?.part).toBe(1);

    // A transcript arriving later reaches the index by the incremental path, equal to a rebuild.
    const live = await KeywordIndexEngine.create({
      vault,
      store: new MemoryKeywordStore(),
      scheduler,
    });
    for (const path of Object.keys(WITH_TRANSCRIPTS))
      await live.applyEvent({ kind: 'create', path });
    expect(live.toPersisted()).toEqual(first.toPersisted());
  });
});
