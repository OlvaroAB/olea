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
 */

import { buildTodayPanel, type ConceptCourses, type TodayViewModel } from 'olea-core';
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
    days: 90,
    note:
      'The same persona and seed with planted.neutralise applied: no cram window, no early ' +
      'pulls. The spacing insight fires anyway, and that is the finding rather than a broken ' +
      'state. Across 40 seeds the detector fires on 40/40 crammers, 0/40 of every other persona, ' +
      'and 8/40 of this neutralised twin — she studies on about a seventh of days, so 90 days ' +
      'leave roughly ten pre-assessment calendar days and one busy evening among them moves the ' +
      'rate a long way. Separating cleanly on this corpus needs a concentration threshold near ' +
      '5; it has not been moved there, because tuning a threshold on fabricated data is what ' +
      'N-015 forbids. The numbers are in test/trends-scenarios.spec.ts.',
  },
  {
    id: 'trends-too-early',
    label: 'Too early to say anything',
    group: 'trends',
    persona: 'single-session',
    neutralised: false,
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

/** Her assessment weights, from the synthetic curriculum (`syn:assessment:…`) — `course` display-named, see `TRENDS_CONCEPTS`'s doc. */
export const TRENDS_ASSESSMENTS = buildCurriculum().assessments.map((assessment) => ({
  // `AssessmentRecord.course` is typed optional even though this corpus
  // always sets it (`buildCurriculum`'s three literal assessments) — `??`
  // preserves "no course stated" as a real, distinct input rather than
  // asserting a value `courseDisplayName` would just throw on anyway.
  course: assessment.course === undefined ? undefined : courseDisplayName(assessment.course),
  weight: assessment.weight,
}));

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
    assessments: TRENDS_ASSESSMENTS,
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
