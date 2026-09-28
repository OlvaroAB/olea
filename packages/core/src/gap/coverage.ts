/**
 * The coverage screen's **scope**, computed rather than asserted
 * (`ol-cvsc` [P3-T07h], F4.5, C4.7).
 *
 * **Why this module exists.** The rejected version of the coverage screen
 * closed with *"nothing else in the two past papers is missing from your
 * notes"* — a completeness claim over a corpus. To say it truthfully the
 * pipeline must have read every question in every paper, resolved each to a
 * concept, and checked each concept against her material. Any silent failure
 * anywhere in that chain turns the line into a false reassurance **in the
 * direction that costs her marks**, because *the screen renders identically
 * whether it found no gaps or found nothing because it read nothing*. That
 * bet has already lost once, silently, on real files (`ol-4gv` / `ol-voen`).
 *
 * So the sentence is not fixed by hedging it. The computation carries its own
 * scope, and the sentence is gated on it. That gate is
 * {@link CoverageScope.canStateExhaustiveness}, and it is a property of the
 * data — a caller cannot render the claim without holding a scope that grants
 * it.
 *
 * **This module recomputes nothing.** `extractTier3Evidence` already emits one
 * `SourceCoverage` row per distinct source, zero-yield rows included, carrying
 * the extractor's own `outcome` (`ol-i2n6`). All that is left is to read those
 * verdicts into the three user-visible states below without collapsing any two
 * of them — which is the entire job, because collapsing them is exactly the
 * defect.
 *
 * **The four read states, and why none of them merges into another.**
 *
 *  - `'read'` — an extractor (or, for markdown, a reader) actually consumed
 *    this source and produced text. Zero citations from a `'read'` source is a
 *    *measurement*: it says her vocabulary is not in that document.
 *  - `'read-yielded-nothing'` — the read succeeded and there was nothing in
 *    it (`'empty-document'`, or `'extracted'` with no units). Nothing is
 *    wrong; there was nothing there. The user-visible consequence is that the
 *    reassurance must **shrink** — this document backs no claim.
 *  - `'unreadable'` — the read did not succeed (`'no-pages-found'`,
 *    `'unreadable'`, `'reached-but-unreadable'`). This is the state the whole
 *    bead exists for: it must never look like a clean zero.
 *  - `'not-attempted'` — no reader ran at all. A markdown `role:
 *    course-material` source carries `outcome: null` *and* the
 *    `'no-tier3-reader-for-role'` limitation; `outcome: null` there is the
 *    extractor's **silence**, not its verdict, and reading silence as success
 *    is the same mistake in a different costume.
 *
 * **`[D-326]`: the completeness record, where one exists, is read instead.**
 * The ruling (`ol-egov.141.89.8.8`) has the coverage fold read the shared
 * per-unit completeness record (`../ingestion/unit-manifest/`) rather than
 * the text-layer re-extraction the tier-3 row carries, with three
 * conditions this module holds for every source a caller supplies a record
 * for (`SummariseCoverageScopeOptions.manifests`):
 *
 *  - **Reading and concept extraction are two facts.** Each row carries
 *    `readingCompleteness` and `conceptExtraction` apart; neither is derived
 *    from the other, and a reading that finished never makes extraction
 *    finished.
 *  - **An unread or partly read region is unknown, never absent.** A source
 *    with any unit read only in part, failed, or still pending grounds no
 *    claim that something is missing from it (`absenceGrounding:
 *    'unknown'`), even when some of it was read and cited.
 *  - **Nothing unfinished is shown as complete.** A partly read or
 *    unsettled source, or unfinished extraction, withdraws
 *    `canStateExhaustiveness`, beside the four read states' own gate.
 *
 * A source with no record keeps today's reading of the extractor verdict,
 * unchanged, with both new facts `'not-recorded'`: the record has no durable
 * store yet, so an absent record is the ordinary production case today, and
 * treating it as unfinished would withdraw a claim she sees now on no new
 * evidence. How a partly read source or unfinished extraction is WORDED is
 * the view's to add with its copy; the four read states are unchanged, so no
 * renderer keyed on them breaks.
 *
 * **`ol-egov.141.89.11.19`: the gate checks the sources it reads, not the
 * examiner's own unit.** `vew.md` section 2.2's gate is "at least one [SCP]
 * unit; every unit aligned ... every source read in full ... extraction
 * finished" — three conditions, and until this bead this function only ever
 * held the third. The population record that could supply every declared
 * unit's alignment state is separate, unbuilt work (`vew.md` section 8's new
 * `packages/core/src/coverage/`), so `SummariseCoverageScopeOptions.declaredUnits`
 * carries only the minimum the gate itself needs: an id and the concept keys
 * aligned to it, mirroring `OutcomeRecord.conceptKeys` (`../outcome/types.js`)
 * by shape rather than by import, so this module stays decoupled from that
 * population module's own evolution — the same isolation argument
 * `OutcomeSourceReference`'s own doc makes for not importing a sibling's
 * shape. Exactly like `manifests`, an absent `declaredUnits` keeps today's
 * gate unchanged (no caller has this yet, so there is no new evidence to
 * withdraw a claim on); once supplied, an empty set or any unit with no
 * concept key withholds the claim, same as `[D-326]`'s own conditions do.
 *
 * **INV-1.** Pure computation over already-gathered inputs; no `obsidian`, no
 * vault I/O, no clock. §7.1: this is a local projection, deterministically
 * recomputable from the same inputs forever.
 */

