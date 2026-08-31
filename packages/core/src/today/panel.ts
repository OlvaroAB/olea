/**
 * The Today panel's view model (F6.1, P2-T09) — one pure function, so the
 * whole panel is testable without Obsidian and `packages/plugin`'s half stays
 * a renderer.
 *
 * INV-1 is the floor, not the reason. The reason is the workbench lane's
 * finding, restated: *a view that wants more than a shallow shim is a signal
 * to move logic core-ward.* Everything the panel decides — what counts as due,
 * what counts as a study day, how long the streak is, how the courses are
 * ordered — is here. `TodayView` builds DOM from this and nothing else.
 *
 * ## `due: null` is not `total: 0`
 *
 * The panel can be in a state where it genuinely does not know how many
 * instruments are waiting: enumerating them needs `ol-p2t07`'s queue
 * composition and, under that, `ol-k7eg`'s instrument-identity rule, both open
 * at the time this shipped. The honest rendering of that state is *"we cannot
 * tell you yet"*, not *"0 due today"* — the two sentences are different claims
 * and only one of them is true.
 *
 * C4.7 requires a surface to say it cannot tell rather than supply a number it
 * does not have, and that holds on a read path as much as on a generated one.
 * `ol-cvsc` made the same move for the coverage screen after `ol-1n1v`:
 * a surface that renders identically whether it counted nothing or counted
 * nothing *because it read nothing* is making a claim it cannot support.
 * `DueSummary | null` makes the distinction unrepresentable-as-a-mistake at
 * the type level rather than leaving it to the renderer's judgment.
 *
 * The streak has no equivalent state and does not need one: the review log is
 * readable today, and a vault with no log is a person who has not studied yet,
 * which is a fact and not an absence of evidence.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildCrossCourseScopeOverview,
  type CrossCourseScopeOverview,
} from '../gap/scope-overview.js';
import type { WeightedAssessment } from '../insights/effort.js';
import { buildInsights, type InsightsSummary } from '../insights/index.js';
import type { ConceptCourses } from '../insights/types.js';
import type { CourseFreshnessReading } from '../schedule/freshness.js';
import type { GroveCourseModel } from '../scope/grove.js';
import type { CalendarDay } from './calendar-day.js';
import { type DueInstrument, type DueSummary, summariseDue } from './due.js';
import { buildMasteryOverview, type MasteryOverview } from './mastery-overview.js';
import {
  detectRhythm,
  type RhythmCourseInput,
  type RhythmInsight,
  type TermWindow,
} from './rhythm.js';
import { computeStreak, DEFAULT_WEEK_LENGTH, type StreakSummary } from './streak.js';

/** Everything the panel is drawn from. */
export interface TodayPanelInput {
  /** Review-log entries covering at least `windowDays` back from `today`. */
  readonly entries: readonly ReviewLogEntry[];
  /**
   * Every instrument the panel may count, or `null` when the set cannot be
   * enumerated yet. See this module's doc: `null` and `[]` mean different
   * things and are both real.
   */
  readonly instruments: readonly DueInstrument[] | null;
  /** Suspended instruments (F2.6), folded from the log by `review-log/suspension.ts`. */
  readonly suspendedInstrumentIds?: ReadonlySet<string>;
  /** Her local calendar day. */
  readonly today: CalendarDay;
  /** The instant her local today ends — see `due.ts`. */
  readonly dueThrough: Date;
  /** How many days of history `entries` covers, ending on `today`. */
  readonly windowDays: number;
  /** Cells in the trailing strip; defaults to a week. */
  readonly weekLength?: number;
  /**
   * Her concepts and the courses they sit in (F1.3), for the F6.2 mastery
   * overview and F6.5's per-course half.
   *
   * **Absent is a third state, and it is the one every existing caller is
   * in.** `undefined` means the panel was never handed a concept set, so it
   * renders no trends section at all — not an empty one, and not a "we could
   * not read it" line. An empty array, by contrast, is a real answer (a vault
   * with no concepts yet) and produces an overview with no course rows. That
   * distinction is the same one `instruments: null` vs `[]` draws two fields
   * up, for the same reason: a surface that looks identical whether it read
   * nothing or read an empty vault is making a claim it cannot support.
   */
  readonly concepts?: readonly ConceptCourses[];
  /**
   * Her assignment notes' weights (F1.1), for F6.5's effort-imbalance half.
   * Absent behaves as empty: the effort detector then reports
   * `not-enough-history`, which is the true statement.
   */
  readonly assessments?: readonly WeightedAssessment[];
  /**
   * F6.9's rhythm reading: one entry per course a material arrival has ever
   * been observed for (`ol-v7r5.6`).
   *
   * **A third state, the same shape `concepts` documents above.** `undefined`
   * means no arrival store was wired at all, and the panel renders no rhythm
   * reading — not a false "not-enough-history" for every course she has.
   * `[]` is a real answer (an install that has never observed a material
   * arrival yet) and reaches `detectRhythm`'s own `'no courses were
   * supplied'` state, which is the true statement for a fresh install.
   */
  readonly courseMaterialArrivals?: readonly RhythmCourseInput[];
  /**
   * F6.9's asked-once term window, already resolved via `resolveTermBoundary`
   * (her recorded dates outrank the ask). Omitted or `null` means neither
   * exists yet — the reading degrades to what is arriving, without a
   * yardstick, and `detectRhythm` never blocks on its absence.
   */
  readonly termWindow?: TermWindow | null;
  /**
   * RHY-3's calendar-schedule freshness signal (`ol-4chx` -> `ol-r6s0` ->
   * `ol-hna1` -> `ol-at1a`; migrated in from a plugin-local widening by
   * `ol-ksw7`) — one reading per course the calendar-events note's matched
   * events cover, from `computeScheduleFreshness`.
   *
   * **Arrives pre-computed, unlike `mastery`/`insights`/`rhythm` above.**
   * Producing a reading needs `discoverScheduleEvents`'s vault-wide scan,
   * which this pure function does not perform — the caller (`olea-core`'s
   * schedule-extraction chain, driven today from `packages/plugin/src/
   * today/data-source.ts`'s `resolveScheduleFreshness`) computes the full
   * list and hands it over already resolved; this field is a pass-through,
   * not a derivation.
   *
   * **`undefined` (never supplied) and `null` (supplied, but the signal
   * could not be computed — no rhythm source wired yet, or the vault read
   * failed) both degrade to the same output** — see `TodayViewModel.
   * courseFreshness`. A caller that has a rhythm source wired always passes
   * one of `null` or a real reading list, never omits the key; the
   * `undefined` case exists for every other caller (tests, the workbench)
   * that has not been taught about this signal at all. `[]` is a real,
   * common answer: a vault with a calendar note but nothing overdue for any
   * course it names, or no calendar note discovered anywhere — both degrade
   * to "no yardstick" for every course, which is what a copy layer
   * (`packages/plugin/src/today/copy.ts`'s `pickRhythmYardstickReading`)
   * already does with an empty array.
   */
  readonly courseFreshness?: readonly CourseFreshnessReading[] | null;
  /**
   * F6.2's cross-course scope reading (`[D-076]` round 2, `ol-a83u` [SCP-1],
   * `ol-4qvc`) — one `../scope/grove.js#GroveCourseModel` per running course,
   * the same per-course computation the grove screen runs (one
   * `buildGroveModel` call per course). **Arrives pre-computed, the same
   * posture `courseFreshness` documents above**: assembling one needs a
   * vault-wide read (registered sources, tier-3 citations, material
   * presence, mastery) this pure function does not perform, so the caller
   * (`packages/plugin/src/today/data-source.ts`'s scope source) computes the
   * list and hands it over already built; `buildTodayPanel` only assembles
   * the cross-course reading over it (`../gap/scope-overview.js#
   * buildCrossCourseScopeOverview`), the same "grouping, not a second
   * computation" discipline that module's own doc states.
   *
   * **Three states, matching `courseFreshness` exactly**: `undefined` means
   * this panel was never wired for a scope reading at all (no section
   * rendered — not a false "no denominator yet" for every course she has);
   * `null` means a scope source was wired but the read failed (same "cannot
   * say" as `courseFreshness: null`); a real array — `[]` included — is an
   * honest answer and produces a reading with exactly that many course rows.
   */
  readonly courseScopeModels?: readonly GroveCourseModel[] | null;
}

