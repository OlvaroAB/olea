/**
 * `ObsidianTermWindowStore` — persists F7.2's ask-once-or-dismissed term
 * start/end (`ol-v7r5.6` built the read side; `ol-0r92.6` / `[D-147]` adds
 * the write side and the decline bit).
 *
 * ## Where this sits after `[D-147]`
 *
 * F7.2, amended (`docs/Olea_alpha_functional_scope.md`, `olea-service`):
 * *"Term dates are on this list … the ask is until-answered-or-dismissed: a
 * quiet pointer appears when the rhythm reading would otherwise render with
 * no yardstick, recurs only while the fields are neither filled nor
 * explicitly skipped, and never again after either — an explicit skip is
 * recorded so it is distinguishable from never-asked."* Building the ask
 * itself was blocked on F7.2 naming it at all (`no-affordance-without-a-
 * clause`) — see `ol-v7r5.6`'s close evidence — and `[D-147]` (ratified
 * 2026-08-29) is the amendment that releases this store's write side:
 * `packages/plugin/src/settings/settings-tab.ts` now calls `save`/`skip`,
 * and `packages/plugin/src/today/view.ts` reads `askState` to decide whether
 * to draw its one quiet pointer.
 *
 * `load` has had a production caller since before this bead —
 * `today/data-source.ts`'s `createRhythmSource` reads it on every panel
 * open, through `resolveTermBoundary` — and its read contract (resolving to
 * `TermWindow | null`, `null` on any half-recorded or unrecognised state) is
 * UNCHANGED by the version-2 shape below.
 *
 * ## The decline bit, and why the shape is versioned
 *
 * `[D-147]`'s ratification resolves the original proposal's open question 2
 * in the affirmative: *"the persisted shape gains the decline marker."*
 * Version 1 (this store's shape before this bead) could not distinguish
 * "never asked" from "asked and explicitly declined" — both were
 * `{start: null, end: null}` — so a decline would have read right back as
 * never-asked and the ask would have fired again on the next panel open,
 * which is exactly the nag `[D-147]`'s ratification calls out as the
 * fragility a literally-once ask exposed. Version 2 adds `skipped`. A
 * version-1 record (any real pre-`[D-147]` install) migrates to
 * `skipped: false` on read — indistinguishable from a fresh install's
 * never-asked state, which is the correct reading: no version-1 install
 * could have recorded a decline, because there was no ask to decline yet.
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
  readonly version: 2;
  /** `null` means "not recorded". */
  readonly start: CalendarDay | null;
  readonly end: CalendarDay | null;
  /**
   * `[D-147]`'s decline bit: `true` once she has explicitly skipped the ask,
   * distinct from never having been asked (or answered) at all. Only
   * `askState()` reads this directly — `load()`'s `TermWindow | null`
   * contract does not change, because the rhythm reading does not care
   * *why* no window exists, only whether one does.
   */
  readonly skipped: boolean;
}

/** The pre-`[D-147]` shape, kept only so `normalisePersisted` can migrate a real install's existing record. Never written by this module again. */
interface PersistedTermWindowV1 {
  readonly version: 1;
  readonly start: CalendarDay | null;
  readonly end: CalendarDay | null;
}

export const EMPTY_TERM_WINDOW: PersistedTermWindow = {
  version: 2,
  start: null,
  end: null,
  skipped: false,
};

/** `[D-147]`'s three-way ask state — drives the Today panel's quiet pointer (`view.ts`'s `renderTermDatesPointer`) and nothing else. */
export type TermDatesAskState = 'unanswered' | 'answered' | 'skipped';

function isCalendarDayOrNull(day: unknown): day is CalendarDay | null {
  return day === null || (typeof day === 'string' && isCalendarDay(day));
}

function isPersistedTermWindowV2(value: unknown): value is PersistedTermWindow {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2) return false;
  if (typeof candidate.skipped !== 'boolean') return false;
  return isCalendarDayOrNull(candidate.start) && isCalendarDayOrNull(candidate.end);
}

