// Scenarios: `features/F6-today.md`, "F6.9 — The processed-revision record" —
// @auto:plugin/ingestion/processed-revisions/store.spec. Every string here is invented (INV-3).
//
// `ol-egov.141.89.11.24`, `[D-426]` (row 25 of `docs/direction/20260929_decision_sheet_responses.md`):
// one replacement store holding, per file version, its fingerprint, the day it was first processed
// and its processing state. The day is a processing day, never an exact arrival time; current
// content can be reread after a loss, its day cannot, so it reads unknown and never today.

import type { CalendarDay } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  applyProcessed,
  applyRebuild,
  EMPTY_PROCESSED_REVISIONS,
  ObsidianProcessedRevisionStore,
  type PersistedProcessedRevisions,
  PROCESSED_REVISION_STORAGE_KEY,
  type ProcessedRevisionInput,
} from '../../../src/ingestion/processed-revisions/store.js';
import {
  CONTENT_DERIVED_SETTINGS_KEYS,
  clearContentDerivedSettings,
  readContentDerivedSettings,
  settingsKeyEntry,
} from '../../../src/privacy/data-manifest.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

/** A host with the atomic path, so the same behaviour is proven through `readModifyWrite`. */
class AtomicFakeDataHost extends FakeDataHost {
  atomicCalls = 0;
  async readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void> {
    this.atomicCalls += 1;
    this.blob = (await mutate(this.blob)) as Record<string, unknown>;
  }
}

/** A clock a test moves by hand: the store never reads any other. */
function clock(start: string): { now: () => Date; set: (iso: string) => void } {
  let current = new Date(`${start}T12:00:00`);
  return {
    now: () => current,
    set: (iso) => {
      current = new Date(`${iso}T12:00:00`);
    },
  };
}

const PATH_A = '01 Courses/CRS-A/week 1.pdf';
const PATH_B = '01 Courses/CRS-A/notes.md';

function input(overrides: Partial<ProcessedRevisionInput> = {}): ProcessedRevisionInput {
  return {
    path: PATH_A,
    courses: ['CRS-A'],
    fingerprint: 'fp-1',
    state: 'read',
    ...overrides,
  };
}

async function rowsOf(host: FakeDataHost): Promise<PersistedProcessedRevisions> {
  return new ObsidianProcessedRevisionStore(host, () => new Date()).load();
}

describe('a version’s first-processed day is recorded once', () => {
  it('records the day a version was first processed, with its fingerprint and state', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input());
    expect((await store.load()).revisions[PATH_A]).toEqual({
      fingerprint: 'fp-1',
      courses: ['CRS-A'],
      state: 'read',
      firstProcessedDay: '2026-09-10',
    });
  });

  it('recording the same version again on a later day does not move its first day', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input());
    c.set('2026-09-24');
    await store.recordProcessed(input());
    expect((await store.load()).revisions[PATH_A]?.firstProcessedDay).toBe('2026-09-10');
  });

  it('a reprocess keeps the first day and takes the newest finished outcome', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input({ state: 'unreadable' }));
    c.set('2026-09-12');
    await store.recordProcessed(input({ state: 'read' }));
    const row = (await store.load()).revisions[PATH_A];
    expect(row?.firstProcessedDay).toBe('2026-09-10');
    expect(row?.state).toBe('read');
  });

  it('a new version of the same file gets its own first day, and replaces the row', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input({ fingerprint: 'fp-1' }));
    c.set('2026-09-20');
    await store.recordProcessed(input({ fingerprint: 'fp-2' }));
    const row = (await store.load()).revisions[PATH_A];
    expect(row?.fingerprint).toBe('fp-2');
    expect(row?.firstProcessedDay).toBe('2026-09-20');
    expect(Object.keys((await store.load()).revisions)).toEqual([PATH_A]);
  });

  it('a new version never gets a day earlier than the version it replaces (a clock that moved back)', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-20');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input({ fingerprint: 'fp-1' }));
    c.set('2026-09-05');
    await store.recordProcessed(input({ fingerprint: 'fp-2' }));
    expect((await store.load()).revisions[PATH_A]?.firstProcessedDay).toBe('2026-09-20');
  });

  it('a file version with no course records nothing: there is no course to attribute it to', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date());
    await store.recordProcessed(input({ courses: [] }));
    expect(host.blob[PROCESSED_REVISION_STORAGE_KEY]).toBeUndefined();
  });

  it('a file in two courses is attributed to both, sorted and without duplicates', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input({ courses: ['CRS-B', 'CRS-A', 'CRS-B'] }));
    expect((await store.load()).revisions[PATH_A]?.courses).toEqual(['CRS-A', 'CRS-B']);
  });

  it('keeps every other file and every other top-level key of the plugin data untouched', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginKey: { untouched: true } };
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input({ path: PATH_A }));
    await store.recordProcessed(input({ path: PATH_B, fingerprint: 'fp-b' }));
    expect(host.blob.someOtherPluginKey).toEqual({ untouched: true });
    expect(Object.keys((await store.load()).revisions).sort()).toEqual([PATH_B, PATH_A].sort());
  });

  it('behaves the same through the atomic read-modify-write path', async () => {
    const host = new AtomicFakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input());
    c.set('2026-09-24');
    await store.recordProcessed(input({ state: 'unreadable' }));
    expect(host.atomicCalls).toBe(2);
    const row = (await store.load()).revisions[PATH_A];
    expect(row?.firstProcessedDay).toBe('2026-09-10');
    expect(row?.state).toBe('unreadable');
  });
});

