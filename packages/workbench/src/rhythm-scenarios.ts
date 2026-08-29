/**
 * The rhythm multicourse composition (RHY-3, `ol-i0zw` — successor to the
 * design-only `ol-movk`), drawn against the REAL schedule-extraction chain
 * over the fixture vault: `discoverScheduleEvents` -> `associateScheduleEvents`
 * -> `computeScheduleFreshness`, all `olea-core`'s own, unmodified pipeline
 * (RHY-3 §9, `ol-4chx` -> `ol-r6s0` -> `ol-hna1`).
 *
 * ## Why this is not `today-scenarios.ts` again
 *
 * Every other surface in this package that draws real signal against the
 * fixture vault feeds a REAL PRODUCT VIEW (`TodayView`, `GapView`,
 * `SessionBuilderView`, ...) real `deps` — see `trends-scenarios.ts`'s own
 * module doc: "nothing here hand-builds a `TodayViewModel`... the states
 * differ only in which stream they feed the product's own pure function."
 * This surface cannot do that, and says so on screen (`main.ts`'s
 * `RHYTHM_NO_PRODUCT_VIEW_NOTICE`, same posture as `mountGenerate`'s "no
 * product view to mount yet" notice for P3-T07b):
 *
 *  - `olea-core`'s `today/panel.ts` computes its `rhythm` field from
 *    `today/rhythm.ts`'s `detectRhythm` — a DIFFERENT, older signal (F6.9,
 *    `ol-ggz3`) that reports only the single quietest course across a caller-
 *    supplied `lastMaterialArrivalDay` per course. It has never read a
 *    calendar note and has no multicourse composition — RHY-3 §7 names that
 *    "wiring the freshness signal into ranking/scheduling" as a Class C stop,
 *    and `ol-at1a` (in progress, `packages/plugin/src/today/` and
 *    `packages/core/src/schedule/`, both outside this bead's `owns`) is
 *    wiring the SINGLE-course freshness reading into the real `TodayView`,
 *    not this pass's multicourse collapse rule.
 *  - The composition rule this file draws —
 *    `docs/design/pass5-refusal-trends-shell/RHY-3-multicourse-composition.md`
 *    §4 — has never been implemented anywhere: that design pass's own close
 *    reason states "no kit file touched," and no product code (`packages/
 *    core`, `packages/plugin`) computes an aggregate reading across courses
 *    today. `detectRhythm` picks one quietest course; `computeScheduleFreshness`
 *    reports every course independently and composes nothing.
 *
 * So this module is the FIRST drawing of that composition rule, over REAL
 * computed per-course freshness readings rather than hand-built ones, and it
 * is workbench-owned, presentational-only code — not a product renderer.
 * **This does not discharge `[D-072]`'s reachability clause**: there is no
 * production caller for this composition, and none is claimed. See this
 * bead's close evidence and `main.ts`'s on-screen notice.
 *
 * ## The calendar-events note
 *
 * `packages/core/fixtures/vault/` (core's own frozen regression target, out
 * of this bead's `owns`) has no calendar-events note at all, so
 * `discoverScheduleEvents` would find nothing there. `./vault/single-file-
 * overlay.ts`'s `withExtraFile` adds ONE synthetic note, read-only, on top of
 * the loaded fixture vault — the same additive-overlay convention
 * `oracle/fixture-oracle-vault.ts` already established for a different
 * surface. Its task-list lines follow `event-line.ts`'s bounded grammar
 * exactly: a bare course-code label (lowercased, deliberately mismatching the
 * `01 Courses/` folder roster's casing — RHY-3 §9's own finding about the
 * real vault, reproduced here on purpose) and a Tasks-plugin `📅 YYYY-MM-DD`
 * stamp. `GEOL204` and `MUSTH104` are the fixture vault's own two course
 * codes; no new course, title or concept name is introduced (fixture-
 * vocabulary discipline, `ol-vs57`).
 *
 * Two variants, so `RHYTHM_STATES` can show the composition rule actually
 * doing something (2 flagged courses) alongside the degenerate case it
 * collapses to at 1 (§4.2 — "the composition question only exists at two or
 * more"):
 *
 *  - `rhythm-two-flagged`: `GEOL204` gets three historical sessions with the
 *    most recent one overdue and unmatched by any arrival — the strongest,
 *    "observed" claim (`not-arrived-with-yardstick`). `MUSTH104` gets exactly
 *    ONE historical session, below `MIN_HISTORICAL_SESSIONS_TO_TRUST` —
 *    `not-arrived-no-yardstick`. This is RHY-3-multicourse-composition.md's
 *    OWN worked example in kind: "one course established, one just starting
 *    with nothing to compare against yet" (state D, §2.1).
 *  - `rhythm-one-flagged`: `GEOL204` unchanged; `MUSTH104` instead gets four
 *    weekly sessions with a last-observed arrival AFTER the most recent one —
 *    `arrived`, so it never enters the candidate set (§2.0) and the panel
 *    degrades to a single flagged row, the same shared renderer with nothing
 *    to compose.
 *
 * Every date and status above was checked against `olea-core`'s real,
 * unmodified `computeCourseFreshness` before this file was written (see this
 * bead's report) — nothing here is asserted without having been run.
 *
 * ## Ordering, and why it is the fallback rather than a real assessment join
 *
 * RHY-3-multicourse-composition.md §4.4 orders composed rows by assessment
 * proximity, with a named fallback for when no assessment date is on record:
 * "a stable, arbitrary order (course code, alphabetical)." The fixture
 * vault's real `02 Assignments/Assignments.base` DOES carry real due dates
 * for both courses (`readAssessments`, real, unmodified content) — but every
 * one of them falls in 2026, months before `WORKBENCH_NOW` (2027-01-15):
 * they were authored for the review/spacing surfaces' own semester, not this
 * one, and every record reads `status: upcoming` despite being calendar-past
 * relative to this surface's fixed clock. Ordering by "which is sooner" over
 * dates that are both already behind `today` would assert a proximity
 * reading this vault's real data does not honestly support at this instant,
 * so this module takes §4.4's own documented fallback — course code,
 * alphabetical — rather than reaching for a real join that would need
 * fabricated meaning layered onto real bytes to make sense.
 */

