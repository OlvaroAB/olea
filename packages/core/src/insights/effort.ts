/**
 * F6.5(b) — effort imbalance: where the time went, against what the plan's
 * own window accounting says this course is owed.
 *
 * ## Re-specified against window accounting (`ol-v7r5.33`), not raw weight
 *
 * This detector used to compare her time share against a course's raw
 * assessment-weight share (grade points in, grade points out). `[D-081]` and
 * `[D-092]` since ruled that cross-course fairness is not a grade-weight
 * ratio at all: component 3.5 (`computeAttentionShares`, `olea-service`'s
 * `src/plan/allocation.ts`) computes a **windowed floor** per course — a
 * guaranteed minimum share of her attention over a rolling window of her
 * sittings, honoured once a course goes too long without meeting it
 * (`[D-092]`'s starvation bound), and already blending worth, proximity,
 * readiness and tempo far more carefully than a bare weight ratio ever did.
 * Re-deriving that formula here would duplicate a component the register
 * marks `boundary: service` (`docs/Olea_component_register.md` row 3.5) —
 * the same "a signal belongs in exactly one layer" rule `allocation.ts`'s own
 * doc states about the proximity half-life. So this module does not compute
 * a floor; it reads the one the plan already computed, carried in the cached
 * study-plan artifact (`StudyPlanAllocationEntry.contributions`, the entry
 * named `'floor'`, `packages/contracts/src/study-plan.ts`) and restated here
 * as a per-course fraction rather than a contribution-array lookup a caller
 * would otherwise have to know how to perform.
 *
 * `docs/Olea_semester_narrative.md` §9 (seam S1) states the corrected claim
 * precisely: *"a course at or above its floor while the other dominates is
 * correct concentration; a course below its floor is the real problem... So
 * 'most of your time went to X' is a problem precisely when the window says
 * Y is owed, and never otherwise."* That is exactly what comparing
 * `timeShare` against `floorShare` (rather than against a grade-weight
 * share) now says, and nothing more.
 *
 * **What did not change:** the course-naming rule (`ol-7j54` / ARC-1,
 * `../insights/index.ts`'s module doc), the never-fires-in-the-negative
 * shape, and the "a course with a floor and no time is included at zero,
 * never dropped" honesty property. The sufficiency floor on sample size
 * (`MIN_TIMED_REVIEWS`) is unchanged in *value*, but its population moved —
 * see "The sufficiency gate reads the whole log", below
 * (`ol-egov.141.89.11.7`).
 *
 * ## This one is validated, and that was not a given
 *
 * The counting primitives for this insight have existed in
 * `packages/synthetic/src/measures.ts` since SYN-1 (`reviewCountByCourse`,
 * `timeSpentMsByCourse`) — but for a long time there was **no persona carrying
 * a planted effort imbalance**, only spacing/cramming and instrument-skip. A
 * detector can be written against primitives; it cannot be *validated* against
 * a corpus that contains no instance of what it detects, and "the arithmetic is
 * obviously right" is precisely the argument this project has stopped
 * accepting.
 *
 * So the persona was built first (`olea-synthetic`'s `lopsided-effort`, whose
 * `Behaviour.courseTakeRate` starves one course of her attention while leaving
 * every other knob at its neutral value), and this detector is held to the same
 * standard as the crammer's: it must fire on that persona's stream and go
 * quiet on the stream generated from the same seed with
 * `planted.neutralise` applied. That pair is asserted in
 * `packages/workbench/test/trends-scenarios.spec.ts`; the persona's own
 * planted pattern is asserted independently, in the generator's vocabulary, in
 * `packages/synthetic/test/personas.spec.ts`. **That workbench pairing lives
 * outside this bead's owned paths (`ol-v7r5.33` owns `packages/core/src/
 * insights/` and `packages/plugin/src/today/copy.ts`), and was updated
 * pragmatically rather than left broken by the rename: `TRENDS_ASSESSMENTS`
 * now builds `CourseFloorShare[]` by summing and normalising the synthetic
 * curriculum's assessment weights per course — the exact arithmetic
 * `detectEffortImbalance` itself used to perform internally before this
 * re-spec moved it out to the caller — so every number the workbench already
 * showed (the 57%/43% split, the 40/40 and 0/40 firing counts) is
 * byte-identical. It is a labelled placeholder, not a real
 * `computeAttentionShares` output (component 3.5 is server-only); see
 * `trends-scenarios.ts`'s own doc on `TRENDS_ASSESSMENTS`.**
 *
 * ## What it compares — now on ONE window, ONE unit (`ol-v7r5.63` / `[DOS-C4]`)
 *
 * **Re-specified again, this time for commensurability.** Before this fix,
 * `timeShare` was computed over however much history a caller happened to
 * hand in — production windows it at `DEFAULT_STREAK_WINDOW_DAYS` (120 days,
 * `packages/plugin/src/today/data-source.ts`) — while `floorShare` is the
 * service's own windowed-floor fraction, denominated in **sittings** over a
 * `runningCourses + slack` window (`[D-092]`, `WINDOW_SLACK_SITTINGS = 2` in
 * `olea-service`'s `src/plan/allocation.ts`, read-only reference here since
 * component 3.5 is `boundary: service`). A 120-day calendar window and a
 * `(n+2)`-sitting window are not the same window, and comparing shares taken
 * over each as though they were commensurable is exactly the defect the
 * dossier review found (review-response.md row 8): for `n=4` or `n=5`
 * running courses the service's floor (`max(0.12, 1/(n+2))`, `0.167`/`0.143`)
 * is *smaller* than the old absolute `MIN_GAP` itself, making the finding
 * structurally unreachable regardless of how neglected a course really was.
 *
 * **The fix is internal to this detector, not a change to what a caller
 * supplies.** `entries` may still arrive pre-windowed at whatever calendar
 * width a caller chooses (120 days, or the whole log) — this module now
 * clusters them into sittings itself (`../session/cluster.js`'s
 * `clusterReviewSessions`, `[SESS-13]`/`[D-091]`'s own contract-grade
 * clustering rule, the identical rule `floorShare`'s own `[D-092]` window is
 * denominated in) and reads `timeShare` over only the most recent
 * `windowWidthSessions(n)` sittings (`../study-session/window.js`, the same
 * `runningCourses + slack` formula the service side declares independently —
 * see that module's own doc on why the two declarations are not imported
 * from one another), where `n` is the number of courses with a known floor
 * share. A calendar pre-filter wider than the true window is harmless (this
 * module narrows further, internally); a calendar pre-filter narrower than
 * it would silently truncate sittings the window is owed, which is a caller
 * contract this module's own doc now states explicitly, below.
 *
 * Two shares, per course, both now read over that same sittings window:
 *
 * - **time share** — milliseconds of review time attributed to the course
 *   **within the windowed sittings only**, over the total across the courses
 *   being compared, also windowed. A record's `durationMs` is attributed
 *   **in full to every distinct course among its concepts**, not split
 *   between them (v3's many-to-many evidence, D-020/`ol-t3sd`): the time
 *   really was spent, and it really is evidence for each of them. The same
 *   rule `timeSpentMsByCourse` already documents.
 * - **floor share** — the course's own windowed-floor fraction from the plan's
 *   most recent computation (`[D-092]`), `0..1`, **taken as given, never
 *   renormalised across the compared courses.** Unlike the old weight share,
 *   a floor share is already an absolute fraction of the whole plan's window —
 *   renormalising it against only the courses this detector happens to have a
 *   floor for would inflate it the moment any running course's floor is
 *   unknown, which is exactly the silent-narrowing the honesty properties
 *   below refuse to do to `timeShare`'s own count.
 *
 * The finding is the *gap* between them, `floorShare - timeShare`, and it is
 * signed on purpose: a positive gap is a course that has logged less time
 * than its own guaranteed minimum — the "below its floor" case the semester
 * narrative names as the real problem. The negative direction (logging more
 * than the floor) is measured too and deliberately **not** surfaced as a
 * finding: a course sitting above its floor while another dominates is, in
 * the ruling's own words, "correct concentration," not an imbalance.
 * `gap` remains diagnostic only — see below for what actually fires the
 * finding now.
 *
 * ## The parameter, re-expressed as a shortfall RATIO (`ol-v7r5.63` / `[DOS-C4]`)
 *
 * **`MIN_GAP`'s absolute framing is retired as the firing criterion.** An
 * absolute gap (`floorShare - timeShare >= 0.2`) can only ever reach as high
 * as `floorShare` itself (at zero attention), so for any course whose floor
 * is below `0.2` — every `n >= 4` under `max(0.12, 1/(n+2))`, and `n = 3`'s
 * own floor sits exactly AT `0.2`, a single-point knife-edge reachable only
 * at literally zero attention — the finding was structurally unreachable no
 * matter how neglected the course really was. `findings/effort-gap-sweep.md`
 * (`olea-service`)'s addendum sweeps this claim across `n = 2..6` at the
 * real floor formula (no corpus needed — reachability here is a fact about
 * the formula, not about any persona).
 *
 * The criterion is now a **shortfall ratio**: a course fires when its time
 * share is under `SHORTFALL_RATIO_K` of its own floor share
 * (`timeShare < SHORTFALL_RATIO_K * floorShare`, and only in the positive
 * direction — `gap > 0` still gates it, per the honesty property above).
 * This is reachable at every `n` by construction: zero attention gives
 * `0 < K * floorShare` for any `floorShare > 0`, regardless of how small the
 * floor itself is. `SHORTFALL_RATIO_K = 0.5` — "the course received under
 * half of what its own floor guarantees it" — is the plain-English pin
 * `findings/effort-gap-sweep.md`'s addendum picks inside the swept band,
 * chosen the same way `MIN_GAP` itself was originally chosen (a statement
 * that survives being said out loud), not fitted to a corpus (N-015). See
 * that finding for the full sweep, the fact/inference split, and the revisit
 * condition (real `sittingsSinceFloorMet` / floor-share history, once a term
 * of it exists, re-sweeps `K` against measured shortfalls rather than the
 * structural argument alone). **Class B, provisional per `[D-194]` bucket
 * one** (a structural-fact number: sensitivity sweep plus a plain-English
 * pin), same posture the session-clustering gap constant takes in
 * `../session/cluster.js`.
 *
 * `MIN_GAP` (0.2) is **retained, unchanged, but no longer read by this
 * module's own firing logic** — `packages/workbench/test/trends-scenarios
 * .spec.ts` (outside this bead's owned paths) still imports it as a bare
 * diagnostic comparison against `widestGap` (which is still computed
 * identically, `floorShare - timeShare`), and removing the export would be a
 * compile break in a file this bead cannot edit. Updating that spec to
 * assert against `SHORTFALL_RATIO_K` instead is filed as a follow-up
 * (`ol-1ojq` [DOS-C4-b]) rather than done here.
 *
 * ## The sufficiency gate reads the whole log (`ol-egov.141.89.11.7`)
 *
 * **Bug, found and fixed.** `1fd420e` (`ol-v7r5.63` / `[DOS-C4]`) correctly
 * put `timeShare` and `floorShare` on the same sittings window for
 * commensurability, above — but as a side effect of routing the module's one
 * counting loop through `windowedReviewsOf`, `MIN_TIMED_REVIEWS` started
 * being checked against `weightedReviewCount` taken over that SAME narrow
 * window (for two courses, `2 + WINDOW_SLACK_SESSIONS(2) = 4` sittings) —
 * despite that commit's own comment on the constant saying it was
 * "unchanged by the window-accounting re-spec". At realistic sitting sizes
 * (a real, or this repo's own synthetic, sitting averages one to two timed
 * reviews) four sittings essentially never reach 40, so the insight read
 * `not-enough-history` almost unconditionally, in production too, no matter
 * how much history existed beyond the window — more history could not
 * rescue it, because history outside the window was structurally invisible
 * to the gate. Reproduction: `./effort.spec.ts`'s "the sufficiency gate
 * reads the whole log" describe block.
 *
 * The fix does not touch commensurability, which is a property of the GAP
 * comparison (`floorShare - timeShare`, both windowed) and is unaffected by
 * how wide a population merely counts evidence. `weightedReviewCount` and
 * `timedReviewCount` (`allReviewsOf`, below) are now counted over the WHOLE
 * clustered log — restoring the pre-`1fd420e` population (the loop used to
 * read `input.entries` directly, whatever calendar width a caller supplied,
 * up to the whole log) — while `timeShare` itself stays read over the narrow
 * D-092 window exactly as `1fd420e` specified. This is the same split
 * `study-session/window.ts`'s `computeWindowDeficit` already makes between
 * its windowed `deficit` and its whole-history `sessionsSinceLastServed`.
 * **Class B**, same posture `1fd420e`'s own SHORTFALL_RATIO_K pin took: a
 * bug fix restoring a constant's stated intent, not a new threshold or a
 * contract change.
 *
 * **Second pass, same bead: `MIN_WINDOWED_TIMED_REVIEWS`.** Widening the
 * log-wide gate alone is a Class C change on its own, by David's own
 * direction: the log-wide gate had been acting as the module's ONLY sample-
 * size protection, accidentally, at the window's own (much smaller)
 * granularity — remove it without replacement and the windowed `timeShare`
 * comparison is free to fire on sampling noise from as few as a handful of
 * windowed reviews (measured: `trends-healthy`, a balanced persona, false-
 * fired `observed`; the `lopsided-effort` persona's neutralised twin false-
 * fired on 19 of 40 seeds; three no-imbalance personas false-fired on 51 of
 * 120). `MIN_WINDOWED_TIMED_REVIEWS` restores that protection as its own
 * declared, named, separately-overridable floor — see its own doc for why
 * its default reproduces `HEAD` exactly, and `EffortDetectionOptions` for
 * how a sweep varies it without touching the declared value.
 *
 * Below this many timed reviews across the courses with a known floor share,
 * a split between them is noise and the detector declines.
 *
 * **A count, not a duration, and the first version of this was a duration.** It
 * was `30 * 60 * 1000` — half an hour of attributed review time — which reads
 * as a sensible floor and measures the wrong thing: it conflates "too few
 * observations to estimate a share" with "her answers are quick". A student
 * with two hundred fast MCQ answers has a perfectly stable split and under a
 * millisecond floor could be refused; a student with six long explain-backs has
 * no split worth reporting and could pass. Sample size is the property that
 * makes a share trustworthy, so sample size is what is counted.
 *
 * The change was made after the floor blocked every persona on a synthetic
 * corpus whose whole deck is 24 instruments — recorded here rather than
 * smoothed over, because "a threshold moved after it inconvenienced a test" is
 * the exact shape N-015 exists to catch. What makes this one legitimate is that
 * it is a **sufficiency** floor and not a detection threshold: it decides
 * whether the question is answerable, never which way the answer goes.
 * `MIN_GAP` is the detection threshold, and it has not moved.
 *
 * ## Two honesty properties built into the shape
 *
 * 1. **A course with a floor share and no time is included, at time share
 *    zero.** Dropping it would make the loudest possible finding the one
 *    thing this detector cannot say.
 * 2. **Courses with no known floor share are excluded from BOTH totals**, and
 *    counted in `coursesWithoutFloorShare` so a caller can say what was left
 *    out. Folding them in at floor-share zero would report every course the
 *    plan has not (yet) allocated for as under-served, which is an artefact
 *    of the plan cache's own coverage and not a fact about her term.
 *
 * ## Why this reports one named course, never an aggregate (`ol-7j54` / ARC-1)
 *
 * `widestGapCourse` is deliberately a single course, not a summary over all of
 * them: "your courses are imbalanced" would be an unscoped claim that could be
 * correct behaviour for a course just starting and a real problem for a course
 * near its end at the very same moment (the three phases are per-course, not
 * per-student). Naming the one course the widest gap belongs to is what lets
 * the copy layer meet `../insights/index.ts`'s course-naming rule — see its
 * doc — instead of presenting a fact whose truth silently depends on a phase
 * this module does not compute.
 *
 * ## Reachability note (`[D-072]` clause 5)
 *
 * **RETRACTED, `ol-v7r5.63` (`[DOS-C4]`) — the paragraph this replaces
 * (visible in git history) was stale.** It said `createVaultTrendsSource`
 * returns `[]` unconditionally and that this re-spec has "no production
 * caller supplying real floor shares today". That has not been true since
 * `ol-v7r5.38` (commit `2afcc76`): `packages/plugin/src/today/data-source.ts`'s
 * `createVaultTrendsSource` reads a real allocation through
 * `deps.studyPlanStore` when supplied, and `main.ts`'s Today-panel call site
 * (`main.ts:902-905`) passes its cached `studyPlanStore` in production. The
 * detector itself (`detectEffortImbalance`) is likewise wired end to end:
 * `main.ts` builds the Today view → `loadTodayPanel` → `buildTodayPanel`
 * (`packages/core/src/today/panel.ts:280`) → `buildInsights`
 * (`./index.ts`) → `detectEffortImbalance`. **This module has a real
 * production caller, and has since `ol-v7r5.38`.**
 *
 * What remains true, and is not a caller gap: `listCourseFloorShares`
 * returns `[]` on a cold start (no plan cached yet), which correctly reads
 * here as `not-enough-history` rather than a fabricated zero — the honest
 * degrade, not an absent producer.
 *
 * **A real gap this bead's own scope does not close**, filed rather than
 * silently left: `sittingsSinceFloorMet` (`../allocation/resolve-inputs.ts`)
 * — the starvation counter the service side reads to decide whether a
 * course's floor is *forced* this round — gains a pure producer function in
 * this bead, but wiring a production caller to hand it real session history
 * is a follow-up (`ol-feza` [DOS-C4-a]), the same posture this very
 * paragraph used to (wrongly) claim about floor shares.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { clusterReviewSessions } from '../session/cluster.js';
import { windowWidthSessions } from '../study-session/window.js';
import type { ConceptCourses, InsightResult } from './types.js';

/**
 * **No longer the live firing threshold** — see the module doc's "The
 * parameter, re-expressed as a shortfall RATIO" section (`ol-v7r5.63` /
 * `[DOS-C4]`). Retained, unchanged, only because
 * `packages/workbench/test/trends-scenarios.spec.ts` (outside this bead's
 * owned paths) imports it for a bare diagnostic comparison against
 * `widestGap`, which is still computed identically
 * (`floorShare - timeShare`) and so is unaffected by which criterion this
 * module fires on internally. The smallest gap that survives being
 * described out loud ("a fifth of the window's attention short of what the
 * course was guaranteed") — see `SHORTFALL_RATIO_K` for the constant that
 * actually decides `status` now.
 */
