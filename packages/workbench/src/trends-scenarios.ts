/**
 * The trends surface: F6.2's mastery overview and F6.5's insights, on the real
 * `TodayView` (`ol-lohq`, `ol-p6t04`).
 *
 * Mirrors `timeline-scenarios.ts`'s shape — a state list, a finder, a builder
 * returning the real view's `deps` plus inspector data — and is a **separate
 * surface from `today-scenarios.ts` on purpose**. Those five state ids are
 * enumerated in `e2e/helpers.ts` and drive the visual-regression goldens; a
 * trends state added there would be a golden regeneration for a surface that
 * has nothing to do with the due count. Nothing in this file touches that list.
 *
 * ## Every state is a persona, and two of them are the same persona twice
 *
 * `trends-cramming` / `trends-cramming-neutralised` and `trends-course-behind` /
 * `trends-course-behind-neutralised` are pairs: same persona, same seed, same
 * everything, except that the second of each has `planted.neutralise` applied —
 * the planted pattern removed from the generator and nothing else changed.
 *
 * That is the falsifiability discipline `packages/synthetic`'s
 * `test/personas.spec.ts` holds itself to, promoted onto a screen. A detector
 * that lights up on both members of a pair is not detecting the pattern, it is
 * detecting something the persona shares with its own twin — and here you can
 * see that by clicking between two URLs rather than by reading a test. The
 * matching assertion, with the margin on both sides of each threshold, is in
 * `test/trends-scenarios.spec.ts`.
 *
 * ## What this surface deliberately does not show
 *
 * **`instruments: []`, not `null`** (`ol-9j3w`, WBF-2 — changed from `null`,
 * which this doc used to defend on the grounds that "the pane renders 'can't
 * count what's due', and that is literally true of this builder". It is not:
 * `olea-core`'s `today/panel.ts` documents `instruments: null` as meaning
 * specifically "the set could not be enumerated", and `TodayView` renders
 * that as `DUE_UNAVAILABLE` — *"it couldn't read your vault just now"*
 * (`today/copy.ts`, whose own doc says the only honest way to reach that line
 * is a walk or a log read that failed). No read was attempted here, let alone
 * failed, so `DUE_UNAVAILABLE` was the first thing this surface showed and it
 * was a false claim about what had just happened. `[]` is the panel's other,
 * true state for this builder: a real, known "nothing enumerated" rather than
 * a fabricated failure — see `today/panel.ts`'s own `null` vs `[]` distinction,
 * drawn for `concepts` two fields up for the identical reason. It renders
 * `NOTHING_DUE` ("Nothing due today.") instead, which is not this surface's
 * subject either, but is not a lie: nothing WAS enumerated, so nothing is due
 * by count.** The due half proper is `today-scenarios.ts`'s, over the real
 * fixture vault, and duplicating it here would mean maintaining a second
 * fiction about what is due.
 *
 * ## N-015
 *
 * Everything behind this surface is fabricated. It exercises machinery. No
 * number on it is evidence about the alpha user and no threshold may be tuned
 * against it.
 *
 * ## WB-8 (`ol-ppxj.31`) — vitality, wired from the same stream
 *
 * `ol-l5og.17` [VIT-3] found this surface's own reachability gap: every state
 * built `buildTodayPanel` with no `vitality` input, so
 * `MasteryOverviewInput.vitality` was never supplied and every
 * `CourseMastery.vitality` came back `null` — `TodayView.renderMastery`'s
 * D-115/D-116 all-null bail-out (`courses.every((c) => c.vitality === null)`)
 * fired for every state, and the ladder (and the sprig geometry VIT-3 put
 * inside it) never reached the screen here.
 *
 * `buildTrendsViewModel` now supplies `vitality` for every state except
 * `trends-cramming-neutralised` (`TrendsWorkbenchState.vitalityWired`) —
 * `createFsrsScheduler()`, `WORKBENCH_NOW` and a locally declared holding cut,
 * the identical three-part shape `packages/plugin/src/today/data-source.ts`'s
 * `loadTodayPanel` already assembles for the real product (`ol-95vv.5`), and
 * `packages/plugin/src/registry/provider.ts`'s `DECLARED_FALLBACK_HOLDING_CUT`
 * before it — a THIRD independent Class B declaration of the same
 * unmeasured constant, matching this codebase's existing convention of no
 * single shared `holdingCut`. **No hand-set vitality field anywhere**: the
 * reading for every course still comes out of `readAllConceptVitality`'s
 * fold over the state's own `entries`, exactly the "real core path, not a
 * hand-set field" this bead's brief asks for — a state with a thin history
 * (`trends-too-early`) reads mostly `early`, a state with ninety days of
 * regular reviews (`trends-healthy`) reads a real mix, and nothing here
 * decides a course's vitality directly.
 *
 * `trends-cramming-neutralised` is left with `vitality` omitted on purpose:
 * one state has to, or the D-115/D-116 bail-out stops being exercised by any
 * fixture at all, and this is the state whose own note is about the spacing
 * detector's measured limitation, not about the mastery ladder — no other
 * state's documented claim depends on its ladder being visible the way
 * `trends-healthy`'s and `trends-course-behind`'s notes do.
 */

