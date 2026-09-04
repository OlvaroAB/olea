/**
 * The Today panel's read path (F6.1, P2-T09).
 *
 * Driven against a plain in-memory `VaultSource`, with no Obsidian anywhere —
 * the same property `review/ports.spec.ts` asserts for its port: if this ever
 * reaches for an `App`, this file stops compiling.
 *
 * The host behaviours worth stating up front, because they are real host
 * behaviour rather than hypotheticals (C5.2a, `ol-yk1c`):
 *
 *  - **A host whose `list()` cannot see `.olea/reviews/` at all** — the real
 *    `ObsidianSource` case, since Obsidian's `vault.getFiles()` never returns
 *    dot-prefixed trees. The per-day probe is what makes this device's
 *    history readable regardless.
 *  - **A host whose `list()` throws on the dot-prefixed path** — also a
 *    legitimate host, not an error condition; the probe survives it the same
 *    way.
 *  - **A host whose `list()` can see the folder** — `FolderSource` included,
 *    once it is asked with `under` pointed directly at the dot-prefixed root.
 *    Then another device's file is discoverable, and her phone's reviews
 *    count.
 *
 * A host that cannot list, and a host that lists honestly but finds nothing,
 * return the identical empty array — so `discoveryDegraded` is the fourth
 * thing tested below: it distinguishes "there is real history here that the
 * listing failed to surface" from "there is nothing to surface".
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import type { ConceptRelation, StudyPlanStore, VaultSource } from 'olea-core';
import { createFsrsScheduler, provisionalConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import {
  createRhythmSource,
  createVaultInstrumentSource,
  createVaultScopeSource,
  createVaultTrendsSource,
  DEFAULT_STREAK_WINDOW_DAYS,
  endOfLocalDay,
  loadTodayPanel,
  localToday,
  readReviewHistory,
  type TodayInstrumentSource,
  type TodayRhythmSource,
  unavailableInstrumentSource,
} from '../../src/today/data-source.js';
import {
  EMPTY_MATERIAL_ARRIVALS,
  ObsidianMaterialArrivalStore,
} from '../../src/today/material-arrival-store.js';
import { ObsidianTermWindowStore } from '../../src/today/term-window-store.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

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
    // The probe found real history the listing could not — this is exactly
    // the case `discoveryDegraded` exists to surface (C5.2a, `ol-yk1c`).
    expect(history.discoveryDegraded).toBe(true);
  });

  it('a vault with no log at all is no history, not an error', async () => {
    const { vault } = fakeVault({});
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history).toEqual({
      entries: [],
      disputes: [],
      windowDays: 7,
      invalidLineCount: 0,
      discoveryDegraded: false,
    });
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
    // The listing demonstrably works here — it found the other device's file
    // — so there is no gap to flag, whatever this device's own history is.
    expect(history.discoveryDegraded).toBe(false);
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
    // A host that refuses to list at all is the same "cannot prove it works"
    // signal as one that lists and finds nothing — both leave real history
    // (found here by the probe) unconfirmed by the listing.
    expect(history.discoveryDegraded).toBe(true);
  });
});

describe('readReviewHistory — discoveryDegraded (C5.2a, ol-yk1c)', () => {
  it('a host that lists honestly and finds nothing is not degraded', async () => {
    // listSeesDotFolder: true means list() returns real results (empty here,
    // since `files` is empty) — this is the "genuinely nothing here" case,
    // never distinguishable from a hiding host by the listing alone, but here
    // there is also no history on this device, so there is nothing to miss.
    const { vault } = fakeVault({}, { listSeesDotFolder: true });
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.discoveryDegraded).toBe(false);
  });

  it('a hiding host with no history anywhere yet is not degraded either', async () => {
    // A brand-new device, nothing to qualify: the flag never asserts
    // completeness, only the presence of a detectable gap, and there isn't
    // one to detect when this device itself has never written a log.
    const { vault } = fakeVault({}, { listSeesDotFolder: false });
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 7,
    });
    expect(history.discoveryDegraded).toBe(false);
  });

  it('a file outside the window still proves the listing works', async () => {
    // The raw listing is checked unfiltered by window: seeing anything in the
    // folder — even a day the streak window does not cover — is proof the
    // host can enumerate it, so a within-window gap on THIS device could not
    // be another device's file the listing failed to surface.
    const { vault } = fakeVault(
      {
        [logPath('2026-01-01', OTHER_DEVICE)]: `${reviewLine('2026-01-01', 'old')}\n`,
        [logPath('2026-08-10', DEVICE)]: `${reviewLine('2026-08-10', 'a')}\n`,
      },
      { listSeesDotFolder: true },
    );
    const history = await readReviewHistory(vault, DEVICE, {
      today: '2026-08-10',
      windowDays: 3,
    });
    expect(history.discoveryDegraded).toBe(false);
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

  describe('C7.9 containment co-presence reaches this call site too (ol-v7r5.7)', () => {
    /** Beta is part of Alpha — `from` is the finer side, `to` the container (`session/containment.ts`'s convention). */
    const partOfAlphaBeta: ConceptRelation = {
      type: 'part-of',
      from: 'Beta',
      to: 'Alpha',
      provenance: 'model-proposed',
      confidence: 0.9,
      introducingPassages: {
        from: {
          sourcePath: 'Courses/MUS/two.md',
          location: { page: 1, charRange: { start: 0, end: 1 } },
        },
        to: {
          sourcePath: 'Courses/GEO/one.md',
          location: { page: 1, charRange: { start: 0, end: 1 } },
        },
      },
    };

    it("with no relations threaded, both concepts count (today's no-op baseline)", async () => {
      const due = await createVaultInstrumentSource({
        vault: noteVault(),
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
      }).listDueCandidates();
      expect(new Set(due?.map((d) => d.courseCode))).toEqual(new Set(['GEO101', 'MUS101']));
    });

    it('threading a live part-of edge drops the container (GEO101/Alpha), keeping the part (MUS101/Beta)', async () => {
      const due = await createVaultInstrumentSource({
        vault: noteVault(),
        scheduler: createFsrsScheduler(),
        deviceId: DEVICE,
        now,
        relations: [partOfAlphaBeta],
      }).listDueCandidates();
      expect(due).not.toBeNull();
      expect(due?.every((d) => d.courseCode === 'MUS101')).toBe(true);
      expect(due).toHaveLength(1);
    });
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

  /**
   * `ol-95vv.5`: `panel.ts`/`data-source.ts` now supply `MasteryVitalityInputs`
   * (a real `createFsrsScheduler()`, `now`, and the declared holding-cut
   * fallback) the same way `registry/provider.ts`'s
   * `createLocalRegistryProvider` already does, so `CourseMastery.vitality`
   * is no longer `null` in production (D-116's fallback — see
   * `mastery-overview.ts`'s own doc for the gap this closes).
   *
   * Deliberately **no stubbed scheduler** here, unlike `mastery-overview.
   * spec.ts`'s own vitality suite: the point of this test is that
   * `loadTodayPanel` — the real production path (`main.ts:751`) — wires a
   * real one, not that the vitality fold's arithmetic is correct (that is
   * `sprig.spec.ts`'s job, re-asserted at the `buildMasteryOverview` layer by
   * `mastery-overview.spec.ts`). An MCQ-only concept is the fixture because
   * its answer is independent of whatever the real scheduler says (R3's
   * filter excludes recognition-tier instruments from the fold entirely
   * before retrievability is ever asked), so the assertion holds however
   * `createFsrsScheduler()` happens to score it. INV-3: every course code and
   * concept name below is invented.
   */
  describe('F6.2 mastery vitality reaches production (ol-95vv.5)', () => {
    it('an MCQ-only concept reads "too early to say" through the real panel path', async () => {
      const conceptId = provisionalConceptKey({ name: 'Coined Concept', boundNotePath: null });
      const mcqReviewLine = (day: string, eventId: string) =>
        JSON.stringify({
          schemaVersion: 3,
          kind: 'review',
          eventId,
          timestamp: `${day}T20:00:00-04:00`,
          instrumentId: `mcq:${conceptId}:1`,
          instrumentType: 'mcq',
          rating: 'good',
          wasUnsure: false,
          durationMs: 1200,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            masteryAtTime: null,
            instrumentTypesOffered: ['mcq'],
            planVersion: null,
          },
          conceptIds: [conceptId],
        });

      const vault = memoryVault({
        'Notes/coined-one.md': [
          '---',
          'topic: [Coined Concept]',
          'course: TESTC303',
          '---',
          '',
          '```olea-mcq',
          'stem: Which one is it?',
          'answer: The right one',
          'distractor: d1',
          'distractor: d2',
          'distractor: d3',
          'distractor: d4',
          'feedback: Because of the thing.',
          '```',
          '',
        ].join('\n'),
        [logPath('2026-08-20', DEVICE)]: `${mcqReviewLine('2026-08-20', 'e1')}\n`,
        [logPath('2026-08-24', DEVICE)]: `${mcqReviewLine('2026-08-24', 'e2')}\n`,
        [logPath('2026-08-28', DEVICE)]: `${mcqReviewLine('2026-08-28', 'e3')}\n`,
      });

      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now: () => new Date(2026, 8, 1, 9, 0),
        windowDays: 30,
        trends: createVaultTrendsSource({ vault }),
      });

      expect(vm.mastery).not.toBeNull();
      const course = vm.mastery?.courses.find((c) => c.course === 'TESTC303');
      if (course === undefined) throw new Error('expected TESTC303 in the mastery overview');

      // D-116's fallback (`null`) would mean the wiring is still missing;
      // a real reading is the thing `ol-95vv.5` is proving reaches production.
      expect(course.vitality).not.toBeNull();

      const totals = { holding: 0, tending: 0, early: 0 };
      for (const stage of Object.values(course.vitality?.byStage ?? {})) {
        totals.holding += stage.holding;
        totals.tending += stage.tending;
        totals.early += stage.early;
      }
      expect(totals).toEqual({ holding: 0, tending: 0, early: 1 });
      expect(course.vitality?.tending).toEqual([]);
    });
  });

  /**
   * `ol-95vv.6`: the tending line used to name a concept by its opaque,
   * never-displayed key. `loadTodayPanel` now resolves each tending
   * concept's `displayName` from the same `listConceptCourses()` read
   * `vm.mastery` was already built from — see `data-source.ts`'s
   * `withTendingDisplayNames` for why the rewrite happens after
   * `buildTodayPanel` rather than inside the vitality fold itself.
   *
   * Real FSRS scheduler, real elapsed time, deliberately no stub — the same
   * posture the `ol-95vv.5` suite above takes, and for the same reason: a
   * single `again`-rated review, five years stale by `now`, drives
   * retrievability low enough to read `needs tending` however the real
   * curve scores it. INV-3: every course code and concept name below is
   * invented.
   */
  describe('F6.2 tending line names the concept by display name (ol-95vv.6)', () => {
    const NOTE_PATH = 'Notes/coined-ridge-note.md';
    const NOTE_CONTENT = [
      '---',
      'topic: [Coined Ridge Concept]',
      'course: TESTC505',
      '---',
      '',
      '## What formed it?',
      '',
      'Coined Ridge Concept front::Coined Ridge Concept back ^g1',
      '',
    ].join('\n');

    it("names the tending concept by her vault's own wording, not its opaque key", async () => {
      // Extraction, not `provisionalConceptKey` called directly, mints the
      // real key here: a topic-derived (non-bound) concept's key is scoped by
      // course (`concept/extract.ts`), which `ConceptKeyInput` alone does not
      // show — reading it back off a real walk is the honest way to get the
      // review log's `conceptIds` to actually correlate with this concept.
      const extracted = await extractConceptsFromVault(
        memoryVault({ [NOTE_PATH]: NOTE_CONTENT }),
        {},
      );
      const record = extracted[0];
      if (record === undefined) throw new Error('expected one extracted concept');
      const conceptId = record.key;

      const vault = memoryVault({
        [NOTE_PATH]: NOTE_CONTENT,
        // Filed inside the read window (`windowDays` below), with a stale
        // `timestamp` inside the record — the file's own day only gates
        // which files `readReviewHistory` looks at; FSRS reads elapsed time
        // from the event's own timestamp, so this is a five-year-stale
        // review the panel still discovers.
        [logPath('2024-06-01', DEVICE)]: `${JSON.stringify({
          schemaVersion: 3,
          kind: 'review',
          eventId: 'stale1',
          timestamp: '2020-01-01T20:00:00-04:00',
          instrumentId: `qa:${conceptId}:1`,
          instrumentType: 'qa',
          rating: 'again',
          wasUnsure: false,
          durationMs: 1200,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            masteryAtTime: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
          conceptIds: [conceptId],
        })}\n`,
      });

      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        // Half a year after the log FILE's own day, so it is read; five years
        // after the review's own stale `timestamp`, so a real FSRS curve
        // reads a low retrievability regardless of its exact parameters.
        now: () => new Date(2025, 0, 1, 9, 0),
        windowDays: 400,
        trends: createVaultTrendsSource({ vault }),
      });

      const course = vm.mastery?.courses.find((c) => c.course === 'TESTC505');
      if (course === undefined) throw new Error('expected TESTC505 in the mastery overview');
      expect(course.vitality?.tending).toHaveLength(1);
      expect(course.vitality?.tending[0]).toMatchObject({
        conceptId,
        displayName: 'Coined Ridge Concept',
      });
    });

    it('falls back to the opaque key when no trends source resolved a display name', async () => {
      const conceptId = provisionalConceptKey({
        name: 'Coined Fallback Concept',
        boundNotePath: null,
      });
      const vault = memoryVault({
        [logPath('2020-01-01', DEVICE)]: `${JSON.stringify({
          schemaVersion: 3,
          kind: 'review',
          eventId: 'stale1',
          timestamp: '2020-01-01T20:00:00-04:00',
          instrumentId: `qa:${conceptId}:1`,
          instrumentType: 'qa',
          rating: 'again',
          wasUnsure: false,
          durationMs: 1200,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            masteryAtTime: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
          conceptIds: [conceptId],
        })}\n`,
      });

      // No `trends` supplied at all — `vm.mastery` stays `null` (F6.2's own
      // "never asked" posture), so this only exercises
      // `withTendingDisplayNames`'s no-op short circuit rather than the
      // naming itself; the sibling test above is the one proving resolution.
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now: () => new Date(2025, 0, 1, 9, 0),
        windowDays: 30,
      });
      expect(vm.mastery).toBeNull();
    });
  });

  describe('F6.9 rhythm reading (ol-v7r5.6)', () => {
    it('leaves the rhythm half null when no rhythm source was wired — a third state, not a computed answer', async () => {
      const { vault } = fakeVault({});
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
      });
      expect(vm.rhythm).toBeNull();
    });

    it('threads a wired rhythm source through to a real reading', async () => {
      const { vault } = fakeVault({});
      const rhythm: TodayRhythmSource = {
        async listCourseMaterialArrivals() {
          return [{ course: 'GEO101', lastMaterialArrivalDay: '2026-07-01' }];
        },
        async resolveTermWindow() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        rhythm,
      });
      expect(vm.rhythm?.status).toBe('observed');
      expect(vm.rhythm?.measured?.quietestCourse).toBe('GEO101');
    });

    it('a rhythm source that cannot enumerate degrades to the same "never wired" null, not a thrown error', async () => {
      const { vault } = fakeVault({});
      const rhythm: TodayRhythmSource = {
        async listCourseMaterialArrivals() {
          return null;
        },
        async resolveTermWindow() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        rhythm,
      });
      expect(vm.rhythm).toBeNull();
    });
  });

  describe('F6.2 cross-course scope reading (ol-4qvc)', () => {
    it('leaves the scope half null when no scope source was wired — a third state, not a computed answer', async () => {
      const { vault } = fakeVault({});
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
      });
      expect(vm.scope).toBeNull();
    });

    it('threads a wired scope source through to a real cross-course reading', async () => {
      const { vault } = fakeVault({});
      const scope = {
        async listCourseGroveModels() {
          return [
            {
              status: 'declared' as const,
              course: 'GEO101',
              cells: [],
              materialGaps: [],
              volunteers: [],
              summary: {
                builtCount: 3,
                denominatorCount: 5,
                denominatorSourcePaths: ['Sources/geo-objectives.pdf'],
                pastPaperSourcePaths: [],
              },
            },
          ];
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        scope,
      });
      expect(vm.scope?.courses).toEqual([
        {
          course: 'GEO101',
          status: 'declared',
          builtCount: 3,
          denominatorCount: 5,
          denominatorSourcePaths: ['Sources/geo-objectives.pdf'],
        },
      ]);
    });

    it('a scope source that cannot enumerate degrades to "could not compute", not a thrown error', async () => {
      const { vault } = fakeVault({});
      const scope = {
        async listCourseGroveModels() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        scope,
      });
      expect(vm.scope).toBeNull();
    });
  });

  describe('RHY-3 calendar-schedule freshness (`ol-4chx` -> `ol-r6s0` -> `ol-hna1` -> `ol-at1a`)', () => {
    // INV-3: every course code, path and line of text below is coined for
    // this test. None of it comes from any real vault.

    it('is null when no rhythm source was wired — the same third state the flat reading uses', async () => {
      const { vault } = fakeVault({});
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
      });
      expect(vm.courseFreshness).toBeNull();
    });

    it('is null when the wired rhythm source cannot enumerate arrivals, not a thrown error', async () => {
      const { vault } = fakeVault({});
      const rhythm: TodayRhythmSource = {
        async listCourseMaterialArrivals() {
          return null;
        },
        async resolveTermWindow() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        rhythm,
      });
      expect(vm.courseFreshness).toBeNull();
    });

    it('is an empty list, not null, when a rhythm source is wired but no calendar note is discoverable', async () => {
      const { vault } = fakeVault({}, { listSeesDotFolder: true });
      const rhythm: TodayRhythmSource = {
        async listCourseMaterialArrivals() {
          return [];
        },
        async resolveTermWindow() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        rhythm,
      });
      expect(vm.courseFreshness).toEqual([]);
    });

    it('reports a with-yardstick reading for a course whose calendar sessions are unmatched by any arrival', async () => {
      // `now` (2026-08-10) is `today` — two FIXTURE101 sessions land before it,
      // both after the last observed arrival, past the one-day grace margin.
      const { vault } = fakeVault(
        {
          '01 Courses/FIXTURE101/Lecture notes.md': 'Just a note — never scanned for events.',
          'UNIVERSITY/Calendar/calendar-events.md': [
            '- [ ] FIXTURE101 Mon 09:00-10:00 📅 2026-08-03',
            '- [ ] FIXTURE101 Wed 09:00-10:00 📅 2026-08-05',
          ].join('\n'),
        },
        { listSeesDotFolder: true },
      );
      const rhythm: TodayRhythmSource = {
        async listCourseMaterialArrivals() {
          return [{ course: 'FIXTURE101', lastMaterialArrivalDay: '2026-08-01' }];
        },
        async resolveTermWindow() {
          return null;
        },
      };
      const vm = await loadTodayPanel({
        vault,
        deviceId: DEVICE,
        instruments: unavailableInstrumentSource,
        now,
        windowDays: 30,
        rhythm,
      });
      expect(vm.courseFreshness).toEqual([
        expect.objectContaining({
          courseCode: 'FIXTURE101',
          status: 'not-arrived-with-yardstick',
          expectedSessionDate: '2026-08-05',
          basis: 'observed',
        }),
      ]);
    });
  });
});

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

