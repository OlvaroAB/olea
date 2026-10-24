/**
 * `[D-633]`: a grounded chunk carries the part or location its index block had, so a passage can be
 * labelled by part, time, page or section. Invented content: a made-up wording in three sources.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import {
  chunkSourceLocation,
  formatSourceCitation,
  passageGrainLabel,
} from '../registry/citation.js';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import { retrieve } from './engine.js';
import type { EmbeddingCacheStore, EmbeddingProvider, PersistedEmbeddingCache } from './types.js';

class MemoryStore implements EmbeddingCacheStore {
  async load(): Promise<PersistedEmbeddingCache | null> {
    return null;
  }
  async save(): Promise<void> {}
}

/** An unreachable provider: retrieval degrades to keyword-only, which is enough to carry the grain. */
const offline: EmbeddingProvider = {
  async embed() {
    throw new Error('offline');
  },
};

const index: PersistedKeywordIndex = {
  documents: [
    {
      path: 'Course/Lecture 2 transcript.txt',
      courses: [],
      contentHash: 'h1',
      blocks: [
        {
          blockIndex: 0,
          kind: 'paragraph',
          text: 'Tessellite grows in interlocking habits.',
          part: 2,
        },
      ],
    },
    {
      path: 'Course/Deck.pptx',
      courses: [],
      contentHash: 'h2',
      blocks: [
        {
          blockIndex: 0,
          kind: 'paragraph',
          text: 'Tessellite on the slide.',
          location: { page: 5, section: 'Habits' },
        },
      ],
    },
    {
      path: 'Course/Plain note.md',
      courses: [],
      contentHash: 'h3',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'A plain tessellite note.' }],
    },
  ],
} as unknown as PersistedKeywordIndex;

describe('a grounded chunk carries its part or location ([D-633])', () => {
  it('keeps the part, the location, and nothing on a plain note', async () => {
    const result = await retrieve(
      {
        keywordIndex: index,
        embeddingCache: await EmbeddingCacheEngine.create({
          store: new MemoryStore(),
          provider: offline,
          model: 'fake-model-v1',
        }),
        embeddingProvider: offline,
      },
      'tessellite',
    );
    if (result.status !== 'grounded') throw new Error(`expected grounded, got ${result.reason}`);
    const byPath = new Map(result.chunks.map((chunk) => [chunk.path, chunk]));
    expect(byPath.get('Course/Lecture 2 transcript.txt' as never)?.part).toBe(2);
    expect(byPath.get('Course/Deck.pptx' as never)?.location).toEqual({
      page: 5,
      section: 'Habits',
    });
    const plain = byPath.get('Course/Plain note.md' as never);
    expect(plain).toBeDefined();
    expect(plain && 'part' in plain).toBe(false);
    expect(plain && 'location' in plain).toBe(false);
    const labels = [...byPath.values()].map((chunk) =>
      formatSourceCitation(chunkSourceLocation(chunk)),
    );
    expect(labels.sort()).toEqual(['Deck (Habits)', 'Lecture 2 transcript (part 2)', 'Plain note']);
    expect(passageGrainLabel(chunkSourceLocation({ path: 'x.md' }))).toBeUndefined();
  });
});
