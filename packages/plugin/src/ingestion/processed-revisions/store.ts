/**
 * `ObsidianProcessedRevisionStore` — the processed-revision record (`[D-426]`, ruled 2026-09-29 as
 * row 25 of `docs/direction/20260929_decision_sheet_responses.md`; `ol-egov.141.89.11.24`): one
 * replacement store holding, per file version, its **fingerprint**, the **day it was first
 * processed** and its **processing state**. It is the input the rhythm reading's arrivals stage
 * (`olea-core`'s `today/arrivals.ts`) reads, and it replaces the verdict-gated
 * `today/material-arrival-store.ts` rather than sitting beside it.
 *
 * ## Where it lives, and why there
 *
 * One top-level key in the plugin's `data.json`, exactly as `[D-426]` option (a) names: a local
 * projection over her vault, never a server (C6, the boundary document's section 1), never her
 * authored notes (INV-6). The vault's own `.olea/` layer was the other candidate (the unit
 * manifest's append-only per-device files, `grove/unit-manifest-store.ts`); it does not fit here
 * for two reasons. A new `.olea/` folder must be registered with the F7.4 export and full delete
 * (`privacy/log-discovery.ts`), a path this build does not own, and a `data.json` key is already
 * cleared and exported by the settings manifest (`privacy/data-manifest.ts`) with no further
 * change. And what the unit manifest's pattern buys (a merge across devices) needs a per-device
 * file; this record is one per install, by `[D-426]`.
 *
 * **The key is the one the store it replaces used** (`'materialArrivals'`, classified
 * `content-derived` in that manifest), at a new record version. That is deliberate and temporary:
 * it keeps the delete and export coverage exact with no privacy-file edit, and it is the
 * "replacement" the ruling asks for. The follow-up that composes this store in `main.ts` and
 * deletes the old one renames the key and rewrites the manifest's `holds` text in the same
 * change (`ol-egov.141.89.11.24`'s close evidence names it). Until then nothing composes both:
 * the old store's own version check reads this record as "nothing observed", and writing it would
 * overwrite this one.
 *
 * ## What the day is
 *
 * **A processing day, never an exact arrival time.** A file reaches her vault, and Olea processes
 * it when it next looks, so the day recorded is no earlier than the arrival and may be later.
 * Nothing that reads this store may word it as an arrival date (`arrivals.ts`'s module doc).
 *
 * ## The rules the ruling fixes, and where each lands
 *
 *  - *Recorded once per version:* {@link applyProcessed} writes a version's first day when the
 *    version has no row, and never moves it afterwards. A reprocess of the same fingerprint may
 *    change the state only, and a reading that finished is never turned back into pending by a
 *    reprocess starting.
 *  - *A new version is its own record:* a changed fingerprint replaces the file's row, with the
 *    day it was first processed (never earlier than the row it replaces: a clock that moved back
 *    cannot make a newer version older). One row per file: the reading needs only the latest
 *    version's day, and a later version's day is never earlier than an earlier one's.
 *  - *Current content can be reread; its day cannot:* {@link applyRebuild} takes what the vault
 *    holds now (fingerprint and state) and records every file with no row **with an unknown day**
 *    (`firstProcessedDay: null`), never with the day of the rebuild. It never invents a day for a
 *    row that has one, never overwrites one, and never counts a file whose content changed
 *    without being processed as a new arrival: an edit counts when it is processed, as before.
 *  - *After loss, unknown:* a deleted store, a corrupted record or the older record shape all
 *    load as nothing on record, and the next rebuild marks everything found unknown. An unknown
 *    day stays unknown when the same version is processed again (whether it was processed before
 *    the loss cannot be told); only a new version, processed after the rebuild, has a known day.
 *  - *Pending is not empty, and unknown is not empty:* a version still being processed is a row
 *    in the state `pending`; a course with nothing on record has no row. A store that has never
 *    been rebuilt (`rebuiltOn: null`) says it cannot say, which the rhythm source reads as "could
 *    not read" (`null`), never as an empty list of courses.
 *
 * ## Two fields beyond the three the ruling names, flagged for review
 *
 * The ruling names fingerprint, first-processed day and state. Three more are here because the
 * reading cannot be sound without them, and none has reached a user's disk yet (nothing composes
 * this store in production; see `ol-egov.141.89.11.24`): `courses` (which courses a file counts
 * for: a note's own `course` list can differ from its folder), `noLaterThan` (on an unknown day
 * only: the day the version was found, so an unknown-day row found before a known day cannot be
 * mistaken for a newer one, and never used as a day itself), and `rebuiltOn` (the store level
 * marker that a rebuild has run, which is what tells "nothing found" from "never looked").
 *
 * **D-005.** No logging here. The rows are paths, course codes, fingerprints, days and states,
 * the same class of thing the materiality hash store already keeps.
 */