import type { ExtractionOutcome, SourceFormat } from '../extract/types.js';
import type { AbsenceGrounding } from '../ingestion/unit-manifest/manifest.js';
import type { UnitManifest, UnitManifestEntry } from '../ingestion/unit-manifest/types.js';
import type { SourceKind, SourceRole } from '../source/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * What actually happened to one source, in the vocabulary a user-facing
 * surface has to distinguish. See the module doc for why these four are four
 * and not two.
 */
export type SourceReadState = 'read' | 'read-yielded-nothing' | 'unreadable' | 'not-attempted';

/**
 * How far a source's pass reached, from its `[D-326]` completeness record:
 * `'full'` every unit read in full (a blank page, or one with no text,
 * counts: the read succeeded); `'partial'` the pass settled with at least
 * one unit read only in part, failed, or not legible; `'unsettled'` a unit
 * is still pending or awaiting a retry; `'not-recorded'` no record was
 * supplied, and the read state is the extractor verdict's, as before.
 */
export type SourceReadingCompleteness = 'full' | 'partial' | 'unsettled' | 'not-recorded';

/**
 * Whether concept extraction has run over the source's read material, from
 * the same record and never from the reading (`[D-326]`): `'complete'` over
 * every unit that was read; `'unfinished'` any read unit not yet extracted,
 * or reading itself unsettled; `'nothing-to-extract'` the pass settled and no
 * unit held readable material; `'not-recorded'` no record was supplied.
 */
export type SourceConceptExtraction =
  | 'complete'
  | 'unfinished'
  | 'nothing-to-extract'
  | 'not-recorded';

/**
 * One examiner-declared assessment unit (`SCP`'s declaration, `[D-355]`), so far as
 * `canStateExhaustiveness` needs to know. See the module doc's `ol-egov.141.89.11.19` note for
 * why this is a local, minimal shape and not an import of `OutcomeRecord`.
 */
export interface DeclaredUnitScope {
  readonly declarationId: string;
  /**
   * The concept keys aligned to this unit (`[D-355]`). Empty means no concept in her material
   * yet, or extracted but not aligned — the gate treats both the same way: not aligned.
   */
  readonly conceptKeys: readonly string[];
}

/** One source's row on the coverage surface — the denominator, made visible. */
export interface CoverageScopeSource {
  readonly sourcePath: VaultPath;
  readonly readState: SourceReadState;
  /** The registered role, or `undefined` for a source reached only as an embed — carried through, never invented. */
  readonly role: SourceRole | undefined;
  readonly kinds: readonly SourceKind[];
  readonly format: SourceFormat | null;
  /** The extractor's own verdict, verbatim, or `null` for a source no extractor ran on. Kept beside `readState` so the derivation is checkable rather than trusted. */
  readonly outcome: ExtractionOutcome | null;
  readonly citations: number;
  readonly units: number;
  /** `[D-326]`: how far the reading reached (module doc). */
  readonly readingCompleteness: SourceReadingCompleteness;
  /** `[D-326]`: whether concept extraction finished, apart from the reading (module doc). */
  readonly conceptExtraction: SourceConceptExtraction;
  /**
   * Whether this source's silence may ground a claim that something is
   * absent from it (`[D-326]`, the same two values as the record's own
   * `absenceGroundingFor`): `'groundable'` only for a source read in full
   * (or read, with no record to say otherwise); every other source is
   * `'unknown'`, never absent.
   */
  readonly absenceGrounding: AbsenceGrounding;
}

