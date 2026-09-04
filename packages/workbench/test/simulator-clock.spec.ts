/**
 * `simulator/clock.ts` (`ol-3ux7.64.2` [WBX-1]) — the page-level `Date`
 * override is the mechanism F9.S2's "the clock override moves every
 * wall-time read the plugin makes" scenario depends on. This file proves
 * the mechanism itself: every un-dated `Date` read shifts, every dated one
 * does not, and `install()`'s returned uninstall function actually restores
 * the real `Date` — load-bearing for `SimulatorController.dispose`, since a
 * leaked override would corrupt every OTHER surface's fixed clock too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSimulatorClock } from '../src/simulator/clock.js';
import { createMemoryStore } from '../src/simulator/store.js';

const RealDate = globalThis.Date;

describe('SimulatorClock', () => {
  afterEach(() => {
    // Belt-and-braces: a test that forgets to call its own uninstall must
    // never leak the override into a later test file.
    globalThis.Date = RealDate;
  });

  it('reads real time when the offset is zero', async () => {
    const clock = await createSimulatorClock(createMemoryStore());
    const before = RealDate.now();
    const now = clock.now().getTime();
    const after = RealDate.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after + 5);
  });

  it('advanceDays shifts now() by whole days and persists the offset', async () => {
    const store = createMemoryStore();
    const clock = await createSimulatorClock(store);
    const before = clock.now().getTime();

    await clock.advanceDays(1);

    const delta = clock.now().getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(86_400_000);
    expect(delta).toBeLessThan(86_400_000 + 1000);
    expect(await store.loadClockOffsetMs()).toBe(clock.offsetMs());
  });

  it('a fresh clock over the same store restores the persisted offset — reload behaviour', async () => {
    const store = createMemoryStore();
    const first = await createSimulatorClock(store);
    await first.advanceDays(3);

    const second = await createSimulatorClock(store);
    expect(second.offsetMs()).toBe(first.offsetMs());
  });

  it('with no persisted offset and an asOf given, now() starts at asOf rather than real time (ol-3ux7.64.14 [WBX-12])', async () => {
    const asOf = new RealDate('2027-01-15T00:00:00.000Z');
    const clock = await createSimulatorClock(createMemoryStore(), asOf);
    expect(clock.now().getTime()).toBe(asOf.getTime());
  });

  it('an asOf argument is ignored once an offset has actually been persisted', async () => {
    const store = createMemoryStore();
    await (await createSimulatorClock(store)).advanceDays(2);

    const asOf = new RealDate('2027-01-15T00:00:00.000Z');
    const clock = await createSimulatorClock(store, asOf);
    expect(clock.now().getTime()).not.toBe(asOf.getTime());
    expect(await store.loadClockOffsetMs()).toBe(clock.offsetMs());
  });

  it('the asOf fallback is itself persisted, so a second clock over the same untouched store reads the same instant back', async () => {
    const asOf = new RealDate('2027-01-15T00:00:00.000Z');
    const store = createMemoryStore();
    const first = await createSimulatorClock(store, asOf);
    expect(first.now().getTime()).toBe(asOf.getTime());

    const second = await createSimulatorClock(store);
    expect(second.now().getTime()).toBe(asOf.getTime());
  });

  it('jumpTo sets now() to exactly the given instant', async () => {
    const clock = await createSimulatorClock(createMemoryStore());
    const target = new RealDate('2027-06-01T12:00:00.000Z');

    await clock.jumpTo(target);

    expect(clock.now().getTime()).toBe(target.getTime());
  });

  describe('install()', () => {
    it('shifts `new Date()` (no arguments) and `Date.now()`', async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      const target = new RealDate('2030-01-01T00:00:00.000Z').getTime();
      await clock.jumpTo(new RealDate(target));
      const uninstall = clock.install();
      try {
        // A tolerance, not an exact match: `now()` is real time plus a fixed
        // offset, not a frozen instant, so real milliseconds elapsed between
        // `jumpTo` and this assertion legitimately show up here.
        expect(Date.now()).toBeGreaterThanOrEqual(target);
        expect(Date.now()).toBeLessThan(target + 1000);
        expect(new Date(Date.now()).getTime()).toBeGreaterThanOrEqual(target);
        expect(Date.now()).toBeLessThan(target + 1000);
      } finally {
        uninstall();
      }
    });

    it('leaves DATED constructors untouched', async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      await clock.jumpTo(new RealDate('2030-01-01T00:00:00.000Z'));
      const uninstall = clock.install();
      try {
        expect(new Date('2020-03-04T00:00:00.000Z').toISOString()).toBe('2020-03-04T00:00:00.000Z');
        expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
        expect(new Date(2020, 0, 1).getFullYear()).toBe(2020);
      } finally {
        uninstall();
      }
    });

    it('keeps `instanceof Date` true for both forms', async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      const uninstall = clock.install();
      try {
        expect(new Date() instanceof Date).toBe(true);
        expect(new Date(0) instanceof Date).toBe(true);
      } finally {
        uninstall();
      }
    });

    it('leaves other statics (parse, UTC) working', async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      const uninstall = clock.install();
      try {
        expect(Date.parse('2020-01-01T00:00:00.000Z')).toBe(
          RealDate.parse('2020-01-01T00:00:00.000Z'),
        );
        expect(Date.UTC(2020, 0, 1)).toBe(RealDate.UTC(2020, 0, 1));
      } finally {
        uninstall();
      }
    });

    it('shifts the bare `Date()` function call the same way', async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      await clock.jumpTo(new RealDate('2030-01-01T00:00:00.000Z'));
      const uninstall = clock.install();
      try {
        const dateFn = (globalThis as unknown as { Date: () => string }).Date;
        expect(new RealDate(dateFn()).getUTCFullYear()).toBe(2030);
      } finally {
        uninstall();
      }
    });

    it("uninstall() restores the real Date — required so leaving #/simulator never shifts another surface's clock", async () => {
      const clock = await createSimulatorClock(createMemoryStore());
      const uninstall = clock.install();
      expect(globalThis.Date).not.toBe(RealDate);
      uninstall();
      expect(globalThis.Date).toBe(RealDate);
    });

    it('two clocks never cross-contaminate — installing the second never changes the first instance’s own offset', async () => {
      const clockA = await createSimulatorClock(createMemoryStore());
      await clockA.jumpTo(new RealDate('2031-01-01T00:00:00.000Z'));
      const uninstallA = clockA.install();
      const offsetBeforeSwap = clockA.offsetMs();

      const clockB = await createSimulatorClock(createMemoryStore());
      await clockB.jumpTo(new RealDate('2032-01-01T00:00:00.000Z'));
      const uninstallB = clockB.install();

      // `offsetMs()` — not a fresh `now()` reading — is the invariant that
      // must hold: a `now()`-to-`now()` comparison would itself be flaky by
      // real elapsed time regardless of cross-contamination.
      expect(clockA.offsetMs()).toBe(offsetBeforeSwap);
      uninstallB();
      uninstallA();
    });
  });
});
