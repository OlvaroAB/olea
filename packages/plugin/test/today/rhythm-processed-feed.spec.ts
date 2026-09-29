// Scenarios: `features/F6-today.md`, "F6.9 — The data plumbing the reading is built on" —
// @auto:plugin/today/rhythm-processed-feed.spec. Every string here is invented (INV-3).
//
// `ol-egov.141.89.11.27`, `[D-426]`: the whole path, end to end. A file is processed and recorded
// through the feed, the record is read by `createRhythmSource`, and Today's rhythm reading counts
// it as an arrival, whatever the materiality verdict. The sentences Today can say are the existing
// ones (`rhythmQuietLine`); nothing new is worded and no processing day is ever shown as a date.

import { stableUnitId, type UnitManifest, type UnitReadingState, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createProcessedRevisionFeed } from '../../src/ingestion/processed-revisions/feed.js';
import {
  ObsidianProcessedRevisionStore,
  PROCESSED_REVISION_STORAGE_KEY,
} from '../../src/ingestion/processed-revisions/store.js';
import { rhythmQuietLine } from '../../src/today/copy.js';
import {
  createRhythmSource,
  loadTodayPanel,
  unavailableInstrumentSource,
} from '../../src/today/data-source.js';
import { ObsidianTermWindowStore } from '../../src/today/term-window-store.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const DEVICE = 'olea-testdevice1';
const COURSE = 'FIXTURE101';
const EXISTING = `01 Courses/${COURSE}/Lecture notes.md`;
const ADDED = `01 Courses/${COURSE}/Week 5 reading.md`;
const DECK = `01 Courses/${COURSE}/deck.pdf`;
const CALENDAR = {
  'UNIVERSITY/Calendar/calendar-events.md': [
    `- [ ] ${COURSE} Mon 09:00-10:00 📅 2026-08-03`,
    `- [ ] ${COURSE} Wed 09:00-10:00 📅 2026-08-05`,
  ].join('\n'),
};

const BLANK: UnitReadingState = { kind: 'unreadable', reason: 'blank-page' };

function manifestOf(
  sourcePath: VaultPath,
  revisionDigest: string,
  states: readonly UnitReadingState[],
): UnitManifest {
  return {
    sourcePath,
    revisionDigest,
    entries: states.map((readingState, index) => ({
      unitId: stableUnitId(sourcePath, index + 1),
      sourcePath,
      page: index + 1,
      readingState,
      conceptExtractionState: 'not-started',
    })),
  };
}

/** One "session" of the plugin: a store and its feed on a shared data file and a clock the test moves. */
function session(
  host: FakeDataHost,
  vault: MemoryVault,
  manifests = new Map<VaultPath, UnitManifest>(),
) {
  let current = new Date('2026-06-01T12:00:00');
  const store = new ObsidianProcessedRevisionStore(host, () => current);
  const feed = createProcessedRevisionFeed({
    store,
    vault,
    manifestsFor: async (paths) => {
      const answer = new Map<VaultPath, UnitManifest>();
      for (const path of paths) {
        const manifest = manifests.get(path);
        if (manifest !== undefined) answer.set(path, manifest);
      }
      return answer;
    },
  });
  return {
    store,
    feed,
    manifests,
    at: (iso: string) => {
      current = new Date(`${iso}T12:00:00`);
    },
  };
}

/** Today's panel for `todayIso`, reading the record the session built. */
async function panelOver(
  store: ObsidianProcessedRevisionStore,
  vault: MemoryVault,
  todayIso: string,
) {
  return loadTodayPanel({
    vault,
    deviceId: DEVICE,
    instruments: unavailableInstrumentSource,
    now: () => new Date(`${todayIso}T12:00:00`),
    windowDays: 30,
    rhythm: createRhythmSource({
      processedRevisions: store,
      termWindow: new ObsidianTermWindowStore(new FakeDataHost()),
    }),
  });
}

