/**
 * The containment co-presence rule (C7.9, `docs/Olea_component_register.md`
 * row 3.7, `olea-service`) — a broad-area concept and one of its own parts
 * are never composed into the same session as though they were unrelated:
 *
 * > and session composition (F4.6) — so a broad area and one of its parts
 * > are never counted as separate peers against the denominator the
 * > examiner set — and session composition (F4.6) — so a broad area and one
 * > of its parts are never served in the same session as though they were
 * > unrelated concepts.
 * (`docs/Olea_alpha_functional_scope.md` C7.9; the identical sentence is
 * restated for F4.6 at `docs/Olea_knowledge_model.md` §3.1.)
 *
 * Named by the RANK-4 relation-ordering paper
 * (`docs/direction/papers/rank4-relation-ordering/PROPOSAL.md` §4.3) as the
 * cheapest relation-aware composition build available: the rule is already
 * contracted rather than proposed, it runs on `part-of` — the one relation
 * type the per-document read stage already emits (`concept/relation.js`'s
 * `RELATION_EMISSION_STATUS`) — and it needs no threshold, no score and no
 * corpus fit. Set membership decides it, nothing else.
 *
 * **Which side yields — declared, not stated verbatim by the clause.** C7.9
 * states the prohibition; it does not spell out which of the two concepts a
 * composer should drop. This module applies the identical asymmetry C7.9
 * states two sentences earlier for concept size itself: *"size errs fine and
 * merges upward … only the fine direction is recoverable"* — a part is the
 * finer, recoverable reading and a container is the coarser one, so where
 * both would be composed into one session, **the container's candidates
 * yield and the part's are kept.** This mirrors `concept/size.ts`'s own
 * documented default (fine unless the material forces coarse) rather than
 * inventing a second rule for the same asymmetry.
 *
 * **Direction convention.** `part-of` is directed
 * (`concept/relation.js`'s `RELATION_DIRECTEDNESS`): `from` is what is made
 * of `to`, the same convention `concept/read.ts`'s `applyContainmentEvidence`
 * already reads (`relation.to` is the "broader side" folded into
 * `containmentEvidence`). This module reuses that convention rather than
 * asserting a new one.
 *
 * **Zero free parameters.** No threshold, no score, no corpus-fitted
 * boundary — a candidate's concept key is either in the co-present drop set
 * or it is not.
 *
 * **Unresolved edges are dropped, not guessed at** — the same discipline
 * `concept/reconcile.js` applies to a relation naming a concept the same
 * read did not return. A `part-of` edge whose `from` or `to` name does not
 * resolve to a concept in this walk's own concept set contributes nothing.
 *
 * **No plumbing invented here.** `edges` is an explicit parameter; this
 * module does not read, cache or persist anything, and it never will —
 * server-side storage of derived relation state is exactly what C6 forbids.
 * Whether a real edge set reaches a real session is a wiring question for
 * whoever calls `buildReviewSession` — see `build.ts`'s module doc for
 * exactly what is wired today and what is not.
 *
 * **A second caller, same rule (`[SESS-11]`, `ol-egov.132.12`).**
 * `study-session/compose.ts`'s `composeSessionRows` — the composer that
 * replaces this one's own selection role (`docs/dev/one-assembly-path.md`
 * §2, olea-service) — applies the identical rule to its own `GapRow[]`
 * candidate pool via {@link containerConceptKeysToDrop}, the primitive this
 * module factors {@link filterContainmentCoPresence} through rather than
 * restating the edge-walk for a second candidate shape. It is, the same way
 * this module's own production callers are, a no-op until a caller threads a
 * live edge set through.
 */

import type { ConceptRelation } from '../concept/relation.js';
import type { ConceptRecord } from '../concept/types.js';
import type { QueueCandidate } from '../queue/types.js';

export interface ContainmentFilterResult {
  /** The candidate pool with every co-present container dropped. */
  readonly candidates: readonly QueueCandidate[];
  /**
   * Candidates dropped because one of their concepts is the container side
   * of a `part-of` edge whose part side is also present in this pool —
   * reported rather than silently discarded, the same posture
   * `VaultInstrumentEnumeration.unbound` and `ComposedQueue.deferred` already
   * take for a session that quietly lost something.
   */
  readonly dropped: readonly QueueCandidate[];
}