export const MIN_GAP = 0.2;

/**
 * The shortfall ratio: a course fires when its time share is under this
 * fraction of its own floor share (`timeShare < SHORTFALL_RATIO_K *
 * floorShare`, only in the positive-gap direction). `0.5` — "the course
 * received under half of what its own floor guarantees it" — is the
 * plain-English pin `findings/effort-gap-sweep.md`'s addendum (`olea-service`)
 * picks after sweeping `n = 2..6` at the real floor formula
 * (`max(0.12, 1/(n+2))`); unlike an absolute gap, a ratio is reachable at
 * zero attention for every `n`, closing row 8's structural-unreachability
 * defect. Declared, not fitted (N-015) — `[D-194]` bucket one, Class B,
 * provisional; revisit condition in the finding.
 */
export const SHORTFALL_RATIO_K = 0.5;

/**
 * Below this many timed reviews across the courses with a known floor share,
 * a split between them is noise and the detector declines.
 *
 * **A count, not a duration** — see the module doc for the full argument.
 * The VALUE is unchanged by the window-accounting re-spec (`ol-v7r5.63` /
 * `[DOS-C4]`); the POPULATION it is checked against is not — see the module
 * doc's "The sufficiency gate reads the whole log" (`ol-egov.141.89.11.7`):
 * counted over the whole clustered log, never the narrow D-092 window
 * `timeShare` itself reads.
 */
