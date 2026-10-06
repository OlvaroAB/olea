/**
 * The page record's half of retire on revision (`ol-egov.141.89.7.78`, `[D-531]` B with completeness
 * rules): the per-page "outcomes extracted" mark, how each stored reading maps for the retire rule,
 * and the version's expected pages, page history and listed versions the fold hands the outcomes
 * trigger. Written to olea-service `features/F4-oracle.md`, F4.1, the scenarios tagged with this
 * file. Every string below is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  outcomeRevisionReadInFull,
  planOutcomeDelivery,
} from '../../outcome/retire-on-revision.js';
import { enumeratedRecord, retiredRecord, SYNTH_SOURCE_PATH, unitRecord } from './fixtures.js';
import { outcomePageReadingOf } from './outcome-extraction.js';
import { createUnitManifestFold, foldUnitManifests } from './projection.js';
import {
  parseUnitManifestLog,
  serialiseUnitManifestRecord,
  type UnitManifestRecord,
  type UnitStateRecord,
} from './records.js';
import type { UnitReadingState } from './types.js';

const PATH = SYNTH_SOURCE_PATH;
const D1 = 'rev-d1';
const D2 = 'rev-d2';

/** A deterministic shuffle (Fisher-Yates over a small LCG), so an order test is repeatable. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function pagesOf(records: readonly UnitManifestRecord[]) {
  const fold = createUnitManifestFold();
  for (const record of records) fold.add(record);
  return fold.outcomeRevisionPagesOf(PATH);
}

function readInFull(records: readonly UnitManifestRecord[]): boolean {
  const pages = pagesOf(records);
  if (pages === undefined) throw new Error('expected a current version');
  return outcomeRevisionReadInFull(pages);
}

function marked(overrides: Partial<UnitStateRecord>): UnitStateRecord {
  return unitRecord({ ...overrides, outcomeExtractionState: 'complete' });
}

describe('the mark on the page record: stored only as "complete", old records read as not extracted', () => {
  // Pinned by hand, byte for byte, as a build before this change wrote it.
  const OLD_LINE =
    '{"v":1,"kind":"unit","deviceId":"device-a","clock":1,"at":"2026-09-29T10:00:00+10:00",' +
    '"sourcePath":"03 Research/SYNTH101 Deck.pdf","revisionDigest":"rev-1",' +
    '"unitId":"03 Research/SYNTH101 Deck.pdf#1","page":1,' +
    '"readingState":{"kind":"read","method":"text-layer"},"conceptExtractionState":"not-started"}\n';

  it('a line written before this change reads as not extracted and writes back byte for byte', () => {
    const { records, invalidLines } = parseUnitManifestLog(OLD_LINE);
    expect(invalidLines).toEqual([]);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record?.kind).toBe('unit');
    expect(record !== undefined && 'outcomeExtractionState' in record).toBe(false);
    expect(serialiseUnitManifestRecord(record as UnitManifestRecord)).toBe(OLD_LINE);
    const manifest = foldUnitManifests([
      enumeratedRecord({ pages: [1] }),
      ...records,
    ]).manifests.get(PATH);
    expect(manifest?.entries[0]?.outcomeExtractionState).toBeUndefined();
  });

  it('a marked line carries the mark after the concept-extraction state, at the same record version', () => {
    const line = serialiseUnitManifestRecord(marked({ conceptExtractionState: 'complete' }));
    const json = JSON.parse(line) as Record<string, unknown>;
    expect(json.v).toBe(1);
    expect(Object.keys(json).slice(-2)).toEqual([
      'conceptExtractionState',
      'outcomeExtractionState',
    ]);
    expect(json.outcomeExtractionState).toBe('complete');
    const { records } = parseUnitManifestLog(line);
    expect(records).toHaveLength(1);
    expect(serialiseUnitManifestRecord(records[0] as UnitManifestRecord)).toBe(line);
    // The two marks stay two fields: neither is derived from the other.
    expect(records[0]).toMatchObject({
      conceptExtractionState: 'complete',
      outcomeExtractionState: 'complete',
    });
  });

  it('a mark holding any other value is a line this build cannot vouch for: reported and skipped', () => {
    for (const value of ['not-started', 'done', 1, null, true]) {
      const line = OLD_LINE.replace(
        '"conceptExtractionState":"not-started"}',
        `"conceptExtractionState":"not-started","outcomeExtractionState":${JSON.stringify(value)}}`,
      );
      const { records, invalidLines } = parseUnitManifestLog(line);
      expect(records, `value ${String(value)}`).toEqual([]);
      expect(invalidLines).toHaveLength(1);
    }
  });
});

describe("each page's reading maps to read, nothing to read, or not read", () => {
  const PROVENANCE = {
    task: 'vision.extract.v2',
    promptVersion: '1.0.0',
    modelIdentity: 'model-synthetic',
    imageDigest: 'digest-synthetic',
  };
  const CASES: readonly [UnitReadingState, 'read' | 'nothing-to-read' | 'not-read'][] = [
    [{ kind: 'read', method: 'text-layer' }, 'read'],
    [{ kind: 'read', method: 'image', provenance: PROVENANCE }, 'read'],
    [{ kind: 'read', method: 'text-and-image', provenance: PROVENANCE }, 'read'],
    [{ kind: 'unreadable', reason: 'blank-page' }, 'nothing-to-read'],
    [{ kind: 'unreadable', reason: 'no-text-on-page', provenance: PROVENANCE }, 'nothing-to-read'],
    [{ kind: 'unreadable', reason: 'not-legible', provenance: PROVENANCE }, 'not-read'],
    [
      { kind: 'partial', method: 'image', coverage: 'the upper half', provenance: PROVENANCE },
      'not-read',
    ],
    [{ kind: 'pending', reason: 'queued' }, 'not-read'],
    [{ kind: 'pending', reason: 'budget' }, 'not-read'],
    [{ kind: 'unavailable' }, 'not-read'],
    [{ kind: 'failed', reason: 'render-failed', retryable: false }, 'not-read'],
    [{ kind: 'failed', reason: 'malformed-response-twice', retryable: true }, 'not-read'],
  ];

  it('maps every stored reading as the table says', () => {
    for (const [state, expected] of CASES) {
      expect(outcomePageReadingOf(state), JSON.stringify(state)).toBe(expected);
    }
  });

  it('the page history carries the mapped reading, and the mark only as stored', () => {
    const records: UnitManifestRecord[] = [
      enumeratedRecord({ revisionDigest: D1, pages: [1], clock: 1 }),
    ];
    CASES.forEach(([readingState], index) => {
      records.push(
        unitRecord({
          revisionDigest: D1,
          page: 1,
          clock: index + 2,
          readingState,
          outcomeExtractionState: 'complete',
        }),
      );
    });
    const pages = pagesOf(records);
    expect(pages?.history.map((state) => state.reading)).toEqual(
      CASES.map(([, reading]) => reading),
    );
    expect(pages?.history.every((state) => state.outcomesExtracted)).toBe(true);
  });

  it('a failed, unavailable, part-read or illegible page never settles, marked or not; a blank one does', () => {
    const base = [
      enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 1 }),
      marked({ revisionDigest: D1, page: 1, clock: 2 }),
    ];
    const withPage2 = (readingState: UnitReadingState, mark: boolean) =>
      readInFull([
        ...base,
        unitRecord({
          revisionDigest: D1,
          page: 2,
          clock: 3,
          readingState,
          ...(mark ? { outcomeExtractionState: 'complete' as const } : {}),
        }),
      ]);
    for (const [state, reading] of CASES) {
      if (reading === 'not-read') {
        expect(withPage2(state, true), JSON.stringify(state)).toBe(false);
        expect(withPage2(state, false), JSON.stringify(state)).toBe(false);
      }
    }
    expect(withPage2({ kind: 'unreadable', reason: 'blank-page' }, false)).toBe(true);
    expect(withPage2({ kind: 'read', method: 'image' }, false)).toBe(false);
    expect(withPage2({ kind: 'read', method: 'image' }, true)).toBe(true);
    // A page the enumeration lists and nothing has read is not read.
    expect(readInFull(base)).toBe(false);
  });
});

describe('the version the fold hands the outcomes trigger', () => {
  const RECORDS: readonly UnitManifestRecord[] = [
    enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 1 }),
    marked({ revisionDigest: D1, page: 1, clock: 2 }),
    retiredRecord({ revisionDigest: D1, clock: 3 }),
    enumeratedRecord({ revisionDigest: D2, pages: [1, 2, 3], clock: 4 }),
    unitRecord({ revisionDigest: D2, page: 1, clock: 5 }),
    marked({ revisionDigest: D2, page: 1, clock: 6 }),
    unitRecord({
      revisionDigest: D2,
      page: 3,
      clock: 7,
      readingState: { kind: 'unreadable', reason: 'blank-page' },
    }),
    // A late write for D1 from another device: never part of D2's history.
    marked({ revisionDigest: D1, page: 2, clock: 8, deviceId: 'device-b' }),
  ];

  it('gives the current version, its expected pages, its history since listing and every listed version', () => {
    expect(pagesOf(RECORDS)).toEqual({
      sourcePath: PATH,
      revisionDigest: D2,
      expectedPages: [1, 2, 3],
      history: [
        { page: 1, reading: 'read', outcomesExtracted: false },
        { page: 1, reading: 'read', outcomesExtracted: true },
        { page: 3, reading: 'nothing-to-read', outcomesExtracted: false },
      ],
      knownRevisions: [D1, D2],
    });
  });

  it('is the same whatever order the records were read in', () => {
    const expected = pagesOf(RECORDS);
    for (let seed = 1; seed <= 12; seed++) {
      expect(pagesOf(shuffled(RECORDS, seed))).toEqual(expected);
    }
  });

  it('marks pages for one version only, beside and apart from concept extraction', () => {
    const manifest = foldUnitManifests(RECORDS).manifests.get(PATH);
    expect(manifest?.revisionDigest).toBe(D2);
    const page1 = manifest?.entries.find((entry) => entry.page === 1);
    expect(page1).toMatchObject({
      conceptExtractionState: 'not-started',
      outcomeExtractionState: 'complete',
    });
    expect(
      manifest?.entries.find((entry) => entry.page === 2)?.outcomeExtractionState,
    ).toBeUndefined();
    // D1, while it was current, had only page 1 marked.
    const d1Only = foldUnitManifests(RECORDS.slice(0, 2)).manifests.get(PATH);
    expect(d1Only?.entries.map((entry) => entry.outcomeExtractionState)).toEqual([
      'complete',
      undefined,
    ]);
  });

  it('hands nothing for a path with no current version', () => {
    expect(pagesOf([unitRecord({ revisionDigest: D1 })])).toBeUndefined();
    expect(
      pagesOf([
        enumeratedRecord({ revisionDigest: D1, clock: 1 }),
        retiredRecord({ revisionDigest: D1, clock: 2 }),
      ]),
    ).toBeUndefined();
  });
});

describe('when a mark counts: after the version was listed, and after every other version was', () => {
  // D1 read in full: page 1 read from its text layer, page 2 from its image.
  const D1_READ: readonly UnitManifestRecord[] = [
    enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 1 }),
    unitRecord({ revisionDigest: D1, page: 1, clock: 2 }),
    unitRecord({
      revisionDigest: D1,
      page: 2,
      clock: 3,
      readingState: { kind: 'read', method: 'image' },
    }),
    marked({ revisionDigest: D1, page: 1, clock: 4 }),
    marked({
      revisionDigest: D1,
      page: 2,
      clock: 5,
      readingState: { kind: 'read', method: 'image' },
    }),
  ];

  it('a version returned to after another needs reading again', () => {
    expect(readInFull(D1_READ)).toBe(true);
    const returned: UnitManifestRecord[] = [
      ...D1_READ,
      retiredRecord({ revisionDigest: D1, clock: 6 }),
      enumeratedRecord({ revisionDigest: D2, pages: [1], clock: 7 }),
      retiredRecord({ revisionDigest: D2, clock: 8 }),
      enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 9 }),
      // The text layer settles page 1 afresh; page 2 keeps the image reading made of these bytes.
      unitRecord({ revisionDigest: D1, page: 1, clock: 10 }),
    ];
    const pages = pagesOf(returned);
    expect(pages?.revisionDigest).toBe(D1);
    expect(pages?.knownRevisions).toEqual([D1, D2]);
    expect(pages?.history).toEqual([
      { page: 2, reading: 'read', outcomesExtracted: false },
      { page: 1, reading: 'read', outcomesExtracted: false },
    ]);
    expect(readInFull(returned)).toBe(false);
    // The projected page keeps its reading, and no mark made before the listing counts.
    const manifest = foldUnitManifests(returned).manifests.get(PATH);
    expect(manifest?.entries.map((entry) => entry.readingState.kind)).toEqual(['read', 'read']);
    expect(manifest?.entries.map((entry) => entry.outcomeExtractionState)).toEqual([
      undefined,
      undefined,
    ]);
    // Read in full again only once both pages are extracted again under the new listing.
    const page1Again = [...returned, marked({ revisionDigest: D1, page: 1, clock: 11 })];
    expect(readInFull(page1Again)).toBe(false);
    expect(
      readInFull([
        ...page1Again,
        marked({
          revisionDigest: D1,
          page: 2,
          clock: 12,
          readingState: { kind: 'read', method: 'image' },
        }),
      ]),
    ).toBe(true);
  });

  it('the same version listed again with no other version between keeps its marks', () => {
    // A second device enumerates the same bytes and settles its text page afresh, unmarked.
    const relisted: UnitManifestRecord[] = [
      ...D1_READ,
      enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 6, deviceId: 'device-b' }),
      unitRecord({ revisionDigest: D1, page: 1, clock: 7, deviceId: 'device-b' }),
    ];
    expect(readInFull(relisted)).toBe(true);
    const pages = pagesOf(relisted);
    expect(planOutcomeDelivery(pages, D1).standing).toBe('reread');
    // The file removed and restored unchanged: a retirement, then the same bytes listed again.
    const restored: UnitManifestRecord[] = [
      ...D1_READ,
      retiredRecord({ revisionDigest: D1, clock: 6, reason: 'source-removed' }),
      enumeratedRecord({ revisionDigest: D1, pages: [1, 2], clock: 7 }),
      unitRecord({ revisionDigest: D1, page: 1, clock: 8 }),
    ];
    expect(readInFull(restored)).toBe(true);
  });

  it('a version another device listed a newer version over counts no earlier mark', () => {
    // Device B listed D2 after D1's last listing, then removed it; D1 is still the live version.
    const records: UnitManifestRecord[] = [
      ...D1_READ,
      enumeratedRecord({ revisionDigest: D2, pages: [1], clock: 6, deviceId: 'device-b' }),
      retiredRecord({
        revisionDigest: D2,
        clock: 7,
        deviceId: 'device-b',
        reason: 'source-removed',
      }),
    ];
    const pages = pagesOf(records);
    expect(pages?.revisionDigest).toBe(D1);
    expect(readInFull(records)).toBe(false);
    expect(
      readInFull([
        ...records,
        marked({ revisionDigest: D1, page: 1, clock: 8 }),
        marked({
          revisionDigest: D1,
          page: 2,
          clock: 9,
          readingState: { kind: 'read', method: 'image' },
        }),
      ]),
    ).toBe(true);
  });

  it('once read in full under its listing, a later change to a page never reopens the version', () => {
    const changed = [
      ...D1_READ,
      unitRecord({
        revisionDigest: D1,
        page: 2,
        clock: 6,
        readingState: { kind: 'failed', reason: 'render-failed', retryable: false },
      }),
    ];
    expect(readInFull(changed)).toBe(true);
    expect(planOutcomeDelivery(pagesOf(changed), D1).standing).toBe('reread');
    expect(planOutcomeDelivery(pagesOf(changed), D2).standing).toBe('late');
  });
});
