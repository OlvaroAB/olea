/**
 * `ObsidianGroveReadCompletenessStore` round-trip tests (`ol-2zfj.157`
 * [DOS-I15]) — same read-modify-write `data.json` shape
 * `./ground-streak-store.spec.ts` already tests, for the same reason (no
 * event-sourced home for this in `packages/contracts` or
 * `packages/core/src/review-log/`).
 *
 * Fixture course codes, source paths and section names below are INVENTED
 * per INV-3 — nothing here is drawn from a real vault.
 */

import type { ConceptReadCoverage } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_GROVE_READ_COMPLETENESS,
  GROVE_READ_COMPLETENESS_STORAGE_KEY,
  ObsidianGroveReadCompletenessStore,
} from '../../src/grove/read-completeness-store.js';
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

function row(overrides: Partial<ConceptReadCoverage> = {}): ConceptReadCoverage {
  return {
    sourcePath: 'Notes/invented.md',
    passagesOffered: 4,
    passagesRead: 4,
    conceptsFound: 1,
    calls: 1,
    truncatedByBudget: false,
    sections: [],
    ...overrides,
  };
}

describe('ObsidianGroveReadCompletenessStore', () => {
  it('returns an empty map when nothing is stored', async () => {
    const store = new ObsidianGroveReadCompletenessStore(new FakeDataHost());
    expect(await store.load()).toEqual(new Map());
  });

  it('round-trips a saved map of course -> coverage rows', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveReadCompletenessStore(host);

    const byCourse = new Map([
      ['INVENTED101', [row({ truncatedByBudget: true, sections: ['Invented Section'] })]],
      ['INVENTED202', [row()]],
    ]);
    await store.save(byCourse);

    const reloaded = await store.load();
    expect(reloaded).toEqual(byCourse);
  });

  it('REPLACES the whole map on save — a course absent from the new save disappears rather than lingering', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGroveReadCompletenessStore(host);

    await store.save(
      new Map([
        ['INVENTED101', [row()]],
        ['INVENTED202', [row()]],
      ]),
    );
    await store.save(new Map([['INVENTED101', [row({ truncatedByBudget: true })]]]));

    const reloaded = await store.load();
    expect(reloaded).toEqual(new Map([['INVENTED101', [row({ truncatedByBudget: true })]]]));
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGroveReadCompletenessStore(host);

    await store.save(new Map([['INVENTED101', [row()]]]));

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect(
      (host.blob as Record<string, unknown>)[GROVE_READ_COMPLETENESS_STORAGE_KEY],
    ).toBeDefined();
  });

  it('falls back to an empty map for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [GROVE_READ_COMPLETENESS_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianGroveReadCompletenessStore(host);
    expect(await store.load()).toEqual(new Map());
  });

  it('exposes the documented empty constant', () => {
    expect(EMPTY_GROVE_READ_COMPLETENESS).toEqual({ version: 1, byCourse: {} });
  });
});
