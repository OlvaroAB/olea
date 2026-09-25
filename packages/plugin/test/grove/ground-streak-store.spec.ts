/**
 * `ObsidianGroveGroundStreakStore` round-trip tests (F4.5, `ol-0r92.20`).
 *
 * Fixture concept keys below are INVENTED per INV-3 — nothing here is drawn
 * from a real vault.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_GROVE_GROUND_STREAK_PROCESSING_PASSES,
  EMPTY_GROVE_GROUND_STREAKS,
  GROVE_GROUND_STREAK_PASS_STORAGE_KEY,
  GROVE_GROUND_STREAKS_STORAGE_KEY,
  ObsidianGroveGroundStreakStore,
} from '../../src/grove/ground-streak-store.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('ObsidianGroveGroundStreakStore', () => {
  it('returns an empty map when nothing is stored', async () => {
    const store = new ObsidianGroveGroundStreakStore(new FakeDataHost());
    expect(await store.load()).toEqual(new Map());
  });

  it('round-trips a saved map of concept-key -> streak', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    const streaks = new Map([
      ['concept-a', 1],
      ['concept-b', 2],
    ]);
    await store.save(streaks);

    const reloaded = await store.load();
    expect(reloaded).toEqual(streaks);
  });

  it('REPLACES the whole map on save — a concept absent from the new save disappears rather than lingering', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.save(
      new Map([
        ['concept-a', 1],
        ['concept-b', 3],
      ]),
    );
    // concept-b stopped reading `ground` — the next save omits it entirely.
    await store.save(new Map([['concept-a', 2]]));

    const reloaded = await store.load();
    expect(reloaded).toEqual(new Map([['concept-a', 2]]));
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.save(new Map([['concept-a', 1]]));

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect((host.blob as Record<string, unknown>)[GROVE_GROUND_STREAKS_STORAGE_KEY]).toEqual({
      ...EMPTY_GROVE_GROUND_STREAKS,
      streaks: { 'concept-a': 1 },
    });
  });

  it('falls back to an empty map for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [GROVE_GROUND_STREAKS_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianGroveGroundStreakStore(host);
    expect(await store.load()).toEqual(new Map());
  });

  it('falls back to an empty map when a stored streak is negative or non-integer', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [GROVE_GROUND_STREAKS_STORAGE_KEY]: { version: 1, streaks: { 'concept-a': -1 } },
    };
    const store = new ObsidianGroveGroundStreakStore(host);
    expect(await store.load()).toEqual(new Map());
  });
});

describe('ObsidianGroveGroundStreakStore — processing-pass identity (ol-egov.141.89.11.14)', () => {
  it('returns an empty map when nothing is stored', async () => {
    const store = new ObsidianGroveGroundStreakStore(new FakeDataHost());
    expect(await store.loadProcessingPasses()).toEqual(new Map());
  });

  it('round-trips a saved map of concept-key -> processing-pass id', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    const passes = new Map([
      ['concept-a', 'sweep-1'],
      ['concept-b', 'sweep-2'],
    ]);
    await store.saveProcessingPasses(passes);

    expect(await store.loadProcessingPasses()).toEqual(passes);
  });

  it('REPLACES the whole map on save — a concept absent from the new save disappears rather than lingering', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.saveProcessingPasses(
      new Map([
        ['concept-a', 'sweep-1'],
        ['concept-b', 'sweep-3'],
      ]),
    );
    // concept-b stopped reading `ground` — the next save omits it entirely.
    await store.saveProcessingPasses(new Map([['concept-a', 'sweep-2']]));

    expect(await store.loadProcessingPasses()).toEqual(new Map([['concept-a', 'sweep-2']]));
  });

  it('is stored under a SEPARATE key from the streak numbers, and never touches them', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.save(new Map([['concept-a', 1]]));
    await store.saveProcessingPasses(new Map([['concept-a', 'sweep-1']]));

    // Both round-trip independently...
    expect(await store.load()).toEqual(new Map([['concept-a', 1]]));
    expect(await store.loadProcessingPasses()).toEqual(new Map([['concept-a', 'sweep-1']]));
    // ...and an install's pre-existing streak NUMBERS are byte-identical to
    // what `load()` already read before this pair existed (INV-2).
    expect((host.blob as Record<string, unknown>)[GROVE_GROUND_STREAKS_STORAGE_KEY]).toEqual({
      ...EMPTY_GROVE_GROUND_STREAKS,
      streaks: { 'concept-a': 1 },
    });
    expect((host.blob as Record<string, unknown>)[GROVE_GROUND_STREAK_PASS_STORAGE_KEY]).toEqual({
      ...EMPTY_GROVE_GROUND_STREAK_PROCESSING_PASSES,
      passes: { 'concept-a': 'sweep-1' },
    });
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGroveGroundStreakStore(host);

    await store.saveProcessingPasses(new Map([['concept-a', 'sweep-1']]));

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
  });

  it('falls back to an empty map for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [GROVE_GROUND_STREAK_PASS_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianGroveGroundStreakStore(host);
    expect(await store.loadProcessingPasses()).toEqual(new Map());
  });

  it('falls back to an empty map when a stored pass id is not a string', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [GROVE_GROUND_STREAK_PASS_STORAGE_KEY]: { version: 1, passes: { 'concept-a': 7 } },
    };
    const store = new ObsidianGroveGroundStreakStore(host);
    expect(await store.loadProcessingPasses()).toEqual(new Map());
  });

  it("an install's pre-existing streak data (written before this pair existed) still reads correctly through `load()` — no rewrite required (INV-2)", async () => {
    const host = new FakeDataHost();
    host.blob = {
      [GROVE_GROUND_STREAKS_STORAGE_KEY]: { version: 1, streaks: { 'concept-a': 2 } },
    };
    const store = new ObsidianGroveGroundStreakStore(host);
    expect(await store.load()).toEqual(new Map([['concept-a', 2]]));
    expect(await store.loadProcessingPasses()).toEqual(new Map());
  });
});
