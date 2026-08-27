/**
 * `ObsidianTermWindowStore` — persists F6.9's asked-once term start/end,
 * wherever a future ask surface writes one (`ol-v7r5.6`).
 *
 * ## Why this exists without an ask surface yet
 *
 * F6.9 (`docs/Olea_alpha_functional_scope.md`, `olea-service`): *"Term start
 * and end are asked once, at the start of a term … wherever she has recorded
 * them, that outranks the ask."* Building the ask itself is a settings
 * surface, and F7.2's enumerated settings list — course mapping, model
 * selection, theme, cache controls, and a named, closed set of study
 * preferences — does not name a term-dates question anywhere in it. The
 * standing rule *"no user-visible affordance without a clause"* forbids
 * inventing one here, so this module builds only the read/write plumbing a
 * future ask surface needs, and the ask itself is left for the bead F7.2
 * would have to be amended by first — see `ol-v7r5.6`'s close evidence for
 * the name.
 *
 * `save` has no production caller yet, deliberately, for the same reason
 * `readConceptsFromVault` and `gradeExplainBackAttempt` shipped with none
 * (see their own module docs): the port existing and tested is what lets the
 * bead that adds the surface call straight into it instead of inventing a
 * second store. `load` DOES have a production caller — `today/data-source.ts`'s
 * `createRhythmSource` reads it on every panel open, through
 * `resolveTermBoundary`, so a term window recorded by hand (or by a later
 * bead's UI) reaches the rhythm reading with no code change here.
 *
 * Same single-key `data.json` pattern every store in this plugin uses
 * (`plan/settings-store.ts` is the closest sibling: one settings-shaped
 * value, versioned, read-modify-write).
 */

import { type CalendarDay, isCalendarDay, type TermWindow } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const TERM_WINDOW_STORAGE_KEY = 'termWindow';

export interface PersistedTermWindow {
  readonly version: 1;
  /** `null` means "not recorded" — the state every install starts in and stays in until F7.2 is amended to ask. */
  readonly start: CalendarDay | null;
  readonly end: CalendarDay | null;
}

export const EMPTY_TERM_WINDOW: PersistedTermWindow = { version: 1, start: null, end: null };

function isPersistedTermWindow(value: unknown): value is PersistedTermWindow {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  const okDay = (day: unknown): boolean =>
    day === null || (typeof day === 'string' && isCalendarDay(day));
  return okDay(candidate.start) && okDay(candidate.end);
}

export class ObsidianTermWindowStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /**
   * The recorded term window, resolved to `TermWindow | null` — `null`
   * whenever either bound is missing or unrecognised, exactly as
   * `resolveTermBoundary`'s own doc requires: a term window is asked for as
   * a pair and a half-recorded pair is not a boundary anything can be
   * measured against.
   */
  async load(): Promise<TermWindow | null> {
    const blob = await this.host.loadData();
    const candidate =
      typeof blob === 'object' && blob !== null
        ? (blob as Record<string, unknown>)[TERM_WINDOW_STORAGE_KEY]
        : undefined;
    const persisted = isPersistedTermWindow(candidate) ? candidate : EMPTY_TERM_WINDOW;
    if (persisted.start === null || persisted.end === null) return null;
    return { start: persisted.start, end: persisted.end };
  }

  /** No production caller yet — see this module's doc. Read-modify-write, same as every other store here. */
  async save(window: TermWindow): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[TERM_WINDOW_STORAGE_KEY] = {
      version: 1,
      start: window.start,
      end: window.end,
    } satisfies PersistedTermWindow;
    await this.host.saveData(blob);
  }
}