/**
 * The scope one coverage pass actually covered.
 *
 * `canStateExhaustiveness` is the load-bearing field and the only reason this
 * shape exists: it is `true` **only** when every source read successfully, so
 * a single unread source withdraws the claim. A consumer that wants to render
 * *"nothing else is missing"* has to hold a scope that says it may.
 */
export interface CoverageScope {
  /** Every source, in `sourcePath` order — including the ones that yielded nothing. An omitted row is a false reassurance. */
  readonly sources: readonly CoverageScopeSource[];
  readonly readCount: number;
  readonly yieldedNothingCount: number;
  readonly unreadableCount: number;
  readonly notAttemptedCount: number;
  /** Sources whose record says the pass settled with a unit read only in part, failed or not legible (`[D-326]`). */
  readonly partlyReadCount: number;
  /** Sources whose record has a unit still pending or awaiting a retry (`[D-326]`). */
  readonly unsettledCount: number;
  /** Sources whose record says concept extraction has not finished over what was read (`[D-326]`). */
  readonly extractionUnfinishedCount: number;
  /**
   * Declared assessment units the caller supplied (`SummariseCoverageScopeOptions.declaredUnits`,
   * `[D-355]`), or `null` when it supplied none — the population record itself is separate,
   * unbuilt work (module doc, `ol-egov.141.89.11.19`).
   */
  readonly declaredUnitCount: number | null;
  /** Of `declaredUnitCount`, those with no concept key aligned to them. `null` exactly when `declaredUnitCount` is. */
  readonly unalignedDeclaredUnitCount: number | null;
  /**
   * Every source read successfully — and therefore the *only* state in which
   * an exhaustiveness claim over the read set is even eligible. Where a
   * `[D-326]` record exists, that also means read in full with concept
   * extraction finished: a partly read or unsettled source, or unfinished
   * extraction, withdraws it. Where the caller supplied `declaredUnits`
   * (`ol-egov.141.89.11.19`), an empty declared set or any unit with no
   * concept key aligned to it withdraws it too, and so does a declared scope
   * the population could not know in full (`declaredScopeUnknown`,
   * `ol-egov.141.89.11.4`).
   *
   * **Note what this still is not.** It says the read path completed, not that
   * concept resolution was complete or that her material was checked
   * exhaustively. It is a necessary condition, deliberately not advertised as
   * a sufficient one, and the sentence it gates is scoped to *"the sources we
   * could read"* rather than to the corpus.
   */
  readonly canStateExhaustiveness: boolean;
}

/**
 * Which read state an extractor verdict means, for a source with no
 * `'no-tier3-reader-for-role'` limitation.
 *
 * The `null` case is markdown, which the block parser reads rather than an
 * extractor: there is no verdict because no extractor ran, and the source was
 * genuinely read by its role-specific reader. A markdown source whose role has
 * no reader is handled by the caller, before this function is reached.
 */
function readStateOfOutcome(outcome: ExtractionOutcome | null, units: number): SourceReadState {
  if (outcome === null) return 'read';
  switch (outcome) {
    case 'extracted':
      // `pages.length > 0` by the `ExtractionResult` contract, but units can
      // still be zero — a page routed to vision with no text produces a page
      // record and no unit. That is a successful read of an empty thing, not
      // a failure, and it is not a `'read'` either: it backs no claim.
      return units > 0 ? 'read' : 'read-yielded-nothing';
    case 'empty-document':
      return 'read-yielded-nothing';
    case 'furniture-only':
      // SCAN-1/ol-738i: the read genuinely succeeded — every page decoded to
      // plausible characters — and there is still nothing here to check her
      // vocabulary against, because all of it was a running head or a
      // page-number stamp (`furniture.ts`). Same consequence as
      // `'empty-document'`, for the same reason: nothing is wrong, there was
      // nothing there, and the coverage claim must shrink accordingly rather
      // than silently counting this source as read content.
      return 'read-yielded-nothing';
    case 'no-pages-found':
    case 'unreadable':
    case 'reached-but-unreadable':
      return 'unreadable';
  }
}

/**
 * Read one `SourceCoverage` row into its user-visible read state.
 *
 * Exported because the mapping *is* the honesty property and deserves to be
 * asserted directly, not only through the aggregate.
 */