import {
  type CalendarDay,
  calendarDayFromLocalDate,
  isCalendarDay,
  type VaultPath,
} from 'olea-core';
import { hasReadModifyWrite } from '../../retrieval/serializing-data-host.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs, the port every store here uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * The top-level key this store owns inside `data.json`. The same key the store it replaces used,
 * at a new record version: see the module doc for why, and for the follow-up that renames it.
 */
export const PROCESSED_REVISION_STORAGE_KEY = 'materialArrivals';

/** Whether a processed version's reading succeeded: `[D-426]`'s read, unreadable or pending. */
export type ProcessingState = 'read' | 'unreadable' | 'pending';

const PROCESSING_STATES: ReadonlySet<string> = new Set<ProcessingState>([
  'read',
  'unreadable',
  'pending',
]);

/** One file's latest processed version. */
export interface ProcessedRevisionRow {
  /** The version's content fingerprint. What makes it "that version". */
  readonly fingerprint: string;
  /** The courses this file counts for, sorted, without duplicates, never empty. */
  readonly courses: readonly string[];
  readonly state: ProcessingState;
  /** The day this version was first processed, or `null` when unknown (never the day of a rebuild). */
  readonly firstProcessedDay: CalendarDay | null;
  /** Present exactly when `firstProcessedDay` is `null`: the day this version was found by rereading. Never a day itself. */
  readonly noLaterThan?: CalendarDay;
}

export interface PersistedProcessedRevisions {
  readonly version: 2;
  /** The day a rebuild pass last completed, or `null` when none has: then the store cannot say. */
  readonly rebuiltOn: CalendarDay | null;
  /** Vault path -> that file's latest processed version. */
  readonly revisions: Readonly<Record<VaultPath, ProcessedRevisionRow>>;
}

/** Nothing on record and never rebuilt: what a fresh install, a lost record or an older record shape reads as. */
export const EMPTY_PROCESSED_REVISIONS: PersistedProcessedRevisions = {
  version: 2,
  rebuiltOn: null,
  revisions: {},
};

/** What a processing moment (or a rebuild) knows about one file version. */
export interface ProcessedRevisionInput {
  readonly path: VaultPath;
  readonly courses: readonly string[];
  readonly fingerprint: string;
  readonly state: ProcessingState;
}

function isRow(value: unknown): value is ProcessedRevisionRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.fingerprint !== 'string' || row.fingerprint.length === 0) return false;
  if (typeof row.state !== 'string' || !PROCESSING_STATES.has(row.state)) return false;
  const courses = row.courses;
  if (
    !Array.isArray(courses) ||
    courses.length === 0 ||
    !courses.every((course) => typeof course === 'string' && course.length > 0)
  ) {
    return false;
  }
  const day = row.firstProcessedDay;
  if (day === null) {
    // An unknown day always carries its bound: without one it could be assumed old.
    return typeof row.noLaterThan === 'string' && isCalendarDay(row.noLaterThan);
  }
  return typeof day === 'string' && isCalendarDay(day) && row.noLaterThan === undefined;
}

/** Exported for tests and for the one place a stored value is trusted. */
export function isPersistedProcessedRevisions(
  value: unknown,
): value is PersistedProcessedRevisions {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2) return false;
  const rebuiltOn = candidate.rebuiltOn;
  if (rebuiltOn !== null && !(typeof rebuiltOn === 'string' && isCalendarDay(rebuiltOn))) {
    return false;
  }
  const revisions = candidate.revisions;
  if (typeof revisions !== 'object' || revisions === null || Array.isArray(revisions)) return false;
  return Object.entries(revisions as Record<string, unknown>).every(
    ([path, row]) => path.length > 0 && isRow(row),
  );
}

function normalisedCourses(courses: readonly string[]): readonly string[] {
  return [...new Set(courses.filter((course) => course.length > 0))].sort();
}

/**
 * A finished reading is never turned back into pending by a reprocess starting; a finished
 * outcome replaces whatever was there.
 */
function mergedState(previous: ProcessingState, incoming: ProcessingState): ProcessingState {
  return incoming === 'pending' && previous !== 'pending' ? previous : incoming;
}

function sameRow(a: ProcessedRevisionRow, b: ProcessedRevisionRow): boolean {
  return (
    a.fingerprint === b.fingerprint &&
    a.state === b.state &&
    a.firstProcessedDay === b.firstProcessedDay &&
    a.noLaterThan === b.noLaterThan &&
    a.courses.length === b.courses.length &&
    a.courses.every((course, index) => course === b.courses[index])
  );
}

/**
 * Pure. A file version was processed on `day`. Returns `current` itself (the same object) when
 * nothing changed, so a caller can skip the write.
 */
