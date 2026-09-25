/**
 * The candidates step's own decision on an embedding failure
 * (`docs/dev/intelligence-build/evd.md` §2, `[ILB-EVD-4]`) — pure, and
 * upstream of `evidencePackage.ts`'s `degraded` mark, which this module's
 * caller is expected to set from the outcome here.
 *
 * **What changes, and why.** Today, `engine.ts`'s `embedQuery` swallows an
 * offline provider, a provider error or an empty query into
 * `queryVector: null` and `retrieve()` always proceeds to keyword-only
 * fusion, silently — a caller reading `HybridHit[]` has no way to tell "no
 * semantic hits because nothing matched" from "no semantic hits because the
 * embedding call itself failed" (see `hybrid.ts`'s `HybridHit.semantic`,
 * added for exactly that reason). Target: the request does not end the
 * moment the embedding call fails. It checks, in addition to whatever
 * keyword hits already exist, whether the concept has a **verified anchor
 * passage** (the introducing passage concept extraction recorded and the
 * Worker actually grounded — `packages/core/src/concept/read.ts`'s
 * `ReadConcept.anchor`, verified by `groundConcepts` dropping any proposal
 * whose `anchorIndex` falls outside `citableChunkCount`,
 * `olea-service/src/tasks/conceptsExtract.ts:253-258,271-292`). If either
 * exists, the request continues on what is available and is marked
 * degraded; only when neither exists does it end as the visible
 * operational outcome `unavailable` — never `insufficient`, which is
 * reserved for a retrieval that itself succeeded but came back empty
 * (`evd.md` §3).
 *
 * **This module has no vault or index access of its own** (INV-1: no
 * `obsidian` import, and no import of `../concept/read.ts` either) — same
 * posture as `scopeFilter.ts`'s `courseOf`: a caller resolves
 * `hasVerifiedAnchor` (and supplies the anchor chunk itself, if one exists,
 * to `withVerifiedAnchor`) and this module only fixes what the resulting
 * facts mean.
 */

import type { VaultPath } from '../vault/types.js';

/** The candidates step's decision — `resolveCandidateAvailability`'s only two shapes. */
export type CandidateAvailability =
  | { readonly kind: 'available'; readonly degraded: boolean }
  | { readonly kind: 'unavailable' };

/**
 * Decides whether the request continues (possibly degraded) or ends as the
 * operational outcome `unavailable`, from three facts about this one
 * request:
 *
 * - `embeddingAvailable`: `false` exactly when `queryVector` came back
 *   `null` (offline, an empty query, or a provider failure/timeout) —
 *   `engine.ts`'s `embedQuery` already computes this; this module never
 *   re-derives it.
 * - `keywordHitCount`: however many hits `searchKeywordIndex` found for
 *   this query, scoped or not — a caller passes whichever count matches
 *   what it will actually fuse from.
 * - `hasVerifiedAnchor`: whether the concept has a verified anchor passage
 *   (see this file's doc) — `false` when the caller has no anchor source
 *   wired at all, which is the honest "unknown, so do not rely on it"
 *   answer rather than a fabricated `true`.
 *
 * When `embeddingAvailable` is `true`, the answer is always
 * `{kind: 'available', degraded: false}` regardless of the other two
 * facts — a healthy embedding call is not itself a reason to mark
 * anything degraded, whatever keyword search or the anchor lookup found.
 */
export function resolveCandidateAvailability(params: {
  readonly embeddingAvailable: boolean;
  readonly keywordHitCount: number;
  readonly hasVerifiedAnchor: boolean;
}): CandidateAvailability {
  if (params.embeddingAvailable) return { kind: 'available', degraded: false };
  if (params.keywordHitCount > 0 || params.hasVerifiedAnchor) {
    return { kind: 'available', degraded: true };
  }
  return { kind: 'unavailable' };
}

/**
 * Prepends `anchor` to `candidates` when it is not already present by
 * identity (`path` + `blockIndex`) — the degraded path's "the list still
 * forms from keyword hits or the concept's verified anchor passage,
 * whichever exists" (`evd.md` §2): a keyword hit that already surfaced the
 * anchor is not duplicated, and a `null` anchor (no anchor known, or the
 * embedding call succeeded so none was looked up) leaves `candidates`
 * untouched — same array reference back, not a copy, when there is nothing
 * to add. Generic over anything shaped like `RetrievalChunk`/`HybridHit`
 * (both carry `path` and `blockIndex`), so a caller can use this before or
 * after fusion.
 */
export function withVerifiedAnchor<
  T extends { readonly path: VaultPath; readonly blockIndex: number },
>(candidates: readonly T[], anchor: T | null): readonly T[] {
  if (!anchor) return candidates;
  const alreadyPresent = candidates.some(
    (c) => c.path === anchor.path && c.blockIndex === anchor.blockIndex,
  );
  return alreadyPresent ? candidates : [anchor, ...candidates];
}
