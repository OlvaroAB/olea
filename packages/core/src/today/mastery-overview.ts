/**
 * F6.2 — the Today panel's mastery overview, per course (`ol-lohq`).
 *
 * ## This module computes nothing
 *
 * That is the point of it, and `ol-lohq` says so in terms: *"this is a
 * rendering task over a computed value, not new computation."* Every mastery
 * number below comes out of `../mastery/sprig.ts`'s `masteryDistribution`,
 * which is itself a fold over `../mastery/rollup.ts`. What is genuinely absent
 * upstream is **grouping**, and grouping is not arithmetic: `ConceptRecord`
 * already carries `courses` (F1.3, `../concept/course.ts`), so a per-course
 * overview is `masteryDistribution` called once per course with that course's
 * concept ids. If a future reader finds themselves writing a second mastery
 * calculation in here, the answer is that they should not — the five states are
 * decided in exactly one place and this file is not it.
 *
 * ## Never one number, and the type says so
 *
 * `CourseMastery` carries a `MasteryDistribution` and no scalar. There is no
 * `averageMastery`, no percentage-complete and no course-level state, and the
 * omission is load-bearing rather than an oversight: D-031's ruling is that
 * mastery is per concept and never an aggregate (`ol-7328` for a single
 * concept; the same reasoning for a set of them), and the F6.2 scenario in
 * `features/F6-today.md` promises "how many concepts sit in each of the five
 * named states, never a single blended score". A field that does not exist is
 * a field no renderer can find lying around — the same defence
 * `today/streak.ts` uses against `longestStreak`.
 *
 * ## A concept named but never reviewed counts as `new`
 *
 * Also promised by that scenario, and it falls out of passing the course's
 * whole concept set to `masteryDistribution` rather than only the ids the log
 * happens to name. The distinction matters on her front door: a course where
 * four of eight concepts have never been opened reads very differently from a
 * course with four concepts, and the second is what a log-derived id list would
 * have shown.
 *
 * ## M:N, and the concept in no course
 *
 * `ConceptCourses.courses` is many-to-many (F1.3). A concept in two courses is
 * counted in both distributions — it really is evidence for both, the same rule
 * `packages/synthetic`'s per-course measures already document — so course
 * totals do not necessarily sum to the concept count. A concept in **no** course
 * is counted in `unassignedConceptCount` and rendered nowhere: F6.2 is a
 * per-course surface, and a bucket labelled "other" would be a course she does
 * not have.
 *
 * ## Principle 12
 *
 * Nothing in this shape ranks courses against each other, names a course as
 * behind, or orders by anything but her own course code. The distribution is
 * information; what to make of it is hers. Ordering by "worst first" was the
 * obvious alternative and is exactly the report-card framing `ol-lohq` rules
 * out — a list whose top row is chosen by weakness says something about her
 * every time she opens the sidebar.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { ConceptCourses } from '../insights/types.js';
import type { MasteryRollupOptions } from '../mastery/rollup.js';
import {
  type MasteryDistribution,
  type MasteryVitality,
  type MasteryVitalityInputs,
  masteryDistribution,
  masteryVitalityByStage,
} from '../mastery/sprig.js';

export interface CourseMastery {
  /** Her course code, verbatim from `ConceptCourses.courses` (R1/R2 — never normalised). */
  readonly course: string;
  /** How many concepts sit in each of F2.11's five named states. Never a blended score. */
  readonly distribution: MasteryDistribution;
  /**
   * F2.11's vitality axis, tallied per stage (`[D-087]`, `[D-116]`; `[VIT-2]`,
   * `ol-a3hv`) — `null` exactly when `MasteryOverviewInput.vitality` was not
   * supplied.
   *
   * **This is the data-side half of D-116's co-presence rule, and its `null`
   * is the fallback the clause itself names**: *"where a surface genuinely
   * cannot carry both, it shows neither."* `null` here means the renderer
   * cannot carry vitality alongside the distribution above, so `view.ts`
   * must show neither — never fall back to the growth-stage-only strip
   * `ol-l5og.16` found in violation. `null` today is the ordinary case: no
   * production caller supplies `vitality` yet — see that field's own doc for
   * the reachability gap and why closing it is outside this bead's `owns`.
   */
  readonly vitality: MasteryVitality | null;
}

