/**
 * Derives retrieval chunks from an already-built keyword index (C2.3, P3-T05).
 *
 * Deliberately not a second document walk: `PersistedKeywordIndex` (P2-T01)
 * already parsed the vault into course → document → block, and its blocks
 * are exactly the granularity C2.3 wants embedded ("per block/chunk"). This
 * module only adds what retrieval needs on top — a per-block content hash,
 * the embedding cache key (D-004) — rather than re-deriving anything
 * `indexDocument` already computed.
 */

import { hashText } from '../ingestion/hash.js';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import type { RetrievalChunk } from './types.js';

/**
 * One `RetrievalChunk` per indexed block, across every document in `index`,
 * in the same document order the index is already sorted by (ascending
 * path) and block order within each document — deterministic, so two calls
 * against the same index produce identically-ordered output.
 */
export async function chunksFromIndex(
  index: PersistedKeywordIndex,
): Promise<readonly RetrievalChunk[]> {
  const chunks: RetrievalChunk[] = [];
  for (const doc of index.documents) {
    for (const block of doc.blocks) {
      const contentHash = await hashText(block.text);
      chunks.push({
        path: doc.path,
        blockIndex: block.blockIndex,
        kind: block.kind,
        text: block.text,
        contentHash,
      });
    }
  }
  return chunks;
}
