/**
 * `chunksFromExtractedUnits` tests (`ol-odb0.1`) — see
 * `src/retrieval/units-to-chunks.ts`'s module doc for why extracted
 * (non-markdown) content needs its own mapping into `RetrievalChunk` rather
 * than reusing `olea-core`'s `chunksFromIndex`.
 */

import type { ExtractedUnit } from 'olea-core';
import { hashText } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { chunksFromExtractedUnits } from '../../src/retrieval/units-to-chunks.js';

function unit(sourcePath: string, text: string, page = 1): ExtractedUnit {
  return {
    text,
    provenance: {
      sourcePath,
      location: { page, charRange: { start: 0, end: text.length } },
    },
  };
}

describe('chunksFromExtractedUnits', () => {
  it('produces one chunk per unit, in order', async () => {
    const units = [unit('Lectures/a.pdf', 'first'), unit('Lectures/a.pdf', 'second')];
    const chunks = await chunksFromExtractedUnits(units);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe('first');
    expect(chunks[1]?.text).toBe('second');
  });

  it('carries the source path straight through', async () => {
    const chunks = await chunksFromExtractedUnits([unit('Lectures/a.pdf', 'x')]);
    expect(chunks[0]?.path).toBe('Lectures/a.pdf');
  });

  it("uses 'paragraph' as the block kind — the closest fit for extracted prose", async () => {
    const chunks = await chunksFromExtractedUnits([unit('Lectures/a.pdf', 'x')]);
    expect(chunks[0]?.kind).toBe('paragraph');
  });

  it('the content hash is SHA-256 of the unit text, hex-encoded — matching chunksFromIndex/WorkerEmbeddingProvider', async () => {
    const chunks = await chunksFromExtractedUnits([unit('Lectures/a.pdf', 'exact text')]);
    expect(chunks[0]?.contentHash).toBe(await hashText('exact text'));
  });

  it('blockIndex counts up per source path, restarting at 0 for each distinct source', async () => {
    const chunks = await chunksFromExtractedUnits([
      unit('Lectures/a.pdf', 'a1'),
      unit('Lectures/b.pdf', 'b1'),
      unit('Lectures/a.pdf', 'a2'),
      unit('Lectures/b.pdf', 'b2'),
    ]);
    const byText = Object.fromEntries(chunks.map((c) => [c.text, c.blockIndex]));
    expect(byText.a1).toBe(0);
    expect(byText.a2).toBe(1);
    expect(byText.b1).toBe(0);
    expect(byText.b2).toBe(1);
  });

  it('identical text in two different units still gets the same content hash (dedup happens downstream, in ensureEmbeddings)', async () => {
    const chunks = await chunksFromExtractedUnits([
      unit('Lectures/a.pdf', 'same text'),
      unit('Lectures/b.pdf', 'same text'),
    ]);
    expect(chunks[0]?.contentHash).toBe(chunks[1]?.contentHash);
  });

  it('an empty input list produces an empty output list', async () => {
    expect(await chunksFromExtractedUnits([])).toEqual([]);
  });
});
