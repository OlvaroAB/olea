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
 * **INV-1.** Pure computation over already-gathered inputs; no `obsidian`, no
 * vault I/O, no clock. §7.1: this is a local projection, deterministically
 * recomputable from the same inputs forever.
 */

import type { ExtractionOutcome, SourceFormat } from '../extract/types.js';
import type { SourceKind, SourceRole } from '../source/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * What actually happened to one source, in the vocabulary a user-facing
 * surface has to distinguish. See the module doc for why these four are four
 * and not two.
 */
export type SourceReadState = 'read' | 'read-yielded-nothing' | 'unreadable' | 'not-attempted';

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
  /**
   * Every source read successfully — and therefore the *only* state in which
   * an exhaustiveness claim over the read set is even eligible.
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

/**
 * Summarise what a tier-3 pass actually read.
 *
 * Takes `extractTier3Evidence`'s own `sourceCoverage` unmodified — composing
 * its output rather than re-deriving a second answer to "what did we read?",
 * for the reason `evidence.ts` gives about denominators computed twice.
 */
export function summariseCoverageScope(sourceCoverage: readonly SourceCoverage[]): CoverageScope {
  const sources: CoverageScopeSource[] = sourceCoverage
    .map((row) => ({
      sourcePath: row.sourcePath,
      readState: readStateOf(row),
      role: row.role,
      kinds: row.kinds,
      format: row.format,
      outcome: row.outcome,
      citations: row.citations,
      units: row.units,
    }))
    .sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));

  const count = (state: SourceReadState): number =>
    sources.filter((s) => s.readState === state).length;

  const readCount = count('read');
  const yieldedNothingCount = count('read-yielded-nothing');
  const unreadableCount = count('unreadable');
  const notAttemptedCount = count('not-attempted');

  return {
    sources,
    readCount,
    yieldedNothingCount,
    unreadableCount,
    notAttemptedCount,
    // Every source read, and at least one source to have read. An empty scope
    // is NOT exhaustive over anything: "we checked all zero of your sources"
    // is the purest form of the sentence this bead rejects.
    canStateExhaustiveness:
      sources.length > 0 &&
      yieldedNothingCount === 0 &&
      unreadableCount === 0 &&
      notAttemptedCount === 0,
  };
}

/** The sources on this scope in a given read state, in `sourcePath` order. */
export function sourcesInState(
  scope: CoverageScope,
  state: SourceReadState,
): readonly CoverageScopeSource[] {
  return scope.sources.filter((s) => s.readState === state);
}
