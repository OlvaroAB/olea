/**
 * The standing views' **population record** and **per-unit coverage**, as types
 * (`ol-egov.141.89.11.4`; the chain spec's sections 2.1 and 2.2; `[D-355]`, `[D-326]`).
 *
 * Every shape here is in memory and recomputed on every read. Nothing is stored:
 * the chain spec rules out a new persisted shape for this stage, and a
 * population is a projection over records other chains own (the examiner-scope
 * chain's declarations, the perception chain's completeness record, the concept
 * chain's concepts and instruments, the attainment reading).
 *
 * Inputs name their own states rather than importing each owner's shape, so this
 * module does not move when an owner's record does; `./readers.ts` turns the
 * production records that exist today into these inputs.
 */

/** How far a document or source was read, from `[D-326]`'s completeness record. */
export type PopulationReadingState =
  | 'complete'
  | 'partial'
  | 'unread'
  | 'unreadable'
  | 'read-empty';

/** One document's or source's reading, from its completeness record. */
export interface PopulationReading {
  readonly state: PopulationReadingState;
  /** For `partial`: how many of its units were read. Carried, never used to round up to complete. */
  readonly unitsRead?: number;
  readonly unitsTotal?: number;
}

/** Whether an extraction (declarations over an examiner document, or concepts over her material) finished. */
export type PopulationExtractionState = 'finished' | 'cut-short' | 'pending' | 'failed';

/**
 * A document registered for the course. `examiner` is true for the roles that
 * declare scope (objectives, an assessment brief, a past paper); a document
 * registered, or reclassified, into any other role is her course material.
 */
export interface PopulationDocumentInput {
  readonly documentId: string;
  readonly examiner: boolean;
  readonly revision: string | null;
  /** ISO calendar day of the revision, or `null` when unknown. */
  readonly revisionDate: string | null;
  /** `null` when no completeness record exists for it: read as unknown, never as complete. */
  readonly reading: PopulationReading | null;
  /** `null` when nothing records whether its declarations were extracted: read as unknown. */
  readonly declarationExtraction: PopulationExtractionState | null;
}

/** How a declared unit was matched to her concepts (the examiner-scope chain's alignment state). */
export type DeclarationAlignment = 'aligned' | 'not-aligned' | 'no-concept';

/** One active declaration: the examiner's declared unit, the counted unit (`[D-355]`). */
export interface PopulationDeclarationInput {
  readonly declarationId: string;
  /** The document that declared it; a declaration whose document is not an examiner document is not counted. */
  readonly documentId: string;
  readonly revision: string | null;
  readonly alignment: DeclarationAlignment;
  /** Concept keys aligned to the unit. Read only when `alignment` is `aligned`. */
  readonly conceptKeys: readonly string[];
}

/** One source of her course material. */
export interface PopulationSourceInput {
  readonly sourceId: string;
  readonly reading: PopulationReading | null;
}

/** One of her concepts in this course. */
export interface PopulationConceptInput {
  readonly conceptKey: string;
  /** The sources of her material it was read from (source or material-document ids). */
  readonly sourceIds: readonly string[];
  /** A withdrawn concept is kept out of every support set and every list (F8.5's withdrawal). */
  readonly withdrawn?: boolean;
}

/**
 * An instrument's standing under C5.8's removal rule. Only `eligible` counts as
 * practice available; the four removal states never do (`[D-330]`, `[D-347]`).
 */
export type PopulationInstrumentStanding =
  | 'eligible'
  | 'withdrawn'
  | 'suspended'
  | 'note-gone'
  | 'passage-changed';

export interface PopulationInstrumentInput {
  readonly instrumentId: string;
  readonly conceptKeys: readonly string[];
  readonly standing: PopulationInstrumentStanding;
}

/**
 * The attainment reading's answer for one concept: `assessed` when evidence that
 * stands now holds a scored attempt; `not-yet-assessed` when none does (never
 * weak). A concept the caller has no reading for reads not yet known.
 */
export type ConceptEvidenceState = 'assessed' | 'not-yet-assessed';

/** One processing pass that queued concepts for instrument building (a render is never a pass). */
export interface PopulationProcessingPass {
  readonly passId: string;
  readonly queuedConceptKeys: readonly string[];
}

/** Everything one course's population is formed from. */
export interface CoursePopulationInput {
  readonly courseId: string;
  /** `false` when the store of registered documents could not be read: nothing is formed from it. */
  readonly documentStoreReadable?: boolean;
  readonly documents: readonly PopulationDocumentInput[];
  readonly declarations: readonly PopulationDeclarationInput[];
  readonly sources: readonly PopulationSourceInput[];
  /** Concept extraction over her material for this course; `null` when nothing records it. */
  readonly conceptExtraction: PopulationExtractionState | null;
  readonly concepts: readonly PopulationConceptInput[];
  readonly instruments: readonly PopulationInstrumentInput[];
  /** Per concept key; a concept absent from the map reads not yet known on evidence. */
  readonly conceptEvidence: ReadonlyMap<string, ConceptEvidenceState>;
  /** Processing passes, where the caller has them; absent leaves `stuck` unformed (`null`), never empty. */
  readonly processingPasses?: readonly PopulationProcessingPass[];
}

