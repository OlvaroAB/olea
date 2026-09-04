/**
 * `ObsidianHomeScopeGrowthStore` and `homeScopeGrowthReceiptFor` tests
 * (F6.10, `[D-223]`, `ol-l5og.21` [HOME-2]) — the mirror image of `test/
 * grove/prior-denominator-store.spec.ts`, which covers the opposite
 * (shrink) direction.
 *
 * Fixture course names and paths below are INVENTED per INV-3 — nothing
 * here is drawn from a real vault.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_HOME_SCOPE_GROWTH,
  HOME_SCOPE_GROWTH_STORAGE_KEY,
  homeScopeGrowthReceiptFor,
  ObsidianHomeScopeGrowthStore,
} from '../../src/home/scope-growth-store.js';
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

describe('ObsidianHomeScopeGrowthStore', () => {
  it('returns an empty map when nothing is stored', async () => {
    const store = new ObsidianHomeScopeGrowthStore(new FakeDataHost());
    expect(await store.load()).toEqual(new Map());
  });

  it('round-trips a saved map of course -> scope snapshot', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianHomeScopeGrowthStore(host);

    const entries = new Map([
      ['TESTC101', { denominatorCount: 2, denominatorSourcePaths: ['03 Research/Objectives.md'] }],
    ]);
    await store.save(entries);

    expect(await store.load()).toEqual(entries);
  });

  it('REPLACES the whole map on save — a course absent from the new save disappears rather than lingering', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianHomeScopeGrowthStore(host);

    await store.save(
      new Map([
        ['TESTC101', { denominatorCount: 2, denominatorSourcePaths: ['a.md'] }],
        ['TESTC202', { denominatorCount: 1, denominatorSourcePaths: ['b.md'] }],
      ]),
    );
    await store.save(
      new Map([['TESTC101', { denominatorCount: 5, denominatorSourcePaths: ['a.md', 'c.md'] }]]),
    );

    expect(await store.load()).toEqual(
      new Map([['TESTC101', { denominatorCount: 5, denominatorSourcePaths: ['a.md', 'c.md'] }]]),
    );
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianHomeScopeGrowthStore(host);

    await store.save(
      new Map([['TESTC101', { denominatorCount: 1, denominatorSourcePaths: ['a.md'] }]]),
    );

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect((host.blob as Record<string, unknown>)[HOME_SCOPE_GROWTH_STORAGE_KEY]).toEqual({
      ...EMPTY_HOME_SCOPE_GROWTH,
      courses: { TESTC101: { denominatorCount: 1, denominatorSourcePaths: ['a.md'] } },
    });
  });

  it('falls back to an empty map for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [HOME_SCOPE_GROWTH_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianHomeScopeGrowthStore(host);
    expect(await store.load()).toEqual(new Map());
  });
});

describe('homeScopeGrowthReceiptFor', () => {
  it('is undefined with no prior read — the very first read for this course', () => {
    expect(
      homeScopeGrowthReceiptFor(undefined, {
        denominatorCount: 3,
        denominatorSourcePaths: ['a.md'],
      }),
    ).toBeUndefined();
  });

  it('is undefined when the count did not grow', () => {
    const snapshot = { denominatorCount: 3, denominatorSourcePaths: ['a.md'] };
    expect(homeScopeGrowthReceiptFor(snapshot, snapshot)).toBeUndefined();
    expect(
      homeScopeGrowthReceiptFor(snapshot, { denominatorCount: 2, denominatorSourcePaths: [] }),
    ).toBeUndefined();
  });

  it('names the added document on a genuine growth', () => {
    const prior = { denominatorCount: 2, denominatorSourcePaths: ['a.md'] };
    const current = { denominatorCount: 5, denominatorSourcePaths: ['a.md', 'b.md'] };
    expect(homeScopeGrowthReceiptFor(prior, current)).toEqual({
      addedDocumentPath: 'b.md',
      priorDenominatorCount: 2,
      newDenominatorCount: 5,
    });
  });

  it('is undefined when it grew but no added document can be named (never guesses)', () => {
    const prior = { denominatorCount: 2, denominatorSourcePaths: ['a.md'] };
    const current = { denominatorCount: 5, denominatorSourcePaths: ['a.md'] };
    expect(homeScopeGrowthReceiptFor(prior, current)).toBeUndefined();
  });

  it('picks the earliest path, sorted, when more than one document was added in the same read', () => {
    const prior = { denominatorCount: 2, denominatorSourcePaths: ['a.md'] };
    const current = { denominatorCount: 6, denominatorSourcePaths: ['a.md', 'z.md', 'b.md'] };
    expect(homeScopeGrowthReceiptFor(prior, current)?.addedDocumentPath).toBe('b.md');
  });
});