export interface TodayViewModel {
  /** `null` when the due set could not be enumerated — never a substitute zero. */
  readonly due: DueSummary | null;
  readonly streak: StreakSummary;
  /**
   * F6.2's per-course distribution, or `null` when no concept set was supplied
   * — see `TodayPanelInput.concepts`. `null` renders as *nothing*, deliberately:
   * a panel that was never asked the question should not answer it.
   */
  readonly mastery: MasteryOverview | null;
  /**
   * F6.5's observed-pattern insights, or `null` on the same condition as
   * `mastery`. Each insight inside carries its own three-way status, so
   * "nothing to say yet" and "looked, and the pattern is not there" stay
   * distinguishable all the way to the renderer.
   */
  readonly insights: InsightsSummary | null;
  /**
   * F6.9's rhythm reading, or `null` when no arrival store was wired — see
   * `TodayPanelInput.courseMaterialArrivals`'s doc for why that is a third
   * state rather than a computed "no courses" answer.
   */
  readonly rhythm: RhythmInsight | null;
  /**
   * RHY-3's calendar-schedule freshness reading, echoed straight from
   * `TodayPanelInput.courseFreshness` — `undefined` there becomes `null`
   * here, the same "always a key, possibly null" posture `due`/`mastery`/
   * `insights`/`rhythm` above already take. See that field's doc for the
   * full state table; this function performs no further computation on it.
   */
  readonly courseFreshness: readonly CourseFreshnessReading[] | null;
  /**
   * F6.2's cross-course scope reading, assembled from
   * `TodayPanelInput.courseScopeModels` via `../gap/scope-overview.js#
   * buildCrossCourseScopeOverview`, `asOf` this panel's own `today` — never a
   * sum, never a rank across courses (F8.3, C5.7). `null` on the same two
   * conditions `courseFreshness` documents above: never wired, or wired and
   * unreadable. See `TodayPanelInput.courseScopeModels`'s doc for the full
   * state table.
   */
  readonly scope: CrossCourseScopeOverview | null;
  /**
   * How many days of review history the numbers above were computed over —
   * echoed back from `windowDays` so the panel can state its own scope rather
   * than implying it read everything (`ol-1n1v`).
   */
  readonly windowDays: number;
}