import {
  associateScheduleEvents,
  type CalendarDay,
  type CourseFreshnessReading,
  computeScheduleFreshness,
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  discoverScheduleEvents,
  type ScheduleAssociationReport,
  type ScheduleDiscoveryReport,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { withExtraFile } from './vault/single-file-overlay.js';

/** Where `build.mjs` copies `packages/core/fixtures/vault` — the same landmark folder `courseFromPath`'s default reads. */
const COURSES_FOLDER = DEFAULT_COURSES_FOLDER;

/** The synthetic calendar note this surface adds — see the module doc. */
const CALENDAR_NOTE_PATH = '06 Calendar/Calendar events.md' as VaultPath;

/** The fixed instant every state reads freshness against — `today/rhythm.ts`'s sibling constant, `clock.ts`'s `WORKBENCH_NOW`, expressed as a bare calendar day. */
const RHYTHM_TODAY = '2027-01-15' as CalendarDay;

export type RhythmScheduleVariant = 'two-flagged' | 'one-flagged';

function calendarLine(courseCodeLower: string, isoDate: string): string {
  return `- [ ] ${courseCodeLower} 📅 ${isoDate}`;
}

/** `GEOL204`'s three sessions, shared by both variants — the most recent (2027-01-11) is unmatched by any arrival and past the grace margin, so it reads `not-arrived-with-yardstick`. */
const GEOL204_SESSIONS = ['2026-12-14', '2027-01-04', '2027-01-11'];
const GEOL204_LAST_ARRIVAL = '2027-01-04' as CalendarDay;

/** `MUSTH104`'s ONE session for `rhythm-two-flagged` — below `MIN_HISTORICAL_SESSIONS_TO_TRUST`, so it reads `not-arrived-no-yardstick` regardless of any arrival fact. */
const MUSTH104_SINGLE_SESSION = ['2027-01-06'];

/** `MUSTH104`'s four weekly Tuesdays for `rhythm-one-flagged`, with an arrival AFTER the last one — reads `arrived`. */
const MUSTH104_ESTABLISHED_SESSIONS = ['2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12'];
const MUSTH104_ESTABLISHED_LAST_ARRIVAL = '2027-01-13' as CalendarDay;

function calendarNoteContent(variant: RhythmScheduleVariant): string {
  const musth104Sessions =
    variant === 'two-flagged' ? MUSTH104_SINGLE_SESSION : MUSTH104_ESTABLISHED_SESSIONS;
  const lines = [
    '# Calendar events',
    '',
    'Synthetic fixture content, added by the workbench (`ol-i0zw`) — a machine-synced calendar ' +
      "note in the shape RHY-3's extraction design reads: task-list lines, a bare course-code " +
      'label, a Tasks-plugin due-date stamp. Casing deliberately disagrees with the course-folder ' +
      'roster, the same mismatch RHY-3 §9 found in the real vault this design was measured ' +
      'against. Not part of `packages/core/fixtures/vault/` — see `rhythm-scenarios.ts`.',
    '',
    ...GEOL204_SESSIONS.map((day) => calendarLine('geol204', day)),
    ...musth104Sessions.map((day) => calendarLine('musth104', day)),
    '',
  ];
  return lines.join('\n');
}

/** `lastArrivalByCourse` per variant — the caller-supplied fact `freshness.ts`'s own doc says this signal never derives itself. */
function lastArrivalByCourse(
  variant: RhythmScheduleVariant,
): ReadonlyMap<string, CalendarDay | null> {
  return new Map([
    ['GEOL204', GEOL204_LAST_ARRIVAL],
    ['MUSTH104', variant === 'two-flagged' ? null : MUSTH104_ESTABLISHED_LAST_ARRIVAL],
  ]);
}

export interface RhythmWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'rhythm';
  readonly variant: RhythmScheduleVariant;
  /** What this state is here to show. Rendered in the inspector. */
  readonly note: string;
}