import {
  buildTodayPanel,
  type ConceptCourses,
  type CourseFloorShare,
  createFsrsScheduler,
  type TodayPanelInput,
  type TodayViewModel,
} from 'olea-core';
import { WORKBENCH_NOW } from './clock.js';
import { Notice } from './obsidian-shim/index.js';
import type { TodayViewDeps } from './plugin-bridge.js';
import {
  buildCurriculum,
  CONCEPTS,
  courseDisplayName,
  generateStream,
  PERSONAS,
  type PersonaId,
  type SyntheticStream,
  streamSpec,
} from './synthetic-bridge.js';

export interface TrendsWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'trends';
  readonly persona: PersonaId;
  /** `true` for the member of a pair with `planted.neutralise` applied. */
  readonly neutralised: boolean;
  /**
   * `false` for exactly one state (`trends-cramming-neutralised`) — see this
   * file's module doc, "WB-8". `true` for the rest: `buildTrendsViewModel`
   * folds `MasteryVitalityInputs` over that state's own stream, so every
   * `CourseMastery.vitality` is a real reading rather than the D-116
   * omitted-caller fallback. Kept `false` for one state so a real fixture
   * still exercises `TodayView.renderMastery`'s D-115/D-116 all-null bail-out
   * (`view.ts`'s `courses.every((course) => course.vitality === null)`),
   * rather than that path going untested the moment every other state stops
   * hitting it.
   */
  readonly vitalityWired: boolean;
  /** Days of simulated history. One, for the too-early state. */
  readonly days: number;
  readonly note: string;
}

