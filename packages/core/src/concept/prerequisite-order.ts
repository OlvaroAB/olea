/**
 * C7.10's named reader for the `prerequisite` relation type (`MOM-8.2`,
 * `ol-3ux7.5.57.9.2`).
 *
 * C7.10, verbatim on this type: **"prerequisite — feeds queue ordering and
 * failure diagnosis: what should be solid before this is attempted."** The
 * knowledge model's §5 says the same and R8 makes it binding — *a relation
 * type is emitted only with a named reader*. The corpus stage
 * (`./corpus-relations/batch.js`) has produced `prerequisite` edges from a
 * real production trigger since `[EXT-11]`, and `deriveRelationSet` folded
 * them; **nothing read them**, which is exactly what
 * `../checks/relation-reader-health.js`'s `checkRelationReaderFires` was red
 * on. This module is the queue-ordering half of that clause, built as the
 * smallest read that changes an order the student actually meets.
 *
 * ## Where it applies, and why that placement is the whole safety argument
 *
 * `[D-113]` ratified **`overdue-first`** as the ordering rule: "a single
 * total order on days waiting, defined for every obligation class, zero free
 * parameters". A prerequisite ordering that could promote an item past a
 * genuinely more-overdue one would be a second policy competing with that,
 * and would need a ruling. So this ordering is applied **only inside an exact
 * tie band** — items identically overdue by the same whole calendar day count
 * — where overdue-first is already indifferent between them and F2.19's
 * grouping is likewise permitted to reorder (`../queue/block-order.js`'s own
 * module doc states that constraint for the identical reason). Overdue-first
 * primacy therefore stays structurally unoverridable rather than merely
 * unexercised, and this module introduces **no constant of any kind** —
 * declared or derived — because the edge itself carries the whole decision.
 *
 * ## Direction is read canonically, never guessed
 *
 * `ol-2zfj.17`'s canonical reading, pinned on `./relation.js`'s
 * `ProposedRelation`/`ConceptRelation`: for a directed type, `from` is the
 * subtype / part / **prerequisite** and `to` is the supertype / whole /
 * **dependent**. So an edge `{ type: 'prerequisite', from: X, to: Y }` reads
 * *X should be solid before Y is attempted*, and this module orders X before
 * Y. An inverted producer would order the pair backwards, which is precisely
 * why `checkRelationReaderFires` grades `directionCorrect` independently of
 * `readerFired`.
 *
 * ## Reuse, not reinvention
 *
 * The name→`conceptKey` join is the same
 * `new Map(concepts.map((c) => [c.name, c.key]))` construction
 * `./related-concept-keys.js` performs for the identical
 * names-are-the-only-join-value situation, with the same exact-match-only
 * posture: an endpoint whose name matches no known concept is **dropped and
 * counted**, never guessed at and never used to mint a concept (R8's
 * reconciliation rule — the concept set is authoritative).
 *
 * Pure: no I/O, no clock, no identity minting, no persistence.
 */

import type { ConceptRelation } from './relation.js';
import type { ConceptRecord } from './types.js';

/** {@link resolvePrerequisiteConceptKeys}'s result: the adjacency map plus the honest miss count. */
export interface PrerequisiteConceptKeysResolution {
  /**
   * `conceptKey` of the **dependent** → the set of `conceptKey`s that should
   * be solid before it. Keyed on the dependent because that is the direction
   * an orderer asks in: *given this item, what must come first?*
   */
  readonly prerequisiteConceptKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Count of relation ENDPOINTS (not edges) whose name did not exact-match
   * any known concept — up to two per `prerequisite` edge, one per side. An
   * edge with either endpoint unresolved is dropped entirely; this is the
   * honest count of what got dropped, so a test can assert on the miss rate
   * rather than have it disappear silently. Same field, same reasoning, as
   * `./related-concept-keys.js`'s.
   */
  readonly unresolvedEndpointCount: number;
}

/**
 * Resolve the `prerequisite` edges of a post-fold edge list (typically
 * `./relation.js`'s `servedRelations` output) into the `conceptKey`-keyed
 * map {@link orderByPrerequisite} reads. Edge types other than
 * `prerequisite` are **ignored rather than rejected**, so a caller holding a
 * whole `RelationSet`'s served edges may pass them straight through — the
 * same posture `../session/build.js`'s `relations` input already documents.
 */
