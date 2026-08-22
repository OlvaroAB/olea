/**
 * `chunksFromExtractedUnits` — turns what `PendingIndexingSink` has
 * accumulated (`../ingestion/pending-indexing-sink.ts`) into the
 * `RetrievalChunk`s `EmbeddingCacheEngine.ensureEmbeddings` wants (`ol-odb0.1`).
 *
 * **Why this exists rather than reusing `olea-core`'s `chunksFromIndex`.**
 * `chunksFromIndex` derives chunks from an already-built `PersistedKeywordIndex`
 * — markdown notes, walked and block-parsed by `KeywordIndexEngine`. Nothing
 * plays that role for PDF/PPTX/DOCX/image content: `ExtractedUnit` (from
 * `createExtractionJobRunner`, `olea-core`'s `extract/types.ts`) carries
 * `text` and a page/char-range `Provenance`, not a vault block index or
 * `BlockKind` — those are markdown-parser concepts an extracted PDF page
 * never had. Retrieval only needs `path`/`blockIndex`/`kind`/`text`/
 * `contentHash` to do its job (`RetrievalChunk`, `packages/core/src/retrieval/types.ts`),
 * so this module supplies the two fields extraction has no natural analogue
 * for, deliberately synthetic and documented as such:
 *
 * - `kind: 'paragraph'` — the closest `BlockKind` to "extracted prose,"
 *   picked once here rather than left for every caller to decide, and never
 *   claimed to mean "this was a markdown paragraph block."
 * - `blockIndex` — this unit's position among every unit extracted from the
 *   *same* `sourcePath`, in the order `PendingIndexingSink` received them
 *   (stable: `receive` always appends). Not a byte offset and not
 *   reconstructible into one; a caller wanting the exact page/char-range
 *   still has it on the original `ExtractedUnit.provenance`, which this
 *   module deliberately does not throw away — retrieval just doesn't carry
 *   it through `RetrievalChunk` today.
 *
 * **Content hash.** Computed the same way `chunksFromIndex` and
 * `WorkerEmbeddingProvider` both do — `hashText` (SHA-256 of the UTF-8 text)
 * — so a chunk built here and a chunk built from the keyword index are
 * comparable and interchangeable inputs to `ensureEmbeddings`: identical text
 * embeds once, wherever it came from (C2.3).
 */

import type { ExtractedUnit, RetrievalChunk } from 'olea-core';
import { hashText } from 'olea-core';

/**
 * One `RetrievalChunk` per unit, in the order `units` is given — the same
 * order `PendingIndexingSink.all()` returns (receive order, grouped by
 * source). `blockIndex` restarts at 0 for each distinct `sourcePath`
 * encountered, independent of where in `units` that source's entries fall.
 */
export async function chunksFromExtractedUnits(
  units: readonly ExtractedUnit[],
): Promise<readonly RetrievalChunk[]> {
  const nextIndex = new Map<string, number>();
  const chunks: RetrievalChunk[] = [];
  for (const unit of units) {
    const path = unit.provenance.sourcePath;
    const blockIndex = nextIndex.get(path) ?? 0;
    nextIndex.set(path, blockIndex + 1);
    const contentHash = await hashText(unit.text);
    chunks.push({
      path,
      blockIndex,
      kind: 'paragraph',
      text: unit.text,
      contentHash,
    });
  }
  return chunks;
}