export const TRENDS_STATES: readonly TrendsWorkbenchState[] = [
  {
    id: 'trends-healthy',
    label: 'A spread across both courses',
    group: 'trends',
    persona: 'steady-reviewer',
    neutralised: false,
    vitalityWired: true,
    days: 90,
    note:
      'F6.2 — the mastery overview with something in most of the five named states, in both ' +
      'courses. F6.5 stays quiet: she is measured, and neither pattern is there. Silence is a ' +
      'result here, not a missing section — compare the two "detector goes quiet" states below, ' +
      'which reach the same silence from a persona that was designed to have a pattern.',
  },
  {
    id: 'trends-course-behind',
    label: 'One course behind on effort',
    group: 'trends',
    persona: 'lopsided-effort',
    neutralised: false,
    vitalityWired: true,
    days: 90,
    note:
      'F6.5(b) — her hours went almost entirely to one of two courses, and it is not the one ' +
      'carrying the larger assessment weight. The mastery strip shows the same story from the ' +
      'other side: the neglected course sits far lower down the five states. Nothing on screen ' +
      'says she is behind — it says what the weights are and what the hours were.',
  },
  {
    id: 'trends-course-behind-neutralised',
    label: 'Effort insight goes quiet (pattern removed)',
    group: 'trends',
    persona: 'lopsided-effort',
    neutralised: true,
    vitalityWired: true,
    days: 90,
    note:
      'The same persona and the same seed with planted.neutralise applied — courseTakeRate back ' +
      'to {} and nothing else touched. The effort insight disappears. If it did not, it would ' +
      'not be detecting the planted pattern, it would be detecting something she shares with ' +
      'her own twin.',
  },
  {
    id: 'trends-cramming',
    label: 'Work clustered before assessments',
    group: 'trends',
    persona: 'crammer',
    neutralised: false,
    vitalityWired: true,
    days: 90,
    note:
      'F6.5(a) — many times the daily rate in the week before an assessment, and a large share ' +
      'of items pulled forward before their due date. The assessment dates behind that are read ' +
      'out of the log itself (every record carries examProximity), never from a note that could ' +
      'have been edited since.',
  },
  {
    id: 'trends-cramming-neutralised',
    label: 'Pattern removed — and it still fires (measured limitation)',
    group: 'trends',
    persona: 'crammer',
    neutralised: true,
    // WB-8 (`ol-ppxj.31`): the one state left without a vitality input, so
    // `TodayView.renderMastery`'s D-115/D-116 all-null bail-out still has a
    // real fixture exercising it — see this file's module doc. Nothing about
    // the finding below depends on the mastery ladder being visible.
    vitalityWired: false,
    days: 90,
    note:
      'The same persona and seed with planted.neutralise applied: no cram window, no early ' +
      'pulls. The spacing insight fires anyway, and that is the finding rather than a broken ' +
      'state. Across 40 seeds the detector fires on 40/40 crammers, 0/40 of every other persona, ' +
      'and 8/40 of this neutralised twin — she studies on about a seventh of days, so 90 days ' +
      'leave roughly ten pre-assessment calendar days and one busy evening among them moves the ' +
      'rate a long way. Separating cleanly on this corpus needs a concentration threshold near ' +
      '5; it has not been moved there, because tuning a threshold on fabricated data is what ' +
      'N-015 forbids. The numbers are in test/trends-scenarios.spec.ts. Mastery vitality is ' +
      "deliberately left unwired on this one state (see trends-scenarios.ts's module doc, " +
      '"WB-8") so the D-115/D-116 all-null bail-out still has a real fixture to fire on.',
  },
  {
    id: 'trends-too-early',
    label: 'Too early to say anything',
    group: 'trends',
    persona: 'single-session',
    neutralised: false,
    vitalityWired: true,
    days: 1,
    note:
      'One day of first exposures. Both detectors decline, and the pane says so rather than ' +
      'drawing a confident empty chart — "not enough history" is a third answer, not a negative ' +
      'result. The mastery strip still renders, because "every concept is new" is a fact about a ' +
      'deck she has just met and not an absence of evidence.',
  },
];

export function findTrendsState(id: string): TrendsWorkbenchState | undefined {
  return TRENDS_STATES.find((state) => state.id === id);
}

/**
 * The same 90-day, `+00:00` window `persona/history.ts` uses, so a persona
 * looks the same on this surface as it does behind the review states. The
 * stream ends the day before `WORKBENCH_NOW` and the second assessment falls
 * three days after it.
 */
const HISTORY_START_DATE = '2026-10-17';
const HISTORY_UTC_OFFSET = '+00:00';
const HISTORY_ASSESSMENT_DAY_OFFSETS: readonly number[] = [42, 93];
const HISTORY_SEED = 'workbench';
const SINGLE_SESSION_START_DATE = '2027-01-14';

