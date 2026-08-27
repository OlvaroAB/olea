/**
 * What the Today panel reads, and from where (F6.1, P2-T09).
 *
 * Obsidian-free on purpose: everything here goes through `VaultSource`, so it
 * runs under Vitest against `FolderSource` or a fake, and `view.ts` stays the
 * only file in this folder that a real Obsidian host is required to execute.
 * Same split as `review/ports.ts` vs `review/obsidian-ports.ts`.
 *
 * ## The streak half is real today
 *
 * The review log is readable now (`ol-p2t03`, closed), so the streak is wired
 * to her actual history rather than stubbed. Two details it has to get right:
 *
 * - **Discovery.** C5.2 puts one file per day per device in `.olea/reviews/`,
 *   and `review-log/path.ts` warns that the folder is dot-prefixed, so
 *   `FolderSource.list()` skips it entirely and Obsidian's `vault.getFiles()`
 *   does not return it either. So this module does both: it asks `list()` (in
 *   case the host does surface the folder, which is the only way another
 *   device's file can be found at all) **and** probes this device's own file
 *   for each day of the window by exact path, which needs no listing. The
 *   union is de-duplicated by path. A phone's reviews therefore count wherever
 *   the host can see the file, and this device's always count.
 * - **Tolerance.** A crash-truncated final line costs that line and nothing
 *   else — `parseReviewLog` already guarantees that per line, and this module
 *   never throws it away wholesale. `invalidLineCount` is surfaced for
 *   diagnostics and is deliberately not rendered: a number of broken lines is
 *   not something the panel has any business putting in front of her.
 *
 * ## The due half is real now too
 *
 * Counting what is due needs an enumeration of every instrument and its
 * scheduling state. Both exist: `olea-core`'s `session/` walks the vault for
 * instruments and replays the log into per-instrument state, and
 * `createVaultInstrumentSource` below is the `TodayInstrumentSource` built on
 * them. `unavailableInstrumentSource` is kept — it is what the real source
 * *returns* when the walk fails, because "we could not read your vault" and
 * "nothing is due" are different sentences and `today/panel.ts` renders them
 * differently. See that module's doc for why the distinction is a type and not
 * a convention.
 *
 * The instrument identity underneath is still provisional (D-030, open): see
 * `olea-core`'s `session/instrument-id.ts`. That affects which ids the counted
 * instruments carry, not whether the count is honest.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildReviewSession,
  buildTodayPanel,
  type CalendarDay,
  type ConceptCourses,
  type ConceptRelation,
  calendarDayFromLocalDate,
  calendarDaysEndingOn,
  type DueInstrument,
  type ExtractConceptsOptions,
  extractConcepts,
  parseReviewLog,
  REVIEW_LOG_FOLDER,
  type RhythmCourseInput,
  readAssessments,
  resolveTermBoundary,
  reviewLogPath,
  type Scheduler,
  type TermWindow,
  type TodayPanelInput,
  type TodayViewModel,
  toDueInstruments,
  type VaultPath,
  type VaultSource,
  type WeightedAssessment,
} from 'olea-core';
import type { ObsidianMaterialArrivalStore } from './material-arrival-store.js';
import type { ObsidianTermWindowStore } from './term-window-store.js';

/**
 * How far back the streak reads. 120 days covers a semester's habit without
 * making the panel read a year of files every time she opens the sidebar, and
 * a run that reaches the edge is reported as `N+` rather than as an exact
 * number (`StreakSummary.atWindowEdge`) — so the bound is visible in the UI
 * instead of silently truncating. Class B: a reversible default.
 */
export const DEFAULT_STREAK_WINDOW_DAYS = 120;

export interface ReviewHistory {
  readonly entries: readonly ReviewLogEntry[];
  /** Days covered, ending on the day asked for — what `computeStreak` needs. */
  readonly windowDays: number;
  /** Lines that did not parse. Diagnostics only; never rendered. */
  readonly invalidLineCount: number;
}

export interface ReadReviewHistoryOptions {
  readonly today: CalendarDay;
  readonly windowDays?: number;
}