export function readStateOf(row: SourceCoverage): SourceReadState {
  // Checked before the outcome, and the order matters: this row's `outcome`
  // is `null` because no reader ran, which `readStateOfOutcome` would
  // otherwise (correctly, for markdown that *was* read) call `'read'`.
  if (row.limitations.includes('no-tier3-reader-for-role')) return 'not-attempted';
  return readStateOfOutcome(row.outcome, row.units);
}

/** The three `[D-326]` facts one completeness record gives a source, and the read state it implies. */
export interface SourceRecordReading {
  readonly readState: SourceReadState;
  readonly readingCompleteness: Exclude<SourceReadingCompleteness, 'not-recorded'>;
  readonly conceptExtraction: Exclude<SourceConceptExtraction, 'not-recorded'>;
}

/** A unit the pass settled on having read nothing usable from, as the census reads it: failed, or not legible. */
function isFailingUnit(entry: UnitManifestEntry): boolean {
  const state = entry.readingState;
  return state.kind === 'failed' || (state.kind === 'unreadable' && state.reason === 'not-legible');
}

/**
 * Read one source's `[D-326]` completeness record into the coverage
 * surface's terms, or `null` for a record with no units (nothing recorded;
 * the caller keeps the extractor verdict).
 *
 * - **Read state**, from the record rather than the re-extraction: any unit
 *   with readable material (read or partial) → `'read'`; else any unit
 *   failed or not legible → `'unreadable'`; else any unit still pending or
 *   unavailable → `'not-attempted'` (no reading has happened yet); else every
 *   unit was blank or held no text → `'read-yielded-nothing'`. A blank page
 *   or one with no text is a read that found nothing, never a failure (the
 *   census's own reading of `[D-325]`, `../source/unreadable.ts`).
 * - **Reading completeness** and **concept extraction** as their types say,
 *   each from its own field of the record.
 *
 * Exported because the fold is the honesty property, asserted directly.
 */
export function readRecordOf(manifest: UnitManifest): SourceRecordReading | null {
  const units = manifest.entries;
  if (units.length === 0) return null;
  const withMaterial = units.filter(
    (u) => u.readingState.kind === 'read' || u.readingState.kind === 'partial',
  );
  const unsettled = units.some(
    (u) => u.readingState.kind === 'pending' || u.readingState.kind === 'unavailable',
  );
  const failing = units.some(isFailingUnit);
  const partial = units.some((u) => u.readingState.kind === 'partial');

  const readState: SourceReadState =
    withMaterial.length > 0
      ? 'read'
      : failing
        ? 'unreadable'
        : unsettled
          ? 'not-attempted'
          : 'read-yielded-nothing';
  const readingCompleteness = unsettled ? 'unsettled' : partial || failing ? 'partial' : 'full';
  const conceptExtraction = unsettled
    ? 'unfinished'
    : withMaterial.length === 0
      ? 'nothing-to-extract'
      : withMaterial.every((u) => u.conceptExtractionState === 'complete')
        ? 'complete'
        : 'unfinished';
  return { readState, readingCompleteness, conceptExtraction };
}

/** Options for `summariseCoverageScope`. */
export interface SummariseCoverageScopeOptions {
  /**
   * `[D-326]`'s completeness records, keyed by source path, where the caller
   * has them. A record is authoritative for its source (module doc); a path
   * with no record, or a record with no units, keeps the extractor verdict.
   */
  readonly manifests?: ReadonlyMap<VaultPath, UnitManifest>;
  /**
   * The examiner's own declared assessment units for this scope (`SCP`, `[D-355]`), where the
   * caller has them (`ol-egov.141.89.11.19`; `vew.md` section 2.2). `undefined` keeps today's
   * gate unchanged (module doc); once supplied, an empty set or any unit with no concept key
   * aligned to it withholds `canStateExhaustiveness`.
   */
  readonly declaredUnits?: readonly DeclaredUnitScope[];
  /**
   * `ol-egov.141.89.11.4`: `true` when some course that declares a scope has a
   * denominator that is not known (declarations not extracted, or a document partly
   * read, unread, unreadable or with no record), so `declaredUnits` may be missing
   * units. Withholds `canStateExhaustiveness`. `undefined` or `false` changes nothing.
   * Formed from the population by `../coverage/gate.ts#coverageGateOptionsOf`.
   */
  readonly declaredScopeUnknown?: boolean;
}