/**
 * Her concepts and their courses, from the synthetic vocabulary — the join
 * F6.2 and F6.5(b) both need and a review log cannot supply.
 *
 * A synthetic concept belongs to exactly one course by construction, so every
 * `courses` array here has one entry. The panel's own shape is M:N (F1.3) and
 * is exercised by `olea-core`'s unit tests; nothing on this surface needs a
 * second course to be interesting.
 *
 * **`courses` carries `courseDisplayName`, not the raw `syn:course:…` id**
 * (WBF-1, `ol-mxw3`) — `TodayView` renders `CourseMastery.course` verbatim
 * (`olea-core`'s `mastery-overview.ts`: "her course code, verbatim, never
 * normalised"), and that field is sourced straight from here, so the raw id
 * was reaching her mastery-strip headers. `conceptId` stays the real id: it
 * is the join key against a review log record's `conceptIds`, never rendered
 * by this surface (`today/view.ts` shows course headers, not concept names).
 * `TRENDS_ASSESSMENTS` below converts the same way and with the same course,
 * so the effort insight's course-string join (`olea-core`'s
 * `insights/effort.ts`) still lines up — both sides of that join pass through
 * `courseDisplayName`.
 */
export const TRENDS_CONCEPTS: readonly ConceptCourses[] = CONCEPTS.map((concept) => ({
  conceptId: concept.conceptId,
  courses: [courseDisplayName(concept.courseId)],
}));

/**
 * A stand-in windowed floor share per course (`[D-081]`/`[D-092]`,
 * `ol-v7r5.33`), for the effort insight's re-specified input.
 *
 * **Placeholder, not a real `computeAttentionShares` output** — component 3.5
 * is `boundary: service` (`docs/Olea_component_register.md` row 3.5), and this
 * workbench has no server call to make. So this reuses the synthetic
 * curriculum's assessment weights (`syn:assessment:…`) as the numbers behind
 * the floor share, exactly the normalisation `detectEffortImbalance` itself
 * used to perform internally before the re-spec moved that step out to the
 * caller: summed per course, then divided by the total across courses that
 * state one. That keeps every number this surface has always shown (57%/43%,
 * the 40/40 and 0/40 firing counts) byte-identical — this is a field rename,
 * not a new measurement — while being honest in its own doc that it is not
 * the real windowed floor D-092 describes. Revalidating these fixtures
 * against a real floor computation is follow-up work, not done here.
 */
export const TRENDS_ASSESSMENTS: readonly CourseFloorShare[] = (() => {
  const totalByCourse = new Map<string, number>();
  for (const assessment of buildCurriculum().assessments) {
    if (assessment.course === undefined || assessment.weight === undefined) continue;
    const course = courseDisplayName(assessment.course);
    totalByCourse.set(course, (totalByCourse.get(course) ?? 0) + assessment.weight);
  }
  const total = [...totalByCourse.values()].reduce((sum, weight) => sum + weight, 0);
  return [...totalByCourse.entries()].map(([course, weight]) => ({
    course,
    floorShare: total > 0 ? weight / total : undefined,
  }));
})();

function streamFor(state: TrendsWorkbenchState): SyntheticStream {
  const base = {
    startDate: state.days === 1 ? SINGLE_SESSION_START_DATE : HISTORY_START_DATE,
    days: state.days,
    utcOffset: HISTORY_UTC_OFFSET,
    assessmentDayOffsets: state.days === 1 ? [4] : HISTORY_ASSESSMENT_DAY_OFFSETS,
  };
  return generateStream(
    streamSpec(state.persona, HISTORY_SEED, {
      ...base,
      // The pair's whole difference, in one spread.
      ...(state.neutralised ? { behaviour: PERSONAS[state.persona].planted.neutralise } : {}),
    }),
  );
}

const viewModelCache = new Map<string, TodayViewModel>();

/**
 * `MasteryVitalityInputs` is not exported directly from `olea-core` (it sits
 * behind `today/panel.ts`'s public `TodayPanelInput`) — the same
 * indexed-access mirror `packages/plugin/src/today/data-source.ts`'s
 * `TodayPanelVitalityInputs` already uses, for the identical reason: the type
 * needed here is a nested field of an already-exported type, and widening
 * `olea-core`'s index is a change to a shared file outside this bead's
 * `owns`.
 */
type TrendsVitalityInputs = NonNullable<TodayPanelInput['vitality']>;