describe('a file added while Olea runs counts as an arrival on the day it is first processed', () => {
  it.each([
    ['a judge that says the edit is material', 'verdict'],
    ['a judge that says it is not', 'verdict'],
    ['no judge to ask, an outage included', 'judge-unavailable'],
  ] as const)('%s', async (_name, kind) => {
    const vault = memoryVault({ [EXISTING]: 'Invented text already there.', ...CALENDAR });
    const { store, feed, at } = session(new FakeDataHost(), vault);
    await feed.start();

    // Just started over files that were already there: their days are unknown, so Today claims nothing.
    const before = await panelOver(store, vault, '2026-06-02');
    expect(before.rhythm?.status).toBe('not-enough-history');
    expect(before.rhythm?.measured?.courses[0]?.quietDays).toBeNull();

    // A new file is added while Olea runs and is first processed on 2026-07-01.
    at('2026-07-01');
    const text = 'A brand new invented reading.';
    await vault.write(ADDED, text);
    await feed.noteEvaluated(ADDED, text, { kind });
    await feed.idle();

    const vm = await panelOver(store, vault, '2026-08-10');
    expect(vm.rhythm?.status).toBe('observed');
    const reading = vm.rhythm?.measured?.courses[0];
    expect(reading?.quietDays).toBe(40);
    // The existing wording, and a day count only: the processing day is never shown as a date.
    const line = rhythmQuietLine(COURSE, reading?.quietDays ?? 0);
    expect(line.text).toBe(rhythmQuietLine(COURSE, 40).text);
    expect(line.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(line.text).not.toContain('2026-07-01');
  });

  it('a raw edit the free checks decline never makes a course look as if something arrived', async () => {
    const vault = memoryVault({ [EXISTING]: 'Invented text already there.', ...CALENDAR });
    const { store, feed, at } = session(new FakeDataHost(), vault);
    await feed.start();
    at('2026-07-01');
    for (const kind of ['unchanged', 'formatting-only', 'debounced', 'below-floor'] as const) {
      await feed.noteEvaluated(EXISTING, 'Invented text already there, touched.', { kind });
    }
    await feed.idle();
    const vm = await panelOver(store, vault, '2026-08-10');
    expect(vm.rhythm?.status).toBe('not-enough-history');
    expect(vm.rhythm?.measured?.courses[0]?.quietDays).toBeNull();
  });

  it('an embedded source queued and settled counts on the day it was queued, and reads as arrived-but-unread while its pages wait', async () => {
    const vault = memoryVault({ [EXISTING]: 'Invented text already there.', ...CALENDAR });
    const { store, feed, manifests, at } = session(new FakeDataHost(), vault);
    await feed.start();
    at('2026-07-01');
    await feed.observeEnqueues({ enqueue: async () => ({ status: 'queued' as const }) }).enqueue({
      contentHash: 'hash-deck',
      label: DECK,
      payload: { kind: 'source', sourcePath: DECK, format: 'pdf' },
    });
    await feed.idle();
    // Queued: pending, and a pending arrival is "arrived, could not be read", never quiet.
    const pending = await panelOver(store, vault, '2026-08-10');
    expect(pending.rhythm?.measured?.courses[0]).toMatchObject({
      status: 'unreadable',
      quietDays: null,
    });
    expect(pending.rhythm?.measured?.quietestCourse).toBeNull();

    at('2026-07-20');
    manifests.set(DECK, manifestOf(DECK, 'hash-deck', [BLANK, BLANK]));
    await feed.jobRan({ kind: 'ran', contentHash: 'hash-deck', outcome: 'done' }, [
      {
        contentHash: 'hash-deck',
        label: DECK,
        payload: { kind: 'source', sourcePath: DECK, format: 'pdf' },
        enqueuedAt: 0,
        status: 'done',
        attempts: 1,
      },
    ]);
    const held = (await store.load()).revisions[DECK];
    // Empty or image-only counts unreadable; the first day is still the day it was queued.
    expect(held).toMatchObject({ state: 'unreadable', firstProcessedDay: '2026-07-01' });
  });
});

describe('after the record is deleted, the next start rebuilds it with unknown days', () => {
  it('Today draws no rhythm line and no calendar-schedule line for those courses until a new file version is processed', async () => {
    const host = new FakeDataHost();
    const vault = memoryVault({ [EXISTING]: 'Invented text already there.', ...CALENDAR });

    // A session that has been recording arrivals.
    const first = session(host, vault);
    await first.feed.start();
    first.at('2026-07-01');
    await first.feed.noteEvaluated(EXISTING, 'Invented text already there, edited.', {
      kind: 'verdict',
    });
    await first.feed.idle();
    expect((await panelOver(first.store, vault, '2026-08-10')).rhythm?.status).toBe('observed');

    // The record is deleted; the next start rebuilds it from what the vault holds now.
    delete host.blob[PROCESSED_REVISION_STORAGE_KEY];
    const second = session(host, vault);
    second.at('2026-08-09');
    await second.feed.start();
    const vm = await panelOver(second.store, vault, '2026-08-10');
    expect(vm.rhythm?.status).toBe('not-enough-history');
    expect(vm.rhythm?.measured?.courses[0]?.quietDays).toBeNull();
    expect(vm.rhythm?.measured?.quietestCourse).toBeNull();
    expect(vm.courseFreshness).toEqual([]);
    for (const row of Object.values((await second.store.load()).revisions)) {
      expect(row.firstProcessedDay).toBeNull();
    }

    // A new file version processed after that counts again.
    second.at('2026-08-09');
    await second.feed.noteEvaluated(EXISTING, 'Invented text already there, edited again.', {
      kind: 'verdict',
    });
    await second.feed.idle();
    const after = await panelOver(second.store, vault, '2026-08-10');
    // Counted again: a day count from that processing day, and not yet a quiet course.
    expect(after.rhythm?.status).toBe('not-observed');
    expect(after.rhythm?.measured?.courses[0]).toMatchObject({
      status: 'not-observed',
      quietDays: 1,
    });
  });
});
