/**
 * Candidate nomination — the first of the corpus stage's three ruled things
 * (`[D-082]`, register row 1.2a).
 *
 * **Cheap signals nominate; the material decides.** This module never
 * proposes an edge, never assigns a type and never assigns a confidence —
 * it only decides which PAIRS are worth sending to `./verdict.js` at all,
 * because the pairwise space over a course's concept set is far too large
 * to read combined contexts for every pair.
 *
 * **Where the signals themselves come from is deliberately not this
 * module's problem.** Component register row 1.2a leaves "the exact split
 * of which nomination signals compute client-side versus arrive as raw
 * material for the service to score" as an open question. Computing
 * co-occurrence over assessment documents, embedding proximity over the
 * local vector cache, or scanning her notes for wikilinks between concept
 * pages are each real subsystems of their own (components 1.7, the
 * evidence tier-3 pass, the frontmatter wikilink reader) — this module
 * takes their output as plain `NominationSignal` data and stays agnostic
 * to how any of it was computed, which is also what keeps it a pure
 * function with no vault or network access of its own.
 *
 * **Scope discipline is enforced here, not left to the caller.** `[D-082]`:
 * "each run is scoped to new-concept × all-concepts, not full
 * recomputation." A pair where NEITHER side is in `newConcepts` is dropped
 * before it ever becomes a candidate — this is what keeps a batch run
 * bounded rather than re-reading the whole course's concept set every time.
 */

import type {
  CorpusConcept,
  CorpusRelationCandidate,
  NominationSignal,
  NominationSignalKind,
} from './types.js';

/**
 * A concept's own identity for pairing purposes — its opaque
 * `CorpusConcept.key` (`[D-088]`) when the caller supplied one, the `name`
 * only as a fallback for a keyless concept. `[ONT-R8]`'s opaque-key
 * identity ("keyed to a stable proposition identity ... rather than to two
 * names") is applied here for the same reason it is applied to disposition
 * identity: two distinct concepts can share one `name` (her real
 * cross-course "Glaze" in ceramics and in cooking, say), and only the key
 * tells them apart. A keyless concept has no other handle, so `name` is the
 * correct — and only — fallback for it (`ol-egov.141.89.4.16`).
 */
function identityOf(concept: CorpusConcept): string {
  return concept.key ?? concept.name;
}

/**
 * Every concept sharing a given `name`, keyed by that name. **More than one
 * entry per name is expected and load-bearing**: two distinct, differently-
 * keyed concepts can legitimately share a name, and a name-only index that
 * kept just the first-seen one would make every other same-named concept
 * permanently invisible to nomination — the exact defect dev scenario
 * REL-a09fac8ff10e5736 measured (`ol-egov.141.89.4.16`). Concepts are
 * deduplicated by {@link identityOf} on the way in, since `allConcepts` and
 * `newConcepts` are expected to overlap (the caller's "new-concept x
 * all-concepts" scope, this module's own doc above) and the same real
 * concept must not occupy two slots in its own name's bucket.
 */
function byName(concepts: readonly CorpusConcept[]): ReadonlyMap<string, readonly CorpusConcept[]> {
  const index = new Map<string, CorpusConcept[]>();
  const seen = new Set<string>();
  for (const concept of concepts) {
    const identity = identityOf(concept);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const bucket = index.get(concept.name);
    if (bucket === undefined) index.set(concept.name, [concept]);
    else bucket.push(concept);
  }
  return index;
}

