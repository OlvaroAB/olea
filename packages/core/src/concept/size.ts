/**
 * Concept size — how much of her material grounds a concept (`[D-066]`,
 * `docs/Olea_component_register.md` row 1.3, F8.1, F8.3, F2.17, C7.9).
 *
 * **The ruling this implements.** `[D-066]` withdrew the earlier proposal to
 * read grain off her Zettelkasten link structure — it assumed a vault shape
 * most students will not have, the same defect the whole reading-stage
 * cluster exists to fix. The ruling instead: size is worked out **from the
 * material**, backed up by her own structure where she keeps one, and never
 * required from her. That is exactly what this module does: it counts how
 * much of her material actually grounds a concept — how many of her notes
 * name it, and, where the reading stage tracked it, how many distinct
 * passages introduced or discussed it — and buckets that count. It never
 * asks for a Zettelkasten, a tag, or a particular folder shape to run.
 *
 * **What this module is NOT.** The component register's row 1.3 describes
 * the eventual full design: "initial sizing rides the model judgement
 * (service); structural refinement by counting children over returned edges
 * is deterministic (client)." Neither half of that exists yet — there is no
 * size judgement in `ConceptReaderPort`'s response (`./read.js`), and the
 * containment edges row 1.2 would refine over (`part-of`) are not built. So
 * this module is the **honest floor**: a deterministic, material-grounded
 * proxy that both named consumers can read today, not a stand-in for the
 * model judgement or the containment refinement once those land. Nothing
 * here calls a model, reads a vault, or does any I/O — pure, total,
 * INV-1-clean.
 *
 * **The asymmetry that sets the default (C7.9, this bead's notes).** Merging
 * two concepts later is cheap and lossless — grafting pools two evidence
 * histories and nothing is lost. Splitting is not: an offshoot must attribute
 * past evidence to a boundary that did not exist when the evidence was
 * collected, and no rule for that beats arbitrary. So wherever the material
 * signal is thin or ambiguous, this module's default is `'fine'`, never
 * `'coarse'` — the cheap correction (merging concepts a later signal shows
 * belong together) runs in one direction only.
 *
 * **The two named consumers** (`[D-066]`'s ruling, register row 1.3): honest
 * scope counting (a broad area and its own parts must not be counted as
 * separate peers against the examiner's denominator, F8.1/F8.3) and session
 * composition (a broad area and one of its parts must not be presented in
 * one sitting as though unrelated, F2.17). Both consumer files sit outside
 * this bead's ownership (`gap/`, `study-session/`) — see the module-level
 * integration notes recorded on `ol-b8wp`.
 */