/**
 * Summarise what a tier-3 pass actually read.
 *
 * Takes `extractTier3Evidence`'s own `sourceCoverage` unmodified — composing
 * its output rather than re-deriving a second answer to "what did we read?",
 * for the reason `evidence.ts` gives about denominators computed twice — and,
 * per `[D-326]`, each source's completeness record where one is supplied.
 */
export function summariseCoverageScope(
  sourceCoverage: readonly SourceCoverage[],
  options: SummariseCoverageScopeOptions = {},
): CoverageScope {
  const sources: CoverageScopeSource[] = sourceCoverage
    .map((row): CoverageScopeSource => {
      const manifest = options.manifests?.get(row.sourcePath);
      const recorded = manifest === undefined ? null : readRecordOf(manifest);
      const readState = recorded?.readState ?? readStateOf(row);
      const readingCompleteness = recorded?.readingCompleteness ?? 'not-recorded';
      return {
        sourcePath: row.sourcePath,
        readState,
        role: row.role,
        kinds: row.kinds,
        format: row.format,
        outcome: row.outcome,
        citations: row.citations,
        units: row.units,
        readingCompleteness,
        conceptExtraction: recorded?.conceptExtraction ?? 'not-recorded',
        absenceGrounding:
          readState === 'read' &&
          (readingCompleteness === 'full' || readingCompleteness === 'not-recorded')
            ? 'groundable'
            : 'unknown',
      };
    })
    .sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));

  const count = (state: SourceReadState): number =>
    sources.filter((s) => s.readState === state).length;

  const readCount = count('read');
  const yieldedNothingCount = count('read-yielded-nothing');
  const unreadableCount = count('unreadable');
  const notAttemptedCount = count('not-attempted');
  const partlyReadCount = sources.filter((s) => s.readingCompleteness === 'partial').length;
  const unsettledCount = sources.filter((s) => s.readingCompleteness === 'unsettled').length;
  const extractionUnfinishedCount = sources.filter(
    (s) => s.conceptExtraction === 'unfinished',
  ).length;

  // `ol-egov.141.89.11.19`: `undefined` keeps today's gate unchanged (module
  // doc) — a caller with no declared-unit population yet must not have its
  // claim withdrawn on no new evidence. Once supplied, an empty declared set
  // or any unit with no concept key aligned to it is the same shape of harm
  // `[D-326]`'s own conditions guard against, so it withholds the same way.
  const declaredUnits = options.declaredUnits;
  const declaredUnitCount = declaredUnits === undefined ? null : declaredUnits.length;
  const unalignedDeclaredUnitCount =
    declaredUnits === undefined
      ? null
      : declaredUnits.filter((u) => u.conceptKeys.length === 0).length;
  const declaredUnitsWithholdExhaustiveness =
    options.declaredScopeUnknown === true ||
    (declaredUnits !== undefined &&
      (declaredUnits.length === 0 || (unalignedDeclaredUnitCount ?? 0) > 0));

  return {
    sources,
    readCount,
    yieldedNothingCount,
    unreadableCount,
    notAttemptedCount,
    partlyReadCount,
    unsettledCount,
    extractionUnfinishedCount,
    declaredUnitCount,
    unalignedDeclaredUnitCount,
    // Every source read, and at least one source to have read. An empty scope
    // is NOT exhaustive over anything: "we checked all zero of your sources"
    // is the purest form of the sentence this bead rejects. `[D-326]`: and
    // nothing recorded as partly read, unsettled or not yet extracted.
    // `ol-egov.141.89.11.19`: and, where declared units were supplied, at
    // least one and every one aligned. `ol-egov.141.89.11.4`: and no declaring
    // course's denominator unknown.
    canStateExhaustiveness:
      sources.length > 0 &&
      yieldedNothingCount === 0 &&
      unreadableCount === 0 &&
      notAttemptedCount === 0 &&
      partlyReadCount === 0 &&
      unsettledCount === 0 &&
      extractionUnfinishedCount === 0 &&
      !declaredUnitsWithholdExhaustiveness,
  };
}

/** The sources on this scope in a given read state, in `sourcePath` order. */
export function sourcesInState(
  scope: CoverageScope,
  state: SourceReadState,
): readonly CoverageScopeSource[] {
  return scope.sources.filter((s) => s.readState === state);
}