export function applyProcessed(
  current: PersistedProcessedRevisions,
  processed: ProcessedRevisionInput,
  day: CalendarDay,
): PersistedProcessedRevisions {
  const courses = normalisedCourses(processed.courses);
  if (courses.length === 0 || processed.fingerprint.length === 0) return current;

  const previous = current.revisions[processed.path];
  let row: ProcessedRevisionRow;
  if (previous !== undefined && previous.fingerprint === processed.fingerprint) {
    // The same version again: its first day is settled (known, or unknown for good).
    row = { ...previous, courses, state: mergedState(previous.state, processed.state) };
  } else {
    // A new version. Never earlier than the version it replaces: a newer version cannot have been
    // first processed before an older one was.
    const floor = previous?.firstProcessedDay ?? null;
    const firstProcessedDay = floor !== null && floor > day ? floor : day;
    row = {
      fingerprint: processed.fingerprint,
      courses,
      state: processed.state,
      firstProcessedDay,
    };
  }
  if (previous !== undefined && sameRow(previous, row)) return current;
  return { ...current, revisions: { ...current.revisions, [processed.path]: row } };
}

/**
 * Pure. Records what the vault holds now, on `day`, and marks the store rebuilt. **Never asserts a
 * first-processed day**: a file with no row is recorded with an unknown day (bounded by `day`); a
 * file with a row for the same version keeps that row (the state may advance); a file whose version
 * differs from its row is left alone, because a change counts when it is processed, not when it is
 * next seen. Rows for files no longer found are kept: they arrived, whatever became of them.
 */
export function applyRebuild(
  current: PersistedProcessedRevisions,
  found: readonly ProcessedRevisionInput[],
  day: CalendarDay,
): PersistedProcessedRevisions {
  const revisions: Record<VaultPath, ProcessedRevisionRow> = { ...current.revisions };
  for (const file of found) {
    const courses = normalisedCourses(file.courses);
    if (courses.length === 0 || file.fingerprint.length === 0) continue;
    const previous = revisions[file.path];
    if (previous === undefined) {
      revisions[file.path] = {
        fingerprint: file.fingerprint,
        courses,
        state: file.state,
        firstProcessedDay: null,
        noLaterThan: day,
      };
    } else if (previous.fingerprint === file.fingerprint) {
      revisions[file.path] = {
        ...previous,
        courses,
        state: mergedState(previous.state, file.state),
      };
    }
    // A different fingerprint: the row keeps speaking for the version that was processed.
  }
  return { version: 2, rebuiltOn: day, revisions };
}

export class ObsidianProcessedRevisionStore {
  /**
   * @param now The clock every recorded day is read from. Injected so a caller cannot record any
   * day but the day of the call, and so a test moves it by hand.
   */
  constructor(
    private readonly host: ObsidianDataHost,
    private readonly now: () => Date,
  ) {}

  /**
   * Returns `EMPTY_PROCESSED_REVISIONS` (never rebuilt, so the store cannot say) when nothing
   * usable is stored: a fresh install, a corrupted record and the older record shape all read that
   * way, the same posture every store here takes.
   */
  async load(): Promise<PersistedProcessedRevisions> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_PROCESSED_REVISIONS;
    const candidate = (blob as Record<string, unknown>)[PROCESSED_REVISION_STORAGE_KEY];
    return isPersistedProcessedRevisions(candidate) ? candidate : EMPTY_PROCESSED_REVISIONS;
  }

  /**
   * A file version was processed just now. Records its first-processed day once, keeps it on a
   * reprocess, and gives a new version its own. Read-modify-write, with the decision inside the
   * queued step, exactly like the store this replaces (`today/material-arrival-store.ts`).
   */
  async recordProcessed(processed: ProcessedRevisionInput): Promise<void> {
    const day = calendarDayFromLocalDate(this.now());
    await this.update((current) => applyProcessed(current, processed, day));
  }

  /**
   * Rereads what the vault holds now into the store: fingerprints and states, every unrecorded file
   * with an unknown day (see {@link applyRebuild}). Marks the store rebuilt. `found` must be the
   * whole listing; a partial one would leave a course looking as if nothing had arrived.
   */
  async rebuild(found: readonly ProcessedRevisionInput[]): Promise<void> {
    const day = calendarDayFromLocalDate(this.now());
    await this.update((current) => applyRebuild(current, found, day));
  }

  private async update(
    next: (current: PersistedProcessedRevisions) => PersistedProcessedRevisions,
  ): Promise<void> {
    const mutate = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const raw = blob[PROCESSED_REVISION_STORAGE_KEY];
      const current = isPersistedProcessedRevisions(raw) ? raw : EMPTY_PROCESSED_REVISIONS;
      const updated = next(current);
      if (updated === current) return blob;
      blob[PROCESSED_REVISION_STORAGE_KEY] = updated;
      return blob;
    };

    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(mutate);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(mutate(existing));
  }
}
