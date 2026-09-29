/**
 * The persisted records of the unit manifest store (`[D-445]`, `ol-egov.141.89.8.43`): the shape a
 * line takes, the round trip (INV-2), and what a reader does with a line it cannot vouch for.
 * Every string below is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { SYNTH_SOURCE_PATH, unitRecord } from './fixtures.js';
import { stableUnitId } from './manifest.js';
import {
  parseUnitManifestLog,
  parseUnitManifestRecord,
  parseUnitReadingState,
  sameUnitReadingState,
  serialiseUnitManifestRecord,
  UNIT_MANIFEST_RECORD_VERSION,
  type UnitManifestRecord,
} from './records.js';
import type { UnitReadingState } from './types.js';

const PATH = SYNTH_SOURCE_PATH;
const PROVENANCE = {
  task: 'vision.extract',
  promptVersion: 'v2-test',
  modelIdentity: 'synthetic-model',
  imageDigest: 'sha256-of-image-bytes',
};

const EVERY_READING_STATE: readonly UnitReadingState[] = [
  { kind: 'read', method: 'text-layer' },
  { kind: 'read', method: 'image', provenance: PROVENANCE },
  { kind: 'read', method: 'text-and-image', provenance: PROVENANCE },
  {
    kind: 'partial',
    method: 'image',
    coverage: 'the upper half of the page',
    provenance: PROVENANCE,
  },
  { kind: 'partial', method: 'text-layer', coverage: 'a synthetic coverage note' },
  { kind: 'unreadable', reason: 'blank-page' },
  { kind: 'unreadable', reason: 'not-legible', provenance: PROVENANCE },
  { kind: 'unreadable', reason: 'no-text-on-page' },
  { kind: 'pending', reason: 'queued' },
  { kind: 'pending', reason: 'budget' },
  { kind: 'unavailable' },
  { kind: 'failed', reason: 'render-failed', retryable: true },
  { kind: 'failed', reason: 'malformed-response-twice', retryable: false },
];

describe('the three record kinds round-trip byte for byte (INV-2)', () => {
  const records: readonly UnitManifestRecord[] = [
    {
      v: UNIT_MANIFEST_RECORD_VERSION,
      kind: 'enumerated',
      deviceId: 'device-a',
      clock: 1,
      at: '2026-09-29T10:00:00+10:00',
      sourcePath: PATH,
      revisionDigest: 'rev-1',
      pages: [1, 2, 3],
    },
    {
      v: UNIT_MANIFEST_RECORD_VERSION,
      kind: 'enumerated',
      deviceId: 'device-a',
      clock: 2,
      at: '2026-09-29T10:00:00+10:00',
      sourcePath: PATH,
      revisionDigest: 'rev-0-empty',
      pages: [],
    },
    {
      v: UNIT_MANIFEST_RECORD_VERSION,
      kind: 'retired',
      deviceId: 'device-b',
      clock: 3,
      at: '2026-09-29T10:00:00+10:00',
      sourcePath: PATH,
      revisionDigest: 'rev-1',
      reason: 'superseded',
    },
    {
      v: UNIT_MANIFEST_RECORD_VERSION,
      kind: 'retired',
      deviceId: 'device-b',
      clock: 4,
      at: '2026-09-29T10:00:00+10:00',
      sourcePath: PATH,
      revisionDigest: 'rev-1',
      reason: 'source-removed',
    },
    ...EVERY_READING_STATE.map((readingState, index) =>
      unitRecord({ clock: 10 + index, page: 1 + index, readingState }),
    ),
    unitRecord({ clock: 40, conceptExtractionState: 'complete' }),
  ];

  it('serialises to one newline-terminated line and parses back to an equal record', () => {
    for (const record of records) {
      const line = serialiseUnitManifestRecord(record);
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toContain('\n');
      expect(parseUnitManifestRecord(JSON.parse(line))).toEqual(record);
    }
  });

  it('a whole file re-serialises to the identical bytes it was read from', () => {
    const file = records.map(serialiseUnitManifestRecord).join('');
    const parsed = parseUnitManifestLog(file);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map(serialiseUnitManifestRecord).join('')).toBe(file);
  });

  it('fixes key order, so a line written with its keys shuffled is read back canonical', () => {
    const shuffled = JSON.stringify({
      readingState: {
        method: 'image',
        provenance: { imageDigest: 'd', modelIdentity: 'm', promptVersion: 'p', task: 't' },
        kind: 'read',
      },
      conceptExtractionState: 'not-started',
      page: 2,
      unitId: stableUnitId(PATH, 2),
      revisionDigest: 'rev-1',
      sourcePath: PATH,
      at: '2026-09-29T10:00:00+10:00',
      clock: 5,
      deviceId: 'device-a',
      kind: 'unit',
      v: 1,
    });
    const parsed = parseUnitManifestLog(`${shuffled}\n`);
    expect(parsed.records).toHaveLength(1);
    const canonical = serialiseUnitManifestRecord(parsed.records[0] as UnitManifestRecord);
    expect(canonical.startsWith('{"v":1,"kind":"unit","deviceId":"device-a","clock":5,')).toBe(
      true,
    );
    expect(canonical).toContain(
      '"readingState":{"kind":"read","method":"image","provenance":{"task":"t","promptVersion":"p","modelIdentity":"m","imageDigest":"d"}}',
    );
  });
});

describe('reading and extraction are two fields on every unit record', () => {
  it('a record with a finished reading and no extraction says exactly that', () => {
    const record = unitRecord({ readingState: { kind: 'read', method: 'text-layer' } });
    expect(record.conceptExtractionState).toBe('not-started');
    const back = parseUnitManifestRecord(JSON.parse(serialiseUnitManifestRecord(record)));
    expect(back).toMatchObject({
      readingState: { kind: 'read' },
      conceptExtractionState: 'not-started',
    });
  });

  it('a record missing either field is not a record', () => {
    const line = JSON.parse(serialiseUnitManifestRecord(unitRecord())) as Record<string, unknown>;
    const { conceptExtractionState: _e, ...withoutExtraction } = line;
    const { readingState: _r, ...withoutReading } = line;
    expect(parseUnitManifestRecord(withoutExtraction)).toBeNull();
    expect(parseUnitManifestRecord(withoutReading)).toBeNull();
  });
});

describe('a line this build cannot vouch for is reported and skipped, never thrown, never guessed at', () => {
  const good = serialiseUnitManifestRecord(unitRecord());

  it.each([
    ['another version', { ...JSON.parse(good), v: 2 }],
    ['an unknown kind', { ...JSON.parse(good), kind: 'moved' }],
    ['a clock of zero', { ...JSON.parse(good), clock: 0 }],
    ['a fractional clock', { ...JSON.parse(good), clock: 1.5 }],
    ['an unknown extraction state', { ...JSON.parse(good), conceptExtractionState: 'partial' }],
    ['an unknown reading kind', { ...JSON.parse(good), readingState: { kind: 'skimmed' } }],
    [
      'an unknown unreadable reason',
      { ...JSON.parse(good), readingState: { kind: 'unreadable', reason: 'smudged' } },
    ],
    ['a read with no method', { ...JSON.parse(good), readingState: { kind: 'read' } }],
    [
      'a failed state with no retryable flag',
      { ...JSON.parse(good), readingState: { kind: 'failed', reason: 'render-failed' } },
    ],
    ['page zero', { ...JSON.parse(good), page: 0, unitId: stableUnitId(PATH, 0) }],
    ['a unit id that is not the path and page', { ...JSON.parse(good), unitId: 'some-other-id' }],
    ['an empty digest', { ...JSON.parse(good), revisionDigest: '' }],
  ])('rejects %s', (_label, json) => {
    expect(parseUnitManifestRecord(json)).toBeNull();
  });

  it('rejects an enumeration whose pages are not ascending distinct positive integers', () => {
    const base = {
      v: 1,
      kind: 'enumerated',
      deviceId: 'device-a',
      clock: 1,
      at: '2026-09-29T10:00:00+10:00',
      sourcePath: PATH,
      revisionDigest: 'rev-1',
    };
    expect(parseUnitManifestRecord({ ...base, pages: [1, 2, 3] })).not.toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: [] })).not.toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: [2, 1] })).toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: [1, 1] })).toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: [0, 1] })).toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: [1, 2.5] })).toBeNull();
    expect(parseUnitManifestRecord({ ...base, pages: 'all' })).toBeNull();
  });

  it('parseUnitReadingState refuses a bad provenance rather than dropping it', () => {
    expect(
      parseUnitReadingState({ kind: 'read', method: 'image', provenance: { task: 't' } }),
    ).toBeNull();
    expect(parseUnitReadingState('read')).toBeNull();
    expect(parseUnitReadingState(null)).toBeNull();
  });

  it('a torn last line costs that one record and no other', () => {
    const second = serialiseUnitManifestRecord(unitRecord({ clock: 2, page: 2 }));
    const torn = `${good}${second.slice(0, 40)}`;
    const parsed = parseUnitManifestLog(torn);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.invalidLines).toHaveLength(1);
    expect(parsed.invalidLines[0]?.lineNumber).toBe(2);
  });

  it('tolerates CRLF and blank lines, and reports nothing for them', () => {
    const parsed = parseUnitManifestLog(`${good.trimEnd()}\r\n\r\n${good}`);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.invalidLines).toEqual([]);
  });

  it('an empty file has no records and no invalid lines', () => {
    expect(parseUnitManifestLog('')).toEqual({ records: [], invalidLines: [] });
  });
});

describe('sameUnitReadingState compares the state, not the order its keys were built in', () => {
  it('is true for one state built two ways, and false for a different reading of the same kind', () => {
    const a: UnitReadingState = { kind: 'read', method: 'image', provenance: PROVENANCE };
    const b = {
      provenance: {
        imageDigest: PROVENANCE.imageDigest,
        modelIdentity: PROVENANCE.modelIdentity,
        promptVersion: PROVENANCE.promptVersion,
        task: PROVENANCE.task,
      },
      method: 'image',
      kind: 'read',
    } as UnitReadingState;
    expect(sameUnitReadingState(a, b)).toBe(true);
    expect(
      sameUnitReadingState(a, { kind: 'read', method: 'text-and-image', provenance: PROVENANCE }),
    ).toBe(false);
    expect(
      sameUnitReadingState(a, {
        kind: 'partial',
        method: 'image',
        coverage: 'c',
        provenance: PROVENANCE,
      }),
    ).toBe(false);
    expect(sameUnitReadingState({ kind: 'unavailable' }, { kind: 'unavailable' })).toBe(true);
  });
});