/** Matches `<YYYY-MM-DD>.<deviceId>.jsonl` — the C5.2 file name, whoever wrote it. */
const LOG_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.[^/]+\.jsonl$/;

function dayOfLogPath(path: VaultPath): CalendarDay | null {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  return LOG_FILE_RE.exec(name)?.[1] ?? null;
}

/**
 * Every review-log entry in the window, from every device file the host can
 * actually see, plus this device's own regardless.
 */
export async function readReviewHistory(
  vault: VaultSource,
  deviceId: string,
  options: ReadReviewHistoryOptions,
): Promise<ReviewHistory> {
  const windowDays = options.windowDays ?? DEFAULT_STREAK_WINDOW_DAYS;
  const days = new Set(calendarDaysEndingOn(options.today, windowDays));

  const paths = new Set<VaultPath>();

  // Other devices, where the host surfaces the folder at all.
  let listed: readonly VaultPath[] = [];
  try {
    listed = await vault.list({ under: REVIEW_LOG_FOLDER });
  } catch {
    // A host that refuses to list a dot-prefixed folder is the expected case,
    // not an error condition — the probe below is the guaranteed path.
    listed = [];
  }
  for (const path of listed) {
    const day = dayOfLogPath(path);
    if (day !== null && days.has(day)) paths.add(path);
  }

  // This device, by exact path — works on every host, listing or not.
  for (const day of days) {
    paths.add(reviewLogPath(day, deviceId));
  }

  const entries: ReviewLogEntry[] = [];
  let invalidLineCount = 0;
  // Sorted so the result is stable across hosts with different enumeration
  // orders; nothing downstream depends on order, but a stable answer is
  // cheaper to debug than a nearly-stable one.
  for (const path of [...paths].sort()) {
    if (!(await vault.exists(path))) continue;
    const parsed = parseReviewLog(await vault.read(path));
    entries.push(...parsed.records);
    invalidLineCount += parsed.invalidLines.length;
  }

  return { entries, windowDays, invalidLineCount };
}

/**
 * Where the panel gets the instruments it counts. Implemented for real by
 * `createVaultInstrumentSource` below, over `olea-core`'s session pipeline;
 * `unavailableInstrumentSource` is what that source returns when it cannot
 * enumerate, and what a caller with no vault to walk passes.
 */
export interface TodayInstrumentSource {
  /**
   * `null` means "cannot enumerate", which is not the same as an empty list.
   *
   * **Suspended instruments (F2.6) are already excluded by the time they get
   * here.** Deliberately not the panel's job: the suspended set is folded from
   * the *whole* log (`review-log/suspension.ts`), and this panel only ever
   * reads a trailing window of it — a suspend from last term is outside that
   * window and would be silently forgotten. The queue is the component that
   * reads the full history and excludes it, exactly as F2.6's scenarios say.
   * `summariseDue` still takes a suspended set, for a caller that does hold
   * the whole log; this one does not pass one, because it would be wrong.
   */
  listDueCandidates(): Promise<readonly DueInstrument[] | null>;
}

/**
 * The stand-in. Returns `null`, never `[]`: an empty list is a claim that
 * nothing is due, and this source is not in a position to make it.
 */
export const unavailableInstrumentSource: TodayInstrumentSource = {
  async listDueCandidates() {
    return null;
  },
};

/**
 * How far back the instrument source *probes by exact path* for this device's
 * own log files, on a host whose `list()` cannot see `.olea/reviews/`.
 *
 * **This is a fallback bound, not the read.** Where the host lists the folder —
 * `FolderSource`, and any in-memory source — every file is read and the history
 * is complete. Obsidian's `vault.getFiles()` does not return dot-prefixed trees
 * (`review-log/path.ts`'s warning), so there the probe is the only route, and
 * it can only ask about days it can name.
 *
 * 400 days covers a full academic year with margin. The cost of the bound is
 * real and is stated rather than hidden: on a listing-blind host, a review
 * older than the window is invisible, so its instrument reads as never-reviewed
 * and is counted as due today. That understates nothing and overstates the
 * count, which is the safer direction of the two, and it is a Class B default —
 * the durable fix is a host adapter that can enumerate the folder, which is a
 * change to `ObsidianSource` and not to this file.
 */