export interface MasteryOverview {
  /** One row per course, ordered by course code. Empty when no concept names a course. */
  readonly courses: readonly CourseMastery[];
  /** Concepts belonging to no course (F1.3: a statement, not a failure). Counted, not bucketed. */
  readonly unassignedConceptCount: number;
  /** Concepts the overview ranged over, counted once each however many courses they sit in. */
  readonly conceptCount: number;
}

export interface MasteryOverviewInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  readonly options?: MasteryRollupOptions;
  /**
   * F2.11/D-116's vitality axis (`[D-087]`; `[VIT-2]`, `ol-a3hv`) — a
   * scheduler, an instant and the derived holding cut (`[D-115]`), the same
   * three things `registry/provider.ts`'s `createLocalRegistryProvider`
   * already assembles (`createFsrsScheduler()`, `deps.now()`, a locally
   * declared `holdingCut` fallback) for the identical reason: growth stage
   * is pure and vitality is not (`../mastery/rollup.ts`'s module doc).
   *
   * **Omitted by every production caller today.** `today/panel.ts`'s
   * `buildTodayPanel` — this function's one caller — calls
   * `buildMasteryOverview({ entries, concepts })` with no third field, and
   * `panel.ts` sits outside this bead's `owns`
   * (`packages/core/src/today/mastery-overview.ts`,
   * `packages/core/src/mastery/sprig.ts`, `packages/plugin/src/today/
   * view.ts`, `packages/plugin/src/today/copy.ts`,
   * `packages/plugin/styles.css`). Wiring `panel.ts` (and, above it,
   * `packages/plugin/src/today/data-source.ts`'s real provider) to supply a
   * scheduler/clock/cut is the follow-up this bead's own report names —
   * the exact shape `openSourceLocationPort`/`acceptNoteOfferPort` already
   * take in `registry/provider.ts` for the same "one bead's `owns` stops one
   * line short of the caller" reason.
   *
   * Until that lands, every `CourseMastery.vitality` is `null` and the
   * Today panel's mastery section renders nothing — D-116's own fallback,
   * and the correct interim state: never the growth-stage-only strip this
   * bead replaces.
   */
  readonly vitality?: MasteryVitalityInputs;
}

/** Pure. Reads no clock (the rollup's `asOf` belongs to `MasteryRollupOptions`) and writes nothing. */
export function buildMasteryOverview(input: MasteryOverviewInput): MasteryOverview {
  const idsByCourse = new Map<string, string[]>();
  const seenConceptIds = new Set<string>();
  let unassignedConceptCount = 0;

  for (const concept of input.concepts) {
    if (seenConceptIds.has(concept.conceptId)) continue;
    seenConceptIds.add(concept.conceptId);

    // Distinct courses only: a concept listing the same course twice is one
    // concept in that course, not two.
    const courses = new Set(concept.courses.filter((course) => course !== ''));
    if (courses.size === 0) {
      unassignedConceptCount += 1;
      continue;
    }
    for (const course of courses) {
      const ids = idsByCourse.get(course);
      if (ids) ids.push(concept.conceptId);
      else idsByCourse.set(course, [concept.conceptId]);
    }
  }

  const vitalityInputs = input.vitality;
  const courses = [...idsByCourse.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([course, conceptIds]) => ({
      course,
      distribution: masteryDistribution(input.entries, conceptIds, input.options),
      vitality:
        vitalityInputs === undefined
          ? null
          : masteryVitalityByStage(input.entries, conceptIds, vitalityInputs, input.options),
    }));

  return { courses, unassignedConceptCount, conceptCount: seenConceptIds.size };
}