export const RHYTHM_STATES: readonly RhythmWorkbenchState[] = [
  {
    id: 'rhythm-two-flagged',
    label: 'Two courses, mixed yardstick',
    group: 'rhythm',
    variant: 'two-flagged',
    note:
      'RHY-3-multicourse-composition.md §2.1 state D, drawn against the real chain: GEOL204 has ' +
      'three synced sessions and the most recent is overdue and unmatched (not-arrived-with-' +
      'yardstick, the strongest "observed" claim); MUSTH104 has one session, below the trust ' +
      'threshold (not-arrived-no-yardstick — "one course just starting, nothing to compare ' +
      'against yet", verbatim from the design). Two flagged courses is where §4.3\'s collapse ' +
      'rule fires: one panel, one fact/consequence/mitigation frame, per-course rows.',
  },
  {
    id: 'rhythm-one-flagged',
    label: 'One course flagged (no composition)',
    group: 'rhythm',
    variant: 'one-flagged',
    note:
      'RHY-3-multicourse-composition.md §4.2 — "the composition question only exists at two or ' +
      'more". GEOL204 unchanged (not-arrived-with-yardstick); MUSTH104 now has four weekly ' +
      'sessions with an arrival after the last one, so it reads arrived and never enters the ' +
      'candidate set (§2.0) at all. The same renderer draws one row, nothing collapsed.',
  },
];

export function findRhythmState(id: string): RhythmWorkbenchState | undefined {
  return RHYTHM_STATES.find((state) => state.id === id);
}

export interface RhythmComposedRow {
  readonly courseCode: string;
  readonly reading: CourseFreshnessReading;
  readonly lastArrivalDay: CalendarDay | null;
}

export type RhythmPanelKind = 'nothing-to-report' | 'single' | 'composed';

export interface RhythmComposedPanel {
  readonly kind: RhythmPanelKind;
  readonly rows: readonly RhythmComposedRow[];
  readonly factLine: string | null;
  readonly consequenceLine: string | null;
  readonly mitigationLine: string | null;
  readonly footerLine: string | null;
}

/** §4.3, reused verbatim once per panel. */
export const RHYTHM_FOOTER_LINE =
  'Nothing here counts sessions, days or hours, and there is no target to hit.';
/** §4.3's consequence sentence, stated once regardless of how many courses are flagged. */
export const RHYTHM_CONSEQUENCE_LINE = "Olea can't rank what it hasn't seen for any of them.";
/** §4.3's mitigation sentence — the cognitive-offloading defusing line (§5), inherited unchanged. */
export const RHYTHM_MITIGATION_LINE =
  "Writing each of these up is itself the studying — this is where Olea's own reading " +
  'currently stops, not a prompt to hurry through any of them.';

