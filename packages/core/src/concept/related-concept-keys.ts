/**
 * F2.19's relatedness resolver (`ol-v7r5.11`): the name→`conceptKey` join
 * `study-session/compose.ts`'s module doc names as the missing production
 * caller for `ComposeSessionRowsInput.relatedConceptKeys` — the identical
 * reachability gap `ARRIVE-1`'s `arrivalDays` had before a follow-up wired it
 * (`ol-v7r5.10`'s handback, "Data path — relatedness").
 *
 * `./relation.js`'s `ConceptRelation.from`/`.to` are concept **names**
 * (matched against `ReadConcept.name`); the grouping seam partitions and
 * joins on `conceptKey`. This module performs exactly that join, and only
 * that join plus the F2.19 allowed-type filter below — no clustering
 * structure, no I/O.
 *
 * **The name→key derivation is REUSED, not reinvented.** It is the same
 * `new Map(concepts.map((concept) => [concept.name, concept.key]))`
 * construction `evidence-edge/build.ts`'s `conceptKeyByName` already performs
 * for the identical name-is-the-only-join-value situation (`ol-63e1`). Exact
 * match only, deliberately: `oracle/compose.ts`'s
 * `resolveCaseInsensitiveConceptKeys` layers a case-insensitive, course-
 * scoped fallback on top of that same join, but it is a narrow repair for one
 * measured defect (`ol-5y40`), scoped to that one composition seam by its own
 * doc ("this is not a case-folding of concept identity") — reusing it here
 * would be a second, undermeasured judgement call this bead has no evidence
 * to defend. A relation endpoint whose name does not exact-match any known
 * concept is dropped rather than guessed at.
 *
 * **Which relation types count as "connected" — F2.19 / `[D-461]`.** Only the
 * four the clause names (`SESSION_GROUPING_RELATION_TYPES`); `causes` and the
 * bare `related` are skipped. Directionality is not read: the adjacency is
 * symmetric, since F2.19 asks whether two concepts connect for PLACEMENT, a
 * weaker question than the directed semantics (`RELATION_DIRECTEDNESS`).
 *
 * **The exact-name join is no longer the only join — `ol-l40p` [REL-9],
 * 2026-09-11.** `resolveRelatedConceptKeys` now keys an endpoint by its own
 * `fromKey`/`toKey` directly when the relation carries one (a corpus-stage
 * edge whose verdict echoed the candidate's `CorpusConcept.key`), and falls
 * back to this module's original name join only when it is absent. See that
 * function's own doc for the argument; the name join above is unchanged and
 * still the only path for a per-document edge or an older, key-less replay.
 */

import type { ConceptRelation, RelationType } from './relation.js';
import type { ConceptRecord } from './types.js';

/**
 * A `ConceptRelation` that also carries its own endpoint keys, when the
 * producer that reconciled it had them -- `ol-l40p` [REL-9]. Structurally
 * identical to `./corpus-relations/types.js`'s `CorpusReconciledRelation`
 * (same two optional fields, same names) but declared locally rather than
 * imported: this module's own contract is general over "any C7.10 relation
 * list", not specific to the corpus stage, and TypeScript's structural
 * typing means a `CorpusReconciledRelation[]` already satisfies this type
 * with no cast needed at the call site.
 */
export interface RelationWithEndpointKeys extends ConceptRelation {
  readonly fromKey?: string;
  readonly toKey?: string;
}

/**
 * The relation types F2.19 session grouping reads: exactly the four the clause
 * names (is-a, part-of, prerequisite, contrasts-with), `[D-461]`
 * (`ol-egov.141.89.4.30`, ruled 2026-09-30, `ol-egov.141.89.4.23`). Explicit,
 * never "everything but X" computed at the call: `causes` (served for
 * explain-back) and the bare `related` type (C7.10, defined and unwritten) stay
 * out, and a relation type added later is out of grouping until a decision puts
 * it here.
 */
export const SESSION_GROUPING_RELATION_TYPES: ReadonlySet<RelationType> = new Set<RelationType>([
  'is-a',
  'part-of',
  'contrasts-with',
  'prerequisite',
]);