import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * Two bands, matching `[D-066]`'s own vocabulary ("coarse and fine concepts
 * share one flat namespace") — this module does not invent a finer scale
 * than the ruling names. `'fine'` is also the default when the material
 * signal is thin (see the module doc's asymmetry note).
 */
export type ConceptSizeBand = 'fine' | 'coarse';

/**
 * The honest inputs behind a size band — never hidden inside the verdict, so
 * a consumer (or a test) can see exactly what was counted rather than trust a
 * label.
 */
export interface ConceptMaterialExtent {
  /** Distinct notes of hers that ground this concept — `ConceptRecord.sourcePaths`, or the union of that with passage-anchor notes for a `ReadConcept`. */
  readonly noteCount: number;
  /**
   * Distinct passages that introduced or discussed this concept, when the
   * source tracks that grain (`./read.js`'s `ReadConcept`, via `anchor` +
   * `alsoIn`). `undefined` for a source that only tracks whole-note
   * grounding (`./extract.js`'s `ConceptRecord`) — never `0` for "not
   * tracked", because `0` is itself a real, distinguishable measurement (an
   * un-anchored, convention-only concept the read never found in a passage).
   */
  readonly passageCount?: number;
  /**
   * Whether her own structure backs this concept as a distinct thing — a
   * concept note of her own (`boundNotePath` set, tier 1). Carried for
   * corroboration and for a consumer or later refinement to read; **the band
   * below never depends on it being present**, per the ruling's "never
   * required of it."
   */
  readonly structureCorroborated: boolean;
  /**
   * Whether an `is-a` or `part-of` edge (C7.10, `./relation.js`) names this
   * concept as the broader side — is-a's target (a kind-of is "evidence for
   * containment, not a substitute for it") or part-of's target (what it is
   * made of). This is the "structural refinement by counting children over
   * returned edges" the component register's row 1.3 describes, wired here
   * as the named reader `[REL-1]` requires (`./read.js`'s
   * `applyContainmentEvidence`). **Only ever pushes the band toward
   * `'coarse'`** (`deriveConceptSize` below), matching C7.9's merge-upward
   * asymmetry: an edge is new material evidence, so it can strengthen a
   * containment reading but never override the measured extent downward.
   * `undefined` (never `false`) for a source that carries no relation data
   * at all — the same "not tracked" vs "measured, found none" distinction
   * `passageCount` already draws.
   */
  readonly containmentEvidence?: boolean;
}

/** A concept's size: the band a consumer reads, plus the extent it was read from. */
export interface ConceptSize {
  readonly band: ConceptSizeBand;
  readonly extent: ConceptMaterialExtent;
}

/**
 * DECLARED (not derived — see `docs/Olea_component_register.md`'s
 * declared/derived rule), and this module's one number.
 *
 * **Plain-English defence.** A concept whose material lives in one or two
 * places — one note, or, at passage grain, one or two passages — has nothing
 * in her material to make it broader: there is no second location Olea could
 * point to as "the rest of it." Above that, breadth across more than a
 * couple of separately-authored notes or passages is itself the material
 * evidence a broader concept leaves behind, in the same spirit as the
 * explain-back test's own boundary (one thing coverable in two or three
 * minutes, which the bead's notes put at roughly 5-15 concepts per lecture,
 * not 50 and not 3 — a lecture with vastly more than a couple of locations
 * devoted to one name is the "not 3" side of that line).
 *
 * **What this is not.** The component register's row 1.3 calls a
 * size-bucket boundary a **derived** constant once the full design (model
 * judgement plus containment-edge refinement) exists, needing a corpus fit.
 * This number is not that — it is a conservative, declared, defensible floor
 * for the proxy this module actually ships today, and it is never tuned
 * against the real vault or against synthetic fixtures (`N-015`); the tests
 * in `size.spec.ts` fix its behaviour, they do not fit its value.
 */
export const COARSE_EXTENT_FLOOR = 2;

/**
 * The one piece of judgement in this module: extent in, band out. Pure and
 * total. `passageCount` is preferred over `noteCount` when the source tracks
 * it, because passage grain is the finer, more honest measurement of how
 * much material actually explains a concept — a concept cited from many
 * notes but explained in exactly one passage is not thereby broader.
 */
export function deriveConceptSize(extent: ConceptMaterialExtent): ConceptSize {
  const measure = extent.passageCount ?? extent.noteCount;
  const band: ConceptSizeBand =
    measure > COARSE_EXTENT_FLOOR || extent.containmentEvidence === true ? 'coarse' : 'fine';
  return { band, extent };
}

/**
 * What a `./extract.js` mint site has on hand for a record before
 * `boundNotePath` is known to be present — `VaultPath | undefined` rather
 * than `Pick<ConceptRecord, ...>`, because `ConceptRecord.boundNotePath` is
 * an optional property (`exactOptionalPropertyTypes`) and a call site with an
 * as-yet-unresolved binding has an explicit `undefined`, not an absent key.
 */
export interface ConceptRecordExtentInput {
  readonly sourcePaths: readonly VaultPath[];
  readonly boundNotePath: VaultPath | undefined;
}

/** The extent behind a `./extract.js` `ConceptRecord` — whole-note grounding only, no passage grain available. */
export function conceptRecordExtent(record: ConceptRecordExtentInput): ConceptMaterialExtent {
  return {
    noteCount: record.sourcePaths.length,
    structureCorroborated: record.boundNotePath !== undefined,
  };
}

/** Convenience: `deriveConceptSize(conceptRecordExtent(record))`, for `./extract.js`'s mint sites. */
export function conceptRecordSize(record: ConceptRecordExtentInput): ConceptSize {
  return deriveConceptSize(conceptRecordExtent(record));
}

/** The shape `./read.js`'s `ReadConcept` construction sites have on hand, before the type itself exists as an import target. */
export interface ReadConceptExtentInput {
  readonly anchor: Provenance | undefined;
  readonly alsoIn: readonly Provenance[];
  readonly sourcePaths: readonly VaultPath[];
  readonly boundNotePath?: VaultPath;
  /** See `ConceptMaterialExtent.containmentEvidence`. Absent when the caller carries no relation data. */
  readonly containmentEvidence?: boolean;
}

/**
 * The extent behind a `./read.js` `ReadConcept` — passage grain, from
 * `anchor` plus `alsoIn`, unioned with any notes her `topic` property named
 * it from (`sourcePaths`) so a concept corroborated by her filing is not
 * under-counted just because the reader anchored it once.
 */
export function readConceptExtent(concept: ReadConceptExtentInput): ConceptMaterialExtent {
  const passageCount = (concept.anchor !== undefined ? 1 : 0) + concept.alsoIn.length;
  const notePaths = new Set<VaultPath>(concept.sourcePaths);
  if (concept.anchor !== undefined) notePaths.add(concept.anchor.sourcePath);
  for (const passage of concept.alsoIn) notePaths.add(passage.sourcePath);
  return {
    noteCount: notePaths.size,
    passageCount,
    structureCorroborated: concept.boundNotePath !== undefined,
    ...(concept.containmentEvidence !== undefined
      ? { containmentEvidence: concept.containmentEvidence }
      : {}),
  };
}

/** Convenience: `deriveConceptSize(readConceptExtent(concept))`, for `./read.js`'s mint sites. */
export function readConceptSize(concept: ReadConceptExtentInput): ConceptSize {
  return deriveConceptSize(readConceptExtent(concept));
}
