/**
 * The Outcome record type (`[ONT-R5]`, knowledge model §4, functional scope F4.1, component
 * register row 1.1b).
 *
 * **What an Outcome is, and why it is a separate node from Concept.** `[ONT-R5]` (2026-09-15)
 * ruled that learning objectives are no longer "sources with a role" — Outcome is its own node:
 * an **examiner-declared unit of scope**, coarser than a concept, the parent of the concepts
 * inferred from how it is taught and examined. F4.1's own words: "Outcome and Concept are
 * different entities, never the same node read at a coarser grain." An outcome the papers turn
 * into several concepts stays in the output as that Outcome parent, and each concept inferred
 * from how it is taught and examined is recorded as a child of it — never flattened into one more
 * concept, because that would present Olea's inference at the same confidence as the examiner's
 * own declaration (F4.1, `[D-247]`).
 *
 * **Confidence is asymmetric, by the same clause.** The parent (`label`, taken from the
 * objectives/assessment-brief material) is outcome-attested — the institution's own words. Each
 * child concept is Olea's inference, and is lower-confidence than its parent. This module does
 * not itself carry a confidence field (no component reads one yet — see the component register's
 * row 1.1b, "constants: none named yet"); the asymmetry lives in which text is stored where, not
 * in a numeric field this record adds unasked.
 *
 * **Persisted schema, Class C.** `docs/Olea_component_register.md` row 1.1b: "an Outcome record,
 * once shipped, is a persisted schema crossing per this register's own rule." This module ships
 * the field set a decision bead proposes for ratification (`ol-d37g` / `[D-253 / OUT-1]`) as the
 * reversible default: opaque id, course membership, source reference, label, the concept keys it
 * parents, and a D7.3 provenance/version stamp. Shipping ahead of ratification, rather than
 * waiting on it, mirrors the same "a stand-in beats no field" argument `../concept/concept-key.ts`
 * already made for `provisionalConceptKey`.
 *
 * **Vault storage, following `../concept/key-store.ts`'s already-ratified shape (`[D-174]`).**
 * `./store.ts` persists one small JSON file per Outcome under `.olea/outcomes/`, in Olea's own
 * directory — never in her authored notes (INV-6 Part one has no carve-out for a write into a
 * note she wrote, and this is not one: `.olea/` is Olea's own layer). `[ONT-R5]`'s own ruling on
 * the wider shape says the same thing generally: "typed records persisted as ordinary per-node
 * JSON records in her vault, projection only when read, never an index or a query engine."
 */

import type { VaultPath } from '../vault/types.js';

/** Bumped only on a breaking change to `OutcomeRecord`'s shape. */
export const OUTCOME_RECORD_SCHEMA_VERSION = 1;

/**
 * Where in her material the examiner's own declaration of this outcome was found — the
 * "source reference" the design brief names. Deliberately a fresh, local shape rather than an
 * import of `../misconception/types.ts`'s `SourceCitation` (a concurrently-owned lane) or
 * `../retrieval/types.ts`'s citation shape — the same isolation argument
 * `../misconception/types.ts`'s `MisconceptionEmbedder` doc already makes: this module needs the
 * shape, not a coupling to either module's own evolution.
 */
export interface OutcomeSourceReference {
  readonly path: VaultPath;
  readonly blockIndex: number;
}

/**
 * F8.5's "pruning is withdrawal, never deletion" pattern, applied to Outcome: retiring an
 * outcome never deletes its record (a concept that was inferred from it, and any review evidence
 * built on that concept, must keep something to point back at). `'retired'` is the withdrawn
 * state; nothing in this module ever removes a record file.
 */
export const OUTCOME_STATUSES = ['active', 'retired'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/**
 * D7.3: "Prompt and model version stamped on every generated artifact, so quality regressions
 * are traceable to a change." An Outcome is read from her material by a model call (component
 * register row 1.1b: "the material-reading judgement is a model call... service"), so it is a
 * generated artifact for this purpose exactly as a drafted instrument is.
 */
export interface OutcomeProvenance {
  readonly promptVersion: string;
  readonly modelVersion: string;
}

/**
 * The persisted read-model — the field set `[D-253 / OUT-1]` proposes, plus the
 * lifecycle/versioning fields every sibling sidecar record (`ConceptKeyRecord`,
 * `MisconceptionRecord`) already carries. See the module doc for the Class C argument and the
 * decision bead.
 */
export interface OutcomeRecord {
  /** Opaque, minted (`./store.ts`'s `mintOpaqueOutcomeId`) — never derived from her wording or the source path, the same C7.11-shaped argument `ol-bo48` makes for concept identity. */
  readonly id: string;
  /** M:N course membership, mirroring `ConceptRecord.courses` (knowledge model §5). Sorted by the writer, never by a reader. */
  readonly courses: readonly string[];
  /** Where the examiner's own declaration was found. */
  readonly source: OutcomeSourceReference;
  /** The examiner's own wording, verbatim — the outcome-attested text F4.1 requires confidence to attach to. */
  readonly label: string;
  /** The concept keys ([D-088] opaque identity) this outcome parents — the outcome→concept containment edge, 1:N, part-of style (component register row 1.1b). Order is attachment order, not significant. */
  readonly conceptKeys: readonly string[];
  readonly status: OutcomeStatus;
  readonly provenance: OutcomeProvenance;
  /** ISO date the outcome was first minted. Debugging only — not personal, no content. */
  readonly mintedAt: string;
  readonly schemaVersion: number;
}
