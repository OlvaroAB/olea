/**
 * The ranked own-note judge context for "Explain it back" (`ol-egov.141.89.6.71`,
 * `[D-453]` with `[D-452]`). **Built and proved on development data; NOT the
 * shipped path.** Nothing in `src/` calls this yet: the one-line switch is held
 * until the single held-out read (see `retrieveAnchoredExplainBackSourceBlocks`
 * in `./request.ts`), and `test/explain-back/anchor-context.spec.ts` pins that.
 *
 * The composition, restated from the harness (`olea-service`
 * `scripts/harness/xbk-context-variants/lib.mjs` `composeContext`, and
 * `scripts/harness/ilb-xbk/context-coverage/lib.mjs` `orderByRanking`), which is
 * the spec this file is proved equal to (`client-port-check.mjs`):
 *
 * - the subject's own-note passages come first: those the retrieval ranking holds,
 *   in ranking order, then the rest in document order;
 * - the retrieval ranking fills the slots that are left, up to the budget (8),
 *   skipping a passage already present (same path and block index) and a passage
 *   whose letters and digits equal an own-note passage's;
 * - with no own passages the result is the ranking's first `budget` passages
 *   untouched, which is what the shipped context is.
 *
 * Pure: no I/O, no `obsidian` (INV-1), type-only imports. An own note never by
 * itself makes the context sufficient; that is the grader's reading, not this
 * file's, and nothing here changes what she does (cognitive-offloading: it changes
 * what evidence the judge sees).
 */

import type { ExplainBackSourceBlock } from './request.js';

/** The slots the judge context fills; the shipped `retrieve()` default is the same 8. */
export const ANCHORED_CONTEXT_BUDGET = 8;

/** The minimum a retrieval chunk carries here: where it came from and its text. */
export interface AnchorChunk {
  readonly path: string;
  readonly blockIndex: number;
  readonly text: string;
}

/** Letters and digits only, case folded: markup differences do not make two passages different. */
const squash = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const keyOf = (chunk: { readonly path: string; readonly blockIndex: number }): string =>
  `${chunk.path}\u0000${chunk.blockIndex}`;

/**
 * `ownNoteChunks` are every passage of the subject's own note (any order);
 * `ranked` is the retrieval ranking after its relevance filter, best first and NOT
 * cut to the budget (the own-note order needs ranks beyond the top 8).
 */
export function composeAnchoredSourceBlocks(input: {
  readonly ownNoteChunks: readonly AnchorChunk[];
  readonly ranked: readonly AnchorChunk[];
  readonly budget?: number;
}): readonly ExplainBackSourceBlock[] {
  const budget = input.budget ?? ANCHORED_CONTEXT_BUDGET;
  const rankOf = new Map<string, number>();
  input.ranked.forEach((chunk, rank) => {
    const key = keyOf(chunk);
    if (!rankOf.has(key)) rankOf.set(key, rank);
  });
  const inDocumentOrder = input.ownNoteChunks
    .map((chunk, position) => ({ chunk, position }))
    .sort((a, b) => a.chunk.blockIndex - b.chunk.blockIndex || a.position - b.position)
    .map((entry) => entry.chunk);
  const own = inDocumentOrder
    .map((chunk, position) => ({ chunk, position, rank: rankOf.get(keyOf(chunk)) }))
    .sort((a, b) => {
      const ar = a.rank ?? Number.POSITIVE_INFINITY;
      const br = b.rank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return a.position - b.position;
    })
    .map((entry) => entry.chunk);

  const chosen: AnchorChunk[] = [];
  const seen = new Set<string>();
  const ownTexts = new Set<string>();
  for (const chunk of own) {
    const key = keyOf(chunk);
    if (seen.has(key)) continue;
    if (chosen.length >= budget) continue;
    seen.add(key);
    ownTexts.add(squash(chunk.text));
    chosen.push(chunk);
  }
  const hadOwn = chosen.length > 0;
  for (const chunk of input.ranked) {
    if (chosen.length >= budget) break;
    const key = keyOf(chunk);
    if (hadOwn && (seen.has(key) || ownTexts.has(squash(chunk.text)))) continue;
    seen.add(key);
    chosen.push(chunk);
  }
  return chosen.map((chunk, index) => ({
    block: { blockId: `${chunk.path}#${chunk.blockIndex}#${index}`, text: chunk.text },
    path: chunk.path,
    blockIndex: chunk.blockIndex,
  }));
}
