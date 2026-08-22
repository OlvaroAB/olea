/**
 * M1 — conservative embedding match (knowledge model §4.1, D-004).
 *
 * "Two wrong answers about the same concept are not necessarily the same
 * misconception... creating two records for one misunderstanding is a much
 * smaller harm than merging two distinct ones and telling her she keeps
 * making a mistake she has only made once." This module is the one place
 * that decision gets made, and it is made conservatively on purpose: the
 * default threshold is deliberately high, and a caller must pass a lower one
 * explicitly to get looser matching.
 *
 * Cosine similarity itself is `../retrieval/cosine.js`'s `cosineSimilarity`
 * — D-004's "same local pattern" — imported, not re-implemented, so M1 and
 * C2.3/C2.5 share one tested definition of "how similar are these two
 * vectors." Nothing here computes an embedding; that is the injected
 * `MisconceptionEmbedder` (`./types.js`), consistent with the Worker being a
 * calculator and this store never calling the network directly.
 */

import { cosineSimilarity } from '../retrieval/cosine.js';
import type { EmbeddingVector } from './types.js';

/**
 * Deliberately high (M1). At this similarity two statements are the same
 * misconception in substance, not merely about the same concept or sharing
 * vocabulary — two distinct wrong answers about one concept routinely score
 * well below this (see `matcher.spec.ts`'s "does not merge" case). A Class B
 * tunable default, not a persisted value: changing it only changes which
 * *future* observations match, and never rewrites an event already on disk.
 */
export const DEFAULT_M1_THRESHOLD = 0.93;

export interface MisconceptionMatchCandidate {
  readonly id: string;
  readonly embedding: EmbeddingVector;
}

/**
 * The best-matching existing misconception for a new statement's embedding,
 * or `null` when nothing clears the threshold. Candidates should already be
 * restricted to the same concept (and typically to `active`/`fading` status
 * — a caller decides which statuses are eligible to reabsorb a new
 * occurrence; `resolved` misconceptions recurring is a legitimate case for a
 * fresh match, handled by `./project.js`'s reactivation rule once an event
 * names the id).
 *
 * Ties (equal top score) resolve to the lexicographically smaller id, so the
 * function is deterministic for the same input in any order — load-bearing
 * for the rebuild-from-log equivalence test, which must not depend on
 * iteration order.
 */
export function matchExistingMisconception(
  statementEmbedding: EmbeddingVector,
  candidates: readonly MisconceptionMatchCandidate[],
  threshold: number = DEFAULT_M1_THRESHOLD,
): string | null {
  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = cosineSimilarity(statementEmbedding, candidate.embedding);
    if (score < threshold) continue;
    if (score > bestScore || (score === bestScore && bestId !== null && candidate.id < bestId)) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId;
}