/** {@link resolveRelatedConceptKeys}'s result: the adjacency map plus the honest miss count. */
export interface RelatedConceptKeysResolution {
  /** `conceptKey` → the set of OTHER `conceptKey`s it connects to — `study-session/compose.ts`'s `ComposeSessionRowsInput.relatedConceptKeys` shape exactly. */
  readonly relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Count of relation ENDPOINTS (not edges) whose name did not exact-match
   * any known concept — up to two per edge, one per side. An edge with
   * either endpoint unresolved is dropped from the map entirely, since an
   * adjacency entry needs both ends to be real keys; this is the honest
   * count of what got dropped, so a caller or a test can assert on the miss
   * rate rather than have it disappear silently.
   */
  readonly unresolvedEndpointCount: number;
}

function link(adjacency: Map<string, Set<string>>, a: string, b: string): void {
  const existing = adjacency.get(a);
  if (existing === undefined) adjacency.set(a, new Set([b]));
  else existing.add(b);
}

/**
 * Resolve C7.10 relation edges (post-fold — typically `servedRelations`'s
 * output) into the `conceptKey`-keyed adjacency map the F2.19 grouping seam
 * reads. Pure: no I/O, no identity minting — `concepts` supplies every key
 * this function can ever produce for an endpoint resolved by name.
 *
 * **Only `allowedTypes` count (default {@link SESSION_GROUPING_RELATION_TYPES},
 * `[D-461]`).** The default is the F2.19 grouping reader's list, so a `causes`
 * edge never groups a session; the one other reader, the explain-back partner
 * lookup (`plugin/src/explain-back/request.ts`), passes its own list because it
 * reads causes by design. An excluded edge is skipped, not counted as a miss.
 *
 * **Keys an endpoint by `fromKey`/`toKey` directly when the relation carries
 * one, falling back to the exact-name join against `concepts` only when it
 * is absent — `ol-l40p` [REL-9], never the reverse.** A relation reconciled
 * from a corpus-relations verdict that echoed the candidate's own
 * `CorpusConcept.key` (`./corpus-relations/verdict.js`'s
 * `reconcileCorpusVerdicts`) already carries a trustworthy key that
 * travelled through the request/response pair unchanged; re-deriving it from
 * `relation.from`/`.to` against a `concepts` list that may come from a
 * DIFFERENT naming pass over the same passage is exactly the join
 * `findings/relations-join-2026-09.md` (`olea-service`) measured failing on
 * most endpoint mentions in production terms. A key that IS present is
 * therefore never second-guessed against `concepts` — the candidate-set
 * check that vouches for it already ran, one layer up, in
 * `reconcileCorpusVerdicts`. Absent (e.g. a per-document `is-a`/`part-of`
 * edge, or a corpus-stage edge replayed from an older cassette entry
 * recorded before either side threaded `key` through), this is exactly the
 * pre-`ol-l40p` behaviour.
 */
export function resolveRelatedConceptKeys(
  relations: readonly RelationWithEndpointKeys[],
  concepts: readonly ConceptRecord[],
  options: { readonly allowedTypes?: ReadonlySet<RelationType> } = {},
): RelatedConceptKeysResolution {
  const allowedTypes = options.allowedTypes ?? SESSION_GROUPING_RELATION_TYPES;
  const keyByName = new Map(concepts.map((concept) => [concept.name, concept.key]));
  const adjacency = new Map<string, Set<string>>();
  let unresolvedEndpointCount = 0;

  for (const relation of relations) {
    if (!allowedTypes.has(relation.type)) continue; // [D-461]: not a type this reader counts; skipped before its endpoints are even resolved
    const fromKey = relation.fromKey ?? keyByName.get(relation.from);
    const toKey = relation.toKey ?? keyByName.get(relation.to);
    if (fromKey === undefined) unresolvedEndpointCount += 1;
    if (toKey === undefined) unresolvedEndpointCount += 1;
    if (fromKey === undefined || toKey === undefined) continue;
    if (fromKey === toKey) continue; // a self-relation cannot inform placement; defensive, not expected from a real reader
    link(adjacency, fromKey, toKey);
    link(adjacency, toKey, fromKey);
  }

  return { relatedConceptKeys: adjacency, unresolvedEndpointCount };
}
