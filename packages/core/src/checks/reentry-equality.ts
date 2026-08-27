/**
 * Component register row 3.8's named health check (F6.6; `[D-113]` item 5):
 * *"for the same log and budget, the re-entry composition must equal the
 * ordinary composition at that budget; a second selection mechanism fails
 * it."*
 *
 * Same family as `rhythm-neutralised-twin.ts` and
 * `misconception-merge-boundary.ts` (this directory's own pattern): the
 * algorithm has already run — a caller (a test, a workbench inspector)
 * composes both a re-entry session and an ordinary session over the same
 * underlying data at the same resolved budget, and hands the two ORDERED
 * instrument-id lists here. This module does no composition itself and
 * imports nothing from `study-session/`.
 *
 * **Ids only, never content (INV-3).** `StudySessionModel.items` carries
 * `noteTitle` and `conceptName` — her own words — alongside the opaque
 * `instrumentId`. This check's input type carries only the id list, exactly
 * `checks/types.ts`'s "counts, ids and ordered lists of ids" discipline, so
 * a caller cannot accidentally hand real content into a structure a future
 * report or log line might quote.
 *
 * **Order matters.** `overdue-first` (`[D-113]` item 3) is a total order,
 * not a set membership rule — a second selection mechanism that chose the
 * identical items in a different sequence would still be a second policy,
 * so this check fails on a reordering, not only on a different item set.
 */
import type { CheckVerdict } from './types.js';

export interface ReentryEqualityCase {
  /** Opaque case id — never a real course code, concept name or note title (INV-3). */
  readonly id: string;
  /** `result.full.model.items.map(i => i.instrumentId)` from the re-entry composition. */
  readonly reentryOrderedInstrumentIds: readonly string[];
  /** The same, from an ordinary composition run at the SAME resolved budget over the SAME underlying rows/instruments/replay. */
  readonly ordinaryOrderedInstrumentIds: readonly string[];
}

export interface ReentryEqualityMeasured {
  readonly n: number;
  /** Case ids where the two ordered lists are not identical — a second selection mechanism, by this check's own definition. */
  readonly diverged: readonly string[];
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Fails if any case's re-entry ordering differs from its ordinary ordering
 * at the same budget, or if zero cases were supplied (N-013).
 */
export function checkReentryEquality(
  cases: readonly ReentryEqualityCase[],
): CheckVerdict<ReentryEqualityMeasured> {
  const diverged = cases
    .filter((c) => !sameOrder(c.reentryOrderedInstrumentIds, c.ordinaryOrderedInstrumentIds))
    .map((c) => c.id);

  const measured: ReentryEqualityMeasured = { n: cases.length, diverged };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero cases supplied — nothing was checked' };
  }
  if (diverged.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${diverged.length} of ${cases.length} case(s) diverged between the re-entry and ordinary compositions at the same budget — a second selection mechanism: ${diverged.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `all ${cases.length} case(s) composed identically at the same budget — no second selection mechanism observed`,
  };
}
