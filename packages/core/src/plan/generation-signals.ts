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
 * ## Duplicated constant, named on purpose
 *
 * "Top band" is [D-176]'s own ceil(len/3)-floored-at-1 partition, defined
 * today as `concept/note-offer.ts`'s unexported `TOP_BAND_DIVISOR`/
 * `isInTopBand`, applied there to a LIVE `CourseOracleRanking` for the
 * note-offer gate. That module is outside this bead's owned paths this round
 * (`packages/core/src/plan/`, `scheduler/`, `review-log/`, `mastery/`, and
 * the plugin's `ingestion/` — not `concept/`), it is held by a concurrent
 * lane this round, and neither the divisor nor a band-membership helper is
 * exported from it or from this package's barrel (`index.ts`, also not this
 * bead's to edit) — so this function cannot literally call it.
 *
 * Rather than invent a DIFFERENT number for the same concept ("top band"),
 * this restates the SAME declared constant (3) and the SAME ceil/floor
 * formula, over the CACHED plan's own `rank`/`concepts.length`
 * (`PlannedConcept`) instead of a live ranking's `rank`/`ranked.length`
 * (`ConceptPriority`) — the same shape, one instance persisted, one live.
 *
 * **Follow-up filed (this bead's report):** export a single shared
 * `TOP_BAND_DIVISOR`/band-membership helper both call sites can use, so the
 * two copies cannot silently drift apart.
 */

import type { StudyPlanCourse } from 'olea-contracts';

/**
 * See module doc. Not a fresh number — restates `concept/note-offer.ts`'s
 * own `TOP_BAND_DIVISOR` (that file's doc: DECLARED, Class B, unratified;
 * flagged for retroactive review, revisit once a semester of real
 * offer/accept/decline data exists).
 */
export const GENERATION_TOP_BAND_DIVISOR = 3;

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
  const cutoff = Math.max(1, Math.ceil(course.concepts.length / GENERATION_TOP_BAND_DIVISOR));
  return entry.rank <= cutoff;
}