export const MIN_TIMED_REVIEWS = 40;

/**
 * A SEPARATE, declared floor on how many weighted reviews fall INSIDE the
 * D-092 sittings window itself (`ol-egov.141.89.11.7`, second pass).
 * `MIN_TIMED_REVIEWS` above answers "is there enough history, log-wide, to
 * trust a share estimate at all" — it says nothing about how much of that
 * history the window (`windowedReviewsOf`) actually holds, and `timeShare`
 * is read only from inside that window. Before this pass, that WAS the gate
 * this module effectively had, as an accident of `1fd420e` routing the one
 * counting loop through the window — this constant makes that same
 * protection explicit, declared, and separately overridable rather than an
 * unnamed side effect of a population bug.
 *
 * **The default, `40`, is deliberately TODAY'S (HEAD) behaviour, not a
 * considered value.** At `40` this floor is, at realistic sitting
 * granularity, essentially unreachable inside a 4-sitting window (two
 * courses: `windowWidthSessions(2)`) — a real sitting is small (median
 * 1.6–2.35 weighted reviews/sitting, measured directly on the workbench's
 * own `steady-reviewer`/`lopsided-effort` personas over 90 days: 62
 * sittings/146 reviews and 54 sittings/86 reviews respectively, with only
 * 4–7 reviews inside the last 4 sittings). So at the default, this module's
 * behaviour on every current workbench and core fixture is BYTE-IDENTICAL
 * to `HEAD` before this bead's first pass — including
 * `packages/workbench/test/trends-scenarios.spec.ts`'s seven originally
 * failing effort cases, which stay failing at this default, on purpose.
 * Lowering it is a Class C threshold call this module does not make; see
 * this bead's report ("Proposed decisions") for the sweep and the
 * recommendation. `EffortDetectionOptions.minWindowedTimedReviews` is the
 * override sweeps and tests use to see the other side of it.
 */