describe('pending is a state, not an absence', () => {
  it('a pending version is on record with its day, where a course with nothing has no row at all', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input({ state: 'pending' }));
    const { revisions } = await store.load();
    expect(revisions[PATH_A]?.state).toBe('pending');
    expect(revisions[PATH_A]?.firstProcessedDay).toBe('2026-09-10');
    expect(Object.values(revisions).some((row) => row.courses.includes('CRS-EMPTY'))).toBe(false);
  });

  it('a reprocess starting never turns a finished reading back into pending', async () => {
    const day = (iso: string): CalendarDay => iso as CalendarDay;
    const read = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ state: 'read' }),
      day('2026-09-10'),
    );
    const restarted = applyProcessed(read, input({ state: 'pending' }), day('2026-09-11'));
    expect(restarted.revisions[PATH_A]?.state).toBe('read');
    const unreadable = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ state: 'unreadable' }),
      day('2026-09-10'),
    );
    expect(
      applyProcessed(unreadable, input({ state: 'pending' }), day('2026-09-11')).revisions[PATH_A]
        ?.state,
    ).toBe('unreadable');
  });

  it('a pending version becomes read when its reading finishes, on the same first day', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-09-10');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input({ state: 'pending' }));
    c.set('2026-09-11');
    await store.recordProcessed(input({ state: 'read' }));
    const row = (await store.load()).revisions[PATH_A];
    expect(row?.state).toBe('read');
    expect(row?.firstProcessedDay).toBe('2026-09-10');
  });
});