function joinWithOr(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** §4.3's fact sentence — named courses, never a bare count (V6). */
function factLineFor(courseCodes: readonly string[]): string {
  return `This week's material hasn't landed yet for ${joinWithOr(courseCodes)}.`;
}

/**
 * Composes `readings` into the panel `RHY-3-multicourse-composition.md` §4
 * describes. Pure: no I/O, reads only its arguments.
 *
 * - 0 flagged (every course `arrived`, or none supplied): `nothing-to-report`
 *   — §4.5, the family stays silent, no positive "all clear" variant.
 * - 1 flagged: `single` — §4.2, unchanged from a plain per-course reading.
 * - 2+ flagged: `composed` — §4.3's collapse rule.
 *
 * `not-arrived-*` is the candidate set per §2.0; `arrived` never enters it.
 * Ordering is the alphabetical fallback per §4.4 — see the module doc for why
 * this vault's real assessment dates are not used here.
 */
export function composeRhythmPanel(
  readings: readonly CourseFreshnessReading[],
  lastArrivalByCourseMap: ReadonlyMap<string, CalendarDay | null>,
): RhythmComposedPanel {
  const flagged = readings.filter((reading) => reading.status !== 'arrived');
  if (flagged.length === 0) {
    return {
      kind: 'nothing-to-report',
      rows: [],
      factLine: null,
      consequenceLine: null,
      mitigationLine: null,
      footerLine: null,
    };
  }

  const ordered = [...flagged].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  const rows: RhythmComposedRow[] = ordered.map((reading) => ({
    courseCode: reading.courseCode,
    reading,
    lastArrivalDay: lastArrivalByCourseMap.get(reading.courseCode) ?? null,
  }));
  const courseCodes = rows.map((row) => row.courseCode);

  if (rows.length === 1) {
    return {
      kind: 'single',
      rows,
      factLine: factLineFor(courseCodes),
      consequenceLine: null,
      mitigationLine: null,
      footerLine: RHYTHM_FOOTER_LINE,
    };
  }

  return {
    kind: 'composed',
    rows,
    factLine: factLineFor(courseCodes),
    consequenceLine: RHYTHM_CONSEQUENCE_LINE,
    mitigationLine: RHYTHM_MITIGATION_LINE,
    footerLine: RHYTHM_FOOTER_LINE,
  };
}

/** Every course code the fixture vault's `01 Courses/` folder names — the same derivation `course/lifecycle.ts`'s `detectCourseProposals` already uses over `courseFromPath`'s output, read here rather than re-exported since this bead's `owns` cannot add to that module. */
export async function knownCourseCodesOf(vault: VaultSource): Promise<ReadonlySet<string>> {
  const paths = await vault.list();
  const codes = new Set<string>();
  for (const path of paths) {
    const code = courseFromPath(path, COURSES_FOLDER);
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

export interface RhythmScenario {
  readonly state: RhythmWorkbenchState;
  readonly discovery: ScheduleDiscoveryReport;
  readonly association: ScheduleAssociationReport;
  readonly readings: readonly CourseFreshnessReading[];
  readonly panel: RhythmComposedPanel;
}

/**
 * Builds one rhythm state end to end over the REAL chain: overlay the
 * synthetic calendar note, `discoverScheduleEvents`, `associateScheduleEvents`
 * against the vault's own course roster, `computeScheduleFreshness` against
 * this state's `lastArrivalByCourse` facts, then `composeRhythmPanel`.
 *
 * `base` is the already-loaded fixture vault (`loadFixtureVault()` in the
 * browser, `FolderSource` over `packages/core/fixtures/vault` in tests) —
 * same split every other scenario builder in this package takes.
 */
export async function buildRhythmScenario(
  stateId: string,
  base: VaultSource,
): Promise<RhythmScenario> {
  const state = findRhythmState(stateId);
  if (state === undefined)
    throw new Error(`workbench: unknown rhythm state ${JSON.stringify(stateId)}`);

  const vault = withExtraFile(base, CALENDAR_NOTE_PATH, calendarNoteContent(state.variant));

  const [discovery, knownCourseCodes] = await Promise.all([
    discoverScheduleEvents(vault),
    knownCourseCodesOf(vault),
  ]);
  const association = associateScheduleEvents(discovery.events, knownCourseCodes);

  const arrivals = lastArrivalByCourse(state.variant);
  const readings = computeScheduleFreshness(association.matched, arrivals, RHYTHM_TODAY);
  const panel = composeRhythmPanel(readings, arrivals);

  return { state, discovery, association, readings, panel };
}
