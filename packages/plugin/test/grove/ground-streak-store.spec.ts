/**
 * `ObsidianGroveGroundStreakStore` round-trip tests (F4.5, `ol-0r92.20`).
 *
 * Fixture concept keys below are INVENTED per INV-3 — nothing here is drawn
 * from a real vault.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_GROVE_GROUND_STREAKS,
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