describe('after the record is lost, the day reads unknown, never today', () => {
  const found: readonly ProcessedRevisionInput[] = [
    input({ path: PATH_A, fingerprint: 'fp-a', state: 'read' }),
    input({ path: PATH_B, fingerprint: 'fp-b', state: 'pending' }),
  ];

  it('rebuilding a deleted store records each fingerprint and state with an unknown first day', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-11-02');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.recordProcessed(input({ fingerprint: 'fp-a' }));
    delete host.blob[PROCESSED_REVISION_STORAGE_KEY]; // the loss
    await store.rebuild(found);

    const { revisions, rebuiltOn } = await store.load();
    expect(rebuiltOn).toBe('2026-11-02');
    expect(revisions[PATH_A]).toEqual({
      fingerprint: 'fp-a',
      courses: ['CRS-A'],
      state: 'read',
      firstProcessedDay: null,
      noLaterThan: '2026-11-02',
    });
    expect(revisions[PATH_B]?.state).toBe('pending');
    for (const row of Object.values(revisions)) {
      expect(row.firstProcessedDay).toBeNull();
      // Never the day of the rebuild in the day's own place.
      expect(row.firstProcessedDay).not.toBe('2026-11-02');
    }
  });

  it('an unknown day stays unknown when the same version is processed again: it is never upgraded to today', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-11-02');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.rebuild(found);
    c.set('2026-11-09');
    await store.recordProcessed(input({ path: PATH_B, fingerprint: 'fp-b', state: 'read' }));
    const row = (await store.load()).revisions[PATH_B];
    expect(row?.state).toBe('read');
    expect(row?.firstProcessedDay).toBeNull();
    expect(row?.noLaterThan).toBe('2026-11-02');
  });

  it('a version processed after the rebuild is a known day again: the new version replaces the unknown one', async () => {
    const host = new FakeDataHost();
    const c = clock('2026-11-02');
    const store = new ObsidianProcessedRevisionStore(host, c.now);
    await store.rebuild(found);
    c.set('2026-11-09');
    await store.recordProcessed(input({ path: PATH_A, fingerprint: 'fp-a-edited' }));
    const row = (await store.load()).revisions[PATH_A];
    expect(row?.firstProcessedDay).toBe('2026-11-09');
    expect(row?.noLaterThan).toBeUndefined();
  });

  it('a rebuild never invents a day and never overwrites one', () => {
    const day = (iso: string): CalendarDay => iso as CalendarDay;
    const recorded = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ fingerprint: 'fp-a' }),
      day('2026-09-10'),
    );
    const rebuilt = applyRebuild(
      recorded,
      [
        // The same version: kept, day untouched.
        input({ path: PATH_A, fingerprint: 'fp-a' }),
        // A file with no record: recorded, day unknown.
        input({ path: PATH_B, fingerprint: 'fp-b' }),
      ],
      day('2026-11-02'),
    );
    expect(rebuilt.revisions[PATH_A]?.firstProcessedDay).toBe('2026-09-10');
    expect(rebuilt.revisions[PATH_B]?.firstProcessedDay).toBeNull();
  });

  it('a file whose version changed without being processed is not counted as a new arrival by a rebuild', () => {
    const day = (iso: string): CalendarDay => iso as CalendarDay;
    const recorded = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ fingerprint: 'fp-a' }),
      day('2026-09-10'),
    );
    const rebuilt = applyRebuild(
      recorded,
      [input({ path: PATH_A, fingerprint: 'fp-a-edited' })],
      day('2026-11-02'),
    );
    // An edit counts only when it is processed; the rebuild claims nothing about it either way.
    expect(rebuilt.revisions[PATH_A]).toEqual(recorded.revisions[PATH_A]);
    expect(rebuilt.rebuiltOn).toBe('2026-11-02');
  });

  it('a rebuild takes a finished reading over a pending one, and never the reverse', () => {
    const day = (iso: string): CalendarDay => iso as CalendarDay;
    const pending = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ state: 'pending' }),
      day('2026-09-10'),
    );
    const finished = applyRebuild(pending, [input({ state: 'read' })], day('2026-09-11'));
    expect(finished.revisions[PATH_A]?.state).toBe('read');
    const stillFinished = applyRebuild(finished, [input({ state: 'pending' })], day('2026-09-12'));
    expect(stillFinished.revisions[PATH_A]?.state).toBe('read');
  });

  it('a rebuild that finds nothing still marks the store rebuilt: nothing found is an answer, not a silence', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-11-02T12:00:00'));
    await store.rebuild([]);
    const loaded = await store.load();
    expect(loaded.rebuiltOn).toBe('2026-11-02');
    expect(loaded.revisions).toEqual({});
  });

  it('a rebuild keeps files it no longer finds: they arrived, whatever became of them', () => {
    const day = (iso: string): CalendarDay => iso as CalendarDay;
    const recorded = applyProcessed(
      EMPTY_PROCESSED_REVISIONS,
      input({ path: PATH_A }),
      day('2026-09-10'),
    );
    const rebuilt = applyRebuild(recorded, [], day('2026-11-02'));
    expect(rebuilt.revisions[PATH_A]).toBeDefined();
  });
});

