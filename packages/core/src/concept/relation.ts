/**
 * Concept-to-concept relation vocabulary — six types, ruled by `[D-070]` as
 * revised, contracted at C7.10 (`docs/Olea_alpha_functional_scope.md`) and
 * the knowledge model's relation section (§5), in the `olea-service` repo.
 *
 * **The governing test, and it is the whole shape of this module: no type
 * ships without a named reader; a type with none is defined but not
 * emitted.** That test is not uniform across the six, so this module states
 * each type's status explicitly rather than leaving it to be inferred from
 * which code paths happen to exist:
 *
 * - **`is-a`, `part-of`** — single-document facts (visible inside one
 *   passage), readers exist in v0.9 (`./size.js` — concept size, coverage
 *   and presentation grain), **emitted** by the per-document read stage
 *   (`./read.js`).
 * - **`contrasts-with`, `prerequisite`** — cross-document facts. Their
 *   readers exist in v0.9 (the misconception record's confusion pairing;
 *   queue ordering and failure diagnosis), and emitting them requires the
 *   corpus-level stage — candidate nomination plus a combined-passage
 *   verdict (`./corpus-relations/`, `[EXT-5]`/`ol-2zfj.7`). That stage is no
 *   longer unbuilt: `[EXT-11]`/`ol-kw4a` (`[D-118]`) landed a production
 *   port and wired a real caller on the existing ingestion-tick interval
 *   (2026-08-25) — see `RELATION_EMISSION_STATUS` below, `'emitted-via-
 *   corpus-stage'`. **Emitted is not the same claim as "a named reader
 *   fires on it"** — whether the misconception store's confusion pairing
 *   and queue ordering actually consume a produced edge yet is a separate,
 *   stricter question this module does not answer; `packages/core/src/
 *   checks/relation-reader-health.ts` is where that is checked, and as of
 *   2026-08-26 it reports these two types' edges are produced and folded
 *   but not yet read by anything production-reachable.
 * - **`causes` (causes / mechanism-of)** — a named reader exists
 *   (relationship elaboration, the deferred "how does X relate to Y"
 *   instrument, `[REL-3]` / `ol-2jod.14`) but the reader itself is deferred
 *   post-v0.9. A deferred named reader is still a named reader (knowledge
 *   model §5), so the type is defined now and **emitted only when that
 *   instrument ships.**
 * - **`related`** — no reader at all, deferred or otherwise (`ol-m81u`,
 *   ruled: park it). Defined and **never emitted** until one is named.
 *
 * **Structurally separate from lineage.** Offshoot, grafting and pruning
 * (F8.5, F8.6) describe one concept's history over time; the six types here
 * describe a standing relationship between two *different* concepts. They
 * never share a table or a vocabulary — this module defines nothing that a
 * lineage type could be confused with, and no lineage vocabulary is
 * imported here or should ever be.
 */

import type { Provenance } from '../extract/types.js';

/** The six ruled types, exactly. Nothing here is this module's to choose. */
export type RelationType =
  | 'is-a'
  | 'part-of'
  | 'contrasts-with'
  | 'prerequisite'
  | 'causes'
  | 'related';

/** Every ruled type, in the order C7.10 lists them. Frozen — the set is ruled, not extensible from here. */
export const RELATION_TYPES: readonly RelationType[] = Object.freeze([
  'is-a',
  'part-of',
  'contrasts-with',
  'prerequisite',
  'causes',
  'related',
]);

/**
 * `directed` types have a meaningful `from`/`to`; `contrasts-with` is the one
 * symmetric type (C7.10, knowledge model §5). `related`, though not emitted,
 * is symmetric too — relatedness has no direction to assert.
 */
export const RELATION_DIRECTEDNESS: Readonly<Record<RelationType, 'directed' | 'symmetric'>> =
  Object.freeze({
    'is-a': 'directed',
    'part-of': 'directed',
    'contrasts-with': 'symmetric',
    prerequisite: 'directed',
    causes: 'directed',
    related: 'symmetric',
  });

