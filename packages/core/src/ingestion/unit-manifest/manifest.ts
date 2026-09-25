/**
 * Pure operations over the `[D-326]` unit manifest (`types.ts`). Nothing
 * here performs I/O or decides durability — see that file's module doc for
 * what is deliberately left to a later wiring decision.
 */

import type { VaultPath } from '../../vault/types.js';
import type {
  ConceptExtractionState,
  UnitManifest,
  UnitManifestEntry,
  UnitReadingState,
} from './types.js';

/**
 * A unit's identity: pure in `sourcePath` and `page` alone, so a region
 * revisited on a later pass — reading resumed after a `'partial'` or
 * `'pending'` state — lands on the SAME entry rather than a new one beside
 * it (`[D-326]`'s "a partly read region keeps a stable identity"). Never a
 * function of the pass, a timestamp, a run id, or the reading's own
 * outcome.
 */
export function stableUnitId(sourcePath: VaultPath, page: number): string {
  return `${sourcePath}#${page}`;
}

/** Builds a brand-new entry, `'pending'` (queued) by construction — the honest starting state before any reading has been attempted. */
export function newPendingEntry(sourcePath: VaultPath, page: number): UnitManifestEntry {
  return {
    unitId: stableUnitId(sourcePath, page),
    sourcePath,
    page,
    readingState: { kind: 'pending', reason: 'queued' },
    conceptExtractionState: 'not-started',
  };
}

/**
 * Replaces one entry's `readingState`, keeping its identity and
 * `conceptExtractionState` untouched — half of the direct proof of
 * `[D-326]`'s first condition: this function never derives
 * `conceptExtractionState` from the new `readingState`, whatever it is
 * (`manifest.spec.ts` asserts this for a `'read'` transition specifically,
 * since that is the direction the ruling calls out by name: "finishing the
 * reading never automatically marks extraction complete").
 */
export function withReadingState(
  entry: UnitManifestEntry,
  readingState: UnitReadingState,
): UnitManifestEntry {
  return { ...entry, readingState };
}

/**
 * Marks concept extraction complete for a unit — the only function in this
 * module that writes `conceptExtractionState`, and the other half of
 * `[D-326]`'s first condition's proof: it never reads or changes
 * `readingState`, so calling it cannot be mistaken for a reading update.
 *
 * Refuses to mark extraction complete for a unit that was never actually
 * read (`'pending'`, `'unavailable'`, `'failed'`, or `'unreadable'`): there
 * is no text there for extraction to have run over, so calling this on one
 * of those states is a caller error, thrown rather than silently accepted —
 * the same "silence is the defect" discipline `../../extract/types.js`
 * argues for its own non-optional discriminants. `'read'` and `'partial'`
 * both qualify: a partial reading's covered text is real material
 * extraction may run over (per.md section 3, "a partial unit contributes
 * only what it covered").
 */
export function markConceptExtractionComplete(entry: UnitManifestEntry): UnitManifestEntry {
  if (entry.readingState.kind !== 'read' && entry.readingState.kind !== 'partial') {
    throw new Error(
      `markConceptExtractionComplete: unit ${entry.unitId} has readingState.kind ` +
        `'${entry.readingState.kind}', which has no read material for extraction to have run over.`,
    );
  }
  return { ...entry, conceptExtractionState: 'complete' as ConceptExtractionState };
}

/** Replaces (or, for a unit not yet in the manifest, appends) one entry, keyed by `unitId` — the update path a resumed `'partial'` reading uses to land on the same entry rather than a new one. */
export function withEntry(manifest: UnitManifest, entry: UnitManifestEntry): UnitManifest {
  const idx = manifest.entries.findIndex((e) => e.unitId === entry.unitId);
  const entries =
    idx === -1
      ? [...manifest.entries, entry]
      : manifest.entries.map((e, i) => (i === idx ? entry : e));
  return { ...manifest, entries };
}

/** Every value `absenceGroundingFor` can return. See that function's own doc — there is no third value, so a caller cannot spell "absent" some other way. */
export type AbsenceGrounding = 'groundable' | 'unknown';

/**
 * Whether a consumer may treat a concept's absence from this unit as
 * informative (`[D-326]`'s third condition, per.md section 3: "an unread or
 * partially read region reads `unknown`, never a claim that a concept is
 * absent"). Only a fully `'read'` unit may ground an absence claim — a
 * `'partial'` unit named what it covered, but never claimed to have covered
 * everything, so treating its silence about the REST of the page as
 * meaningful would be exactly the inference the ruling forbids. Every other
 * state (`'partial'`, `'unreadable'`, `'pending'`, `'unavailable'`,
 * `'failed'`) is `'unknown'` by construction.
 */
export function absenceGroundingFor(entry: UnitManifestEntry): AbsenceGrounding {
  return entry.readingState.kind === 'read' ? 'groundable' : 'unknown';
}

/**
 * A source revision counts as fully read only when every one of its units
 * does (per.md section 3, Coverage: "a source with any unit not read is
 * never counted as fully read"). `'partial'` and `'unreadable'` both count
 * as settled/"read" for this purpose — the pass over them finished, even
 * though a `'partial'` unit's coverage is incomplete and an `'unreadable'`
 * unit found nothing usable; only `'pending'`, `'unavailable'` and
 * `'failed'` are "not read" in the sense this predicate means. How a partly
 * read source is *shown* to her is `VEW`'s to design (per.md section 3) —
 * this is only the underlying fact a coverage view would read.
 */
export function isFullyRead(manifest: UnitManifest): boolean {
  return manifest.entries.every(
    (entry) =>
      entry.readingState.kind === 'read' ||
      entry.readingState.kind === 'partial' ||
      entry.readingState.kind === 'unreadable',
  );
}

/** True while any unit still awaits a pass — the manifest has not "settled" (per.md section 3's grove-census gate: "once its pass settles, nothing pending"). Both `'pending'` and `'unavailable'` count: an outage is retried the same resumable way a budget-deferred unit is, and neither should be reported as a structural failure while still in flight. */
export function hasPendingUnits(manifest: UnitManifest): boolean {
  return manifest.entries.some(
    (entry) => entry.readingState.kind === 'pending' || entry.readingState.kind === 'unavailable',
  );
}