/**
 * `[D-115]`'s ratified retrievability cut, declared independently rather than
 * imported — see the module doc, "WB-8": neither
 * `packages/plugin/src/registry/provider.ts`'s `DECLARED_FALLBACK_HOLDING_CUT`
 * nor `packages/plugin/src/today/data-source.ts`'s copy is exported, and this
 * workbench has no dependency on `packages/plugin` to import one from anyway.
 * A plain-English default, not a derivation — this file's own N-015 note
 * already says no number here is evidence about the alpha user.
 */
const WORKBENCH_HOLDING_CUT = 0.8;

const trendsScheduler = createFsrsScheduler();

/**
 * The real `buildTodayPanel`, over a real persona stream. Nothing here
 * hand-builds a `TodayViewModel`: the states differ only in which stream they
 * feed the product's own pure function.
 */
export function buildTrendsViewModel(stateId: string): TodayViewModel {
  const cached = viewModelCache.get(stateId);
  if (cached !== undefined) return cached;

  const state = findTrendsState(stateId);
  if (state === undefined)
    throw new Error(`workbench: unknown trends state ${JSON.stringify(stateId)}`);

  const stream = streamFor(state);
  // WB-8 (`ol-ppxj.31`): every course shares this one `vitality` input, or
  // (for `state.vitalityWired === false`) none does — see
  // `MasteryOverviewInput.vitality`'s own doc for why that is an "either all
  // of them carry a reading or none do" choice, not a per-course one.
  const vitality: TrendsVitalityInputs | undefined = state.vitalityWired
    ? { scheduler: trendsScheduler, now: WORKBENCH_NOW, holdingCut: WORKBENCH_HOLDING_CUT }
    : undefined;
  const vm = buildTodayPanel({
    entries: stream.entries,
    // See the module doc (WBF-2, `ol-9j3w`): `[]`, not `null` — a real "no
    // instruments enumerated" rather than the panel's "could not enumerate"
    // state, which `TodayView` renders as a false read-failure message here.
    instruments: [],
    today: WORKBENCH_NOW.toISOString().slice(0, 10),
    dueThrough: WORKBENCH_NOW,
    windowDays: state.days,
    concepts: TRENDS_CONCEPTS,
    floorShares: TRENDS_ASSESSMENTS,
    ...(vitality !== undefined ? { vitality } : {}),
  });

  viewModelCache.set(stateId, vm);
  return vm;
}

export interface TrendsScenario {
  readonly deps: TodayViewDeps;
  readonly note: string;
  readonly persona: PersonaId;
  readonly neutralised: boolean;
  /** Surfaced for the inspector — the same object the pane was drawn from. */
  readonly viewModel: TodayViewModel;
}

/** Builds one trends state. Throws on an unknown id, same discipline as the other surfaces. */
export function buildTrendsScenario(stateId: string): TrendsScenario {
  const state = findTrendsState(stateId);
  if (state === undefined)
    throw new Error(`workbench: unknown trends state ${JSON.stringify(stateId)}`);

  // `courseFreshness` is a `TodayPanelInput` field now (`ol-ksw7`), which
  // `buildTrendsViewModel`'s `buildTodayPanel` call already resolves to
  // `null` by omitting it — this surface never wires a rhythm source, so no
  // extra widening is needed to get that "no rhythm source wired" null.
  // Read once, here, rather than inside `deps.load`'s closure: `viewModel`
  // below is the exact object both `load()` resolves to and this scenario
  // returns as `viewModel`, and `renderTrendsInspector`'s own doc promises
  // the inspector "re-states the same `viewModel` the pane rendered from,
  // never a second computation" — a fresh object per `load()` call would
  // break that identity.
  const viewModel = buildTrendsViewModel(state.id);

  return {
    deps: {
      load: () => Promise.resolve(viewModel),
      startReview: () => {
        new Notice(
          'Workbench: this surface is the trends half of the Today pane. Pressing "Start ' +
            'review" would open a review session in the real product; see the Review states in ' +
            'the sidebar.',
        );
      },
    },
    note: state.note,
    persona: state.persona,
    neutralised: state.neutralised,
    viewModel,
  };
}