/**
 * Whether v0.9 emits data for a type, per the governing test — see this
 * module's doc for the argument behind each value. **Never read this table
 * as "which types exist"**: all six exist (are defined) regardless of this
 * column. It answers only "is there data on the wire today."
 *
 * - `'emitted'` — the per-document read stage emits it today.
 * - `'emitted-via-corpus-stage'` — the corpus-level stage
 *   (`./corpus-relations/`) emits it today, since `[EXT-11]`/`ol-kw4a`
 *   (`[D-118]`) wired a real production caller on 2026-08-25. Kept as a
 *   literal distinct from bare `'emitted'`, never collapsed into it, because
 *   `stageForRelationType` below and `./corpus-relations/types.js`'s
 *   `CORPUS_STAGE_EMITTABLE_TYPES` both derive "which types the corpus stage
 *   owns" from this exact value — the same single-source-of-truth
 *   discipline this module already uses for `PER_DOCUMENT_EMITTABLE_TYPES`.
 *   **This is a statement about whether data reaches the fold, not about
 *   whether a named downstream reader visibly reacts to it** — see this
 *   module's own top doc and `packages/core/src/checks/
 *   relation-reader-health.ts` for that stricter, separate question.
 * - `'blocked-on-deferred-reader'` — reader exists and is named, but the
 *   reader itself is a deferred post-v0.9 instrument; defined, not emitted,
 *   until that instrument ships.
 * - `'no-reader'` — defined, not emitted, and not tracked toward emission by
 *   any bead — emitting it is a decision, not an implementation detail
 *   (`ol-m81u`).
 */
export type RelationEmissionStatus =
  | 'emitted'
  | 'emitted-via-corpus-stage'
  | 'blocked-on-deferred-reader'
  | 'no-reader';

export const RELATION_EMISSION_STATUS: Readonly<Record<RelationType, RelationEmissionStatus>> =
  Object.freeze({
    'is-a': 'emitted',
    'part-of': 'emitted',
    'contrasts-with': 'emitted-via-corpus-stage',
    prerequisite: 'emitted-via-corpus-stage',
    causes: 'blocked-on-deferred-reader',
    related: 'no-reader',
  });

/**
 * The types the **per-document** read stage (`./read.js`) is structurally
 * eligible to emit — `is-a` and `part-of` only, because C7.10 draws the
 * two-stage split on exactly this line: those two are visible inside a
 * single document, and the other four either need cross-document context
 * (`contrasts-with`, `prerequisite`) or are withheld regardless
 * (`causes`, `related`). A relation of any other type reaching this stage —
 * from a reader response, however that came about — is not a per-document
 * fact and is dropped rather than emitted; see `./read.js`'s use of this
 * set and `./reconcile.js` for the unknown-concept half of that same
 * discipline.
 */
export const PER_DOCUMENT_EMITTABLE_TYPES: ReadonlySet<RelationType> = new Set(['is-a', 'part-of']);

/**
 * One relation edge, proposed by a `ConceptReaderPort` before reconciliation
 * (`./reconcile.js`) against the concepts the same read actually returned.
 *
 * **Names, not keys.** `from`/`to` name concepts the way `ProposedConcept`
 * does — verbatim wording as the reader wrote it, matched against the same
 * read's proposed concepts (name or alias) at reconciliation time. This
 * mirrors `ProposedConcept` deliberately: a relation is proposed in the same
 * unit of work as the concepts it connects, over the same passages, so it
 * carries no identity scheme of its own.
 *
 * **`confidence` is required, not defaulted.** Fabricating a number here
 * would be exactly the "constant fitted to nothing" the component register
 * warns against — this module declines to have an opinion; the reader
 * states it.
 *
 * **Canonical directed-endpoint reading** (`[D-070]`, C7.10, knowledge model
 * §5, `ol-2zfj.17`) — for a **directed** type (`RELATION_DIRECTEDNESS`),
 * `from`/`to` are not interchangeable and this is the canonical,
 * checked-by-code reading of each:
 *
 * - **`is-a`** — `from` is the subtype (the kind), `to` is the supertype
 *   (the kind-of it names). "X is-a Y" → `from: X, to: Y`.
 * - **`part-of`** — `from` is the part, `to` is the whole/container. "X
 *   part-of Y" → `from: X, to: Y`. `./read.js`'s `applyContainmentEvidence`
 *   is where this is load-bearing rather than merely descriptive: it folds
 *   containment evidence onto the concept named by **`to`**, never `from`
 *   — a swapped edge would silently mark the part coarse instead of the
 *   whole. `read.spec.ts` pins this with `part-of, from: 'Part', to:
 *   'Whole'` producing containment evidence on `'Whole'`, and the sibling
 *   is-a case alongside it.
 * - **`prerequisite`** — `from` is the prerequisite (must be solid before
 *   `to` is attempted), `to` is the dependent concept. Fixed by
 *   `./corpus-relations/verdict.js`'s `CorpusVerdict.direction`: `'a-to-b'`
 *   reads as "a is prerequisite to b" and reconciles to `from: a, to: b` —
 *   `verdict.spec.ts` pins a named canonical example.
 * - **`contrasts-with`, `related`** — symmetric; `from`/`to` carry no
 *   direction at all (`RELATION_DIRECTEDNESS`).
 * - **`causes`** — directed (subject causes/is-mechanism-of object, `from:
 *   subject, to: object`), but deferred: no reader mints one yet
 *   (`RELATION_EMISSION_STATUS.causes`), so this is stated for completeness
 *   rather than pinned by any running code today.
 */
