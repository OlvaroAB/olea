/**
 * Graph checks — `docs/dev/intelligence-build/rel.md` §2's diagram ("graph checks: predicate
 * contract, a prerequisite-only cycle report naming its members and the prerequisite propositions
 * among them it blocks") and §3's Default 2 (`olea-service`, `[D-296]`, clarified `ol-egov.141.89.4.12`).
 *
 * **Scoped to `prerequisite` only, by ruling, not by omission.** Of the six C7.10 types, only
 * `prerequisite` has a named reader that needs an acyclic order (queue ordering, the F2.12 failure
 * check). `contrasts-with` is symmetric, so "cycle" is not a meaningful fault on it; `causes` may
 * legally cycle (the plan's provisional semantics); `is-a`/`part-of` have no reader that orders by
 * them at all. This module's cycle report therefore never receives, and could not meaningfully
 * accept, an edge of any other type.
 *
 * **A cycle blocks only the edges strictly between two of its own members — never a member's edge
 * to a dependent outside the cycle** (Default 2, clarified `ol-egov.141.89.4.12`: "a member's edge
 * to a key outside the cycle is a non-cyclic prerequisite proposition on that member like any
 * other"). This is the whole reason `blockedPropositions` below is a set of EDGE identities, never
 * a set of KEYS — blocking by key would also silently exclude that edge.
 *
 * Pure: no I/O, no clock, no identity minting.
 */

/** One directed `prerequisite` edge, by opaque endpoint keys (`from` is the prerequisite, `to` is the dependent — `../relation.ts`'s canonical directed-endpoint reading). */
export interface PrerequisiteEdge {
  readonly fromKey: string;
  readonly toKey: string;
}

export interface PrerequisiteCycleReport {
  /** Each reported cycle, as the ordered list of keys that form it (last edge closes back to the first). */
  readonly cycles: readonly (readonly string[])[];
  /** Every key that is a member of at least one reported cycle. */
  readonly memberKeys: ReadonlySet<string>;
  /** Edge identities (`${fromKey}\u0000${toKey}`) strictly between two members of the SAME reported cycle — the only edges Default 2 holds out of eligibility. */
  readonly blockedEdgeIds: ReadonlySet<string>;
}

function edgeId(fromKey: string, toKey: string): string {
  return `${fromKey}\u0000${toKey}`;
}

/**
 * Report every simple cycle in the `prerequisite` edge set, and exactly which edges among the
 * reported cycles' own members Default 2 blocks. Uses a standard DFS with a recursion-stack colour
 * marking (white/grey/black) — cheap and sufficient at the scale this stage runs at (one course's
 * concept set per batch, not the whole vault).
 */
export function findPrerequisiteCycles(edges: readonly PrerequisiteEdge[]): PrerequisiteCycleReport {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromKey);
    if (list === undefined) adjacency.set(edge.fromKey, [edge.toKey]);
    else list.push(edge.toKey);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const path: string[] = [];

  function visit(node: string): void {
    color.set(node, GREY);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === WHITE) {
        visit(next);
      } else if (nextColor === GREY) {
        // Found a cycle: the path from `next`'s first occurrence to here, closing back to `next`.
        const start = path.indexOf(next);
        if (start !== -1) cycles.push(path.slice(start));
      }
    }
    path.pop();
    color.set(node, BLACK);
  }

  const allKeys = new Set<string>();
  for (const edge of edges) {
    allKeys.add(edge.fromKey);
    allKeys.add(edge.toKey);
  }
  for (const key of allKeys) {
    if ((color.get(key) ?? WHITE) === WHITE) visit(key);
  }

  const memberKeys = new Set<string>();
  for (const cycle of cycles) for (const key of cycle) memberKeys.add(key);

  // Default 2: block only edges strictly between two members of the SAME reported cycle, never a
  // member's edge to anything outside it. Computed per cycle, not from `memberKeys` globally, so
  // two disjoint cycles sharing no member never cross-block each other's edges.
  const blockedEdgeIds = new Set<string>();
  for (const cycle of cycles) {
    const inThisCycle = new Set(cycle);
    for (const edge of edges) {
      if (inThisCycle.has(edge.fromKey) && inThisCycle.has(edge.toKey)) {
        blockedEdgeIds.add(edgeId(edge.fromKey, edge.toKey));
      }
    }
  }

  return { cycles, memberKeys, blockedEdgeIds };
}

/** Whether one edge is blocked by a cycle report — the read side `./eligibility.ts` calls. */
export function isEdgeBlockedByCycle(edge: PrerequisiteEdge, report: PrerequisiteCycleReport): boolean {
  return report.blockedEdgeIds.has(edgeId(edge.fromKey, edge.toKey));
}

/**
 * The predicate contract's structural floor — the one thing ruled today (rel.md §7: transitivity
 * and acyclicity for `is-a`/`part-of` stay open, a separate build step). A self-loop violates every
 * one of the six types: a concept cannot be its own prerequisite, contrast, cause, kind or part.
 * This is exactly Default 6's self-relation case (`../relation-cache.ts`'s module doc) restated as
 * a structural check rather than only a merge-time observation, so a self-loop reaching this stage
 * by any other route is caught the same way.
 */
export function violatesPredicateContract(edge: { readonly fromKey: string; readonly toKey: string }): boolean {
  return edge.fromKey === edge.toKey;
}