export const MIN_WINDOWED_TIMED_REVIEWS = 40;

/** The minimum a comparison needs to exist at all. */
export const MIN_COURSES_WITH_FLOOR_SHARE = 2;

/**
 * The structural subset of `StudyPlanAllocationEntry`
 * (`packages/contracts/src/study-plan.ts`, A2.5/component 3.5) this detector
 * reads — a course's own windowed-floor fraction, restated as a plain field
 * so a caller does not have to know the `contributions`-array shape (the
 * entry named `'floor'`) to supply this detector. `undefined` means "the plan
 * has nothing to say about this course's floor right now" (no cached plan, a
 * course the plan has not run for, or a stale plan predating this course) —
 * the same "absence, never a guessed number" convention the rest of A2.5's
 * own schema already uses.
 */
export interface CourseFloorShare {
  readonly course: string | undefined;
  /** This course's windowed floor, `0..1` (`[D-092]`) — taken as given, never renormalised here. */
  readonly floorShare: number | undefined;
}

export interface CourseEffort {
  readonly course: string;
  /** Milliseconds of review time attributed to this course. */
  readonly timeMs: number;
  /** This course's share of the attributed time, across courses with a known floor share only. */
  readonly timeShare: number;
  /** This course's windowed floor share, exactly as the plan's own computation stated it (`[D-092]`). */
  readonly floorShare: number;
  /** `floorShare - timeShare`. Positive when the course has logged less time than its own guaranteed minimum. */
  readonly gap: number;
}