export interface ProposedRelation {
  readonly type: RelationType;
  /** The narrower/earlier end of a directed type — see this interface's own doc for the canonical reading per type. */
  readonly from: string;
  /** The broader/later end of a directed type — see this interface's own doc for the canonical reading per type. */
  readonly to: string;
  readonly confidence: number;
}

/**
 * Who vouches for an edge (C7.10, `[D-070]`). An edge she authored — a link
 * between two of her own concept notes — is strong evidence; one a model
 * proposed from adjacency in the material is not, and **only the first
 * reaches triage as an assertion.**
 *
 * **Both literals are minted in production, and by different stages**
 * *(corrected — this doc previously said nothing mints `'hers'` yet, which
 * `ol-9qwy` made stale on 2026-08-25; that bead's close explicitly held the
 * refresh for this file's owning lane, `ol-2zfj.12`)*:
 *
 * - The **per-document** stage (`./read.js` via `./reconcile.js`) mints
 *   `'model-proposed'` for every edge it emits, with no path to `'hers'`. It
 *   reads one document's passages and has no view of her links at all.
 * - The **corpus** stage stamps `'hers'` whenever `'her-link'` was among a
 *   candidate's nomination signals (`./corpus-relations/verdict.js`,
 *   `ol-9qwy`): the expensive judgement — *these two ideas belong together* —
 *   is a link she authored. The relation TYPE stays model-inferred from the
 *   combined passages either way, so `[D-082]` is intact: provenance answers
 *   who vouches for the pair, type answers what the relation is, and neither
 *   implies the other.
 *
 * The practical consequence for anything reading this field: `'hers'` can
 * only ever appear on a **corpus-stage** type (`prerequisite`,
 * `contrasts-with`). An `is-a` or `part-of` edge is always
 * `'model-proposed'`, which is why `RelationTriageStanding` is not, and must
 * not become, a filter on what readers are served.
 */
export type RelationProvenanceKind = 'hers' | 'model-proposed';

/**
 * One relation edge after reconciliation (`./reconcile.js`) — the shape a
 * consumer (`./size.js` today; the misconception store and queue ordering
 * are the named future consumers of the corpus-stage types, `[EXT-5]`/
 * `ol-2zfj.7` — that stage itself landed and is wired to a production
 * caller as of 2026-08-25, `[EXT-11]`/`ol-kw4a`; whether either named
 * consumer actually reads a produced edge yet is tracked separately by
 * `packages/core/src/checks/relation-reader-health.ts`, not by this doc)
 * actually reads.
 *
 * **Provenance is at passage grain and names the introducing passages of
 * BOTH endpoints** (C7.10) — never a file path alone, because a path does
 * not put the passage that introduced a concept in front of anything that
 * later needs to check, re-grade or show it to her. `./reconcile.js` is
 * where this gets constructed, by reading each endpoint's own anchor off the
 * concept it resolved to — an edge whose endpoint has no anchor (a
 * filing-only concept the read never anchored to a passage) cannot carry
 * this and is dropped rather than emitted, the same "honestly un-anchored"
 * posture `./read.js`'s `ReadConcept.anchor` already documents.
 */