/** name -> key, first occurrence wins. Stable because `concepts` arrives in vault order (`enumerate.ts`). */
function nameToKey(concepts: readonly ConceptRecord[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const concept of concepts) {
    if (!map.has(concept.name)) map.set(concept.name, concept.key);
  }
  return map;
}

/**
 * The container concept KEYS to drop, given a name -> key resolver and the
 * concept keys actually present in some candidate pool. Every `part-of` edge
 * whose part side and container side are BOTH present drops the container
 * side. Edge types other than `part-of` are ignored rather than rejected, so
 * a caller may hand over a whole `RelationSet`'s served edges (`is-a`,
 * `prerequisite`, …) without pre-filtering by type — this rule is C7.9's
 * alone and `part-of`'s alone (RANK-4 §4.3).
 *
 * **Exported as its own primitive** (`[SESS-11]`, `ol-egov.132.12`) so a
 * caller working in a different candidate shape —
 * `study-session/compose.ts`'s `GapRow[]`, one row per concept rather than
 * one `QueueCandidate` per instrument — can apply the identical rule without
 * a second implementation of the edge-walk, or a second concept lookup: that
 * caller already carries `GapRow.conceptName`/`.conceptKey` on every row, so
 * it builds its own name -> key map from the rows it already has rather than
 * requiring a `ConceptRecord[]` it is not otherwise given. `keyOfName` is
 * this module's own {@link nameToKey} when the caller is instrument
 * candidates (see {@link containerKeysToDrop} below); a `GapRow`-based caller
 * builds the equivalent map itself, the same first-occurrence-wins
 * convention.
 */
export function containerConceptKeysToDrop(
  edges: readonly ConceptRelation[],
  keyOfName: ReadonlyMap<string, string>,
  presentConceptKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const drop = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== 'part-of') continue;
    const partKey = keyOfName.get(edge.from);
    const containerKey = keyOfName.get(edge.to);
    if (partKey === undefined || containerKey === undefined) continue;
    if (presentConceptKeys.has(partKey) && presentConceptKeys.has(containerKey))
      drop.add(containerKey);
  }
  return drop;
}

/**
 * {@link containerConceptKeysToDrop}, specialised to a `QueueCandidate` pool:
 * resolves the name -> key map from `concepts` and the present-key set from
 * every candidate's `conceptIds`, then defers to the shared primitive.
 */
function containerKeysToDrop(
  edges: readonly ConceptRelation[],
  concepts: readonly ConceptRecord[],
  candidates: readonly QueueCandidate[],
): ReadonlySet<string> {
  const keyOf = nameToKey(concepts);
  const present = new Set<string>();
  for (const candidate of candidates) {
    for (const conceptId of candidate.conceptIds) present.add(conceptId);
  }
  return containerConceptKeysToDrop(edges, keyOf, present);
}

/**
 * Apply the containment co-presence rule to one session's candidate pool.
 *
 * Pure and total: no clock, no I/O, no identity minting. A no-op whenever
 * `edges` carries no resolvable `part-of` pair — which is every real caller
 * today, since nothing yet threads a live edge set to composition (see
 * `build.ts`). Order-preserving and order-independent in its result: the
 * kept and dropped lists preserve `candidates`' own order, and the drop set
 * is a plain union over `edges`, so the result does not depend on the order
 * either array arrives in.
 */
export function filterContainmentCoPresence(
  candidates: readonly QueueCandidate[],
  edges: readonly ConceptRelation[],
  concepts: readonly ConceptRecord[],
): ContainmentFilterResult {
  if (edges.length === 0 || candidates.length === 0) {
    return { candidates, dropped: [] };
  }
  const drop = containerKeysToDrop(edges, concepts, candidates);
  if (drop.size === 0) return { candidates, dropped: [] };

  const kept: QueueCandidate[] = [];
  const dropped: QueueCandidate[] = [];
  for (const candidate of candidates) {
    const hitsDroppedContainer = candidate.conceptIds.some((id) => drop.has(id));
    (hitsDroppedContainer ? dropped : kept).push(candidate);
  }
  return { candidates: kept, dropped };
}
