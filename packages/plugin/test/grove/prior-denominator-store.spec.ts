/**
 * `ObsidianGrovePriorDenominatorStore` round-trip tests (`[D-184]`, F8.1,
 * `ol-v7r5.32`).
 *
 * Fixture course names and paths below are INVENTED per INV-3 — nothing
 * here is drawn from a real vault.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_GROVE_PRIOR_DENOMINATORS,
  GROVE_PRIOR_DENOMINATORS_STORAGE_KEY,
  ObsidianGrovePriorDenominatorStore,
} from '../../src/grove/prior-denominator-store.js';
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

describe('ObsidianGrovePriorDenominatorStore', () => {
  it('returns an empty map when nothing is stored', async () => {
    const store = new ObsidianGrovePriorDenominatorStore(new FakeDataHost());
    expect(await store.load()).toEqual(new Map());
  });

  it('round-trips a saved map of course -> denominator snapshot', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGrovePriorDenominatorStore(host);

    const entries = new Map([
      [
        'TESTC101',
        {
          denominatorCount: 2,
          denominatorSourcePaths: ['03 Research/Objectives A.md', '03 Research/Objectives B.md'],
        },
      ],
    ]);
    await store.save(entries);

    const reloaded = await store.load();
    expect(reloaded).toEqual(entries);
  });

  it('REPLACES the whole map on save — a course absent from the new save disappears rather than lingering', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGrovePriorDenominatorStore(host);

    await store.save(
      new Map([
        ['TESTC101', { denominatorCount: 2, denominatorSourcePaths: ['a.md', 'b.md'] }],
        ['TESTC202', { denominatorCount: 1, denominatorSourcePaths: ['c.md'] }],
      ]),
    );
    // TESTC202 is no longer 'declared' this session — the next save omits it entirely.
    await store.save(
      new Map([['TESTC101', { denominatorCount: 1, denominatorSourcePaths: ['a.md'] }]]),
    );

    const reloaded = await store.load();
    expect(reloaded).toEqual(
      new Map([['TESTC101', { denominatorCount: 1, denominatorSourcePaths: ['a.md'] }]]),
    );
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGrovePriorDenominatorStore(host);

    await store.save(
      new Map([['TESTC101', { denominatorCount: 1, denominatorSourcePaths: ['a.md'] }]]),
    );

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect((host.blob as Record<string, unknown>)[GROVE_PRIOR_DENOMINATORS_STORAGE_KEY]).toEqual({
      ...EMPTY_GROVE_PRIOR_DENOMINATORS,
      courses: { TESTC101: { denominatorCount: 1, denominatorSourcePaths: ['a.md'] } },
    });
  });

  it('falls back to an empty map for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [GROVE_PRIOR_DENOMINATORS_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianGrovePriorDenominatorStore(host);
    expect(await store.load()).toEqual(new Map());
  });

  it('falls back to an empty map when a stored denominatorCount is negative or non-integer', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [GROVE_PRIOR_DENOMINATORS_STORAGE_KEY]: {
        version: 1,
        courses: { TESTC101: { denominatorCount: -1, denominatorSourcePaths: [] } },
      },
    };
    const store = new ObsidianGrovePriorDenominatorStore(host);
    expect(await store.load()).toEqual(new Map());
  });
});