/**
 * Pure. Writes nothing, reads no clock, and is the panel's only source of
 * truth.
 *
 * Optional inputs are **resolved here, not forwarded as `undefined`**. The
 * repo runs `exactOptionalPropertyTypes`, under which "absent" and "present
 * and undefined" are genuinely different, and this function is the boundary
 * where an absent option acquires its meaning: no `weekLength` means a week,
 * no suspended set means nothing is suspended. Passing the `undefined` through
 * would push that decision one layer down and make two modules both
 * half-responsible for it.
 */
export function buildTodayPanel(input: TodayPanelInput): TodayViewModel {
  const streak = computeStreak(input.entries, {
    today: input.today,
    windowDays: input.windowDays,
    weekLength: input.weekLength ?? DEFAULT_WEEK_LENGTH,
  });

  const due =
    input.instruments === null
      ? null
      : summariseDue(input.instruments, {
          dueThrough: input.dueThrough,
          suspendedInstrumentIds: input.suspendedInstrumentIds ?? EMPTY_SUSPENDED,
        });

  // The trends half (F6.2, F6.5) is present exactly when a concept set was
  // supplied. Both fields resolve together so the renderer never has to decide
  // whether half a section is worth drawing.
  const concepts = input.concepts;
  const mastery =
    concepts === undefined ? null : buildMasteryOverview({ entries: input.entries, concepts });
  const insights =
    concepts === undefined
      ? null
      : buildInsights({
          entries: input.entries,
          concepts,
          assessments: input.assessments ?? EMPTY_ASSESSMENTS,
        });

  // F6.9 (`ol-v7r5.6`): the same "absent means never asked" third state as
  // `concepts`/`mastery`/`insights` above, not the detector's own
  // `'not-enough-history'` — a panel this was never wired for should render
  // nothing, not a claim about a course list it never received.
  const courseMaterialArrivals = input.courseMaterialArrivals;
  const rhythm =
    courseMaterialArrivals === undefined
      ? null
      : detectRhythm({
          today: input.today,
          courses: courseMaterialArrivals,
          ...(input.termWindow !== undefined ? { termWindow: input.termWindow } : {}),
        });

  // `ol-ksw7`: arrives pre-computed (see `TodayPanelInput.courseFreshness`'s
  // doc) — nothing to derive here beyond the same "undefined input becomes
  // null output" resolution every optional field on this function performs.
  const courseFreshness = input.courseFreshness ?? null;

  // F6.2's cross-course scope reading (`ol-4qvc`). `courseScopeModels`
  // arrives pre-computed (see that field's doc) — `undefined`/`null` both
  // collapse to no reading, matching `courseFreshness` above; a real list
  // (`[]` included) is assembled into the honest cross-course shape, `asOf`
  // this panel's own `today` (the reading's own timestamp — see `../gap/
  // scope-overview.js`'s module doc for why that is never a per-source
  // registration date).
  const courseScopeModels = input.courseScopeModels;
  const scope =
    courseScopeModels === undefined || courseScopeModels === null
      ? null
      : buildCrossCourseScopeOverview(courseScopeModels, input.today);

  return {
    due,
    streak,
    mastery,
    insights,
    rhythm,
    courseFreshness,
    scope,
    windowDays: input.windowDays,
  };
}

/** Shared because it is immutable and read-only — no caller can add to it. */
const EMPTY_SUSPENDED: ReadonlySet<string> = new Set<string>();

/** Same reasoning: frozen, so "no assessments supplied" cannot become a caller's scratch array. */
const EMPTY_ASSESSMENTS: readonly WeightedAssessment[] = Object.freeze([]);
