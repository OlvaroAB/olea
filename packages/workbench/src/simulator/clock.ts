/**
 * The simulator's clock (`docs/dev/simulator-design.md` §3).
 *
 * The plugin reads wall time in several places via bare `new Date()` /
 * `Date.now()` rather than an injected instant (see the design doc's own
 * citation list). Threading a real clock through the plugin touches
 * `packages/plugin/src/main.ts`, which is outside every WBX bead's `owns` —
 * so instead this module installs a page-level override of the global
 * `Date` constructor, offset by a persisted number of milliseconds, before
 * anything that reads wall time runs. Every `new Date()` (no arguments),
 * `Date.now()` and bare `Date()` call then reports the shifted instant;
 * dated constructors (`new Date(2020, 0, 1)`, `new Date(ms)`, `new
 * Date(isoString)`) are untouched, because a caller that named an instant
 * explicitly is not asking the clock what time it is.
 *
 * `page.clock` (Playwright's own time-mocking) is deliberately not used —
 * the override has to be what a real browser (David's, during a lived
 * walkthrough) runs, not a mechanism only the test runner understands.
 */

import type { SimulatorStore } from './store.js';

/** Captured at module load, before anything has a chance to install an override — see {@link installSimulatorDateOverride}. */
const RealDate = globalThis.Date;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SimulatorClock {
  /** The current simulated instant: the real wall clock plus the persisted offset. */
  now(): Date;
  /** The persisted offset, in milliseconds. `0` means the clock reads real time. */
  offsetMs(): number;
  /**
   * Installs the page-level `Date` override. Call once, after construction
   * and before mounting anything that reads wall time. Returns an uninstall
   * function (restores the real `Date`), for tests and for a clean unmount.
   */
  install(): () => void;
  /** Steps the offset by whole days (negative steps back) and persists it. */
  advanceDays(days: number): Promise<void>;
  /** Sets the offset directly, in milliseconds from the real wall clock, and persists it. */
  setOffsetMs(offsetMs: number): Promise<void>;
  /** Sets the offset so {@link now} reads exactly `asOf`, and persists it. */
  jumpTo(asOf: Date): Promise<void>;
  /** Resets the offset to zero (real time) and persists it — the clock's third of a full reset. */
  resetOffset(): Promise<void>;
}

/**
 * Installs a `Proxy` over the real `Date` constructor on `globalThis`.
 * `construct` forwards dated constructors unchanged and shifts only the
 * zero-argument form; `apply` covers the rarely-used bare `Date()` call
 * (which real JS ignores arguments for and always returns the current time as
 * a string); `get` shifts only the `now` static. Every other static
 * (`parse`, `UTC`, ...) and the whole prototype chain pass straight through
 * `Reflect`, so `instanceof Date` and every other `Date` method are
 * unaffected.
 */
function installSimulatorDateOverride(getOffsetMs: () => number): () => void {
  const handler: ProxyHandler<DateConstructor> = {
    construct(_target, args, newTarget) {
      if (args.length === 0) {
        return Reflect.construct(RealDate, [RealDate.now() + getOffsetMs()], newTarget);
      }
      return Reflect.construct(RealDate, args, newTarget);
    },
    apply() {
      return new RealDate(RealDate.now() + getOffsetMs()).toString();
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => RealDate.now() + getOffsetMs();
      return Reflect.get(target, prop, receiver);
    },
  };
  const proxied = new Proxy(RealDate, handler) as unknown as DateConstructor;
  (globalThis as { Date: DateConstructor }).Date = proxied;
  return () => {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  };
}

/**
 * Builds a `SimulatorClock` whose offset is loaded from (and every change
 * persisted to) `store`.
 *
 * `asOf` (`ol-3ux7.64.14` [WBX-12]) is the world's snapshot day, used ONLY
 * when `store` has never persisted an offset at all — `store.ts`'s own doc on
 * why `loadClockOffsetMs` returns `undefined` rather than defaulting to `0`
 * for exactly this distinction. Omitting it (every pre-WBX-12 caller, and
 * every test in this file that does not pass it) preserves the old default:
 * a never-touched clock reads real wall time. Passing it is what makes "on
 * first open, the simulated date is the world's asOf, not real today" true
 * (design doc §3 / F9.S6) — `SimulatorController.create` passes the world
 * descriptor's `asOf` here.
 */
export async function createSimulatorClock(
  store: SimulatorStore,
  asOf?: Date,
): Promise<SimulatorClock> {
  const persisted = await store.loadClockOffsetMs();
  let offsetMs =
    persisted !== undefined ? persisted : asOf !== undefined ? asOf.getTime() - RealDate.now() : 0;

  async function setOffsetMs(next: number): Promise<void> {
    offsetMs = next;
    await store.saveClockOffsetMs(offsetMs);
  }

  // Persist the `asOf` fallback the moment it is computed — never leave the
  // offset "on the never-persisted default" once it has actually been
  // decided, or a second `createSimulatorClock` over the same store before
  // anything else touches the clock (e.g. a reload with nothing yet rated)
  // would recompute a SECOND, slightly-later fallback instead of reading a
  // stable value back.
  if (persisted === undefined && asOf !== undefined) await setOffsetMs(offsetMs);

  return {
    now: () => new RealDate(RealDate.now() + offsetMs),
    offsetMs: () => offsetMs,
    install: () => installSimulatorDateOverride(() => offsetMs),
    advanceDays: (days: number) => setOffsetMs(offsetMs + days * DAY_MS),
    setOffsetMs,
    jumpTo: (asOf: Date) => setOffsetMs(asOf.getTime() - RealDate.now()),
    resetOffset: () => setOffsetMs(0),
  };
}
