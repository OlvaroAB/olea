/**
 * F3.7/D-238's top-band trigger signal — GEN-3.5 (`ol-2zfj.136`).
 *
 * `generation/triggers.ts`'s `topBandTrigger` (`ol-2zfj.63` [GEN-3.1]) takes
 * an opaque `enteredTopBand: boolean`; this module is the one place that
 * boolean is computed, from the CACHED study plan (`StudyPlanCourse`, A2.5)
 * this directory already builds/caches/executes against
 * (`build.ts`/`cache.ts`/`execute.ts`) — never a live `CourseOracleRanking`
 * recomputed here (that would mean this module reaching into `oracle/`,
 * which is not this bead's owned path either).
 *
 * ## One divisor, one cutoff rule, shared with `concept/note-offer.ts`
 *
 * "Top band" is [D-176]'s own ceil(len/3)-floored-at-1 partition. Its one
 * source of truth is `concept/note-offer.ts`'s exported `TOP_BAND_DIVISOR`
 * and `isRankInTopBand` (a follow-up from this bead's own earlier round,
 * now landed): this module imports both rather than restating the divisor
 * or the ceil/floor formula a second time, so `note-offer.ts`'s LIVE
 * `CourseOracleRanking` reading and this module's CACHED `StudyPlanCourse`
 * reading (`PlannedConcept.rank`/`concepts.length` vs. `ConceptPriority.rank`/
 * `ranked.length` — the same shape, one instance persisted, one live) can
 * never silently drift apart.
 */

import type { StudyPlanCourse } from 'olea-contracts';
import { isRankInTopBand, TOP_BAND_DIVISOR } from '../concept/note-offer.js';

/**
 * Re-exported under this module's own established name (existing callers
 * and this file's spec import it this way) — the identical value as
 * `concept/note-offer.ts#TOP_BAND_DIVISOR`, never a second constant.
 */
export const GENERATION_TOP_BAND_DIVISOR = TOP_BAND_DIVISOR;

/**
 * Has `conceptId` (`PlannedConcept.conceptId` — that field's own doc still
 * describes it as "the verbatim display name", but `plan/build.ts`'s actual
 * writer sets it to `entry.conceptKey`, the opaque key; stale doc, not this
 * bead's to fix — this function is identity-agnostic and joins on whatever
 * string the plan and the caller both use) entered its course's top band,
 * reading the CACHED plan's own per-course ranking (`StudyPlanCourse`, ascending by
 * `rank`)?
 *
 * An abstained course (`status !== 'ranked'`), or a concept the plan never
 * ranked (vetoed away upstream, or simply absent from this course's slice),
 * is never in the top band — there is no ranking to sit in, the identical
 * reading `concept/note-offer.ts#isInTopBand` gives for a live ranking.
 */
export function conceptEnteredTopBand(course: StudyPlanCourse, conceptId: string): boolean {
  if (course.status !== 'ranked') return false;
  const entry = course.concepts.find((concept) => concept.conceptId === conceptId);
  if (entry === undefined) return false;
  return isRankInTopBand(entry.rank, course.concepts.length);
}
