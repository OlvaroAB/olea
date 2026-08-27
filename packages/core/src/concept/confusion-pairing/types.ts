/**
 * Shared shapes for the confusion-pairing corroboration reader
 * (`ol-2zfj.20`, from the scoping memo at
 * `docs/direction/papers/confusion-pairing-home/PROPOSAL.md` §3 option 1 in
 * `olea-service`).
 *
 * **What this reader is.** The knowledge model (§5) and functional scope
 * (C7.10) both say a `contrasts-with` edge (a model's *hypothesis* that two
 * concepts are confusable) and a misconception record's
 * `confusedWithConceptId` (*evidence* she was actually confused,
 * `../../misconception/types.js`) "should be able to confirm each other" —
 * "an edge that repeatedly produces real confusions is strong where one
 * that never does is noise worth retiring." Nothing in the codebase read
 * both shapes together before this module. This is that reader: a pure
 * corroboration score per `contrasts-with` edge, over `RelationSet`
 * (`../relation.js`) and the misconception projection's
 * `MisconceptionRecord[]` (`../../misconception/project.js`).
 *
 * **What this reader is NOT.** It never mints a new `contrasts-with` edge
 * from misconception evidence alone — that would bypass `[D-082]`'s
 * combined-passage verdict rule, the same discipline
 * `../corpus-relations/nominate.js` already enforces for every nomination
 * signal (cheap signals nominate; the material decides). A pair with real,
 * repeated misconception evidence but no existing edge is counted
 * (`ConfusionPairingResult.unmatchedMisconceptionPairs`), never promoted to
 * one here — the `assessment-error-adjacency` nomination signal
 * (`../corpus-relations/types.js`'s `NominationSignalKind`, `ol-2zfj.19`) is
 * the legitimate path from that count to a real edge, via a verdict call.
 * It also holds no state and does no I/O: same inputs, same output.
 *
 * **No persistence, no student surface.** Nothing here is a Class C
 * concern: both inputs are already-computed, in-memory, transient-batch
 * shapes (the same "posted and forgotten" posture the corpus stage itself
 * uses), and this reader adds no new one. Whether — and how — a
 * corroboration verdict is ever shown to her is the open, human-held
 * decision at `ol-2zfj.21`; until it closes, this reader has no caller and
 * yields data nobody renders (`[D-072]` clause 5's named exception).
 *
 * **Identity-space convention, restated from `packages/plugin/src/concept/
 * corpusRelationSignals.ts`'s `AssessmentErrorAdjacencyOptions` doc, because
 * this reader inherits the identical risk.** `MisconceptionRecord.conceptId`/
 * `.confusedWithConceptId` are plain `string`, with no identity-space
 * documented on the misconception module itself and no production caller
 * populating them from `[D-088]`'s opaque `ConceptRecord.key` today. This
 * reader resolves both against `ConfusionPairingConcept`'s `name`/`aliases`
 * space — the SAME interim identity `her-link`, `assessment-cooccurrence`
 * and `assessment-error-adjacency` already key on, and that `../relation.js`
 * itself documents as the fold's deliberate interim choice ("`from`/`to` are
 * NAMES... because C7.11 rules identity is an opaque key never derived from
 * content, but the opaque-key registry does not exist yet"). **If a future
 * misconception-store caller starts stamping `conceptId` with that opaque
 * key instead of a name, this reader's resolution does not mismatch
 * silently — it silently stops matching anything at all** (every id looks
 * unrecognised), which is exactly why `unresolvedRecords` and
 * `evidenceBearingRecords` are both reported rather than only a merged
 * count: a caller wiring a real misconception store for the first time
 * should verify `unresolvedRecords` is not permanently equal to
 * `evidenceBearingRecords`. `./health.ts` makes that check concrete.
 */

import type { RelationSetEntry } from '../relation.js';

/**
 * What this reader needs to know about one concept to resolve a
 * `MisconceptionRecord`'s ids against the name-or-alias space
 * `RelationSet`'s edges are keyed on. Deliberately narrower than
 * `../corpus-relations/types.js`'s `CorpusConcept` — no `anchor` — because
 * this reader never touches passage provenance, only name/alias resolution.
 */
export interface ConfusionPairingConcept {
  /** Post-corroboration identity — matches `RelationSetEntry.edge.from`/`.to`. */
  readonly name: string;
  /** Every other wording seen for this concept, verbatim — matches `../corpus-relations/types.js`'s `CorpusConcept.aliases`. */
  readonly aliases: readonly string[];
}

/**
 * `'corroborated'` — at least one misconception record evidences this pair,
 * either direction, after name/alias resolution. `'uncorroborated'` — none
 * does, on the material handed to this run. Deliberately not itself an
 * action ("retire this edge"): the contract's "noise worth retiring"
 * language names a consequence, not a number, and inventing a repetition
 * threshold here would be exactly the "constant fitted to nothing" the
 * component register's declared-vs-derived rule warns against. A future
 * consumer (gated by `ol-2zfj.21`) decides what to do with the counts this
 * reader reports; this reader only reports them.
 */
export type ConfusionCorroborationStanding = 'corroborated' | 'uncorroborated';

/** One `contrasts-with` edge's corroboration verdict. */
export interface ConfusionPairCorroboration {
  /** `RelationSetEntry.key` for this edge — same fold identity, unchanged. */
  readonly key: string;
  /** `entry.edge.from`/`.to`, carried through verbatim (symmetric type — order is the fold's, not a claim about direction). */
  readonly a: string;
  readonly b: string;
  /** The folded entry itself — the winning attestation, its triage standing and every attestation that agreed, untouched by this reader. */
  readonly edge: RelationSetEntry;
  /** Distinct misconception records (post-M1 merge, `../../misconception/matcher.js`) evidencing this pair, either direction. */
  readonly misconceptionRecordCount: number;
  /** Sum of `MisconceptionRecord.occurrenceCount` across those records — every real grading-time occurrence, not merely how many distinct records exist. */
  readonly misconceptionOccurrenceCount: number;
  readonly standing: ConfusionCorroborationStanding;
}

/** One run's full output — see this module's top doc for what is and is not built here. */
export interface ConfusionPairingResult {
  /** One entry per `contrasts-with` edge the fold currently serves (`RelationSetEntry.evidence === 'current'` — the same abstention gate `servedRelations` enforces), sorted by `key`. */
  readonly entries: readonly ConfusionPairCorroboration[];
  /**
   * Misconception-evidenced pairs (both endpoints resolved to a known
   * concept name) that have no corresponding `contrasts-with` edge in the
   * `RelationSet` handed in. Counted, never turned into an edge here — see
   * this module's top doc.
   */
  readonly unmatchedMisconceptionPairs: number;
  /**
   * Of `evidenceBearingRecords`, how many failed name/alias resolution on
   * EITHER endpoint (`conceptId` or `confusedWithConceptId` not found among
   * any concept's name/aliases). See this module's top doc — the identity-
   * space caveat this count exists to make checkable.
   */
  readonly unresolvedRecords: number;
  /** `MisconceptionRecord`s handed in with a non-null `confusedWithConceptId` — the denominator `unresolvedRecords` is checked against. */
  readonly evidenceBearingRecords: number;
}