export const SCHEDULING_HISTORY_PROBE_DAYS = 400;

export interface VaultInstrumentSourceDeps {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  /** Names this device's own log files for the probe above. */
  readonly deviceId: string;
  /** Injected so the source is deterministic under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Notes to walk past — documentation *about* the card format is not a corpus. */
  readonly excludePaths?: readonly VaultPath[];
  readonly probeDays?: number;
  /**
   * `part-of` edges available at composition time (C7.9; `ol-v7r5.7`) —
   * forwarded straight to `buildReviewSession`'s `relations` input, so the
   * Today panel's due count agrees with the review queue about which
   * container/part candidates the containment co-presence filter drops.
   * Omitted means none, the same real no-op `buildReviewSession` documents.
   */
  readonly relations?: readonly ConceptRelation[];
}

/**
 * The real source: walk her vault, replay her log, count what is waiting.
 *
 * Three things it does that the panel must not do itself:
 *
 *  - **Reads the whole log, not the streak's window.** Suspension is a fold
 *    over all history, and a suspend from last term is outside any trailing
 *    window. The panel's own `TodayInstrumentSource` doc says the exclusion
 *    belongs to the component that reads the full history; this is it.
 *  - **Excludes the suspended set before returning.** So the panel counts what
 *    it is handed and never re-derives the rule.
 *  - **Returns `null` when it cannot enumerate.** A vault that throws mid-walk
 *    is not a vault with nothing due. This is the one place the honest-absence
 *    state survives now that the seam is closed.
 */
export function createVaultInstrumentSource(
  deps: VaultInstrumentSourceDeps,
): TodayInstrumentSource {
  return {
    async listDueCandidates() {
      try {
        const today = localToday(deps.now());
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );

        const session = await buildReviewSession({
          vault: deps.vault,
          scheduler: deps.scheduler,
          now: deps.now(),
          reviewLog: { additionalPaths },
          ...(deps.excludePaths !== undefined
            ? { instruments: { excludePaths: deps.excludePaths } }
            : {}),
          ...(deps.relations !== undefined ? { relations: deps.relations } : {}),
        });

        // `toDueInstruments` maps every enumerated record, not
        // `session.candidates` — so C7.9's containment filter (`ol-v7r5.7`)
        // has to be re-applied here by instrument id, the same way suspension
        // already is, or a `relations` argument would compose the queue
        // correctly while the Today count kept the container's candidates.
        const containmentDropped = new Set(
          session.containmentDropped.map((candidate) => candidate.instrumentId),
        );
        return toDueInstruments(session.instruments.records, session.replay).filter(
          (instrument) =>
            !session.suspended.has(instrument.instrumentId) &&
            !containmentDropped.has(instrument.instrumentId),
        );
      } catch {
        // "We could not read your vault" is not "nothing is due". The panel
        // renders `null` as the former, which is the true statement.
        return null;
      }
    },
  };
}

/**
 * The instant her local today ends, for `summariseDue`'s `dueThrough`. Local
 * getters on purpose — the panel is being drawn on the device she is sitting
 * at, and "her day" is a fact about that device's clock, not about UTC.
 */
export function endOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

/** Today, as the device she is looking at reckons it. */
export function localToday(now: Date): CalendarDay {
  return calendarDayFromLocalDate(now);
}

/**
 * Where the trends half (F6.2's mastery overview, F6.5's insights) gets the two
 * things a review log cannot supply: which course a concept belongs to, and
 * what her assessments are worth.
 *
 * **Optional on `TodayPanelDeps` — a panel built without one renders no trends
 * section at all.** `buildTodayPanel` leaves `mastery`/`insights` null and
 * `view.ts` draws nothing in that case, which is why the workbench Today
 * states with no trends source are pixel-identical with what a bare `main.ts`
 * wiring would render. **Production passes one**: `main.ts` builds
 * `createVaultTrendsSource({ vault, assessmentsBasePath })` and hands it to
 * `loadTodayPanel` as `trends`, so this is reachable, not just buildable.
 */
