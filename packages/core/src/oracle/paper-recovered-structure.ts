/**
 * `paperRecoveredStructureFromReadings` — her stored past-paper readings, restated as the
 * practice paper's recovered structure (F4.11 input (b), `[D-548]`, `ol-egov.141.89.7.87`).
 * Pure: no I/O, no clock, no model call.
 *
 * **What it is for.** Olea already stores a reading of each registered past paper the Worker could
 * read (`../outcome/scope-reading-types.ts`, `[D-429]`). F4.11 sets the paper's extent "within the
 * range the course's own assessment evidence demonstrates", and `./paper-blueprint.ts`'s
 * `extentSlotCountTarget` already reads that range from a `PaperRecoveredStructure`: the median
 * past-paper item count for a standard paper, clamped 1 to 8. This module is the one place a stored
 * reading becomes that structure, so the paper's length follows her past papers once a reading
 * exists, and stays the declared standard extent while none does (`null`).
 *
 * **Which readings count.** One per paper revision the caller says is current, and only when both
 * hold:
 *
 * - its structure view is `current` (the current revision, by a reader version the caller
 *   accepts): a stale revision or a stale reader is never handed out (`structureView`'s own rule);
 * - its processing state is `recorded`: read in full and a structure found. A paper read only in
 *   part (`partly-read`) undercounts its own questions, so its count is not the paper's count; a
 *   structure whose state is not yet written (a crash between the two writes) reads as not yet
 *   known. Neither counts.
 *
 * **What is carried, and what is not.** Each counted reading is one sitting, its sections restated
 * with their label, question form, item count and marks. Marks the paper does not state stay
 * `'unknown'` (`[D-431]`), never zero. Nothing else is carried:
 *
 * - **No regime.** No production fact records a paper's regime (the plugin's
 *   `scope-reading/declared-demands.ts` module doc), so every sitting reads `regime: 'unknown'`,
 *   and the structure's `currentCount` and `historicalCount` count only sittings whose regime is
 *   known: none. F4.2 makes the regime a qualifier on a sentence, never a numerical decay, so the
 *   length does not depend on it.
 * - **No seal, and so no demand and no source pointer.** Nothing records a sealed mark either.
 *   F4.11 lets a sealed paper inform structure and composition "the same as any other past paper"
 *   and keeps it from grounding an item; demand is read from non-sealed papers only. So every
 *   registered paper's sections count toward the length, and no section carries `demands` and no
 *   sitting a `sourceRef`: the paper's intended demand and its face statement stay exactly as they
 *   were (`./paper-blueprint.ts`'s `dominantDemand` reads nothing here), and no past paper's text
 *   reaches a generated item.
 *
 * Group and part readings (`ScopePaperStructure.groups`/`parts`) are not read: the item count is
 * the sections' own, which is what `extentSlotCountTarget` sums.
 */

import type { DocumentStateView, StructureView } from '../outcome/scope-reading-project.js';
import type {
  PaperRecoveredSection,
  PaperRecoveredSitting,
  PaperRecoveredStructure,
} from './paper-types.js';

/** One past paper revision's stored reading, as the scope-reading projection labels it against what the caller says is current. */
export interface PastPaperStoredReading {
  /** `documentStateView` for the revision the caller says is current. */
  readonly state: DocumentStateView;
  /** `structureView` for the same revision, under the caller's reader policy. */
  readonly structure: StructureView;
}

/** `true` when this reading's count is the paper's count: a current structure over a revision read in full. See the module doc. */
export function pastPaperReadingCounts(reading: PastPaperStoredReading): boolean {
  return (
    reading.structure.status === 'current' &&
    reading.state.status === 'known' &&
    reading.state.state.kind === 'recorded'
  );
}

/**
 * The recovered structure the paper's length is read from, or `null` when no reading counts (none
 * stored, none current, none read in full): the declared standard extent then stands, exactly as
 * with no past papers. Readings keep the caller's order.
 */
export function paperRecoveredStructureFromReadings(
  readings: readonly PastPaperStoredReading[],
): PaperRecoveredStructure | null {
  const sittings: PaperRecoveredSitting[] = [];
  for (const reading of readings) {
    if (!pastPaperReadingCounts(reading) || reading.structure.status !== 'current') continue;
    const sections: PaperRecoveredSection[] = reading.structure.reading.sections.map((section) => ({
      label: section.label,
      questionForm: section.questionForm,
      itemCount: section.itemCount,
      marks:
        section.marks.status === 'stated'
          ? { status: 'stated', value: section.marks.value }
          : { status: 'unknown' },
    }));
    sittings.push({ regime: 'unknown', sections });
  }
  if (sittings.length === 0) return null;
  return {
    sittingCount: sittings.length,
    currentCount: 0,
    historicalCount: 0,
    sittings,
  };
}