function pairKey(a: string, b: string): string {
  // Unordered — `contrasts-with` is symmetric and `prerequisite`'s direction
  // is a verdict question, not a nomination one, so a pair nominated as
  // (A, B) and (B, A) by two different signals is one candidate, not two.
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * C7.10 / `[D-082]`: the corpus-level stage runs "over a course's concept
 * set" — D-082's close reason, verbatim: "the pairwise space over a course's
 * concept set is far too large to read combined contexts for every pair."
 * An edge may only ever connect two concepts that share at least one course
 * (`ol-x3qg`).
 *
 * `CorpusConcept.courses` being `undefined` on either side means the caller
 * has not threaded course data through yet (see that field's own doc) — this
 * stays permissive in that case, rather than silently dropping every
 * candidate a not-yet-updated caller nominates. Once both sides carry real
 * course data, a concept genuinely in no course (`courses: []`) shares
 * nothing with anyone, which is the correct read of "a course's concept
 * set": such a concept is in no course's set. A concept in more than one
 * course (her real cross-course bridging notes) nominates fine against
 * either course's other members — the overlap check, not a single-course
 * assignment, is what the ruling actually needs.
 */
function shareACourse(a: CorpusConcept, b: CorpusConcept): boolean {
  if (a.courses === undefined || b.courses === undefined) return true;
  return a.courses.some((course) => b.courses?.includes(course));
}

/**
 * Nominate candidate pairs for the corpus stage to verdict.
 *
 * @param newConcepts Concepts introduced since the corpus stage last ran —
 *   the "new-concept" half of the scope. Every returned candidate has at
 *   least one endpoint in this set.
 * @param allConcepts The course's full, current concept set (the
 *   "all-concepts" half) — used only to resolve the OTHER endpoint of a
 *   pair a signal names; a concept present here but absent from
 *   `newConcepts` never generates a candidate on its own.
 * @param signals Cheap-signal occurrences, from any source. `NominationSignal.a`/`.b`
 *   are concept names (that type's own doc) — every same-named concept is
 *   tried as a resolution of the name, and {@link identityOf} (key-first)
 *   decides self-pairs and candidate identity once resolved, so two
 *   distinct concepts sharing a name are never collapsed into each other. A
 *   pair backed by more than one signal kind is still one candidate,
 *   carrying every kind that nominated it.
 */
export function nominateCorpusRelationCandidates(
  newConcepts: readonly CorpusConcept[],
  allConcepts: readonly CorpusConcept[],
  signals: readonly NominationSignal[],
): readonly CorpusRelationCandidate[] {
  const newIdentities = new Set(newConcepts.map(identityOf));
  // `allConcepts` is the resolution index; `newConcepts` is folded in too so
  // a signal naming two NEW concepts (neither yet in what the caller passed
  // as "all") still resolves both sides.
  const byNameIndex = byName([...allConcepts, ...newConcepts]);

  const candidates = new Map<
    string,
    { a: CorpusConcept; b: CorpusConcept; signals: Set<string> }
  >();

  for (const signal of signals) {
    // A signal names two concepts by name, but the same name can resolve to
    // more than one real concept (`./byName`'s own doc) — try every
    // combination the two names could mean, rather than assuming whichever
    // same-named concept was seen first is the one the signal is about.
    const aOptions = byNameIndex.get(signal.a) ?? [];
    const bOptions = byNameIndex.get(signal.b) ?? [];

    for (const a of aOptions) {
      for (const b of bOptions) {
        // A self-pair is decided by IDENTITY (key-first), never by name —
        // two distinct, differently-keyed concepts sharing a name are not
        // the same concept, however the names alone read (`[ONT-R8]`). A
        // signal naming a concept this run doesn't recognise at all
        // resolves to no options at all, so this loop simply does not run
        // for it — there is no introducing passage to verdict against, so
        // surfacing it as a candidate would only be dropped downstream for
        // no reason to log.
        if (identityOf(a) === identityOf(b)) continue;
        // Scope discipline: at least one endpoint must be new. A signal
        // linking two concepts that were both already part of the corpus
        // before this run is exactly the full-recomputation case `[D-082]`
        // rules out.
        if (!newIdentities.has(identityOf(a)) && !newIdentities.has(identityOf(b))) continue;
        // Scope discipline, the other half: C7.10 / `[D-082]` — the corpus
        // stage runs over a course's concept set, so a pair spanning two
        // concepts that share no course is never a candidate.
        if (!shareACourse(a, b)) continue;

        const key = pairKey(identityOf(a), identityOf(b));
        const existing = candidates.get(key);
        if (existing === undefined) {
          candidates.set(key, { a, b, signals: new Set([signal.kind]) });
        } else {
          existing.signals.add(signal.kind);
        }
      }
    }
  }

  return [...candidates.values()]
    .map((c) => ({ a: c.a, b: c.b, signals: [...c.signals].sort() as NominationSignalKind[] }))
    .sort((x, y) => (x.a.name < y.a.name ? -1 : x.a.name > y.a.name ? 1 : 0));
}
