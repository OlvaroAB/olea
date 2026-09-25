/**
 * The simulator's clock (`docs/dev/simulator-design.md` §3).
 *
 * **`ol-3ux7.64.9` [WBX-8] update.** This module used to also install a
 * page-level override of the global `Date` constructor, because nothing in
 * `packages/plugin/src/main.ts` took an injected clock and threading one
 * through touched a file no WBX bead owned. That gap is closed:
 * `OleaPlugin` now exposes `setClock(clock: Clock): void`
 * (`packages/plugin/src/main.ts`), and `SimulatorController.remountPane`
 * calls it right after every mount with `{ now: () => this.clock.now() }`.
 * The page-level override (`installSimulatorDateOverride`, `SimulatorClock
 * .install`) is retired along with it — nothing in this package needs the
 * global `Date` constructor shifted any more. What remains here is the
 * offset bookkeeping itself: `now()`, `offsetMs()`, `advanceDays`,
 * `setOffsetMs`, `jumpTo`, `resetOffset`, all built on the REAL `Date`
 * (`RealDate` below), persisted through `store`.
 */

import type { SimulatorStore } from './store.js';

const RealDate = globalThis.Date;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SimulatorClock {
  /** The current simulated instant: the real wall clock plus the persisted offset. */
  now(): Date;
  /** The persisted offset, in milliseconds. `0` means the clock reads real time. */
  offsetMs(): number;
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
    advanceDays: (days: number) => setOffsetMs(offsetMs + days * DAY_MS),
    setOffsetMs,
    jumpTo: (asOf: Date) => setOffsetMs(asOf.getTime() - RealDate.now()),
    resetOffset: () => setOffsetMs(0),
  };
}