export interface EffortMeasured {
  /** Every course with a known floor share, sorted by `gap` descending — the widest first. */
  readonly courses: readonly CourseEffort[];
  /** The widest positive gap, or `0` when none is positive. */
  readonly widestGap: number;
  /** The course carrying `widestGap`, or `null` when no gap is positive. */
  readonly widestGapCourse: string | null;
  readonly totalTimeMs: number;
  /**
   * Reviews that contributed time to any course, across the WHOLE clustered
   * log (`ol-egov.141.89.11.7`) — the sufficiency population, not the
   * (narrower) population `totalTimeMs`/`courses[].timeMs` are actually
   * summed over, below. Reviews with a `null` duration contribute none.
   */
  readonly timedReviewCount: number;
  /**
   * Of those, the ones on a course with a known floor share — the sample
   * size behind the sufficiency check (`MIN_TIMED_REVIEWS`), log-wide. NOT
   * the sample size behind the share itself, which reads only the narrower
   * D-092 sittings window `timeShare` is denominated in; a passed
   * sufficiency check says there is enough history to trust a share in
   * principle, not that the current window holds much of it.
   */
  readonly weightedReviewCount: number;
  /**
   * The same "on a course with a known floor share" count as
   * `weightedReviewCount`, but counted ONLY within the D-092 sittings
   * window `timeShare` itself is read over (`ol-egov.141.89.11.7`, second
   * pass) — the sample size the SHARE actually rests on, checked against
   * `MIN_WINDOWED_TIMED_REVIEWS`. Can be far smaller than
   * `weightedReviewCount`: passing the log-wide sufficiency check does not
   * mean the window holds much of that history.
   */
  readonly windowedWeightedReviewCount: number;
  /**
   * Courses that appear in her review history but have no known floor share
   * from the plan, so are in neither total. Surfaced so a caller can say what
   * was left out rather than quietly narrowing the claim.
   */
  readonly coursesWithoutFloorShare: readonly string[];
}

