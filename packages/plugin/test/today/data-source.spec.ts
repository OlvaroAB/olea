/**
 * The Today panel's read path (F6.1, P2-T09).
 *
 * Driven against a plain in-memory `VaultSource`, with no Obsidian anywhere —
 * the same property `review/ports.spec.ts` asserts for its port: if this ever
 * reaches for an `App`, this file stops compiling.
 *
 * The two cases worth stating up front, because both are real host behaviour
 * rather than hypotheticals:
 *
 *  - **A host whose `list()` cannot see `.olea/reviews/`.** `FolderSource`
 *    skips dot-prefixed trees outright and Obsidian's `vault.getFiles()` does
 *    not return them either (`review-log/path.ts`'s own warning). The per-day
 *    probe is what makes this device's history readable regardless.
 *  - **A host whose `list()` can.** Then another device's file is discoverable,
 *    and her phone's reviews count towards the streak.
 */

import type { VaultSource } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createVaultInstrumentSource,
  DEFAULT_STREAK_WINDOW_DAYS,
  endOfLocalDay,
  loadTodayPanel,
  localToday,
  readReviewHistory,
  type TodayInstrumentSource,
  unavailableInstrumentSource,
} from '../../src/today/data-source.js';

const DEVICE = 'olea-testdevice1';
const OTHER_DEVICE = 'olea-herphone01';

// Deliberately still v3 lines, and deliberately not migrated (`ol-g6zg`): this
// is what a semester of her existing history looks like on disk, and the Today
// panel has to count it. A fixture regenerated at the current version would
// stop testing the read path that matters most for an alpha user upgrading.
function reviewLine(day: string, eventId: string): string {
  return JSON.stringify({
    schemaVersion: 3,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00-04:00`,
    instrumentId: 'qa:clast-imbrication:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      masteryAtTime: 'sprout',
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    conceptIds: ['clast-imbrication'],
  });
}

function suspendLine(day: string, eventId: string): string {
  return JSON.stringify({
    schemaVersion: 3,
    kind: 'suspend',
    eventId,
    timestamp: `${day}T20:00:00-04:00`,
    instrumentId: 'qa:clast-imbrication:1',
    conceptIds: ['clast-imbrication'],
  });
}

interface FakeVaultOptions {
  /** Whether `list()` can see the dot-prefixed log folder, as a real host may or may not. */
  readonly listSeesDotFolder?: boolean;
}

function fakeVault(
  files: Record<string, string>,
  options: FakeVaultOptions = {},
): { vault: VaultSource; reads: string[] } {
  const reads: string[] = [];
  const unreachable = (name: string) => () => {
    throw new Error(`the Today data source must not call VaultSource.${name}`);
  };
  const vault = {
    async list() {
      if (options.listSeesDotFolder !== true) return [];
      return Object.keys(files).sort();
    },
    async exists(path: string) {
      return Object.hasOwn(files, path);
    },
    async read(path: string) {
      reads.push(path);
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    readBinary: unreachable('readBinary'),
    write: unreachable('write'),
    watch: unreachable('watch'),
  } as unknown as VaultSource;
  return { vault, reads };
}

function logPath(day: string, deviceId: string): string {
  return `.olea/reviews/${day}.${deviceId}.jsonl`;
}

describe('readReviewHistory — this device, by exact path', () => {
  it('reads the days it was asked about and nothing else', async () => {
    const { vault, reads } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
      [logPath('2026-08-09', DEVICE)]: `${reviewLine('2026-08-09', 'b')}\n`,
      // Outside the window.
      [logPath('2026-08-01', DEVICE)]: `${reviewLine('2026-08-01', 'c')}\n`,
    });
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 3,
    });
    expect(history.entries.map((e) => e.eventId).sort()).toEqual(['a', 'b']);
    expect(reads).not.toContain(logPath('2026-08-01', DEVICE));
  });

  it('works on a host whose list() cannot see the dot-prefixed folder', async () => {
    const { vault } = fakeVault(
      { [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n` },
      { listSeesDotFolder: false },
    );
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries).toHaveLength(1);
  });

  it('a vault with no log at all is no history, not an error', async () => {
    const { vault } = fakeVault({});
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history).toEqual({ entries: [], windowDays: 7, invalidLineCount: 0 });
  });

  it('reports the window it actually read, so the streak knows its own limit', async () => {
    const { vault } = fakeVault({});
    const history = await readReviewHistory(vault, DEVICE, { today: '2026-08-10' });
    expect(history.windowDays).toBe(DEFAULT_STREAK_WINDOW_DAYS);
  });
});