export interface TodayTrendsSource {
  /**
   * `null` means "could not enumerate", which is not an empty vault. The panel
   * renders nothing rather than an overview of no courses, for the same reason
   * `listDueCandidates` returns `null` rather than `[]`.
   */
  listConceptCourses(): Promise<readonly ConceptCourses[] | null>;
  /**
   * Weighted assessments (F1.1). `[]` is a real and common answer — a vault
   * with no assignments table — and the effort detector reports
   * `not-enough-history` on it, which is the true statement.
   */
  listAssessmentWeights(): Promise<readonly WeightedAssessment[]>;
}

export interface VaultTrendsSourceDeps {
  readonly vault: VaultSource;
  /** Where the concept walk looks; defaults are F1.3's folder conventions. */
  readonly conceptOptions?: ExtractConceptsOptions;
  /**
   * Vault path of the `.base` file `readAssessments` scans, from her settings
   * (`plan/settings-store.ts`). Blank or absent means "not configured", and
   * yields no weights rather than a guessed folder.
   */
  readonly assessmentsBasePath?: VaultPath;
}

/**
 * The real trends source: walk her vault for concepts, read her assignments
 * table for weights.
 *
 * Both halves swallow their own failures into the honest value —
 * `null` concepts, `[]` weights — for the reason `createVaultInstrumentSource`
 * already gives: a vault that throws mid-walk is not a vault with nothing in
 * it, and the panel is the wrong place to surface a read error at her.
 *
 * **A concept's id is its opaque key, not its name** (`ol-63e1`, `[D-088]`/
 * `[D-109]`). `extractConcepts` returns `ConceptRecord`s carrying both — `key`
 * is the identity a review-log record's `conceptIds` now carries
 * (`session/enumerate.ts`), `name` is her verbatim display string. The mapping
 * is one line and is written here rather than inside core so that the seam
 * where it could stop matching is visible.
 */
