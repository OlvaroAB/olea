/**
 * `ObsidianMaterialArrivalStore` — persists one calendar day per course,
 * naming the most recent day Olea observed material from that course arrive
 * (F6.9, `ol-v7r5.6`).
 *
 * ## Why this exists
 *
 * `packages/core/src/today/rhythm.ts`'s own module doc names three inputs
 * F6.9 needs "to be computable at all" — term start/end, tempo, and a
 * per-course last-material-arrival timestamp — and says only the third has
 * anywhere to come from today. This is that somewhere: a local projection,
 * never server-side (C6), read-modify-write on `data.json` the same
 * single-key pattern every other store in this plugin uses
 * (`ingestion/materiality/hash-store.ts`'s module doc argues the shape;
 * `plan/settings-store.ts` is the closest sibling in this same package).
 *
 * **What "arrived" means here is a call site's decision, not this store's.**
 * `main.ts`'s materiality trigger path (`evaluateMaterialityChange`) is what
 * decides *when* to call `recordArrival` — see that call site's own comment
 * for exactly which `MaterialityEvaluationResult` outcomes count. This module
 * only remembers, per course, the latest day it was told about.
 *
 * ## Monotonic by construction
 *
 * `recordArrival` never moves a course's recorded day backwards. Materiality
 * events are watched off `vault.watch`, which gives no ordering guarantee
 * across paths, so two edits in different courses (or a delayed re-evaluation
 * of an older event) must never let a later write regress an earlier, more
 * recent observation. `Date.parse`-free string comparison is safe because
 * `CalendarDay` is always `YYYY-MM-DD` (`calendar-day.ts`'s own guarantee),
 * which sorts identically as a string and as a date.
 */

import { type CalendarDay, isCalendarDay } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const MATERIAL_ARRIVAL_STORAGE_KEY = 'materialArrivals';

export interface PersistedMaterialArrivals {
  readonly version: 1;
  /** Course code -> the most recent local calendar day material from it was observed arriving. */
  readonly lastArrivalByCourse: Readonly<Record<string, CalendarDay>>;
}

/** Nothing observed yet — the state a fresh install starts in. */
export const EMPTY_MATERIAL_ARRIVALS: PersistedMaterialArrivals = {
  version: 1,
  lastArrivalByCourse: {},
};

function isPersistedMaterialArrivals(value: unknown): value is PersistedMaterialArrivals {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  const table = candidate.lastArrivalByCourse;
  if (typeof table !== 'object' || table === null) return false;
  return Object.entries(table as Record<string, unknown>).every(
    ([course, day]) => course.length > 0 && typeof day === 'string' && isCalendarDay(day),
  );
}

export class ObsidianMaterialArrivalStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EMPTY_MATERIAL_ARRIVALS` — never a throw — when nothing usable is stored. */
  async load(): Promise<PersistedMaterialArrivals> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_MATERIAL_ARRIVALS;
    const candidate = (blob as Record<string, unknown>)[MATERIAL_ARRIVAL_STORAGE_KEY];
    // A corrupted or unrecognised entry is treated as "never observed" for
    // every course, the same posture `ObsidianMaterialityHashStore.load`
    // takes for one path: refusing to read is a worse failure than falling
    // back to a fresh-install state.
    return isPersistedMaterialArrivals(candidate) ? candidate : EMPTY_MATERIAL_ARRIVALS;
  }

  /**
   * Records `day` as `course`'s latest observed arrival, unless a
   * later-or-equal day is already on record — see this module's doc for why
   * that direction is never allowed to regress.
   */
  async recordArrival(course: string, day: CalendarDay): Promise<void> {
    // Read-modify-write, not a cached blob from construction time: another
    // course's arrival (or another install session, in principle) may have
    // written since this store last loaded.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const currentRaw = blob[MATERIAL_ARRIVAL_STORAGE_KEY];
    const current = isPersistedMaterialArrivals(currentRaw) ? currentRaw : EMPTY_MATERIAL_ARRIVALS;

    const previousDay = current.lastArrivalByCourse[course];
    if (previousDay !== undefined && previousDay >= day) return;

    blob[MATERIAL_ARRIVAL_STORAGE_KEY] = {
      version: 1,
      lastArrivalByCourse: { ...current.lastArrivalByCourse, [course]: day },
    } satisfies PersistedMaterialArrivals;
    await this.host.saveData(blob);
  }
}
