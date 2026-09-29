/**
 * The processed-revision store's rows as the arrivals stage's per-course input
 * (`ol-egov.141.89.11.24`, `[D-426]`): the seam between the record (`./store.ts`) and `olea-core`'s
 * `detectArrivals` (`today/arrivals.ts`), which turns it into the rhythm reading's input.
 *
 * Pure, and deliberately thin. It maps and groups; it decides nothing about arrival:
 *
 *  - a row is one file's latest version, so a course's `revisions` is one entry per file that counts
 *    for it (a file in two courses is one entry in each);
 *  - the day carried is the FIRST-PROCESSED day, or `null` when unknown together with its bound
 *    (`noLaterThan`), which the arrivals stage uses for one decision only and never as a day. It is
 *    never worded as an arrival here or downstream (`arrivals.ts`'s module doc);
 *  - the state is the processing state as it stands: pending stays pending (the arrivals stage folds
 *    it into "arrived, could not be read"), never absent;
 *  - a course with nothing on record has no entry: "nothing yet" is an empty course list, and it is
 *    the store's `rebuiltOn` (checked by the caller, `today/data-source.ts`) that separates that
 *    from "never looked".
 *
 * No fingerprint, path or course code leaves in a revision: the reading's input has no field for
 * them, so nothing downstream can log or word one (D-005).
 */

import type { CourseArrivalsInput, ProcessedRevision } from 'olea-core';
import type { PersistedProcessedRevisions, ProcessedRevisionRow } from './store.js';

function revisionOf(row: ProcessedRevisionRow): ProcessedRevision {
  return {
    firstProcessedDay: row.firstProcessedDay,
    ...(row.noLaterThan === undefined ? {} : { noLaterThan: row.noLaterThan }),
    readState: row.state,
  };
}

/** One `CourseArrivalsInput` per course with at least one row, in course order. */
export function courseArrivalInputs(
  persisted: PersistedProcessedRevisions,
): readonly CourseArrivalsInput[] {
  const byCourse = new Map<string, ProcessedRevision[]>();
  for (const row of Object.values(persisted.revisions)) {
    for (const course of row.courses) {
      const revisions = byCourse.get(course) ?? [];
      revisions.push(revisionOf(row));
      byCourse.set(course, revisions);
    }
  }
  return [...byCourse.keys()]
    .sort()
    .map((course) => ({ course, revisions: byCourse.get(course) ?? [] }));
}