/** What the course's count counts (the spec's 2.1). */
export type CountedUnit = 'declared-unit' | 'concept-labelled' | 'unknown';

/** The denominator's state. Only `known` carries a value; every other state has none, never zero. */
export type DenominatorState =
  | 'known'
  | 'not-declared'
  | 'not-yet-known'
  | 'partly-read'
  | 'could-not-read';

/** One document that supplied the denominator: its id, revision and revision day (the count's as-of). */
export interface DenominatorSource {
  readonly documentId: string;
  readonly revision: string | null;
  readonly revisionDate: string | null;
}

export interface PopulationDenominator {
  readonly state: DenominatorState;
  /** The number of declared units when `known`; `null` otherwise, never 0 for an unknown. */
  readonly value: number | null;
  readonly sources: readonly DenominatorSource[];
  /** The latest revision day among `sources`, or `null`. */
  readonly asOf: string | null;
}

/** A set of documents or sources summarised: one shared state, `mixed`, `unknown` (no record) or `none` (empty set). */
export type PopulationReadingSummary = PopulationReadingState | 'mixed' | 'unknown' | 'none';

/** An extraction summarised over a set: the least finished state, `unknown` (no record) or `none` (nothing to extract from). */
export type PopulationExtractionSummary = PopulationExtractionState | 'unknown' | 'none';

/** A unit's material dimension. `missing` (F4.10) only over material read in full with extraction finished. */
export type UnitMaterialState = 'read' | 'partly-read' | 'missing' | 'not-yet-known';

/** A unit's practice or evidence dimension over its whole support. Evidence `none` means not yet assessed, never weak. */
export type UnitSupportState = 'every' | 'some' | 'none' | 'not-yet-known';

/** One declared unit's coverage on its four dimensions, never collapsed. */
export interface DeclaredUnitCoverage {
  readonly declarationId: string;
  readonly documentId: string;
  readonly revision: string | null;
  /** The alignment as read: `aligned` with no live concept (every aligned concept withdrawn) reads `no-concept`. */
  readonly alignment: DeclarationAlignment;
  /** Concept keys supporting the unit, deduplicated and sorted: a broad concept and its part are one set. */
  readonly support: readonly string[];
  /** Always true: every declared unit is counted (`[D-355]`). */
  readonly counted: true;
  /** Always 1: a unit is one entry in the denominator however many concepts support it. */
  readonly entries: 1;
  readonly material: UnitMaterialState;
  readonly practice: UnitSupportState;
  readonly evidence: UnitSupportState;
}

/** Units per state on one dimension. */
export type UnitMaterialCounts = Readonly<Record<UnitMaterialState, number>>;
export type UnitSupportCounts = Readonly<Record<UnitSupportState, number>>;

export interface PopulationCounts {
  readonly material: UnitMaterialCounts;
  readonly practice: UnitSupportCounts;
  readonly evidence: UnitSupportCounts;
}

/** Why the exhaustive claim is withheld; every reason that holds is listed. */
export type ExhaustiveWithholdReason =
  | 'document-store-unreadable'
  | 'no-declared-unit'
  | 'unit-not-aligned'
  | 'examiner-document-not-read-in-full'
  | 'declaration-extraction-unfinished'
  | 'material-not-read-in-full'
  | 'concept-extraction-unfinished';

/** One course's population record and per-unit coverage. */
export interface CoursePopulation {
  readonly courseId: string;
  readonly countedUnit: CountedUnit;
  /** True exactly when the count is Olea's own concept reading, which must carry its label (`[D-151]`). */
  readonly labelRequired: boolean;
  readonly denominator: PopulationDenominator;
  readonly readingState: {
    readonly examiner: PopulationReadingSummary;
    readonly material: PopulationReadingSummary;
  };
  readonly extractionState: {
    readonly declarations: PopulationExtractionSummary;
    readonly concepts: PopulationExtractionSummary;
  };
  /** Every counted declared unit, by declaration id. Empty when the denominator cannot be read at all. */
  readonly units: readonly DeclaredUnitCoverage[];
  /** Units per state per dimension, when the denominator is `known` or `partly-read`; else `null`. */
  readonly counts: PopulationCounts | null;
  /** Units whose material reads missing, when `counts` is formed; else `null`. */
  readonly unmatched: readonly string[] | null;
  /** Her live concepts aligned to no declared unit, when the denominator is `known`; else `null`. */
  readonly volunteers: readonly string[] | null;
  /** Supporting concepts in her material with no eligible instrument yet (F8.2's ground); `null` when the document store could not be read. */
  readonly inFlight: readonly string[] | null;
  /** In-flight concepts queued by two distinct processing passes; `null` when no passes were supplied or `inFlight` is `null`. */
  readonly stuck: readonly string[] | null;
  readonly exhaustive: 'allowed' | 'withheld';
  readonly exhaustiveWithheldBecause: readonly ExhaustiveWithholdReason[];
}
