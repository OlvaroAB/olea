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
 *   queue ordering and failure diagnosis), but emitting them requires the
 *   corpus-level stage — candidate nomination plus a combined-passage
 *   verdict — which is a **separate, not-yet-built** piece of machinery
 *   (`[EXT-5]`, `ol-2zfj.7`). Defined here; **not emitted** until that stage
 *   exists. This module does not build it, and does not pretend to.
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
 * - `'blocked-on-corpus-stage'` — reader exists, but only the (unbuilt)
 *   corpus-level stage can produce it; defined, not emitted, until `[EXT-5]`
 *   lands.
 * - `'blocked-on-deferred-reader'` — reader exists and is named, but the
 *   reader itself is a deferred post-v0.9 instrument; defined, not emitted,
 *   until that instrument ships.
 * - `'no-reader'` — defined, not emitted, and not tracked toward emission by
 *   any bead — emitting it is a decision, not an implementation detail
 *   (`ol-m81u`).
 */
export type RelationEmissionStatus =
  | 'emitted'
  | 'blocked-on-corpus-stage'
  | 'blocked-on-deferred-reader'
  | 'no-reader';

export const RELATION_EMISSION_STATUS: Readonly<Record<RelationType, RelationEmissionStatus>> =
  Object.freeze({
    'is-a': 'emitted',
    'part-of': 'emitted',
    'contrasts-with': 'blocked-on-corpus-stage',
    prerequisite: 'blocked-on-corpus-stage',
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
 */
export interface ProposedRelation {
  readonly type: RelationType;
  readonly from: string;
  readonly to: string;
  readonly confidence: number;
}

/**
 * Who vouches for an edge (C7.10, `[D-070]`). An edge she authored — a link
 * between two of her own concept notes — is strong evidence; one a model
 * proposed from adjacency in the material is not, and **only the first
 * reaches triage as an assertion.** Nothing in this codebase mints `'hers'`
 * yet — every edge this module's readers produce today comes from the
 * per-document model read, so it is always `'model-proposed'`. The literal
 * exists so the type is correct for the day a wikilink-derived source is
 * built, rather than needing a breaking change then.
 */
export type RelationProvenanceKind = 'hers' | 'model-proposed';

/**
 * One relation edge after reconciliation (`./reconcile.js`) — the shape a
 * consumer (`./size.js` today; the misconception store and queue ordering
 * once `[EXT-5]` lands) actually reads.
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
  /** Concept names, matching `ReadConcept.name` post-corroboration. */
  readonly from: string;
  readonly to: string;
  readonly provenance: RelationProvenanceKind;
  readonly confidence: number;
  readonly introducingPassages: {
    readonly from: Provenance;
    readonly to: Provenance;
  };
}
