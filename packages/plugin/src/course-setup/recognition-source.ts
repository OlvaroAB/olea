/**
 * F8.7's proposal-time read (`ol-egov.141.89.9.49`, discovered from
 * `ol-egov.141.89.9.47`): assembles the two inputs `../../core/src/today/
 * earlier-course-recognition.ts`'s `buildEarlierCourseRecognitions` needs —
 * the review log and the concept-to-course join (F1.3) — at the moment
 * `main.ts`'s `openNextCourseSetupProposal` is about to show a course-setup
 * proposal, and folds them through it. Everything downstream (the render
 * layers, `./copy.ts#buildRecognitionClaimCopy`, `./view.ts
 * #renderRecognitionClaims`, `./confirmation-view.ts`) already exists; this
 * module is the missing seam `ol-egov.141.89.9.47`'s report named by
 * file:line.
 *
 * ## Follows `../today/data-source.ts`'s own reads — read-only here
 *
 * This bead owns no edit to that file, so both halves below call its already-
 * production functions rather than re-deriving them:
 * - **entries** — `readReviewHistory(vault, deviceId, { today })`, the same
 *   whole-log (not windowed) read Today's mastery overview and insights
 *   already use for the identical "current-state, not trailing" reason
 *   (att.md item 4, `ol-egov.141.89.9.15`).
 * - **concepts** — `extractConceptsFromVault`, mapped `record.key` ->
 *   `conceptId` / `record.courses` -> `courses`, the exact one-line mapping
 *   `createVaultTrendsSource#listConceptCourses` performs for the identical
 *   join. `displayName` is dropped: `buildEarlierCourseRecognitions` only
 *   ever reads `conceptId`/`courses` off this shape, never a name.
 *
 * ## Vitality is omitted, not computed
 *
 * `buildEarlierCourseRecognitions`'s own module doc: "vitality is accepted,
 * never computed" — a live reading needs a `Scheduler`, `now` and
 * `HOLDING_CUT`, dependencies this proposal-time seam has no other reason to
 * construct. Every claim's `vitality` therefore reads `null` here, the same
 * honest "not read" every other caller that omits the option gets, never a
 * fabricated default.
 *
 * ## Both reads fail closed to `[]`
 *
 * A vault walk or log read that throws mid-way must not crash course
 * detection — the same swallow-to-honest-empty rule `createVaultTrendsSource`
 * / `createVaultInstrumentSource` already use, for the same reason (a
 * throwing vault is not a vault with nothing in it). Unlike a due count or a
 * mastery stage, F8.7 is a reading with nothing to confirm, so collapsing a
 * failed read to "show no recognition claims this time" costs her nothing
 * she was relying on.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildEarlierCourseRecognitions,
  type CalendarDay,
  type ConceptCourses,
  type EarlierCourseRecognition,
  type ExtractConceptsOptions,
  type VaultSource,
} from 'olea-core';
import { extractConceptsFromVault } from '../concept/wiring.js';
import { readReviewHistory } from '../today/data-source.js';

export interface CourseSetupRecognitionSourceDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Forwarded to `extractConceptsFromVault`; defaults match F1.3's conventions. */
  readonly conceptOptions?: ExtractConceptsOptions;
}

/**
 * `newCourse`: the course code the proposal is about —
 * `CourseDetectionProposal.code`, read from `courseFromPath` the same way
 * `ConceptCourses.courses` already is (`../concept/course.ts`), so the two
 * need no translation between them.
 *
 * Pure fold aside, this function itself is not: it performs the two vault
 * reads `buildEarlierCourseRecognitions` needs and then calls it, so a
 * caller gets recognition claims in one await rather than assembling the
 * core call's input by hand.
 */
export async function readCourseSetupRecognitions(
  newCourse: string,
  deps: CourseSetupRecognitionSourceDeps,
): Promise<readonly EarlierCourseRecognition[]> {
  let entries: readonly ReviewLogEntry[];
  try {
    entries = (await readReviewHistory(deps.vault, deps.deviceId, { today: deps.today })).entries;
  } catch {
    entries = [];
  }

  let concepts: readonly ConceptCourses[];
  try {
    const records = await extractConceptsFromVault(deps.vault, deps.conceptOptions ?? {});
    concepts = records.map((record) => ({ conceptId: record.key, courses: record.courses }));
  } catch {
    concepts = [];
  }

  return buildEarlierCourseRecognitions({ newCourse, entries, concepts });
}