describe('readReviewHistory — other devices, where the host surfaces them', () => {
  it("picks up another device's file when list() can see the folder", async () => {
    const { vault } = fakeVault(
      {
        [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
        [logPath('2026-08-09', OTHER_DEVICE)]: `${reviewLine('2026-08-09', 'phone')}\n`,
      },
      { listSeesDotFolder: true },
    );
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries.map((e) => e.eventId).sort()).toEqual(['a', 'phone']);
  });

  it('ignores files in the folder that are not review logs', async () => {
    const { vault } = fakeVault(
      {
        [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
        '.olea/reviews/README.md': 'not a log',
        '.olea/reviews/2026-08-10.jsonl': 'no device segment',
      },
      { listSeesDotFolder: true },
    );
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries.map((e) => e.eventId)).toEqual(['a']);
  });

  it('reads each file once even when both discovery paths find it', async () => {
    const { vault, reads } = fakeVault(
      { [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n` },
      { listSeesDotFolder: true },
    );
    await readReviewHistory(vault, DEVICE, { today: '2026-08-10', windowDays: 7 });
    expect(reads).toEqual([logPath('2026-08-10', DEVICE)]);
  });

  it('survives a host whose list() throws on a dot-prefixed path', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
    });
    // biome-ignore lint/suspicious/noExplicitAny: replacing one method on a test double
    (vault as any).list = async () => {
      throw new Error('refusing to list a hidden folder');
    };
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries).toHaveLength(1);
  });
});

describe('readReviewHistory — tolerance', () => {
  it('a crash-truncated final line costs that line and nothing before it', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]:
        `${reviewLine('2026-08-10', 'a')}\n{"schemaVersion":3,"kind":"rev`,
    });
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries.map((e) => e.eventId)).toEqual(['a']);
    expect(history.invalidLineCount).toBe(1);
  });

  it('a suspend event comes through as an entry, and is not a review', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: `${suspendLine('2026-08-10', 's1')}\n`,
    });
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.entries.map((e) => e.kind)).toEqual(['suspend']);
  });
});