export interface ConceptRelation {
  readonly type: RelationType;
  /**
   * Concept names, matching `ReadConcept.name` post-corroboration. Same
   * canonical directed-endpoint reading as `ProposedRelation.from`/`.to`
   * (see that interface's own doc, `ol-2zfj.17`) — reconciliation
   * (`./reconcile.js`, `./corpus-relations/verdict.js`) carries `from`/`to`
   * straight through from the proposal without reordering them.
   */
  readonly from: string;
  readonly to: string;
  readonly provenance: RelationProvenanceKind;
  readonly confidence: number;
  readonly introducingPassages: {
    readonly from: Provenance;
    readonly to: Provenance;
  };
}

// ===========================================================================
// THE FOLD — where both stages' edges land (`ol-2zfj.12`)
// ===========================================================================
//
// Two producers now emit `ConceptRelation`s and neither owns the result: the
// per-document stage (`./read.js` via `./reconcile.js`) and the corpus-level
// stage (`./corpus-relations/batch.js`). Before this section both outputs
// were computed and dropped on the floor at the composition root.
//
// **This is a FOLD, not a store, and that is the whole design decision.**
// The full argument, the options weighed and the Class C line are in
// `olea-service/docs/dev/relation-landing-design.md`. The three load-bearing
// reasons, restated here because a reader meets the code first:
//
// 1. **Edges are a PROJECTION, not events.** The architecture boundary §1
//    rules the vault event log the truth and every knowledge state a local
//    projection recomputed from it. A model's reading of her material is not
//    something she did; it is a derivation over material the vault already
//    holds, rebuildable by re-running the read. Appending edges to the event
//    log would put a derivation where only her acts belong, and would make
//    INV-2's byte-identical round-trip carry model output. **Her verdicts on
//    edges are the events** — and those are `[D-097]`'s gate, which is not
//    built here.
// 2. **`from`/`to` are NAMES, and C7.11 rules identity is an opaque key
//    never derived from content (`[D-088]`).** Persisting name-keyed edges
//    today would bake into a persisted schema exactly the fragility C7.11
//    exists to prevent — a rename orphaning every edge. The fold holds names
//    because that is all either producer emits; a persisted home must hold
//    keys, and minting those is the crossing that needs a decision bead.
// 3. **Nothing persists concepts either.** A relations store ahead of a
//    concept registry is structure with nothing to attach to.
//
// So this section builds the merge, the dedupe, the provenance ranking and
// the two read-side gates — everything that is reversible — and stops at the
// seam. `deriveRelationSet` is pure: no I/O, no clock, no identity minting.

/**
 * Which of the two stages a type is emitted by, derived from
 * `RELATION_EMISSION_STATUS` rather than restated — the same discipline
 * `./corpus-relations/types.js`'s `CORPUS_STAGE_EMITTABLE_TYPES` already
 * uses, so a change to the emission table moves both together.
 *
 * `undefined` for a type no stage may emit today (`causes`, `related`). An
 * edge of such a type reaching the fold is a producer defect — both
 * reconcilers already refuse it — and is dropped and counted here rather
 * than trusted a second time over the same boundary.
 */
export type RelationStage = 'per-document' | 'corpus';

export function stageForRelationType(type: RelationType): RelationStage | undefined {
  if (PER_DOCUMENT_EMITTABLE_TYPES.has(type)) return 'per-document';
  if (RELATION_EMISSION_STATUS[type] === 'emitted-via-corpus-stage') return 'corpus';
  return undefined;
}

