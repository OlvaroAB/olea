/**
 * `oracle.rank.v1`'s `bases` request field, built from this package's own
 * `ConceptAssessmentEdge`s (`ol-egov.142.2`, `[D-247]`).
 *
 * **PURE, and deliberately uncalled from anywhere in production.**
 * `oracle.rank.v1` has no caller anywhere in either repo — see
 * `./compose.ts`'s module doc ("`oracle.rank.v1` has no production caller
 * anywhere in either repo... `ol-egov.142.2` is filed to give it one") and
 * that bead's own notes: the planner will not call it, D-374 has not yet
 * ruled the F2.22 surface that would, and D-212's Slot O model pick needs
 * re-checking before any production caller exists. `ol-egov.142.2` was
 * asked for this mapping in advance of that caller — so it exists here,
 * tested, and is not wired to anything. ZERO SPEND: adding a caller of
 * `oracle.rank.v1` (a paid task) is explicitly out of this module's scope.
 *
 * **Mirrors, but does not import** ([D-069] — the two repos share no types
 * across that boundary) the service's `oracleEvidenceBasis` /
 * `OracleConceptCandidate.bases` (`olea-service/src/tasks/oracleRank.ts`):
 *
 *   z.array(z.object({
 *     basis: z.enum(['past-paper', 'objectives', 'assessment-brief']),
 *     confidence: z.number().min(0).max(1),
 *   })).default([])
 *
 * See `./rank-request-bases.spec.ts` for the test that validates this
 * module's output against a local mirror of that shape.
 */

import type { ConceptAssessmentEdge, ConceptEvidenceBasis } from '../evidence-edge/types.js';

/** One entry of `oracle.rank.v1`'s `OracleConceptCandidate.bases` array. */
export interface OracleRankRequestBasis {
  readonly basis: ConceptEvidenceBasis;
  readonly confidence: number;
}

/**
 * One concept's `bases` entries for an `oracle.rank.v1` request, built from
 * every edge supplied for that concept (any course, any basis — the caller
 * decides which edges belong to one candidate; this function does no
 * grouping of its own).
 *
 * **Deduplicated by basis, keeping the higher confidence.** The same basis
 * can appear on more than one edge only when the caller passes edges from
 * more than one course for what it treats as a single candidate (`rank.ts`'s
 * own `edgesByConcept` groups by course first, so a single-course caller
 * never triggers this) — rather than leave the tie to `Map` iteration
 * order, the higher of the two measured confidences wins, documented here
 * as the rule rather than left implicit.
 *
 * **`edge.basis` defaults to `'past-paper'` when absent** — the same
 * default `ConceptAssessmentEdge.basis`'s own doc states for every edge
 * built before `[D-226]` added the field.
 *
 * **Sorted by basis name.** `oracle.rank.v1`'s schema imposes no order on
 * this array, but a pure function with no caller yet should not leave the
 * order a future caller sees to `Map` iteration order.
 */
export function toOracleRankRequestBases(
  edges: readonly ConceptAssessmentEdge[],
): readonly OracleRankRequestBasis[] {
  const confidenceByBasis = new Map<ConceptEvidenceBasis, number>();
  for (const edge of edges) {
    const basis = edge.basis ?? 'past-paper';
    const existing = confidenceByBasis.get(basis);
    if (existing === undefined || edge.confidence > existing) {
      confidenceByBasis.set(basis, edge.confidence);
    }
  }
  return [...confidenceByBasis.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([basis, confidence]) => ({ basis, confidence }));
}
