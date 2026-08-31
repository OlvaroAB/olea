/**
 * F6.2's cross-course scope reading (`[SCP-1]`, `ol-a83u`) — the "count per
 * course, each naming its own denominator" clause `[D-076]` round 2 added
 * ("Can she see where she stands against everything, not one course at a
 * time?", `docs/Olea_alpha_functional_scope.md` F6.2, service repo).
 *
 * ## This module computes no scope of its own
 *
 * `../scope/grove.js#buildGroveModel` already does the real work per course:
 * it reads the examiner's own denominator (F8.1's registered objectives and
 * past-paper sources, never Olea's inference) and splits `ground` from
 * material gap (`[D-054]`'s "ground correction", vocabulary registry §6).
 * This module's entire job is the one thing that per-course computation
 * cannot do for itself — place one course's already-built model beside
 * another's, honestly, without inventing a comparison the contract forbids.
 * The pattern mirrors `../today/mastery-overview.js#buildMasteryOverview`
 * (F6.2's mastery half, `ol-lohq`): grouping is not arithmetic, and a second
 * computation of what `buildGroveModel` already decided would be the mistake
 * that module's own doc warns against.
 *
 * ## Never a sum, never a rank (F8.3, C5.7)
 *
 * "Five examiners' denominators added together produce a figure with no
 * referent" (F6.2's own words) — so this module has no total field anywhere,
 * the same "cannot be found lying around" defence `mastery-overview.ts` uses
 * for the average it declines to compute. Rows are sorted by course code
 * only, matching `buildMasteryOverview`'s own principle-12 discipline:
 * nothing here orders courses by how well each is going, and C5.7's ban on a
 * cross-course score applies to this reading exactly as it does to the
 * ranking (F6.2's scenario, `features/F6-today.md`).
 *
 * ## "As of when" is the reading's own timestamp, not a guessed one
 *
 * The F6.2 scenario asks that each course's count name "its own denominator's
 * source ... and as of when". `Source` (`../source/types.js`) carries no
 * registration timestamp today — nothing in the pipeline writes one — so
 * inventing a per-source date here would be exactly the fabrication this
 * project's honest-scope-counting discipline forbids everywhere else
 * (`ol-cvsc`'s coverage scope never turns an unread source into a clean zero;
 * the same rule, pointed at a date instead of a count, says never a clean
 * date either). What this module CAN state honestly is when the reading
 * itself was taken, which every caller already threads through as `asOf`
 * (`RankOracleResult.asOf`, `../gap/build.js#GapViewModel.asOf`) — so that is
 * what `CrossCourseScopeOverview.asOf` echoes. A genuine per-source
 * registration date is a real absent capability, not a design choice here —
 * see "Undecided" below.
 *
 * ## Three course-model statuses collapse to two reading states
 *
 * `GroveCourseModel` distinguishes `'no-registered-source'` from
 * `'inferred'` because the grove SCREEN needs to say which (a bare empty
 * state versus a labelled guess, F8.1 scenarios 2–3). This reading never
 * draws a grove and only needs to say whether a real, examiner-supplied
 * denominator has arrived, so both collapse to `'no-denominator-yet'` —
 * matching F6.2's own scenario wording ("that course's row states it has no
 * denominator yet") rather than re-exposing the grove screen's vocabulary on
 * a surface that never renders one.
 *
 * ## Undecided
 *
 * A per-source registration date does not exist anywhere in the data model
 * yet — adding one is F1.5/`../source/`'s call, not this module's, and that
 * directory is outside this bead's `owns`. Until it exists, "as of when"
 * here is the reading's own `asOf`, never the document's registration date;
 * a caller wanting the finer claim needs that capability built first.
 *
 * ## INV-1 / §7.1
 *
 * Pure. No `obsidian`, no vault I/O, no clock — `asOf` is supplied by the
 * caller, never read here.
 */

import type { GroveCourseModel } from '../scope/grove.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One course's row in the cross-course scope reading. See the module doc for
 * why the grove's three-way status collapses to two here.
 */
export type CourseScopeReading =
  | {
      readonly course: string;
      readonly status: 'no-denominator-yet';
    }
  | {
      readonly course: string;
      readonly status: 'declared';
      /** `GroveCourseModel.summary.denominatorCount`, verbatim — never a ratio (F8.3). */
      readonly denominatorCount: number;
      /** `GroveCourseModel.summary.builtCount`, verbatim — never combined with `denominatorCount` into a single figure. */
      readonly builtCount: number;
      /** Which registered documents supplied this course's denominator (F8.1) — never invented, never borrowed from another course's row. */
      readonly denominatorSourcePaths: readonly VaultPath[];
    };

/**
 * F6.2's cross-course scope reading. No field here sums or ranks across
 * courses — see module doc.
 */
export interface CrossCourseScopeOverview {
  /** One row per course model supplied, in course-code order — never ordered by how well each course is going (principle 12, matching `mastery-overview.ts`). */
  readonly courses: readonly CourseScopeReading[];
  /** Echoed, not computed — when this reading was taken. See module doc's "as of when" note; this is deliberately not a per-source registration date. */
  readonly asOf: string;
}

/** Names forbidden on any cross-course scope shape (F8.3) — mirrors `../scope/grove.js`'s own tripwire. */
type ForbiddenCoverageScalarKey =
  | 'ratio'
  | 'percent'
  | 'percentage'
  | 'completion'
  | 'coveragePercent'
  | 'quotient'
  | 'total';
type AssertNever<T extends never> = T;
type _assertNoCoverageScalarOnReading = AssertNever<
  Extract<keyof CourseScopeReading, ForbiddenCoverageScalarKey>
>;
type _assertNoCoverageScalarOnOverview = AssertNever<
  Extract<keyof CrossCourseScopeOverview, ForbiddenCoverageScalarKey>
>;

function byCourse(a: CourseScopeReading, b: CourseScopeReading): number {
  return a.course < b.course ? -1 : a.course > b.course ? 1 : 0;
}

/**
 * Assemble the cross-course scope reading from each running course's own,
 * independently-computed `GroveCourseModel`
 * (`../scope/grove.js#buildGroveModel`, one call per course — this function
 * performs none of that computation and re-derives nothing about extraction,
 * denominators or coverage states).
 *
 * A duplicated course in `models` is the caller's bug (one model per running
 * course, by construction of `buildGroveModel`'s own per-course contract) and
 * is not de-duplicated here — silently dropping a duplicate would hide
 * exactly the kind of error this reading exists to surface honestly, the
 * same posture `buildGroveModel` itself takes toward a caller's malformed
 * input.
 */
export function buildCrossCourseScopeOverview(
  models: readonly GroveCourseModel[],
  asOf: string,
): CrossCourseScopeOverview {
  const courses: CourseScopeReading[] = models
    .map((model): CourseScopeReading => {
      if (model.status !== 'declared') {
        return { course: model.course, status: 'no-denominator-yet' };
      }
      return {
        course: model.course,
        status: 'declared',
        denominatorCount: model.summary.denominatorCount,
        builtCount: model.summary.builtCount,
        denominatorSourcePaths: model.summary.denominatorSourcePaths,
      };
    })
    .sort(byCourse);

  return { courses, asOf };
}
