/**
 * The term scrubber (`ol-3ux7.64.16` [WBX-13], `docs/dev/simulator-design.md`
 * §4b, F9.S2) — replaces the bare `[data-sim-jump]` date input the bottom
 * strip carried before this bead. A single `<input type="range">` bounded
 * from the world's `asOf` (`world.ts`) forward {@link SCRUBBER_TERM_WEEKS}
 * weeks, with the chosen date shown beside it.
 *
 * **Draw, do not decide** — the same split `shell.ts`'s `renderRibbonViews`
 * and `provenance-badge.ts`'s `renderProvenanceBadge` already use. This
 * module only builds/updates the DOM and reports which day a given slider
 * position names; `controller.ts` owns turning a committed move into a clock
 * jump, a visibility-cutoff update and a remount (exactly what Advance does
 * today — see that file's own doc).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far past the world's `asOf` the scrubber reaches. Declared, not
 * derived, per this bead's own brief. 16 weeks is a full term's worth of
 * forward room — comfortably longer than the real snapshot's own remaining
 * span and every persona world's `persona-world.mjs`-declared run to date —
 * so every world's scrubber has the same reach regardless of exactly how
 * many weeks that particular world's own history happens to cover, rather
 * than a second per-world field this bead would have to plumb through the
 * descriptor (`world.ts`) for no product benefit: nothing today reads "how
 * many weeks are actually left in THIS world's term," and a slider that
 * reached exactly as far as the last authored day would invite scrubbing
 * into a day nobody generated any material for.
 */
export const SCRUBBER_TERM_WEEKS = 16;

export const SIMULATOR_SCRUBBER_SELECTOR = '[data-wb-sim-scrubber]';

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** The date `days` past `asOfIso` — `controller.ts`'s scrub handler uses this to turn a committed slider position back into a jump target, and it is what {@link renderTermScrubber} itself uses to compute the label, so the two can never disagree. */
export function scrubberDateAt(asOfIso: string, days: number): string {
  return isoDay(addDays(parseIsoDay(asOfIso), days));
}

/** The scrubber's own upper bound, in whole days past `asOf` — `SCRUBBER_TERM_WEEKS * 7`, exposed so `controller.ts` can clamp a committed value without duplicating the arithmetic. */
export const SCRUBBER_MAX_DAYS = SCRUBBER_TERM_WEEKS * 7;

/**
 * The offset (whole days, clamped to `[0, SCRUBBER_MAX_DAYS]`) between
 * `asOfIso` and `currentIso` — the inverse of {@link scrubberDateAt}, used to
 * position the handle from the clock's own current day. Clamped rather than
 * asserted: a persisted clock offset from BEFORE this bead landed, or a
 * future jump past the declared window, must not desync the native
 * `<input type="range">`, which silently clamps its own displayed value to
 * `[min, max]` regardless of what `.value` is set to — clamping here keeps
 * the DISPLAYED date in sync with whatever the slider will actually show.
 */
export function daysSinceAsOf(asOfIso: string, currentIso: string): number {
  const raw = Math.round(
    (parseIsoDay(currentIso).getTime() - parseIsoDay(asOfIso).getTime()) / DAY_MS,
  );
  return Math.min(Math.max(raw, 0), SCRUBBER_MAX_DAYS);
}

export interface TermScrubberState {
  /** `YYYY-MM-DD` — the world's snapshot day; the scrubber's own left bound. */
  readonly asOf: string;
  /** `YYYY-MM-DD` — the simulator clock's current day; where the handle sits. */
  readonly current: string;
}

export interface TermScrubberElements {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly dateLabel: HTMLElement;
}

/**
 * Builds (on first call) or updates (idempotent — safe on every remount, the
 * same contract `renderProvenanceBadge` already keeps) the scrubber inside
 * `container`. Returns the live elements so `controller.ts` can wire the
 * `input`'s own `input`/`change` listeners once, at first render, without
 * this module reaching back into `SimulatorController` itself.
 */
export function renderTermScrubber(
  container: HTMLElement,
  state: TermScrubberState,
): TermScrubberElements {
  let root = container.querySelector<HTMLElement>(SIMULATOR_SCRUBBER_SELECTOR);
  if (root === null) {
    root = container.createDiv({
      cls: 'wb-sim-scrubber',
      attr: { 'data-wb-sim-scrubber': 'true' },
    });
    root.createDiv({ cls: 'wb-sim-jump-label', text: 'Term' });
    root.createEl('input', {
      attr: { type: 'range', 'data-sim-scrub': 'true', min: '0' },
    });
    root.createSpan({ cls: 'wb-sim-scrub-date', attr: { 'data-sim-scrub-date': 'true' } });
  }

  const input = root.querySelector<HTMLInputElement>('[data-sim-scrub]');
  const dateLabel = root.querySelector<HTMLElement>('[data-sim-scrub-date]');
  if (input === null || dateLabel === null) {
    throw new Error('renderTermScrubber: scrubber DOM is missing an expected child');
  }

  const clampedDays = daysSinceAsOf(state.asOf, state.current);
  input.max = String(SCRUBBER_MAX_DAYS);
  input.value = String(clampedDays);
  dateLabel.setText(scrubberDateAt(state.asOf, clampedDays));

  return { root, input, dateLabel };
}