export type EffortInsight = InsightResult<EffortMeasured>;

export interface EffortInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  readonly floorShares: readonly CourseFloorShare[];
}

/**
 * `ol-egov.141.89.11.7` (second pass). Same posture
 * `ClusterReviewSessionsOptions.gapSeconds` already takes: an override for
 * sweeps and tests ONLY — production reads the declared constant.
 */
export interface EffortDetectionOptions {
  /** Override {@link MIN_WINDOWED_TIMED_REVIEWS}. Sweeps and tests only. */
  readonly minWindowedTimedReviews?: number;
}

/**
 * The reviews `timeShare` (the share itself) is actually computed over: the
 * local `[SESS-13]`/`[D-091]` sitting clustering, narrowed to the most
 * recent `windowWidthSessions(coursesWithFloorShare)` sittings — the same
 * window width formula (`runningCourses + slack`) `[D-092]`'s own
 * service-side floor-share window is denominated in (`ol-v7r5.63` /
 * `[DOS-C4]`; see the module doc's "What it compares" section). `entries`
 * may arrive pre-windowed at a wider calendar cut (production windows at
 * `DEFAULT_STREAK_WINDOW_DAYS`) — that is harmless, since this function only
 * ever narrows further. A caller passing a calendar window NARROWER than
 * this true sittings window would silently truncate sittings the window is
 * owed, which is a contract on the caller this function cannot itself
 * detect or repair.
 *
 * **Not the population `MIN_TIMED_REVIEWS` is checked against** — see
 * `allReviewsOf`, below, and the module doc's "The sufficiency gate reads
 * the whole log" section (`ol-egov.141.89.11.7`).
 */
