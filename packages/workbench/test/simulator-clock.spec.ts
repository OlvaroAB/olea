/**
 * `simulator/clock.ts` (`ol-3ux7.64.2` [WBX-1]) — the offset bookkeeping
 * `SimulatorController` moves through `advanceDays`/`jumpTo`/`resetOffset`
 * and persists through `store`.
 *
 * `ol-3ux7.64.9` [WBX-8] retired this module's page-level `Date` override
 * (`install()`/`installSimulatorDateOverride`): `OleaPlugin` now takes an
 * injected clock directly (`setClock`), so nothing needs the global `Date`
 * constructor shifted any more — that mechanism's own test coverage (every
 * un-dated read shifts, every dated one does not, `instanceof` and the
 * other statics survive, uninstall restores the real `Date`) went with it.
 * This file now proves only the offset arithmetic and persistence below.
 */
import { describe, expect, it } from 'vitest';
import { createSimulatorClock } from '../src/simulator/clock.js';
import { createMemoryStore } from '../src/simulator/store.js';

const RealDate = globalThis.Date;

describe('SimulatorClock', () => {
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
});
