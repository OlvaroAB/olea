// Scenarios: `features/F6-today.md`, "F6.9 — The processed-revision record" —
// @auto:plugin/ingestion/processed-revisions/current-revisions.spec. Every string here is
// invented (INV-3).
//
// `ol-egov.141.89.11.24`, `[D-426]`: the rebuild reads current content back from the vault (the
// notes) and from the source reading (the embedded sources); it can recover the fingerprint and
// the state, never the day.

import {
  hashContent,
  hashText,
  stableUnitId,
  type UnitManifest,
  type UnitReadingState,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  listCurrentRevisions,
  processedNoteRevision,
} from '../../../src/ingestion/processed-revisions/current-revisions.js';
import { courseArrivalInputs } from '../../../src/ingestion/processed-revisions/facts.js';
import {
  applyRebuild,
  EMPTY_PROCESSED_REVISIONS,
  ObsidianProcessedRevisionStore,
} from '../../../src/ingestion/processed-revisions/store.js';

function fakeVault(files: Readonly<Record<string, string | Uint8Array>>): VaultSource & {
  unreadable: Set<string>;
} {
  const unreadable = new Set<string>();
  const text = (content: string | Uint8Array) =>
    typeof content === 'string' ? content : new TextDecoder().decode(content);
  const bytes = (content: string | Uint8Array) =>
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    unreadable,
    async list() {
      return Object.keys(files).sort();
    },
    async read(path) {
      const content = files[path];
      if (content === undefined || unreadable.has(path)) throw new Error('no such file');
      return text(content);
    },
    async readBinary(path) {
      const content = files[path];
      if (content === undefined || unreadable.has(path)) throw new Error('no such file');
      return bytes(content);
    },
    async write() {
      throw new Error('the rebuild never writes into the vault');
    },
    async exists(path) {
      return files[path] !== undefined;
    },
    watch() {
      return () => undefined;
    },
  };
}

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

const READ: UnitReadingState = { kind: 'read', method: 'text-layer' };
const PENDING: UnitReadingState = { kind: 'pending', reason: 'queued' };
const BLANK: UnitReadingState = { kind: 'unreadable', reason: 'blank-page' };

const NOTE = '01 Courses/CRS-A/week 1.md';
const DECK = '01 Courses/CRS-A/deck.pdf';
const SCAN = '01 Courses/CRS-B/scan.pdf';

describe('listCurrentRevisions — notes', () => {
  it('lists a course note with its fingerprint, its folder’s course and the state read', async () => {
    const vault = fakeVault({ [NOTE]: 'Some invented lecture text.' });
    const listed = await listCurrentRevisions({ vault });
    expect(listed).toEqual([
      {
        path: NOTE,
        courses: ['CRS-A'],
        fingerprint: await hashText('Some invented lecture text.'),
        state: 'read',
      },
    ]);
  });

  it('a note’s own course list outranks its folder, and a note outside the courses folder counts through it', async () => {
    const vault = fakeVault({
      '05 Zettelkasten/idea.md': '---\ncourse:\n  - CRS-B\n  - CRS-A\n---\nBody text.',
      '05 Zettelkasten/no course.md': 'Body text with no course at all.',
    });
    const listed = await listCurrentRevisions({ vault });
    expect(listed.map((item) => [item.path, item.courses])).toEqual([
      ['05 Zettelkasten/idea.md', ['CRS-B', 'CRS-A']],
    ]);
  });

  it('never lists an empty note, one of Olea’s own home notes, or anything in a hidden folder', async () => {
    const vault = fakeVault({
      '01 Courses/CRS-A/empty.md': '   \n',
      '01 Courses/CRS-A/home.md': '---\nolea-home-note: true\n---\nOlea’s own note.',
      '.olea/reviews/2026-09-01.md': 'hidden layer text',
      '.obsidian/plugins/notes.md': 'hidden text',
      [NOTE]: 'Real text.',
    });
    const listed = await listCurrentRevisions({ vault });
    expect(listed.map((item) => item.path)).toEqual([NOTE]);
  });

  it('processedNoteRevision gives the same fingerprint and courses the rebuild does, so a processed note is the same version', async () => {
    const text = '---\ncourse: CRS-A\n---\nInvented body.';
    const vault = fakeVault({ '05 Zettelkasten/a.md': text });
    const [listed] = await listCurrentRevisions({ vault });
    expect(await processedNoteRevision('05 Zettelkasten/a.md', text, 'read')).toEqual(listed);
  });

  it('processedNoteRevision returns null for a note with no course or no content', async () => {
    expect(await processedNoteRevision('05 Zettelkasten/a.md', 'text', 'read')).toBeNull();
    expect(await processedNoteRevision(NOTE, '  ', 'read')).toBeNull();
  });
});