function windowedReviewsOf(
  entries: readonly ReviewLogEntry[],
  coursesWithFloorShare: number,
): readonly ReviewLogRecord[] {
  const sittings = clusterReviewSessions(entries);
  const width = windowWidthSessions(coursesWithFloorShare);
  const windowed = width > 0 ? sittings.slice(Math.max(0, sittings.length - width)) : sittings;
  return windowed.flatMap((sitting) => sitting.reviews);
}

/**
 * The reviews the sufficiency gate (`MIN_TIMED_REVIEWS`) is counted over:
 * every clustered review in the log, never narrowed to the D-092 sittings
 * window `windowedReviewsOf` applies to `timeShare` (`ol-egov.141.89.11.7`,
 * discovered from `ol-egov.141.89.11.6`). Sample size is a fact about how
 * much evidence exists at all to trust a share estimate — a question about
 * the whole log — not about how much of it fell inside the narrow window a
 * share happens to be read over; `study-session/window.ts`'s own
 * `sessionsSinceLastServed` (`computeWindowDeficit`) takes the identical
 * posture, reading its whole supplied history while `deficit` itself stays
 * windowed, for the same reason.
 *
 * Still clustered (`clusterReviewSessions`), not `entries` raw — clustering
 * also drops non-review records and entries with an unparseable timestamp,
 * the same tolerance the windowed reading gets, so a record uncounted by one
 * is uncounted by the other for the same reason, never a different one.
 */
function allReviewsOf(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return clusterReviewSessions(entries).flatMap((sitting) => sitting.reviews);
}

/** The floor-share-eligible courses a review's concepts touch — shared by both the sufficiency count and the windowed time attribution, so what counts as "on a course with a known floor share" cannot silently drift between them. */
function coursesForRecord(
  record: ReviewLogRecord,
  coursesOfConcept: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const courses = new Set<string>();
  for (const conceptId of record.conceptIds) {
    for (const course of coursesOfConcept.get(conceptId) ?? []) courses.add(course);
  }
  return courses;
}

function abstain(reason: string): EffortInsight {
  return { id: 'effort-balance', status: 'not-enough-history', measured: null, reason };
}