function isPersistedTermWindowV1(value: unknown): value is PersistedTermWindowV1 {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  return isCalendarDayOrNull(candidate.start) && isCalendarDayOrNull(candidate.end);
}

/** Migrates a raw `data.json` value to the current shape — corrupted, missing or unrecognised input is the empty, never-asked state (never a throw). */
function normalisePersisted(candidate: unknown): PersistedTermWindow {
  if (isPersistedTermWindowV2(candidate)) return candidate;
  if (isPersistedTermWindowV1(candidate)) {
    return { version: 2, start: candidate.start, end: candidate.end, skipped: false };
  }
  return EMPTY_TERM_WINDOW;
}

export class ObsidianTermWindowStore {
  constructor(private readonly host: ObsidianDataHost) {}

  private async loadPersisted(): Promise<PersistedTermWindow> {
    const blob = await this.host.loadData();
    const candidate =
      typeof blob === 'object' && blob !== null
        ? (blob as Record<string, unknown>)[TERM_WINDOW_STORAGE_KEY]
        : undefined;
    return normalisePersisted(candidate);
  }

  private async writePersisted(next: PersistedTermWindow): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[TERM_WINDOW_STORAGE_KEY] = next;
    await this.host.saveData(blob);
  }

  /**
   * The recorded term window, resolved to `TermWindow | null` — `null`
   * whenever either bound is missing or unrecognised, exactly as
   * `resolveTermBoundary`'s own doc requires: a term window is asked for as
   * a pair and a half-recorded pair is not a boundary anything can be
   * measured against. Unchanged by `[D-147]`: the rhythm reading's caller
   * does not need to know skip state, only whether a usable window exists.
   */
  async load(): Promise<TermWindow | null> {
    const persisted = await this.loadPersisted();
    if (persisted.start === null || persisted.end === null) return null;
    return { start: persisted.start, end: persisted.end };
  }

  /**
   * `[D-147]`'s ask state, for the settings ask and the Today panel's quiet
   * pointer: `'answered'` once both bounds are recorded (regardless of the
   * decline bit — filling the fields in later always wins), `'skipped'`
   * when she explicitly declined and neither bound is recorded, and
   * `'unanswered'` otherwise — the state every fresh install starts in, and
   * the only state that ever draws the pointer.
   */
  async askState(): Promise<TermDatesAskState> {
    const persisted = await this.loadPersisted();
    if (persisted.start !== null && persisted.end !== null) return 'answered';
    if (persisted.skipped) return 'skipped';
    return 'unanswered';
  }

  /**
   * The settings ask's production caller (`settings-tab.ts`): a complete
   * window, both bounds given. Always clears the decline bit — recording a
   * value later, after a skip, is an answer, not a change of mind about the
   * skip needing to be remembered.
   */
  async save(window: TermWindow): Promise<void> {
    await this.writePersisted({
      version: 2,
      start: window.start,
      end: window.end,
      skipped: false,
    });
  }

  /**
   * `[D-147]`'s explicit-skip path: records the decline bit with no dates,
   * and never invents one — the clause's own words, "no default term length
   * is ever suggested". Idempotent; skipping twice is the same state as
   * skipping once.
   */
  async skip(): Promise<void> {
    await this.writePersisted({ version: 2, start: null, end: null, skipped: true });
  }

  /**
   * Clears a partially- or fully-entered pair back to never-asked, without
   * marking a skip — the settings field pair stays an ordinary editable
   * control (proposal §2: "not a second ask; it is the same one field"), so
   * deleting what she entered is a correction, not a decline. A Class B
   * default: the proposal's open questions did not name this case, and
   * re-showing the pointer after a value is removed is the reversible
   * reading of `askState`'s own contract (`start`/`end` both absent).
   */
  async clear(): Promise<void> {
    await this.writePersisted({ version: 2, start: null, end: null, skipped: false });
  }
}
