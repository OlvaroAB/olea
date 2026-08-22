import { describe, expect, it } from 'vitest';
import { hashText } from '../ingestion/hash.js';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import { chunksFromIndex } from './chunks.js';

function index(
  docs: { path: string; blocks: { blockIndex: number; text: string }[] }[],
): PersistedKeywordIndex {
  return {
    version: 1,
    documents: docs.map((doc) => ({
      path: doc.path,
      courses: [],
      contentHash: 'doc-hash-unused-by-chunking',
      blocks: doc.blocks.map((b) => ({
        blockIndex: b.blockIndex,
        kind: 'paragraph' as const,
        text: b.text,
      })),
    })),
  };
}

describe('chunksFromIndex (C2.3)', () => {
  it('produces one chunk per indexed block, carrying path, block position and text', async () => {
    const idx = index([
      {
        path: 'a.md',
        blocks: [
          { blockIndex: 1, text: 'first block' },
          { blockIndex: 3, text: 'second block' },
        ],
      },
      { path: 'b.md', blocks: [{ blockIndex: 0, text: 'only block' }] },
    ]);

    const chunks = await chunksFromIndex(idx);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ path: 'a.md', blockIndex: 1, text: 'first block' });
    expect(chunks[1]).toMatchObject({ path: 'a.md', blockIndex: 3, text: 'second block' });
    expect(chunks[2]).toMatchObject({ path: 'b.md', blockIndex: 0, text: 'only block' });
  });

  it('keys every chunk by the content hash of its own text (D-004)', async () => {
    const idx = index([{ path: 'a.md', blocks: [{ blockIndex: 0, text: 'hello world' }] }]);
    const chunks = await chunksFromIndex(idx);
    expect(chunks[0]?.contentHash).toBe(await hashText('hello world'));
  });

  it('gives identical text the identical content hash, even across different documents', async () => {
    const idx = index([
      { path: 'a.md', blocks: [{ blockIndex: 0, text: 'shared boilerplate line' }] },
      { path: 'b.md', blocks: [{ blockIndex: 0, text: 'shared boilerplate line' }] },
    ]);
    const chunks = await chunksFromIndex(idx);
    expect(chunks[0]?.contentHash).toBe(chunks[1]?.contentHash);
  });

  it('an empty index produces zero chunks', async () => {
    const chunks = await chunksFromIndex({ version: 1, documents: [] });
    expect(chunks).toEqual([]);
  });
});