/**
 * How an edge arrives at triage (C7.10, knowledge model §5, R8, `[D-070]`):
 * *"An edge she authored — a link between two of her own concept notes — is
 * strong evidence; one a model proposed from adjacency in the material is
 * not. **Only the first reaches triage as an assertion; the second is a
 * candidate.**"*
 *
 * **This is a property of the TRIAGE surface, not of reader eligibility, and
 * conflating the two is the mistake this type exists to prevent.** The word
 * "candidate" is used three ways in the corpus and they are different facts:
 *
 * 1. `./corpus-relations/types.js`'s `CorpusRelationCandidate` — a nominated
 *    *pair*, before any verdict. Not an edge at all.
 * 2. **This type** — a minted edge's *standing* when it is shown to her:
 *    hers is presented as an assertion, a model's as a proposal awaiting
 *    corroboration, "never rendered identically"
 *    (`features/F1-sources.md`'s `relations-triage` scenario).
 * 3. `RelationEvidenceState` below — `[D-093]`'s degradation, where an edge
 *    whose cited passage moved abstains automatically.
 *
 * Reading (2) as (3) would silently switch off concept size's containment
 * evidence (`./size.js`), a reader C7.10 names by name: `is-a` and `part-of`
 * come only from the per-document stage, which has no path to `'hers'` at all
 * (see `RelationProvenanceKind`), so **every** edge size reads would be a
 * candidate and therefore unservable. It is (3), and only (3), that gates
 * what a reader is served.
 *
 * **No confidence FLOOR is applied here.** `[D-070]` rules provenance, not a
 * number; a numeric triage cutoff would be a derived constant (component
 * register's declared-versus-derived rule) and nobody has run that
 * derivation. This module declines to invent one.
 */
export type RelationTriageStanding = 'assertion' | 'candidate';

export const TRIAGE_STANDING_BY_PROVENANCE: Readonly<
  Record<RelationProvenanceKind, RelationTriageStanding>
> = Object.freeze({
  hers: 'assertion',
  'model-proposed': 'candidate',
});

/**
 * `[D-093]` / C7.10's edge staleness, as a field the fold carries and
 * **deliberately never sets.** An edge whose endpoint passage was
 * meaningfully changed or deleted degrades and abstains automatically,
 * because "candidates are never served"; it is re-verdicted at the next
 * batch pass.
 *
 * **`[CORP-3]` (`ol-2zfj.2`, component register row 1.4) owns that
 * lifecycle and this module does not build one line of it** — no hashing, no
 * materiality judgement, no re-verdict. What is built here is the *shape*
 * that lifecycle needs so it is not a breaking change later: the state lives
 * per entry, `servedRelations` enforces the abstention by construction
 * rather than asking every reader to remember, and each attestation keeps
 * its own `introducingPassages` so degradation can be decided per
 * attestation rather than per merged edge.
 */
export type RelationEvidenceState = 'current' | 'stale';

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The dedupe identity of an edge, respecting directedness: a directed type
 * keys on `(type, from, to)`; the symmetric types key on `(type, {a,b}
 * sorted)`, so the two producers emitting the same `contrasts-with` in
 * opposite orientations fold into one entry rather than two.
 *
 * **Keyed on NAMES, and that is a stated limitation rather than a choice.**
 * C7.11 rules a concept's identity is an opaque, immutable key never derived
 * from content (`[D-088]`) — precisely because name-as-identity makes every
 * rename an orphaning. Both producers emit post-corroboration *names*, so a
 * name key is all this fold can compute. It is sound for an in-memory fold
 * over one read, where every name in the set came from that same read. It is
 * **not** sound for a persisted home, which is the first reason
 * `relation-landing-design.md` stops at the seam.
 *
 * The `\u0000` separator is NUL, which cannot occur in a concept
 * name read out of markdown, so no pair of distinct edges can collide by
 * concatenation. A printable separator would not do — a name containing a
 * space, a slash or a colon is not hypothetical in a vault.
 *
 * **The key holds concept names, so it is an in-memory join value and never
 * a telemetry one** (D-005). No caller may log it.
 */
export function relationKey(relation: Pick<ConceptRelation, 'type' | 'from' | 'to'>): string {
  const endpoints =
    RELATION_DIRECTEDNESS[relation.type] === 'symmetric'
      ? [relation.from, relation.to].sort(byCodeUnit)
      : [relation.from, relation.to];
  return `${relation.type}\u0000${endpoints[0]}\u0000${endpoints[1]}`;
}

