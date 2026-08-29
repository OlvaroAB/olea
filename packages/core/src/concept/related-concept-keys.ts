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
 * that join — no relation-type filtering beyond what already reached the
 * fold, no clustering structure, no I/O.
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
 * **Which of C7.10's six relation types count as "connected", and
 * directionality — a reversible default, not a ruling.** `compose.ts`'s own
 * module doc leaves this "deliberately type-agnostic... the caller's call".
 * The default taken here (Class B, flagged for retroactive review): every
 * relation type present in the input counts as evidence of a connection, and
 * the resulting adjacency is symmetric — an edge's `from` and `to` are each
 * added to the other's set regardless of the relation's own directedness
 * (`RELATION_DIRECTEDNESS`). F2.19 asks whether two concepts "connect to each
 * other" for PLACEMENT purposes, a weaker question than the six types' own
 * directed semantics, and grouping two concepts next to each other reads the
 * same regardless of which one is nominally the prerequisite. In production
 * this only ever sees whatever `servedRelations` currently yields —
 * `is-a`/`part-of`/`contrasts-with`/`prerequisite` today
 * (`RELATION_EMISSION_STATUS`); `causes`/`related` carry no production edges
 * yet, so this default has not been exercised against those two and should be
 * revisited if it ever is.
 */

import type { ConceptRelation } from './relation.js';
import type { ConceptRecord } from './types.js';

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
 * this function can ever produce.
 */
export function resolveRelatedConceptKeys(
  relations: readonly ConceptRelation[],
  concepts: readonly ConceptRecord[],
): RelatedConceptKeysResolution {
  const keyByName = new Map(concepts.map((concept) => [concept.name, concept.key]));
  const adjacency = new Map<string, Set<string>>();
  let unresolvedEndpointCount = 0;

  for (const relation of relations) {
    const fromKey = keyByName.get(relation.from);
    const toKey = keyByName.get(relation.to);
    if (fromKey === undefined) unresolvedEndpointCount += 1;
    if (toKey === undefined) unresolvedEndpointCount += 1;
    if (fromKey === undefined || toKey === undefined) continue;
    if (fromKey === toKey) continue; // a self-relation cannot inform placement; defensive, not expected from a real reader
    link(adjacency, fromKey, toKey);
    link(adjacency, toKey, fromKey);
  }

  return { relatedConceptKeys: adjacency, unresolvedEndpointCount };
}
