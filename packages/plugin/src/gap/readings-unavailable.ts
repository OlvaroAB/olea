/**
 * `[D-539]` (`ol-egov.141.89.104.56`, F4.3): the gap view's half of "a reading that would read
 * evidence whose hold check could not be made is unavailable, never weak and never a gap".
 *
 * When the hold store cannot be read as a whole, the hold reader reports the evidence it bears on
 * as unknown (`../ingestion/materiality/hold-record-reader.ts`'s `evidenceUnknown`), and the
 * readings that would read it are not made (`olea-core`'s `mastery/attainment.ts`,
 * `UnavailableCurrentReading`). `./provider.ts` names the concepts whose readings that leaves
 * unavailable; this module decides what the view lists for them: **nothing**. A row for such a
 * concept would word need it does not have ("recall here hasn't caught up", or "no recall evidence
 * for it yet", which says her log holds none), so it is never listed as a gap or as a weakness and
 * its page never opens. The rows stay in the model, so every count the view already states (the
 * syllabus counterweight's "of N", the coverage screen's gap count) stays true of what was ranked.
 *
 * **No words are added.** Any sentence for the unavailable state waits on its clause and registry
 * entry; `./view.ts`'s `renderCourse`, where the listed rows are drawn, is where it would attach.
 */

import type { GapRow } from 'olea-core';

/** The concepts whose current readings could not be made, because evidence they read could not be hold-checked. */
export interface GapReadingsUnavailable {
  /** Concept keys (`GapRow.conceptKey`), distinct and sorted. Never empty. */
  readonly conceptKeys: readonly string[];
}

/** Whether a row may be listed or opened: never one whose concept's readings are unavailable. */
export function isListedGapRow(
  row: GapRow,
  unavailable: GapReadingsUnavailable | undefined,
): boolean {
  return unavailable === undefined || !unavailable.conceptKeys.includes(row.conceptKey);
}

/**
 * The rows a ranked course lists, in the model's order. With nothing unavailable, the very rows
 * the model holds. Otherwise the rows left after those whose readings are unavailable, each taking
 * its place in the list as its rank, so the list shows no unexplained hole where a row was left
 * out (the rank shown is a position, never a score).
 */
export function listedGapRows(
  rows: readonly GapRow[],
  unavailable: GapReadingsUnavailable | undefined,
): readonly GapRow[] {
  if (unavailable === undefined || unavailable.conceptKeys.length === 0) return rows;
  return rows
    .filter((row) => isListedGapRow(row, unavailable))
    .map((row, index) => (row.rank === index + 1 ? row : { ...row, rank: index + 1 }));
}