describe('endOfLocalDay and localToday', () => {
  it('the end of her day is the last millisecond of it, in her zone', () => {
    const end = endOfLocalDay(new Date(2026, 7, 10, 9, 15));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(10);
    expect(end.getHours()).toBe(23);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('today is the local calendar day', () => {
    expect(localToday(new Date(2026, 7, 10, 23, 30))).toBe('2026-08-10');
  });
});

describe('unavailableInstrumentSource', () => {
  it('returns null, never an empty list — an empty list would be a claim', async () => {
    await expect(unavailableInstrumentSource.listDueCandidates()).resolves.toBeNull();
  });
});

// Scenarios: features/F2-review.md, "F6.1 — The Today panel counts what the
// queue would offer" — @auto:plugin/today/data-source.spec
describe('createVaultInstrumentSource — the seam, closed', () => {
  const now = () => new Date(2026, 7, 10, 9, 15);

  function noteVault(extra: Record<string, string> = {}): VaultSource {
    const files: Record<string, string> = {
      'Courses/GEO/one.md': [
        '---',
        'topic: [Alpha]',
        'course: GEO101',
        '---',
        '',
        '## First?',
        '',
        'Alpha front::Alpha back ^a1',
        '',
        'Alpha is ==layered== here.',
        '',
      ].join('\n'),
      'Courses/MUS/two.md': [
        '---',
        'topic: [Beta]',
        'course: MUS101',
        '---',
        '',
        '## Second?',
        '',
        'Beta front::Beta back ^b1',
        '',
      ].join('\n'),
      ...extra,
    };
    return {
      async list(options = {}) {
        const extensions = options.extensions?.map((e) => e.toLowerCase());
        return Object.keys(files)
          .filter((p) => options.under === undefined || p.startsWith(`${options.under}/`))
          .filter((p) => extensions === undefined || extensions.some((e) => p.endsWith(`.${e}`)))
          .sort();
      },
      async read(path: string) {
        const value = files[path];
        if (value === undefined) throw new Error(`no such file ${path}`);
        return value;
      },
      async readBinary(path: string) {
        return new TextEncoder().encode(await this.read(path));
      },
      async write(path: string, content: string) {
        files[path] = content;
      },
      async exists(path: string) {
        return Object.hasOwn(files, path);
      },
      watch() {
        return () => undefined;
      },
    } as VaultSource;
  }

  it('counts every instrument the vault carries, grouped by course', async () => {
    const source = createVaultInstrumentSource({
      vault: noteVault(),
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now,
    });
    const due = await source.listDueCandidates();
    expect(due).not.toBeNull();
    expect(due).toHaveLength(3);
    expect(new Set(due?.map((d) => d.courseCode))).toEqual(new Set(['GEO101', 'MUS101']));
    // Never reviewed, so every one is due now — `due: null` means now.
    expect(due?.every((d) => d.due === null)).toBe(true);
  });

  it('the panel counts them, so the due summary is present rather than absent', async () => {
    const vm = await loadTodayPanel({
      vault: noteVault(),
      deviceId: DEVICE,
      instruments: createVaultInstrumentSource({
        vault: noteVault(),
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
      }),
      now,
      windowDays: 30,
    });
    expect(vm.due).not.toBeNull();
    expect(vm.due?.total).toBe(3);
    expect(vm.due?.courses.reduce((sum, row) => sum + row.count, 0)).toBe(vm.due?.total);
  });

  it('an instrument reviewed into the future is not counted today', async () => {
    const vault = noteVault();
    const bare = createVaultInstrumentSource({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now,
    });
    const all = await bare.listDueCandidates();
    const target = all?.[0];
    if (target === undefined) throw new Error('expected an instrument');

    await vault.write(
      logPath('2026-08-10', DEVICE),
      `${JSON.stringify({
        schemaVersion: 3,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-10T08:00:00-04:00',
        instrumentId: target.instrumentId,
        instrumentType: 'qa',
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          masteryAtTime: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
        conceptIds: ['Alpha'],
      })}\n`,
    );

    const vm = await loadTodayPanel({
      vault,
      deviceId: DEVICE,
      instruments: createVaultInstrumentSource({
        vault,
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
      }),
      now,
      windowDays: 30,
    });
    // A Good today pushes it past the end of her day; the other two remain.
    expect(vm.due?.total).toBe(2);
  });

  it('a suspended instrument is not counted, because the source reads the whole log', async () => {
    const vault = noteVault();
    const bare = createVaultInstrumentSource({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now,
    });
    const all = await bare.listDueCandidates();
    const target = all?.[0];
    if (target === undefined) throw new Error('expected an instrument');

    // Deliberately far outside the streak's trailing window: a source that
    // read only the window would forget it and count her suspended card.
    await vault.write(
      logPath('2025-09-01', DEVICE),
      `${JSON.stringify({
        schemaVersion: 3,
        kind: 'suspend',
        eventId: 's1',
        timestamp: '2025-09-01T08:00:00-04:00',
        instrumentId: target.instrumentId,
        conceptIds: ['Alpha'],
      })}\n`,
    );

    const due = await createVaultInstrumentSource({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now,
    }).listDueCandidates();
    expect(due).toHaveLength(2);
    expect(due?.map((d) => d.instrumentId)).not.toContain(target.instrumentId);
  });

  it('a vault it cannot walk says "cannot count yet", never zero', async () => {
    const broken = {
      async list() {
        throw new Error('the vault is unreadable');
      },
    } as unknown as VaultSource;

    const vm = await loadTodayPanel({
      vault: noteVault(),
      deviceId: DEVICE,
      instruments: createVaultInstrumentSource({
        vault: broken,
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
      }),
      now,
      windowDays: 30,
    });
    expect(vm.due).toBeNull();
  });

  it('a vault with no instruments at all is a real zero, not an absence', async () => {
    const empty = {
      async list() {
        return [];
      },
      async read() {
        throw new Error('nothing to read');
      },
      async readBinary() {
        throw new Error('nothing to read');
      },
      async write() {
        return undefined;
      },
      async exists() {
        return false;
      },
      watch() {
        return () => undefined;
      },
    } as unknown as VaultSource;

    const vm = await loadTodayPanel({
      vault: empty,
      deviceId: DEVICE,
      instruments: createVaultInstrumentSource({
        vault: empty,
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
      }),
      now,
      windowDays: 30,
    });
    expect(vm.due).toEqual({ total: 0, newCount: 0, courses: [] });
  });
});

describe('loadTodayPanel', () => {
  const now = () => new Date(2026, 7, 10, 9, 15);

  it('folds the log into a streak and reports the due set as unknown', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
      [logPath('2026-08-09', DEVICE)]: `${reviewLine('2026-08-09', 'b')}\n`,
    });
    const vm = await loadTodayPanel({
      vault,
      deviceId: DEVICE,
      instruments: unavailableInstrumentSource,
      now,
      windowDays: 30,
    });
    expect(vm.streak.currentDays).toBe(2);
    expect(vm.streak.studiedToday).toBe(true);
    expect(vm.due).toBeNull();
  });

  it('a day whose only entry is a suspend does not count as studying', async () => {
    const { vault } = fakeVault({
      [logPath('2026-08-10', DEVICE)]: `${suspendLine('2026-08-10', 's1')}\n`,
      [logPath('2026-08-09', DEVICE)]: `${reviewLine('2026-08-09', 'b')}\n`,
    });
    const vm = await loadTodayPanel({
      vault,
      deviceId: DEVICE,
      instruments: unavailableInstrumentSource,
      now,
      windowDays: 30,
    });
    expect(vm.streak.studiedToday).toBe(false);
    // Yesterday is still intact, so the run is not lost — it is one day.
    expect(vm.streak.currentDays).toBe(1);
  });

  it('counts what a real instrument source hands it', async () => {
    const instruments: TodayInstrumentSource = {
      async listDueCandidates() {
        return [
          { instrumentId: 'a', courseCode: 'BIOL204', courseName: 'Sandstone', due: null },
          {
            instrumentId: 'b',
            courseCode: 'BIOL204',
            courseName: 'Sandstone',
            due: '2026-08-10T08:00:00Z',
          },
          {
            instrumentId: 'c',
            courseCode: 'STAT110',
            courseName: 'Counterpoint',
            due: '2026-09-01T08:00:00Z',
          },
        ];
      },
    };
    const { vault } = fakeVault({});
    const vm = await loadTodayPanel({
      vault,
      deviceId: DEVICE,
      instruments,
      now,
      windowDays: 30,
    });
    expect(vm.due).toEqual({
      total: 2,
      // One of the two carries no due instant, which is the never-reviewed
      // case and therefore the new one (F6.1).
      newCount: 1,
      courses: [{ courseCode: 'BIOL204', courseName: 'Sandstone', count: 2 }],
    });
  });

  it('an enumerable but empty instrument set is a real zero', async () => {
    const { vault } = fakeVault({});
    const vm = await loadTodayPanel({
      vault,
      deviceId: DEVICE,
      instruments: { listDueCandidates: async () => [] },
      now,
      windowDays: 30,
    });
    expect(vm.due).toEqual({ total: 0, newCount: 0, courses: [] });
  });
});