describe('createRhythmSource — the real source, over the two persisted stores', () => {
  it('lists exactly the courses the arrival store has ever heard from', async () => {
    const arrivalStore = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await arrivalStore.recordArrival('GEO101', '2026-08-01');
    await arrivalStore.recordArrival('MUS101', '2026-08-10');
    const source = createRhythmSource({
      materialArrivals: arrivalStore,
      termWindow: new ObsidianTermWindowStore(new FakeDataHost()),
    });
    const arrivals = await source.listCourseMaterialArrivals();
    expect(arrivals).toEqual(
      expect.arrayContaining([
        { course: 'GEO101', lastMaterialArrivalDay: '2026-08-01' },
        { course: 'MUS101', lastMaterialArrivalDay: '2026-08-10' },
      ]),
    );
    expect(arrivals).toHaveLength(2);
  });

  it('a fresh install lists no courses at all — the empty state, not a failure', async () => {
    const source = createRhythmSource({
      materialArrivals: new ObsidianMaterialArrivalStore(new FakeDataHost()),
      termWindow: new ObsidianTermWindowStore(new FakeDataHost()),
    });
    expect(await source.listCourseMaterialArrivals()).toEqual([]);
    expect(EMPTY_MATERIAL_ARRIVALS.lastArrivalByCourse).toEqual({});
  });

  it('resolves a recorded term window through resolveTermBoundary', async () => {
    const termStore = new ObsidianTermWindowStore(new FakeDataHost());
    await termStore.save({ start: '2026-08-01', end: '2026-12-15' });
    const source = createRhythmSource({
      materialArrivals: new ObsidianMaterialArrivalStore(new FakeDataHost()),
      termWindow: termStore,
    });
    expect(await source.resolveTermWindow()).toEqual({ start: '2026-08-01', end: '2026-12-15' });
  });

  it('no recorded term window resolves to null — F6.9 never blocks on it', async () => {
    const source = createRhythmSource({
      materialArrivals: new ObsidianMaterialArrivalStore(new FakeDataHost()),
      termWindow: new ObsidianTermWindowStore(new FakeDataHost()),
    });
    expect(await source.resolveTermWindow()).toBeNull();
  });
});

