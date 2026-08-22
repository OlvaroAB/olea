/**
 * The adapter `today/due.ts` names and deliberately does not contain (F6.1, `ol-9n0b`).
 *
 * `summariseDue` counts `DueInstrument`s, which carry **one** `courseCode`,
 * because `total === sum(courses.count)` is the only thing about the panel a
 * reader can verify by looking at it. A concept's course membership is M:N
 * (R1/R2), so `QueueCandidate.courses` is a list. Something has to close that
 * gap, and `today/due.ts`'s module doc is explicit that the closing happens in
 * the adapter and states the question rather than answering it there.
 *
 * Here is the answer, and it is a reversible default rather than a ruling:
 * **an instrument is counted under the first of its concept's courses**, sorted
 * — which is the order `ConceptRecord.courses` already comes in, so it is
 * stable across runs and hosts without this module inventing an ordering.
 *
 * Why not fan out into every course it belongs to: the rows would sum to more
 * than the headline, with nothing on screen explaining why, and the one
 * checkable property of the panel would be gone. Why not a "multiple" bucket:
 * that is a UI element nobody asked for, in a panel whose whole design note is
 * about not saying things it cannot stand behind. Why not drop multi-course
 * instruments: they would vanish from a count that claims to be a total.
 *
 * A concept with no course at all is counted under the empty string, which the
 * panel renders as an unnamed row rather than dropping the instrument. Losing
 * it would make the headline wrong, and the headline is the number she reads.
 */

import type { DueInstrument } from '../today/due.js';
import type { ReplayResult } from './replay.js';
import type { VaultInstrumentRecord } from './types.js';

/**
 * Every enumerated instrument as the Today panel needs to count it.
 *
 * Suspension is **not** applied here. `summariseDue` takes a suspended set and
 * the caller holding the whole log passes it — `buildReviewSession` produces
 * exactly that set. Excluding here as well would put the same rule in two
 * places, and the panel's own doc is clear that the exclusion belongs to the
 * component that read the full history.
 */
export function toDueInstruments(
  records: readonly VaultInstrumentRecord[],
  replay: ReplayResult,
): readonly DueInstrument[] {
  return records.map((record) => ({
    instrumentId: record.instrumentId,
    courseCode: record.courses[0] ?? '',
    // The vault gives a course *code* (her folder and her `course:` property)
    // and no longer name, and `DueInstrument.courseName` says an empty string
    // is what that looks like. Inventing an expansion here would be inventing
    // vault content (INV-3).
    courseName: '',
    due: replay.states.get(record.instrumentId)?.state.due ?? null,
  }));
}