/** The same key with a directed edge's endpoints swapped — symmetric types return their own key. */
function reversedRelationKey(relation: Pick<ConceptRelation, 'type' | 'from' | 'to'>): string {
  return relationKey({ type: relation.type, from: relation.to, to: relation.from });
}

/** One folded edge: the winning attestation, its standing, and every attestation that agreed. */
export interface RelationSetEntry {
  /** `relationKey` of every attestation below — the entry's identity within one fold. */
  readonly key: string;
  readonly stage: RelationStage;
  /** The winning attestation — the one a reader is served. Always `attestations[0]`. */
  readonly edge: ConceptRelation;
  /** From `edge.provenance`, per `TRIAGE_STANDING_BY_PROVENANCE`. */
  readonly triageStanding: RelationTriageStanding;
  /** Always `'current'` from this module — see `RelationEvidenceState`. */
  readonly evidence: RelationEvidenceState;
  /**
   * Every attestation of this edge, best-first, **kept rather than
   * discarded**. Two stages independently reading the same relation out of
   * different passages is corroborating evidence, and each attestation
   * carries its own `introducingPassages`, which is what `[D-093]` needs to
   * degrade one attestation without discarding the edge.
   */
  readonly attestations: readonly ConceptRelation[];
}

/** The fold's result — entries plus the health counts a caller reports against (D-005: counts, never names). */
export interface RelationSet {
  /** Sorted by `key`, so a fold over the same inputs in any order is identical. */
  readonly entries: readonly RelationSetEntry[];
  /** How many attestations were folded into an existing entry rather than opening a new one. */
  readonly mergedDuplicates: number;
  /**
   * Directed pairs where both `A→B` and `B→A` of the same type survived —
   * a real contradiction (nothing is both a kind of and an instance of the
   * other), counted once per pair. **Reported, never resolved**: picking a
   * winner would be a judgement about her material this module has no
   * evidence for. It is component register row 1.2a's health check made
   * countable.
   */
  readonly contradictions: number;
  /** Edges of a type no stage may emit (`causes`, `related`) — a producer defect, dropped. */
  readonly droppedUnemittable: number;
}

/**
 * Rank two attestations of the same edge. Negative means `a` wins.
 *
 * **Provenance outranks confidence, and never the other way round**
 * (`[D-070]`): an edge she authored is strong evidence and a model's
 * self-reported number cannot outbid it. Within one provenance, higher
 * confidence wins; a genuine tie keeps the first seen, which makes the fold
 * order-stable given sorted input.
 *
 * **Confidences are never combined.** Two attestations at 0.6 do not make an
 * edge at 0.84, or 0.6, or anything else this module could defend in plain
 * English — any combination rule is a derived constant, and inventing one
 * here is exactly the "constant fitted to nothing" the component register
 * warns against. The winner's own confidence travels verbatim, and
 * `attestations` keeps the rest so a later derivation has the raw material.
 */
function rankAttestations(a: ConceptRelation, b: ConceptRelation): number {
  const aHers = a.provenance === 'hers' ? 0 : 1;
  const bHers = b.provenance === 'hers' ? 0 : 1;
  if (aHers !== bHers) return aHers - bHers;
  return b.confidence - a.confidence;
}

/**
 * Fold every producer's edges into one deduplicated, provenance-ranked set.
 *
 * Pure: same inputs, same output, no I/O and no identity minting. Call it
 * with the per-document read's `relations` and the corpus batch's
 * `relations` — in any order, and with any number of groups, since the stage
 * of each edge is derived from its own type rather than from which argument
 * it arrived in.
 */