describe('listCurrentRevisions — embedded sources, from the source reading', () => {
  const deckBytes = new TextEncoder().encode('invented deck bytes');
  const scanBytes = new TextEncoder().encode('invented scan bytes');

  it('takes the fingerprint from the reading and the state from what was read of it', async () => {
    const vault = fakeVault({ [DECK]: deckBytes, [SCAN]: scanBytes });
    const manifests = new Map<VaultPath, UnitManifest>([
      [DECK, manifestOf(DECK, 'digest-deck', [READ, PENDING])],
      [SCAN, manifestOf(SCAN, 'digest-scan', [PENDING, PENDING])],
    ]);
    const listed = await listCurrentRevisions({
      vault,
      manifestsFor: async () => manifests,
    });
    expect(listed).toEqual([
      { path: DECK, courses: ['CRS-A'], fingerprint: 'digest-deck', state: 'read' },
      { path: SCAN, courses: ['CRS-B'], fingerprint: 'digest-scan', state: 'pending' },
    ]);
  });

  it('a source that read as blank or nothing at all is unreadable, as an empty or image-only source is counted', async () => {
    const vault = fakeVault({ [DECK]: deckBytes });
    const listed = await listCurrentRevisions({
      vault,
      manifestsFor: async () => new Map([[DECK, manifestOf(DECK, 'digest-deck', [BLANK, BLANK])]]),
    });
    expect(listed[0]?.state).toBe('unreadable');
  });

  it('a source the reading could not enumerate is unreadable, fingerprinted from its own bytes', async () => {
    const vault = fakeVault({ [DECK]: deckBytes });
    const listed = await listCurrentRevisions({ vault, manifestsFor: async () => new Map() });
    expect(listed).toEqual([
      {
        path: DECK,
        courses: ['CRS-A'],
        fingerprint: await hashContent(deckBytes),
        state: 'unreadable',
      },
    ]);
  });

  it('a source nothing has read yet (the unknown reading) is pending, fingerprinted from its own bytes', async () => {
    const vault = fakeVault({ [DECK]: deckBytes });
    const unknown = manifestOf(DECK, 'unverified', [PENDING]);
    const listed = await listCurrentRevisions({
      vault,
      manifestsFor: async () => new Map([[DECK, unknown]]),
    });
    expect(listed).toEqual([
      {
        path: DECK,
        courses: ['CRS-A'],
        fingerprint: await hashContent(deckBytes),
        state: 'pending',
      },
    ]);
  });

  it('with no source reading supplied, every embedded source is pending, never read', async () => {
    const vault = fakeVault({ [DECK]: deckBytes });
    const listed = await listCurrentRevisions({ vault });
    expect(listed[0]?.state).toBe('pending');
  });

  it('an embedded source outside the courses folder has no course and is not listed', async () => {
    const vault = fakeVault({ '03 Research/loose.pdf': deckBytes });
    expect(await listCurrentRevisions({ vault })).toEqual([]);
  });
});

describe('listCurrentRevisions — a listing that could not be completed is not a listing', () => {
  it('rejects when a course file cannot be read, so a rebuild never runs on a partial listing', async () => {
    const vault = fakeVault({ [NOTE]: 'Real text.', '01 Courses/CRS-A/other.md': 'More text.' });
    vault.unreadable.add('01 Courses/CRS-A/other.md');
    await expect(listCurrentRevisions({ vault })).rejects.toThrow();
  });
});

describe('after the record is lost, the rebuild reads current content and marks every day unknown', () => {
  class Host {
    blob: Record<string, unknown> = {};
    async loadData() {
      return this.blob;
    }
    async saveData(data: unknown) {
      this.blob = data as Record<string, unknown>;
    }
  }

  it('recovers each fingerprint and state, and gives no version the day of the rebuild', async () => {
    const vault = fakeVault({
      [NOTE]: 'Real text.',
      [DECK]: new TextEncoder().encode('invented deck bytes'),
    });
    const host = new Host(); // the store was deleted: nothing on record
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-11-02T12:00:00'));
    await store.rebuild(
      await listCurrentRevisions({
        vault,
        manifestsFor: async () =>
          new Map([[DECK, manifestOf(DECK, 'digest-deck', [READ, PENDING])]]),
      }),
    );
    const loaded = await store.load();
    expect(loaded.rebuiltOn).toBe('2026-11-02');
    expect(Object.keys(loaded.revisions).sort()).toEqual([DECK, NOTE].sort());
    for (const row of Object.values(loaded.revisions)) {
      expect(row.firstProcessedDay).toBeNull();
      expect(row.noLaterThan).toBe('2026-11-02');
    }
    // What the reading makes of it: the day is unknown, so nothing is claimed about the course.
    const [course] = courseArrivalInputs(loaded);
    expect(course?.course).toBe('CRS-A');
    expect(course?.revisions.every((revision) => revision.firstProcessedDay === null)).toBe(true);
  });

  it('a vault with no course files at all still rebuilds: the store can say there is nothing', () => {
    const rebuilt = applyRebuild(EMPTY_PROCESSED_REVISIONS, [], '2026-11-02');
    expect(rebuilt.rebuiltOn).toBe('2026-11-02');
    expect(rebuilt.revisions).toEqual({});
  });
});