export function resolvePrerequisiteConceptKeys(
  relations: readonly ConceptRelation[],
  concepts: readonly ConceptRecord[],
): PrerequisiteConceptKeysResolution {
  const keyByName = new Map(concepts.map((concept) => [concept.name, concept.key]));
  const adjacency = new Map<string, Set<string>>();
  let unresolvedEndpointCount = 0;

  for (const relation of relations) {
    if (relation.type !== 'prerequisite') continue;
    const fromKey = keyByName.get(relation.from);
    const toKey = keyByName.get(relation.to);
    if (fromKey === undefined) unresolvedEndpointCount += 1;
    if (toKey === undefined) unresolvedEndpointCount += 1;
    if (fromKey === undefined || toKey === undefined) continue;
    if (fromKey === toKey) continue; // a self-prerequisite cannot order anything; defensive
    const existing = adjacency.get(toKey);
    if (existing === undefined) adjacency.set(toKey, new Set([fromKey]));
    else existing.add(fromKey);
  }

  return { prerequisiteConceptKeys: adjacency, unresolvedEndpointCount };
}

/**
 * Reorder `entries` so that, wherever one entry's concept is a prerequisite
 * of another's, the prerequisite is met first — **stably**, and only within
 * whatever set the caller hands over (the caller is responsible for that set
 * being an exact overdue tie band; see the module doc).
 *
 * Stable Kahn: at every step the earliest still-eligible entry in the
 * INCOMING order is taken, so an entry with no prerequisite relationship at
 * all never moves relative to its neighbours and an empty map is a
 * byte-for-byte no-op. A cycle — which a model-proposed edge set can
 * perfectly well contain — leaves its members in incoming order rather than
 * throwing or dropping them: the ordering is a preference the material
 * offered, never a constraint the queue is entitled to fail on.
 *
 * `keyOf` may return the same key for two entries (two instruments for one
 * concept, R1/R2); such entries are unordered with respect to each other and
 * keep incoming order.
 */
export function orderByPrerequisite<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  prerequisiteConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): readonly T[] {
  if (prerequisiteConceptKeys === undefined || prerequisiteConceptKeys.size === 0) return entries;
  if (entries.length <= 1) return entries;

  const present = new Set(entries.map(keyOf));
  // Blocker count per ENTRY index: how many entries ahead of it in the
  // prerequisite relation are still unemitted.
  const blockedBy: Set<number>[] = entries.map(() => new Set<number>());
  let anyEdge = false;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const dependentKey = keyOf(entry);
    const prerequisites = prerequisiteConceptKeys.get(dependentKey);
    if (prerequisites === undefined) continue;
    for (const prerequisiteKey of prerequisites) {
      if (prerequisiteKey === dependentKey || !present.has(prerequisiteKey)) continue;
      for (let j = 0; j < entries.length; j += 1) {
        const other = entries[j];
        if (other === undefined || j === i || keyOf(other) !== prerequisiteKey) continue;
        blockedBy[i]?.add(j);
        anyEdge = true;
      }
    }
  }
  if (!anyEdge) return entries;

  const emitted: T[] = [];
  const done = new Set<number>();
  while (emitted.length < entries.length) {
    let picked = -1;
    for (let i = 0; i < entries.length; i += 1) {
      if (done.has(i)) continue;
      const blockers = blockedBy[i];
      if (blockers === undefined) continue;
      let clear = true;
      for (const b of blockers) {
        if (!done.has(b)) {
          clear = false;
          break;
        }
      }
      if (clear) {
        picked = i;
        break;
      }
    }
    if (picked === -1) {
      // A cycle: emit every remaining entry in incoming order, unchanged.
      for (let i = 0; i < entries.length; i += 1) {
        if (done.has(i)) continue;
        const entry = entries[i];
        if (entry !== undefined) emitted.push(entry);
        done.add(i);
      }
      break;
    }
    const entry = entries[picked];
    if (entry !== undefined) emitted.push(entry);
    done.add(picked);
  }

  return emitted;
}