export function deriveRelationSet(...groups: readonly (readonly ConceptRelation[])[]): RelationSet {
  const byKey = new Map<string, ConceptRelation[]>();
  const stageByKey = new Map<string, RelationStage>();
  let mergedDuplicates = 0;
  let droppedUnemittable = 0;

  for (const group of groups) {
    for (const edge of group) {
      const stage = stageForRelationType(edge.type);
      if (stage === undefined) {
        droppedUnemittable += 1;
        continue;
      }
      const key = relationKey(edge);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, [edge]);
        stageByKey.set(key, stage);
        continue;
      }
      existing.push(edge);
      mergedDuplicates += 1;
    }
  }

  // No early return on an empty map: a fold that dropped every edge as
  // unemittable is NOT the same measurement as a fold that was handed
  // nothing, and returning the shared empty set here would silently erase
  // `droppedUnemittable` — the one signal that says a producer emitted a type
  // no stage may emit.
  const entries: RelationSetEntry[] = [];
  for (const [key, attestations] of byKey) {
    const ranked = [...attestations].sort(rankAttestations);
    const edge = ranked[0];
    // Unreachable — a key exists only because an edge was pushed under it —
    // but `noUncheckedIndexedAccess` is on and a thrown-away assertion is
    // worse than a guard that can never fire.
    if (edge === undefined) continue;
    const stage = stageByKey.get(key);
    if (stage === undefined) continue;
    entries.push({
      key,
      stage,
      edge,
      triageStanding: TRIAGE_STANDING_BY_PROVENANCE[edge.provenance],
      evidence: 'current',
      attestations: ranked,
    });
  }
  entries.sort((a, b) => byCodeUnit(a.key, b.key));

  const keys = new Set(entries.map((entry) => entry.key));
  let contradictions = 0;
  for (const entry of entries) {
    if (RELATION_DIRECTEDNESS[entry.edge.type] === 'symmetric') continue;
    const reversed = reversedRelationKey(entry.edge);
    // Count each contradicting pair once, from whichever side sorts first.
    if (keys.has(reversed) && byCodeUnit(entry.key, reversed) < 0) contradictions += 1;
  }

  return { entries, mergedDuplicates, contradictions, droppedUnemittable };
}

/**
 * The edges a named reader (`./size.js` today; the misconception store and
 * queue ordering once their beads land) is served.
 *
 * **The abstention gate, enforced here rather than at every reader**
 * (`[D-093]`, C7.10): an edge whose evidence has gone stale is withheld —
 * "abstention is automatic, because candidates are never served". Today no
 * edge is ever `'stale'`, because `[CORP-3]` has not built the detection, so
 * this is presently an identity filter. It is written now so that switching
 * the lifecycle on is a change in one module rather than an audit of every
 * consumer that learned to read `entries` directly.
 *
 * **Triage standing is deliberately NOT filtered here** — see
 * `RelationTriageStanding`'s doc. A model-proposed edge is a candidate *at
 * triage*; it is still what concept size reads, and has been since
 * `[EXT-6]`.
 */
export function servedRelations(set: RelationSet): readonly ConceptRelation[] {
  return set.entries.filter((entry) => entry.evidence === 'current').map((entry) => entry.edge);
}

/**
 * The edges that would reach a triage surface **as assertions** — hers, not
 * a model's (`[D-070]`, and `features/F1-sources.md`'s scenario *"an edge she
 * authored reaches triage as an assertion; a model-proposed edge is a
 * candidate only"*, tagged `@auto:core/registry/relations-triage.spec`).
 *
 * **Nothing composes this to a surface, and nothing may.** No contract clause
 * names a concept-relation triage surface — C7.10 rules what triage *shows*,
 * never that a screen exists — and the standing rule *"no user-visible
 * affordance without a clause"* forbids a lane inventing one. This function
 * exists for the same reason `routing/instrument-mix.js`'s `routingReason`
 * does: so that the rule is a checkable value with its own test coverage
 * before a surface reaches for it, rather than being invented at the UI layer
 * against no source of truth on the day one is clauses.
 *
 * **It is not empty in production, which is what makes the missing clause a
 * live gap rather than a hypothetical one.** Since `ol-9qwy` the corpus stage
 * stamps `'hers'` on any edge her own wikilink helped nominate
 * (`./corpus-relations/verdict.js`), so a real vault with a linked card index
 * yields real assertions here — with nowhere ruled for them to go. The one
 * thing that follows from that is a decision bead, not a screen.
 */
export function assertionsForTriage(set: RelationSet): readonly RelationSetEntry[] {
  return set.entries.filter((entry) => entry.triageStanding === 'assertion');
}