export function createVaultTrendsSource(deps: VaultTrendsSourceDeps): TodayTrendsSource {
  return {
    async listConceptCourses() {
      try {
        const records = await extractConcepts(deps.vault, deps.conceptOptions ?? {});
        return records.map((record) => ({
          conceptId: record.key,
          courses: record.courses,
        }));
      } catch {
        return null;
      }
    },
    async listAssessmentWeights() {
      const basePath = deps.assessmentsBasePath;
      if (basePath === undefined || basePath.trim() === '') return [];
      try {
        const report = await readAssessments(deps.vault, basePath);
        return report.records.map((record) => ({
          course: record.course,
          weight: record.weight,
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Where the panel gets F6.9's rhythm reading's two inputs (`ol-v7r5.6`):
 * every course a material arrival was ever observed for, and her recorded
 * term window, if any. Implemented for real by `createRhythmSource` below,
 * over `material-arrival-store.ts`'s and `term-window-store.ts`'s persisted
 * `data.json` stores — never the vault, never a server (C6).
 */
export interface TodayRhythmSource {
  /**
   * `null` means "could not read the arrival store", the same third state
   * `TodayInstrumentSource.listDueCandidates` and `TodayTrendsSource.
   * listConceptCourses` already draw: not the same as `[]`, which is a real,
   * common answer for an install that has never observed an arrival yet.
   */
  listCourseMaterialArrivals(): Promise<readonly RhythmCourseInput[] | null>;
  /**
   * `resolveTermBoundary`'d already: her recorded dates outrank being asked.
   * `null` means neither exists — F6.9 never blocks on this, so the caller
   * degrades to the reading with no yardstick rather than treating `null` as
   * a failure.
   */
  resolveTermWindow(): Promise<TermWindow | null>;
}

export interface RhythmSourceDeps {
  readonly materialArrivals: ObsidianMaterialArrivalStore;
  readonly termWindow: ObsidianTermWindowStore;
}

/**
 * The real source. `listCourseMaterialArrivals` reads exactly the courses the
 * arrival store has ever heard from — a course with no observed arrival ever
 * simply is not in the list, rather than appearing with a `null` day, which
 * is a considered simplification (see `material-arrival-store.ts`'s module
 * doc) rather than an oversight: F6.9 has nothing to call "quiet" for a
 * course Olea has never once seen material from, and `detectRhythm`'s own
 * `not-enough-history` status already covers that case for the courses it IS
 * given.
 */
export function createRhythmSource(deps: RhythmSourceDeps): TodayRhythmSource {
  return {
    async listCourseMaterialArrivals() {
      try {
        const persisted = await deps.materialArrivals.load();
        return Object.entries(persisted.lastArrivalByCourse).map(
          ([course, lastMaterialArrivalDay]) => ({ course, lastMaterialArrivalDay }),
        );
      } catch {
        return null;
      }
    },
    async resolveTermWindow() {
      try {
        const recorded = await deps.termWindow.load();
        // `asked: null` until F7.2 is amended with an ask-once surface
        // (`ol-v7r5.6`'s close evidence names the gap) — recorded still
        // outranks it the moment one exists, with no change here.
        return resolveTermBoundary({ recorded, asked: null });
      } catch {
        return null;
      }
    },
  };
}

export interface TodayPanelDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly instruments: TodayInstrumentSource;
  /** Injected so the panel is deterministic under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  readonly windowDays?: number;
  /** Absent means no trends section — see `TodayTrendsSource`. */
  readonly trends?: TodayTrendsSource;
  /** Absent means no rhythm reading — see `TodayRhythmSource`. */
  readonly rhythm?: TodayRhythmSource;
}

/**
 * Loads both halves and folds them through core's one entry point. This is the
 * whole of what `view.ts` calls; everything it then does is DOM.
 */
export async function loadTodayPanel(deps: TodayPanelDeps): Promise<TodayViewModel> {
  const now = deps.now();
  const today = localToday(now);
  // Resolved here rather than forwarded as `undefined`: under
  // `exactOptionalPropertyTypes` an absent option and an explicit `undefined`
  // are different values, and this is the boundary where "absent" is given
  // its meaning.
  const history = await readReviewHistory(deps.vault, deps.deviceId, {
    today,
    windowDays: deps.windowDays ?? DEFAULT_STREAK_WINDOW_DAYS,
  });
  const instruments = await deps.instruments.listDueCandidates();

  const base: TodayPanelInput = {
    entries: history.entries,
    instruments,
    today,
    dueThrough: endOfLocalDay(now),
    windowDays: history.windowDays,
  };

  // Each half resolves independently and spreads in only when it is a real
  // answer — under `exactOptionalPropertyTypes`, passing e.g.
  // `concepts: undefined` is NOT the same as omitting it, and the difference
  // is exactly the one that matters here: core reads "absent" as "this panel
  // was never asked", never as "asked, and it read nothing".
  const trendsFields = await resolveTrendsFields(deps.trends);
  const rhythmFields = await resolveRhythmFields(deps.rhythm);

  return buildTodayPanel({ ...base, ...trendsFields, ...rhythmFields });
}

/** F6.2/F6.5's half of `TodayPanelInput` — `{}` when `trends` is absent or could not enumerate. */
async function resolveTrendsFields(
  trends: TodayTrendsSource | undefined,
): Promise<Pick<TodayPanelInput, 'concepts' | 'assessments'> | Record<string, never>> {
  if (trends === undefined) return {};
  const concepts = await trends.listConceptCourses();
  if (concepts === null) return {};
  const assessments = await trends.listAssessmentWeights();
  return { concepts, assessments };
}

/** F6.9's half of `TodayPanelInput` — `{}` when `rhythm` is absent or could not enumerate. */
async function resolveRhythmFields(
  rhythm: TodayRhythmSource | undefined,
): Promise<Pick<TodayPanelInput, 'courseMaterialArrivals' | 'termWindow'> | Record<string, never>> {
  if (rhythm === undefined) return {};
  const courseMaterialArrivals = await rhythm.listCourseMaterialArrivals();
  if (courseMaterialArrivals === null) return {};
  const termWindow = await rhythm.resolveTermWindow();
  return { courseMaterialArrivals, termWindow };
}
