/**
 * Read-side operations over a `PersistedKeywordIndex` — the course →
 * document → block structure C2.1 requires, searched by keyword for the
 * internal retrieval C2.2 asks for.
 *
 * **Internal retrieval only** — C2.2 is explicit that user-facing search
 * stays Obsidian's own. This is a plain in-memory scan, not an inverted
 * index: D-003 sizes her whole knowledge model as comfortably
 * in-memory-at-her-scale, and a hand-rolled inverted index would be
 * "architecture," where D-003 asks only that the shape be right — the same
 * restraint D-003 already applies to R6. Revisit only if real scale proves
 * this too slow, exactly as D-003 says.
 */

import type { VaultPath } from '../vault/types.js';
import type { IndexedDocument, PersistedKeywordIndex } from './types.js';

/** Splits on runs of non-letter/non-digit characters and lowercases. Shared by both the query and every block's text, so a match means the same thing on both sides. */
function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export interface SearchHit {
  readonly path: VaultPath;
  readonly blockIndex: number;
  readonly text: string;
  /** Count of distinct query tokens this block matched. Always >= 1 — blocks matching none are never returned. */
  readonly score: number;
}

export interface SearchOptions {
  /** Caps the number of hits returned, highest score first. Omit for no cap. */
  readonly limit?: number;
}

/**
 * Keyword search over an already-loaded index (C2.2). A block is a hit when
 * it contains at least one query token; `score` is how many distinct query
 * tokens it contains, so a block matching more of a multi-word query ranks
 * above one matching fewer. Ties break by path then block position, so
 * results are deterministic for a given index — required for the C2.4
 * equivalence test to be meaningful about search behaviour, not just raw
 * structure.
 */
export function searchKeywordIndex(
  index: PersistedKeywordIndex,
  query: string,
  options: SearchOptions = {},
): readonly SearchHit[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const hits: SearchHit[] = [];
  for (const doc of index.documents) {
    for (const block of doc.blocks) {
      const blockTokens = new Set(tokenize(block.text));
      let score = 0;
      for (const token of queryTokens) {
        if (blockTokens.has(token)) score += 1;
      }
      if (score > 0) {
        hits.push({ path: doc.path, blockIndex: block.blockIndex, text: block.text, score });
      }
    }
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.blockIndex - b.blockIndex;
  });

  return options.limit !== undefined ? hits.slice(0, options.limit) : hits;
}

/**
 * The "course → document" half of C2.1's hierarchy, derived rather than
 * physically nested in `PersistedKeywordIndex`: a document's `courses` is
 * M:N (a note can carry more than one `course` value, or none), so a nested
 * `course -> document -> block` JSON shape would either duplicate whole
 * documents across course keys or force a single-course assumption the
 * frontmatter doesn't make. `index.documents` is the single source of truth;
 * this is a view over it. Documents with no `course` value at all appear
 * under no key here (still fully covered by `searchKeywordIndex`).
 */
export function documentsByCourse(
  index: PersistedKeywordIndex,
): ReadonlyMap<string, readonly VaultPath[]> {
  const byCourse = new Map<string, VaultPath[]>();
  const addTo = (course: string, doc: IndexedDocument): void => {
    let paths = byCourse.get(course);
    if (!paths) {
      paths = [];
      byCourse.set(course, paths);
    }
    paths.push(doc.path);
  };
  for (const doc of index.documents) {
    for (const course of doc.courses) addTo(course, doc);
  }
  return byCourse;
}