/** Pure. Reads no clock and no vault. */
export function detectEffortImbalance(
  input: EffortInput,
  options: EffortDetectionOptions = {},
): EffortInsight {
  const minWindowedTimedReviews = options.minWindowedTimedReviews ?? MIN_WINDOWED_TIMED_REVIEWS;
  const floorShareByCourse = new Map<string, number>();
  for (const entry of input.floorShares) {
    const { course, floorShare } = entry;
    if (course === undefined || course === '') continue;
    if (floorShare === undefined || !Number.isFinite(floorShare) || floorShare <= 0) continue;
    // One floor share per course from the plan, not summed across records —
    // a later entry for the same course (a plan re-read, say) replaces
    // rather than accumulates.
    floorShareByCourse.set(course, floorShare);
  }
  if (floorShareByCourse.size < MIN_COURSES_WITH_FLOOR_SHARE) {
    return abstain(`fewer than ${MIN_COURSES_WITH_FLOOR_SHARE} courses have a known floor share`);
  }

  const coursesOfConcept = new Map<string, readonly string[]>();
  for (const concept of input.concepts) coursesOfConcept.set(concept.conceptId, concept.courses);

  // Sufficiency, over the WHOLE log (`ol-egov.141.89.11.7`): is there enough
  // history at all to trust a share estimate? See `allReviewsOf`'s doc —
  // this population is deliberately wider than the one `timeShare` itself
  // reads, below.
  let timedReviewCount = 0;
  let weightedReviewCount = 0;
  for (const record of allReviewsOf(input.entries)) {
    if (record.durationMs === null) continue;
    const courses = coursesForRecord(record, coursesOfConcept);
    if (courses.size === 0) continue;
    timedReviewCount += 1;
    // Counted once per record, however many floor-share courses it touches.
    let countsTowardWeighted = false;
    for (const course of courses) {
      if (floorShareByCourse.has(course)) countsTowardWeighted = true;
    }
    if (countsTowardWeighted) weightedReviewCount += 1;
  }

  if (weightedReviewCount < MIN_TIMED_REVIEWS) {
    return abstain(
      `fewer than ${MIN_TIMED_REVIEWS} timed reviews on a course with a known floor share`,
    );
  }

  // The share itself, windowed to the D-092 sittings window `floorShare` is
  // denominated in (see the module doc's "What it compares" section) — a
  // narrower, and possibly empty, population than the one the sufficiency
  // check above just cleared. That is by design: passing the sufficiency
  // gate says there is enough history to trust a share in principle, not
  // that the current window itself holds much of it — a course can still be
  // reported at `timeShare` zero within the window, which is exactly the
  // "included at zero, never dropped" honesty property below.
  const timeByCourse = new Map<string, number>();
  const seenCourses = new Set<string>();
  let windowedWeightedReviewCount = 0;
  for (const record of windowedReviewsOf(input.entries, floorShareByCourse.size)) {
    if (record.durationMs === null) continue;
    // Set semantics: two of a record's concepts sharing a course must not
    // attribute that record's time to it twice.
    const courses = coursesForRecord(record, coursesOfConcept);
    if (courses.size === 0) continue;
    // Mirrors `weightedReviewCount`'s own definition above, exactly, but
    // over the windowed population — counted once per record, however many
    // floor-share courses it touches.
    let countsTowardWeighted = false;
    for (const course of courses) {
      seenCourses.add(course);
      if (!floorShareByCourse.has(course)) continue;
      countsTowardWeighted = true;
      timeByCourse.set(course, (timeByCourse.get(course) ?? 0) + record.durationMs);
    }
    if (countsTowardWeighted) windowedWeightedReviewCount += 1;
  }

  // The windowed-sample floor (`ol-egov.141.89.11.7`, second pass): the
  // log-wide sufficiency check above says nothing about how much of that
  // history actually falls inside the window `timeShare` is read over — see
  // `MIN_WINDOWED_TIMED_REVIEWS`'s own doc.
  if (windowedWeightedReviewCount < minWindowedTimedReviews) {
    return abstain(
      `fewer than ${minWindowedTimedReviews} timed reviews within the D-092 window on a course with a known floor share`,
    );
  }

  const totalTimeMs = [...timeByCourse.values()].reduce((sum, ms) => sum + ms, 0);
  if (totalTimeMs <= 0) {
    return abstain(
      `fewer than ${MIN_TIMED_REVIEWS} timed reviews on a course with a known floor share`,
    );
  }

  const courses: CourseEffort[] = [...floorShareByCourse.entries()]
    .map(([course, floorShare]) => {
      const timeMs = timeByCourse.get(course) ?? 0;
      const timeShare = timeMs / totalTimeMs;
      return { course, timeMs, timeShare, floorShare, gap: floorShare - timeShare };
    })
    .sort((a, b) => (b.gap !== a.gap ? b.gap - a.gap : a.course < b.course ? -1 : 1));

  const widest = courses[0];
  const widestGap = widest !== undefined && widest.gap > 0 ? widest.gap : 0;
  const widestGapCourse = widest !== undefined && widest.gap > 0 ? widest.course : null;

  const coursesWithoutFloorShare = [...seenCourses]
    .filter((c) => !floorShareByCourse.has(c))
    .sort();

  const measured: EffortMeasured = {
    courses,
    widestGap,
    widestGapCourse,
    totalTimeMs,
    timedReviewCount,
    weightedReviewCount,
    windowedWeightedReviewCount,
    coursesWithoutFloorShare,
  };

  // `[DOS-C4]` / `ol-v7r5.63`: the shortfall RATIO fires, not the absolute
  // gap — `gap > 0` still gates the positive-only direction (the honesty
  // property above), and `MIN_GAP` is no longer read here at all. See the
  // module doc's "The parameter, re-expressed as a shortfall RATIO" section.
  const widestRatio =
    widest !== undefined && widest.floorShare > 0 ? widest.timeShare / widest.floorShare : 1;
  const observed = widestGapCourse !== null && widestRatio < SHORTFALL_RATIO_K;

  return observed
    ? {
        id: 'effort-balance',
        status: 'observed',
        measured,
        reason: `${widestGapCourse}'s time share (${widest?.timeShare.toFixed(3)}) is under ${SHORTFALL_RATIO_K} of its floor share (${widest?.floorShare.toFixed(3)}) — ratio ${widestRatio.toFixed(3)}`,
      }
    : {
        id: 'effort-balance',
        status: 'not-observed',
        measured,
        reason:
          widestGapCourse === null
            ? 'no course is below its own floor share'
            : `${widestGapCourse}'s shortfall ratio ${widestRatio.toFixed(3)} does not clear ${SHORTFALL_RATIO_K}`,
      };
}
