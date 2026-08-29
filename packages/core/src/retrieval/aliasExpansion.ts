/**
 * Alias-aware query expansion for keyword search — the wiring
 * `docs/dev` follow-up `ol-l5og.11` names: F8.4/`[D-088]`'s "retrieval keeps
 * matching material written before the rename" clause, which `ol-4v2l`
 * (`[REG-1]`) built the override and alias record for
 * (`../registry/overrides.ts`) but never wired into anything that reads
 * concept names for matching (`features/F8-concepts-scope.md`'s "her old
 * wording still resolves after the rename" scenario, left honestly
 * `@auto:core/registry/rename.spec` with a "not yet delivered" note).
 *
 * **What this does, precisely.** A concept's rename history
 * (`aliasEquivalenceGroups`) is a set of names all denoting one concept
 * within this run. If `query` contains one of those names — as a
 * contiguous run of tokens, using the *exact* tokenizer `searchKeywordIndex`
 * scores blocks with (`../keyword-index/query.ts`'s `tokenize`), so
 * "would this expansion actually match" and "did we decide to expand" never
 * disagree — every OTHER name in that group is appended to the query text.
 * `searchKeywordIndex`'s scoring already counts distinct query tokens found
 * in a block, so a block written under the old wording now contributes to
 * `score` for a query built from the new wording, with no change to that
 * scoring function itself.
 *
 * **Why this is honest about C7.11's still-provisional key.** Nothing here
 * keys on `ConceptRecord.key` or persists anything across a call — every
 * call re-derives from the `RegistryOverrides` its caller hands in, which is
 * itself always this run's own state. If the key were to change between two
 * runs (a note rename, a `topic:` edit — see `../concept/types.ts`), the
 * *next* run's `overrides` blob (keyed by the new run's key) is what this
 * function reads, and it is that run's own rename history that gets
 * expanded — never a stale cross-run assumption. This is a narrower claim
 * than "the key is stable," which is exactly what `ol-zfty` (the open
 * key-stability bead this follow-up was told not to solve) still owns.
 *
 * **Scope: keyword search only, not the embedding query.** `retrieve()`
 * applies this to the text handed to `searchKeywordIndex` alone — the
 * semantic query embedded via `EmbeddingProvider` and the query text handed
 * to an optional reranker are both left as the caller wrote them. Appending
 * several alias names to a short natural-language question before embedding
 * it would blur the very query vector cosine similarity depends on being a
 * faithful representation of what was asked; keyword scoring has no such
 * property to protect, since it already treats a query as an unordered
 * token set.
 */

import { tokenize } from '../keyword-index/query.js';
import { aliasEquivalenceGroups } from '../registry/overrides.js';
import type { RegistryOverrides } from '../registry/types.js';

/** True when `needle`'s tokens appear, in order, as a contiguous run somewhere inside `haystack`. Empty `needle` never matches — nothing should expand on an empty name. */
function containsContiguousRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Expands `query` with every alias name of every renamed concept `query`
 * already mentions, so a keyword search over `../keyword-index/query.js`'s
 * `searchKeywordIndex` also surfaces material indexed under a concept's
 * pre-rename wording. Returns `query` unchanged (same string) when
 * `overrides` has no rename history, or when nothing in `query` names a
 * renamed concept — the common case, and never a behaviour change from
 * before this function existed.
 */
export function expandQueryWithAliases(query: string, overrides: RegistryOverrides): string {
  const groups = aliasEquivalenceGroups(overrides);
  if (groups.size === 0) return query;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return query;

  const additions = new Set<string>();
  const consideredGroups = new Set<readonly string[]>();
  for (const [name, group] of groups) {
    if (consideredGroups.has(group)) continue;
    const nameTokens = tokenize(name);
    if (containsContiguousRun(queryTokens, nameTokens)) {
      consideredGroups.add(group);
      for (const alt of group) {
        if (alt !== name) additions.add(alt);
      }
    }
  }

  return additions.size === 0 ? query : `${query} ${[...additions].join(' ')}`;
}
