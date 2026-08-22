/**
 * The concept → instrument lookup (F4.6; P5-T06b, `ol-p5t06b`).
 *
 * **Why this did not exist before.** Every consumer of
 * `enumerateVaultInstruments` so far has wanted the records *in vault order*:
 * `composeQueue` walks them all and sorts by due instant, `today/panel.ts`
 * counts them, `gap/build.ts` only ever wants how MANY a note holds
 * (`buildMaterialPresence`'s count map). The session builder is the first
 * caller to ask the other question — *"give me the instruments that practise
 * THIS concept"* — and `VaultInstrumentEnumeration` returns a flat list, so
 * without an index that question is a linear scan per gap row.
 *
 * **One instrument, every concept its note names.** `VaultInstrumentRecord.
 * conceptIds` is a list because `ol-t3sd` removed D-031's narrowing: an
 * instrument is evidence for every concept its note names, and nothing is
 * attributed away from anything. So a record is filed under each of its
 * `conceptIds`, and looking up either concept finds it. The *session* still
 * offers it once — that is {@link buildStudySession}'s job (the same shape
 * F2.17's dedupe has), not this index's, because "which concepts does this
 * practise" and "how many times should she see it" are different questions
 * and collapsing them here would hide the second one.
 *
 * **Concept ids are concept names.** `session/enumerate.ts` sets
 * `conceptIds = ordered.map((concept) => concept.name)`, and `gap/build.ts`
 * keys its rows on `ConceptPriority.conceptName`. So a `GapRow.conceptName`
 * joins this index directly, with no mapping layer and no case folding —
 * R1/R2's verbatim rule applies here exactly as it does upstream, and a
 * lookup that "helpfully" normalised case would be the fuzzy matching this
 * pipeline refuses everywhere else.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock, nothing
 * stored — an in-memory reshaping of records the caller already holds.
 */

import type { VaultInstrumentRecord } from '../session/types.js';

/**
 * A read-only view of "which instruments practise this concept", built once
 * and queried per gap row.
 *
 * An interface rather than a bare `ReadonlyMap` because the empty answer is
 * load-bearing: {@link ConceptInstrumentIndex.instrumentsFor} returns `[]` for
 * an unknown concept, never `undefined`, so a caller cannot accidentally
 * distinguish "no cards" from "concept not in the index" — on this surface
 * they are the same fact (F4.5's coverage gap), and a nullable return would
 * invite two code paths where there is one answer.
 */
export interface ConceptInstrumentIndex {
  /** Every concept id with at least one instrument, sorted — the index's own universe, inspectable rather than inferred. */
  readonly concepts: readonly string[];
  /** How many distinct instrument records went in. Not the sum of the per-concept lists: a record naming two concepts is counted once here and appears twice there. */
  readonly recordCount: number;
  /** The instruments practising `conceptId`, in the caller's own record order (vault order, then source order within a note). Empty for anything unknown. */
  instrumentsFor(conceptId: string): readonly VaultInstrumentRecord[];
}

const NO_INSTRUMENTS: readonly VaultInstrumentRecord[] = Object.freeze([]);

/**
 * Index `records` by concept id.
 *
 * Input order is preserved inside every bucket, deliberately:
 * `enumerateVaultInstruments` returns vault order then source order within a
 * note, and its own doc calls that "the tiebreaker a never-reviewed corpus is
 * composed in". The session builder inherits that tiebreak rather than
 * inventing a second one, so two runs over the same vault build the same
 * session.
 */
export function buildConceptInstrumentIndex(
  records: readonly VaultInstrumentRecord[],
): ConceptInstrumentIndex {
  const byConcept = new Map<string, VaultInstrumentRecord[]>();
  const seenIds = new Set<string>();

  for (const record of records) {
    seenIds.add(record.instrumentId);
    for (const conceptId of record.conceptIds) {
      const bucket = byConcept.get(conceptId);
      // A note that names the same `topic:` twice would otherwise file the
      // instrument under it twice; `enumerate.ts` already de-duplicates
      // `ordered`, so this is belt-and-braces rather than a known case.
      if (bucket === undefined) byConcept.set(conceptId, [record]);
      else if (!bucket.includes(record)) bucket.push(record);
    }
  }

  const concepts = [...byConcept.keys()].sort();

  return {
    concepts,
    recordCount: seenIds.size,
    instrumentsFor(conceptId: string): readonly VaultInstrumentRecord[] {
      return byConcept.get(conceptId) ?? NO_INSTRUMENTS;
    },
  };
}
