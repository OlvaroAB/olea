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
 * **The legacy read path (`ol-2zfj.155`).** The interim identity-space caveat below stops short
 * of naming how a caller-side migration to `[D-088]`'s opaque key should be read once it starts
 * happening gradually (some records stamped under the old, name-keyed scheme, some under the
 * new one, in the same batch; nothing forces an atomic cutover). Trying both schemes without
 * telling them apart risks the specific failure `components-group1.md:1842` (private
 * `olea-service` repo) names: a legacy name-keyed record read as if it had always used the
 * opaque key is a semantic migration, not a lookup. This reader classifies every id it resolves
 * (`../../misconception/types.js`'s `classifyMisconceptionConceptIdScheme`) before choosing a
 * lookup space: `'legacy-name'` resolves through the name/alias index this file has always used;
 * `'opaque-key'` resolves through `ConfusionPairingConcept.key` instead, when a caller supplies
 * one. Either miss is reported, split by scheme
 * (`ConfusionPairingResult.legacyUnresolvedRecords`/`.opaqueKeyUnresolvedRecords`), never merged
 * into one undifferentiated bucket and never silently reinterpreted as the other scheme.
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
  /**
   * `[D-088]`'s opaque concept key, when the caller has one (`ol-bo48`'s `mintOpaqueConceptKey`
   * output, or the sidecar it persists). `null`/`undefined` while a caller has not wired the key
   * store through to this reader yet — today's only production caller does not
   * (`packages/plugin/src/main.ts`'s `corroborateConfusionPairings` call site passes
   * `name`/`aliases` alone). Optional, not required: widening this field must never force every
   * existing construction site to change (see this module's top doc, "the legacy read path").
   * This reader's own edge join still keys on `name`, unchanged — `key` is consulted only to
   * resolve an `'opaque-key'`-scheme `MisconceptionRecord` id back to a concept.
   */
  readonly key?: string | null;
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
   * Of `evidenceBearingRecords`, how many failed resolution on EITHER endpoint (`conceptId` or
   * `confusedWithConceptId` not found in the lookup space its own scheme selects — see this
   * module's top doc, "the legacy read path"). Always
   * `legacyUnresolvedRecords + opaqueKeyUnresolvedRecords`.
   */
  readonly unresolvedRecords: number;
  /**
   * Of `unresolvedRecords`, how many had at least one endpoint classified `'legacy-name'`
   * (`../../misconception/types.js`'s `classifyMisconceptionConceptIdScheme`) that found no
   * match in the name/alias index — an unmappable legacy record, the case this bead's read path
   * exists to make explicit rather than lump into a single undifferentiated count. Optional only
   * so a hand-built `ConfusionPairingResult` fixture predating this field still type-checks
   * (`corroborateConfusionPairs` itself always sets it); a real result always carries a number.
   */
  readonly legacyUnresolvedRecords?: number;
  /**
   * Of `unresolvedRecords`, the remainder: both endpoints classified `'opaque-key'` but at least
   * one found no match in any concept's `key` — expected until a caller wires the key store
   * through to `ConfusionPairingConcept.key`, and distinguished from `legacyUnresolvedRecords`
   * so that eventual wiring is verifiable rather than indistinguishable from ordinary legacy
   * misses. Optional for the same fixture-compatibility reason as `legacyUnresolvedRecords`.
   */
  readonly opaqueKeyUnresolvedRecords?: number;
  /** `MisconceptionRecord`s handed in with a non-null `confusedWithConceptId` — the denominator `unresolvedRecords` is checked against. */
  readonly evidenceBearingRecords: number;
}