/**
 * `createVaultScopeSource` — F6.2's cross-course scope reading's real input
 * (`ol-a83u` [SCP-1], `ol-4qvc`): one `buildGroveModel` call per running
 * course. This suite tests the WIRING this bead adds (assembling
 * `buildGroveModel`'s inputs from a vault walk) — not `buildGroveModel`'s own
 * acceptance criteria, which is `packages/core/src/scope/grove.spec.ts`'s
 * job, nor `buildCrossCourseScopeOverview`'s, which is `packages/core/src/
 * gap/scope-overview.spec.ts`'s (re-asserted at the `buildTodayPanel` layer
 * in `packages/core/src/today/panel.spec.ts`).
 *
 * Fixture shape matches `../grove/provider.spec.ts`'s own
 * `fixtureVaultWithRegisteredSource` — same registered-objectives-plus-two-
 * courses fixture, proven there to produce a real `'declared'`/`'inferred'`
 * split; INV-3: every course code and concept name below is invented.
 */
describe('createVaultScopeSource — the real F6.2 scope source (ol-4qvc)', () => {
  const NOW = new Date('2026-09-01T09:00:00Z');

  function fixtureVault() {
    return memoryVault({
      '03 Research/Objectives.md': [
        '---',
        'role: objectives',
        'course: TESTC101',
        '---',
        '',
        'The course covers Concept A in depth.',
        '',
      ].join('\n'),
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      'Notes/two.md': [
        '---',
        'topic: [Concept B]',
        'course: TESTC202',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
    });
  }

  it('one buildGroveModel call per running course: a declared course reads a real built/denominator count and its source, an inferred course reads no denominator (F8.1)', async () => {
    const source = createVaultScopeSource({
      vault: fixtureVault(),
      deviceId: DEVICE,
      now: () => NOW,
    });
    const models = await source.listCourseGroveModels();
    expect(models).not.toBeNull();
    const byCourse = new Map((models ?? []).map((model) => [model.course, model]));
    expect([...byCourse.keys()].sort()).toEqual(['TESTC101', 'TESTC202']);

    const c101 = byCourse.get('TESTC101');
    if (c101 === undefined || c101.status !== 'declared') {
      throw new Error(`expected TESTC101 declared, got ${c101?.status}`);
    }
    expect(c101.summary.denominatorSourcePaths).toEqual(['03 Research/Objectives.md']);
    expect(c101.summary.denominatorCount).toBe(1);
    // "Front::Back" gives Concept A a real instrument, so it reads `seed`
    // (never having been reviewed) rather than `ground` — built, in F8.3's
    // count-and-source sense.
    expect(c101.summary.builtCount).toBe(1);

    // TESTC202 has a concept of her own ("Concept B") but no registered
    // objectives/past-paper source at all — F8.1 scenario 3's inference case,
    // which `buildCrossCourseScopeOverview` reads as "no denominator yet".
    expect(byCourse.get('TESTC202')?.status).toBe('inferred');
  });

  it('an empty vault reads no running courses at all — a real, honest empty list, not a failure', async () => {
    const source = createVaultScopeSource({
      vault: memoryVault({}),
      deviceId: DEVICE,
      now: () => NOW,
    });
    expect(await source.listCourseGroveModels()).toEqual([]);
  });

  it('returns null, never throws, when the vault cannot be read', async () => {
    const source = createVaultScopeSource({
      vault: unreadableVault() as ReturnType<typeof fixtureVault>,
      deviceId: DEVICE,
      now: () => NOW,
    });
    expect(await source.listCourseGroveModels()).toBeNull();
  });
});

/**
 * `createVaultTrendsSource().listCourseFloorShares` (`ol-v7r5.38`, F6.5(b)).
 *
 * Read-only over `deps.studyPlanStore`: the fixtures below build a
 * `StudyPlanEnvelope` and hand it to a fake `StudyPlanStore` (same shape as
 * `packages/core/src/plan/cache.spec.ts`'s own `memoryStore`, restated here
 * rather than imported — that file lives outside this package's tsconfig).
 * Course codes are coined, never anything from a real vault (INV-3).
 */
describe('createVaultTrendsSource#listCourseFloorShares', () => {
  const COMPUTED_AT = '2026-08-16T09:00:00.000Z';
  const NOW = new Date(COMPUTED_AT);

  function memoryStudyPlanStore(initial: unknown = null): StudyPlanStore {
    let value: unknown = initial;
    return {
      async load() {
        return value;
      },
      async save(plan) {
        value = plan;
      },
    };
  }

  function planFixture(overrides: Partial<StudyPlanEnvelope['body']> = {}): StudyPlanEnvelope {
    return {
      envelopeVersion: 1,
      kind: 'study-plan',
      bodyVersion: 1,
      policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
      computedAt: COMPUTED_AT,
      freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
      governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
      body: {
        asOf: '2026-08-16',
        courses: [],
        ...overrides,
      },
    };
  }

  it("reads real per-course floor shares from the cached plan's allocation contributions", async () => {
    const store = memoryStudyPlanStore(
      planFixture({
        allocation: [
          {
            courseId: 'COGS214',
            share: 0.6,
            minBlockSeconds: 600,
            contributions: [
              { name: 'floor', value: 0.35 },
              { name: 'rawDesire', value: 0.5 },
            ],
            reason: 'COGS214 has the nearer assessment.',
          },
          {
            courseId: 'STAT221',
            share: 0.4,
            minBlockSeconds: 600,
            contributions: [{ name: 'floor', value: 0.2 }],
            reason: 'STAT221 keeps its minimum share.',
          },
        ],
      }),
    );
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: store,
      now: () => NOW,
    });
    expect(await source.listCourseFloorShares()).toEqual([
      { course: 'COGS214', floorShare: 0.35 },
      { course: 'STAT221', floorShare: 0.2 },
    ]);
  });

  it('returns [] when no cached plan exists — the honest not-enough-history path', async () => {
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: memoryStudyPlanStore(null),
      now: () => NOW,
    });
    expect(await source.listCourseFloorShares()).toEqual([]);
  });

  it('returns [] when no studyPlanStore dependency is supplied at all', async () => {
    const source = createVaultTrendsSource({ vault: memoryVault({}) });
    expect(await source.listCourseFloorShares()).toEqual([]);
  });

  it('returns [] on a malformed cached blob, without throwing', async () => {
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: memoryStudyPlanStore({ envelopeVersion: 99, garbage: true }),
      now: () => NOW,
    });
    await expect(source.listCourseFloorShares()).resolves.toEqual([]);
  });

  it('returns [] when the store itself throws, without throwing', async () => {
    const throwingStore: StudyPlanStore = {
      async load() {
        throw new Error('disk read failed');
      },
      async save() {},
    };
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: throwingStore,
      now: () => NOW,
    });
    await expect(source.listCourseFloorShares()).resolves.toEqual([]);
  });

  it('returns [] for a plan cached before the allocation field existed (ol-v7r5.17 [ALLOC-2])', async () => {
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: memoryStudyPlanStore(planFixture()),
      now: () => NOW,
    });
    expect(await source.listCourseFloorShares()).toEqual([]);
  });

  it('returns [] for an expired plan — a governing artifact past its horizon is not evidence', async () => {
    const pastHorizon = new Date(
      new Date(COMPUTED_AT).getTime() + (GOVERNING_GOVERNS_FOR_SECONDS + 1) * 1000,
    );
    const store = memoryStudyPlanStore(
      planFixture({
        allocation: [
          {
            courseId: 'COGS214',
            share: 1,
            minBlockSeconds: 600,
            contributions: [{ name: 'floor', value: 0.5 }],
            reason: 'only course.',
          },
        ],
      }),
    );
    const source = createVaultTrendsSource({
      vault: memoryVault({}),
      studyPlanStore: store,
      now: () => pastHorizon,
    });
    expect(await source.listCourseFloorShares()).toEqual([]);
  });
});