describe('a store that has never been rebuilt cannot say, and is not read as nothing having arrived', () => {
  it('a fresh install, a corrupted record and an older record all read as not rebuilt', async () => {
    const fresh = new FakeDataHost();
    expect((await rowsOf(fresh)).rebuiltOn).toBeNull();

    const corrupted = new FakeDataHost();
    corrupted.blob = { [PROCESSED_REVISION_STORAGE_KEY]: { version: 2, revisions: 'nope' } };
    expect(await rowsOf(corrupted)).toEqual(EMPTY_PROCESSED_REVISIONS);

    // An older record shape found under this store's own key.
    const older = new FakeDataHost();
    older.blob = {
      [PROCESSED_REVISION_STORAGE_KEY]: {
        version: 1,
        lastArrivalByCourse: { 'CRS-A': '2026-09-01' },
      },
    };
    expect(await rowsOf(older)).toEqual(EMPTY_PROCESSED_REVISIONS);
  });

  it('recording a processed version is not a rebuild: rows may exist while the store still cannot say', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input());
    const loaded = await store.load();
    expect(loaded.rebuiltOn).toBeNull();
    expect(Object.keys(loaded.revisions)).toEqual([PATH_A]);
  });

  it('a row whose unknown day carries no bound is refused, so an unbounded unknown cannot be assumed old', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [PROCESSED_REVISION_STORAGE_KEY]: {
        version: 2,
        rebuiltOn: '2026-11-02',
        revisions: {
          [PATH_A]: {
            fingerprint: 'fp',
            courses: ['CRS-A'],
            state: 'read',
            firstProcessedDay: null,
          },
        },
      },
    };
    expect(await rowsOf(host)).toEqual(EMPTY_PROCESSED_REVISIONS);
  });

  it('a row that carries a bound alongside a known day is refused', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [PROCESSED_REVISION_STORAGE_KEY]: {
        version: 2,
        rebuiltOn: null,
        revisions: {
          [PATH_A]: {
            fingerprint: 'fp',
            courses: ['CRS-A'],
            state: 'read',
            firstProcessedDay: '2026-09-10',
            noLaterThan: '2026-09-11',
          },
        },
      },
    };
    expect(await rowsOf(host)).toEqual(EMPTY_PROCESSED_REVISIONS);
  });

  it('writing over an older or corrupted record replaces it without throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [PROCESSED_REVISION_STORAGE_KEY]: 'garbage', keep: 1 };
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input());
    expect(host.blob.keep).toBe(1);
    expect((await store.load()).revisions[PATH_A]?.firstProcessedDay).toBe('2026-09-10');
  });
});

describe('the record is a local projection under its own key, covered by a full delete and the export', () => {
  it('lives in data.json under its own key, not the one the retired verdict-gated store used', () => {
    expect(PROCESSED_REVISION_STORAGE_KEY).toBe('processedRevisions');
    expect(PROCESSED_REVISION_STORAGE_KEY).not.toBe('materialArrivals');
  });

  it('is classified content-derived in the settings manifest, so a full delete clears it and the export carries it', async () => {
    expect(settingsKeyEntry(PROCESSED_REVISION_STORAGE_KEY)?.classification).toBe(
      'content-derived',
    );
    expect(CONTENT_DERIVED_SETTINGS_KEYS).toContain(PROCESSED_REVISION_STORAGE_KEY);

    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    await store.recordProcessed(input());
    expect(Object.keys(await readContentDerivedSettings(host))).toContain(
      PROCESSED_REVISION_STORAGE_KEY,
    );
    const cleared = await clearContentDerivedSettings(host);
    expect(cleared.clearedKeys).toContain(PROCESSED_REVISION_STORAGE_KEY);
    expect(host.blob[PROCESSED_REVISION_STORAGE_KEY]).toBeUndefined();
    // After the delete the record reads as never rebuilt, and the next start's rebuild marks every
    // file it finds unknown.
    expect((await store.load()).rebuiltOn).toBeNull();
  });

  it('the retired store’s record is left where it is and read by nothing: nothing migrates, and writing here never touches it', async () => {
    const retired = { version: 1, lastArrivalByCourse: { 'CRS-A': '2026-09-01' } };
    const host = new FakeDataHost();
    host.blob = { materialArrivals: retired };
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-09-10T12:00:00'));
    // Never rebuilt: it cannot say, whatever the retired record held.
    expect(await store.load()).toEqual(EMPTY_PROCESSED_REVISIONS);
    await store.rebuild([input()]);
    await store.recordProcessed(input({ path: PATH_B, fingerprint: 'fp-2' }));
    expect(host.blob.materialArrivals).toEqual(retired);
    expect((await store.load()).revisions[PATH_A]?.firstProcessedDay).toBeNull();
  });
});
