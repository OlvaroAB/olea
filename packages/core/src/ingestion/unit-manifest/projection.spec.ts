/**
 * The unit manifest projection (`[D-445]`, `ol-egov.141.89.8.43`), against David's ruling on row 26
 * of the 2026-09-29 sheet: append-only per-device records, separate reading and extraction states,
 * explicit revision retirement, unread or pending units unknown and never absent, and a rebuild after
 * deletion that never shows false completeness. Every string below is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { readRecordOf } from '../../gap/coverage.js';
import { reasonForUnitManifest } from '../../source/unreadable.js';
import { enumeratedRecord, retiredRecord, SYNTH_SOURCE_PATH, unitRecord } from './fixtures.js';
import { absenceGroundingFor, hasPendingUnits, isFullyRead, stableUnitId } from './manifest.js';
import {
  createUnitManifestFold,
  foldUnitManifests,
  manifestsWithUnknown,
  nextUnitManifestClock,
  UNENUMERATED_UNIT_PAGE,
  UNVERIFIED_REVISION_DIGEST,
  unknownUnitManifest,
} from './projection.js';
import type { UnitManifestRecord } from './records.js';
import type { UnitManifest } from './types.js';

const PATH = SYNTH_SOURCE_PATH;
const OTHER = '03 Research/SYNTH101 Scan.png';

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

function manifestOf(records: readonly UnitManifestRecord[], path = PATH): UnitManifest {
  const manifest = foldUnitManifests(records).manifests.get(path);
  if (manifest === undefined) throw new Error(`expected a manifest for ${path}`);
  return manifest;
}

describe('unread or pending units are unknown, never absent', () => {
  it('a page the enumeration names but no state record mentions reads pending, in the manifest', () => {
    const manifest = manifestOf([enumeratedRecord({ pages: [1, 2, 3] })]);
    expect(manifest.entries.map((e) => e.page)).toEqual([1, 2, 3]);
    for (const entry of manifest.entries) {
      expect(entry.readingState).toEqual({ kind: 'pending', reason: 'queued' });
      expect(entry.conceptExtractionState).toBe('not-started');
      expect(absenceGroundingFor(entry)).toBe('unknown');
    }
    expect(isFullyRead(manifest)).toBe(false);
    expect(hasPendingUnits(manifest)).toBe(true);
  });

  it('a crash after two of five pages landed leaves the other three pending, not missing', () => {
    // The enumeration was written first and whole; only the state records were cut short.
    const manifest = manifestOf([
      enumeratedRecord({ pages: [1, 2, 3, 4, 5], clock: 1 }),
      unitRecord({ page: 1, clock: 2 }),
      unitRecord({ page: 2, clock: 3 }),
    ]);
    expect(manifest.entries).toHaveLength(5);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual([
      'read',
      'read',
      'pending',
      'pending',
      'pending',
    ]);
    expect(isFullyRead(manifest)).toBe(false);
  });

  it('state records for a revision nothing enumerated make no manifest: those readings are unknown', () => {
    const projection = foldUnitManifests([
      unitRecord({ page: 1 }),
      unitRecord({ page: 2, clock: 2 }),
    ]);
    expect(projection.manifests.has(PATH)).toBe(false);
    // A consumer is handed the unknown manifest, so the source is neither read nor absent.
    const handed = manifestsWithUnknown(projection.manifests, [PATH]).get(PATH);
    expect(handed).toEqual(unknownUnitManifest(PATH));
  });

  it('a partial, failed or unavailable unit never grounds an absence either', () => {
    const manifest = manifestOf([
      enumeratedRecord({ pages: [1, 2, 3, 4] }),
      unitRecord({
        page: 1,
        clock: 2,
        readingState: { kind: 'partial', method: 'image', coverage: 'synthetic' },
      }),
      unitRecord({ page: 2, clock: 3, readingState: { kind: 'unavailable' } }),
      unitRecord({
        page: 3,
        clock: 4,
        readingState: { kind: 'failed', reason: 'render-failed', retryable: true },
      }),
      unitRecord({ page: 4, clock: 5, readingState: { kind: 'read', method: 'text-layer' } }),
    ]);
    expect(manifest.entries.map((e) => absenceGroundingFor(e))).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'groundable',
    ]);
  });
});

describe('pending is not empty', () => {
  it('a source enumerated with no pages is a known, empty manifest; a source never enumerated is unknown', () => {
    const empty = manifestOf([enumeratedRecord({ pages: [] })]);
    expect(empty.entries).toEqual([]);
    expect(reasonForUnitManifest(empty)).toBeNull(); // nothing to classify: excluded
    expect(readRecordOf(empty)).toBeNull(); // the extractor's verdict stands: nothing in it

    const unknown = unknownUnitManifest(OTHER);
    expect(reasonForUnitManifest(unknown)).toBe('not-settled');
    expect(readRecordOf(unknown)).toMatchObject({
      readState: 'not-attempted',
      readingCompleteness: 'unsettled',
      conceptExtraction: 'unfinished',
    });
  });

  it('the unknown manifest is one pending unit on a page that is not a page', () => {
    const unknown = unknownUnitManifest(OTHER);
    expect(unknown.revisionDigest).toBe(UNVERIFIED_REVISION_DIGEST);
    expect(unknown.entries).toHaveLength(1);
    expect(unknown.entries[0]).toMatchObject({
      page: UNENUMERATED_UNIT_PAGE,
      unitId: stableUnitId(OTHER, UNENUMERATED_UNIT_PAGE),
      readingState: { kind: 'pending', reason: 'queued' },
      conceptExtractionState: 'not-started',
    });
    expect(isFullyRead(unknown)).toBe(false);
    expect(hasPendingUnits(unknown)).toBe(true);
    expect(absenceGroundingFor(unknown.entries[0] as never)).toBe('unknown');
  });

  it('manifestsWithUnknown hands every asked path a manifest and never invents a read one', () => {
    const live = foldUnitManifests([
      enumeratedRecord({ pages: [1] }),
      unitRecord({ clock: 2 }),
    ]).manifests;
    const handed = manifestsWithUnknown(live, [PATH, OTHER]);
    expect([...handed.keys()]).toEqual([PATH, OTHER]);
    expect(isFullyRead(handed.get(PATH) as UnitManifest)).toBe(true);
    expect(isFullyRead(handed.get(OTHER) as UnitManifest)).toBe(false);
  });
});

describe('reading and extraction stay two fields through the fold', () => {
  it('a later reading record does not complete extraction, and a later extraction record does not change the reading', () => {
    const afterReading = manifestOf([
      enumeratedRecord({ pages: [1] }),
      unitRecord({
        clock: 2,
        readingState: { kind: 'read', method: 'text-layer' },
        conceptExtractionState: 'not-started',
      }),
    ]);
    expect(afterReading.entries[0]).toMatchObject({
      readingState: { kind: 'read' },
      conceptExtractionState: 'not-started',
    });

    const afterExtraction = manifestOf([
      enumeratedRecord({ pages: [1] }),
      unitRecord({
        clock: 2,
        readingState: { kind: 'read', method: 'text-layer' },
        conceptExtractionState: 'not-started',
      }),
      unitRecord({
        clock: 3,
        readingState: { kind: 'read', method: 'text-layer' },
        conceptExtractionState: 'complete',
      }),
    ]);
    expect(afterExtraction.entries[0]).toMatchObject({
      readingState: { kind: 'read', method: 'text-layer' },
      conceptExtractionState: 'complete',
    });
    expect(readRecordOf(afterExtraction)).toMatchObject({
      readingCompleteness: 'full',
      conceptExtraction: 'complete',
    });
    expect(readRecordOf(afterReading)).toMatchObject({
      readingCompleteness: 'full',
      conceptExtraction: 'unfinished',
    });
  });

  it('a partial then a later read on the same page is one unit, not two', () => {
    const manifest = manifestOf([
      enumeratedRecord({ pages: [1] }),
      unitRecord({
        clock: 2,
        readingState: { kind: 'partial', method: 'image', coverage: 'synthetic' },
      }),
      unitRecord({ clock: 3, readingState: { kind: 'read', method: 'image' } }),
    ]);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.readingState.kind).toBe('read');
  });
});

describe('append-only: every state ever written stays input, and the latest per page wins', () => {
  it('a later record for a page replaces the earlier in the projection while both remain in the records', () => {
    const records = [
      enumeratedRecord({ pages: [1] }),
      unitRecord({ clock: 2, readingState: { kind: 'unavailable' } }),
      unitRecord({ clock: 3, readingState: { kind: 'read', method: 'image' } }),
    ];
    expect(records).toHaveLength(3);
    expect(manifestOf(records).entries[0]?.readingState.kind).toBe('read');
    // Dropping the newest record (say it never synced) returns to the earlier truth, never to complete.
    expect(manifestOf(records.slice(0, 2)).entries[0]?.readingState.kind).toBe('unavailable');
  });

  it('the projection is the same whatever order the records arrive in', () => {
    const records: UnitManifestRecord[] = [
      enumeratedRecord({ pages: [1, 2, 3], clock: 1 }),
      unitRecord({ page: 1, clock: 2 }),
      unitRecord({ page: 2, clock: 3, readingState: { kind: 'unavailable' } }),
      unitRecord({ page: 2, clock: 5, readingState: { kind: 'read', method: 'image' } }),
      unitRecord({
        page: 3,
        clock: 4,
        readingState: { kind: 'partial', method: 'image', coverage: 'synthetic' },
      }),
      unitRecord({ page: 1, clock: 6, conceptExtractionState: 'complete' }),
      enumeratedRecord({ sourcePath: OTHER, pages: [1], clock: 7, deviceId: 'device-b' }),
    ];
    const expected = foldUnitManifests(records);
    for (let seed = 1; seed <= 25; seed++) {
      const got = foldUnitManifests(shuffled(records, seed));
      expect([...got.manifests]).toEqual([...expected.manifests]);
      expect(got.maxClock).toBe(expected.maxClock);
    }
  });

  it('folding a record twice is folding it once', () => {
    const records = [enumeratedRecord({ pages: [1] }), unitRecord({ clock: 2 })];
    expect(foldUnitManifests([...records, ...records]).manifests).toEqual(
      foldUnitManifests(records).manifests,
    );
  });

  it('the incremental fold agrees with the whole fold after every record', () => {
    const records: UnitManifestRecord[] = [
      enumeratedRecord({ pages: [1, 2], clock: 1 }),
      unitRecord({ page: 1, clock: 2 }),
      retiredRecord({ clock: 3 }),
      enumeratedRecord({ revisionDigest: 'rev-2', pages: [1], clock: 4 }),
      unitRecord({ revisionDigest: 'rev-2', page: 1, clock: 5 }),
    ];
    const fold = createUnitManifestFold();
    records.forEach((record, index) => {
      fold.add(record);
      expect(fold.project()).toEqual(foldUnitManifests(records.slice(0, index + 1)));
      expect(fold.manifestOf(PATH)).toEqual(
        foldUnitManifests(records.slice(0, index + 1)).manifests.get(PATH),
      );
    });
  });
});

describe('concurrent devices', () => {
  it('two devices reading different pages offline fold to both readings, in either file order', () => {
    const deviceA: UnitManifestRecord[] = [
      enumeratedRecord({ pages: [1, 2], clock: 1, deviceId: 'device-a' }),
      unitRecord({ page: 1, clock: 2, deviceId: 'device-a' }),
    ];
    const deviceB: UnitManifestRecord[] = [
      enumeratedRecord({ pages: [1, 2], clock: 1, deviceId: 'device-b' }),
      unitRecord({
        page: 2,
        clock: 2,
        deviceId: 'device-b',
        readingState: { kind: 'read', method: 'image' },
      }),
    ];
    const ab = manifestOf([...deviceA, ...deviceB]);
    const ba = manifestOf([...deviceB, ...deviceA]);
    expect(ab).toEqual(ba);
    expect(ab.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read']);
  });

  it('equal clocks resolve by device id, the same way in either order', () => {
    const a = unitRecord({
      page: 1,
      clock: 7,
      deviceId: 'device-a',
      readingState: { kind: 'unavailable' },
    });
    const b = unitRecord({
      page: 1,
      clock: 7,
      deviceId: 'device-b',
      readingState: { kind: 'read', method: 'image' },
    });
    const base = enumeratedRecord({ pages: [1], clock: 1 });
    expect(manifestOf([base, a, b]).entries[0]?.readingState.kind).toBe('read');
    expect(manifestOf([base, b, a]).entries[0]?.readingState.kind).toBe('read');
  });

  it('two devices that enumerated the same revision with different page lists fold to the union, never the intersection', () => {
    const one = enumeratedRecord({ pages: [1, 2], clock: 1, deviceId: 'device-a' });
    const other = enumeratedRecord({ pages: [2, 3], clock: 2, deviceId: 'device-b' });
    expect(manifestOf([one, other]).entries.map((e) => e.page)).toEqual([1, 2, 3]);
    expect(manifestOf([other, one]).entries.map((e) => e.page)).toEqual([1, 2, 3]);
  });

  it('two distinct records with the same clock and device still fold the same in either order', () => {
    const base = enumeratedRecord({ pages: [1], clock: 1 });
    const x = unitRecord({ page: 1, clock: 4, readingState: { kind: 'unavailable' } });
    const y = unitRecord({ page: 1, clock: 4, readingState: { kind: 'read', method: 'image' } });
    expect(manifestOf([base, x, y])).toEqual(manifestOf([base, y, x]));
  });

  it('a clock, not wall time, orders records: an older wall time with a higher clock wins', () => {
    const later = unitRecord({
      page: 1,
      clock: 9,
      at: '2026-01-01T00:00:00+10:00',
      readingState: { kind: 'read', method: 'image' },
    });
    const earlier = unitRecord({
      page: 1,
      clock: 3,
      at: '2026-12-31T00:00:00+10:00',
      readingState: { kind: 'unavailable' },
    });
    expect(
      manifestOf([enumeratedRecord({ pages: [1] }), earlier, later]).entries[0]?.readingState.kind,
    ).toBe('read');
  });

  it('maxClock is the highest clock seen anywhere, retired and superseded records included, so the next stamp is above all of them', () => {
    const projection = foldUnitManifests([
      enumeratedRecord({ clock: 4 }),
      retiredRecord({ clock: 11 }),
      unitRecord({ clock: 6 }),
    ]);
    expect(projection.maxClock).toBe(11);
    expect(nextUnitManifestClock(projection.maxClock)).toBe(12);
    expect(nextUnitManifestClock(0)).toBe(1);
  });
});

describe('explicit revision retirement', () => {
  const rev1 = [
    enumeratedRecord({ pages: [1, 2], clock: 1 }),
    unitRecord({ page: 1, clock: 2 }),
    unitRecord({ page: 2, clock: 3 }),
  ];

  it('a retired revision leaves the projection: the source is unknown until enumerated again', () => {
    expect(isFullyRead(manifestOf(rev1))).toBe(true);
    const projection = foldUnitManifests([...rev1, retiredRecord({ clock: 4 })]);
    expect(projection.manifests.has(PATH)).toBe(false);
    expect(
      hasPendingUnits(manifestsWithUnknown(projection.manifests, [PATH]).get(PATH) as UnitManifest),
    ).toBe(true);
  });

  it('a new revision, once enumerated, is what the projection holds; the old revision stays on disk but never shows', () => {
    const records = [
      ...rev1,
      retiredRecord({ clock: 4 }),
      enumeratedRecord({ revisionDigest: 'rev-2', pages: [1, 2, 3], clock: 5 }),
    ];
    const manifest = manifestOf(records);
    expect(manifest.revisionDigest).toBe('rev-2');
    // None of rev-1's readings carry over to bytes they were not made from.
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('a revision is retired by a later enumeration of another even when no retirement was written', () => {
    const manifest = manifestOf([
      ...rev1,
      enumeratedRecord({ revisionDigest: 'rev-2', pages: [1], clock: 9, deviceId: 'device-b' }),
    ]);
    expect(manifest.revisionDigest).toBe('rev-2');
    expect(manifest.entries).toHaveLength(1);
  });

  it('a state record written late for a retired revision cannot bring it back', () => {
    const manifest = manifestOf([
      ...rev1,
      retiredRecord({ clock: 4 }),
      enumeratedRecord({ revisionDigest: 'rev-2', pages: [1], clock: 5 }),
      // A slow device finishes a reading of the old bytes after the new revision was enumerated.
      unitRecord({ page: 1, clock: 50, readingState: { kind: 'read', method: 'image' } }),
    ]);
    expect(manifest.revisionDigest).toBe('rev-2');
    expect(manifest.entries[0]?.readingState.kind).toBe('pending');
  });

  it('a retirement is ordered: a source reverted to bytes it once had is live again, with the readings already made of them', () => {
    const manifest = manifestOf([
      ...rev1,
      retiredRecord({ clock: 4 }),
      enumeratedRecord({ revisionDigest: 'rev-2', pages: [1], clock: 5 }),
      retiredRecord({ revisionDigest: 'rev-2', clock: 6 }),
      // She restored the earlier file: it is enumerated again, after both retirements.
      enumeratedRecord({ pages: [1, 2], clock: 7 }),
    ]);
    expect(manifest.revisionDigest).toBe('rev-1');
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read']);
  });

  it('a removal retires the revision and leaves the source unknown, not read', () => {
    const projection = foldUnitManifests([
      ...rev1,
      retiredRecord({ clock: 4, reason: 'source-removed' }),
    ]);
    expect(projection.manifests.size).toBe(0);
  });

  it('a retirement never touches another path or another revision', () => {
    const projection = foldUnitManifests([
      ...rev1,
      enumeratedRecord({ sourcePath: OTHER, pages: [1], clock: 2 }),
      retiredRecord({ revisionDigest: 'some-other-rev', clock: 8 }),
    ]);
    expect(projection.manifests.has(PATH)).toBe(true);
    expect(projection.manifests.has(OTHER)).toBe(true);
  });
});

describe('deletion and rebuild never show false completeness', () => {
  const settledSource: UnitManifestRecord[] = [
    enumeratedRecord({ pages: [1, 2, 3], clock: 1 }),
    unitRecord({ page: 1, clock: 2, conceptExtractionState: 'complete' }),
    unitRecord({ page: 2, clock: 3, conceptExtractionState: 'complete' }),
    unitRecord({
      page: 3,
      clock: 4,
      readingState: { kind: 'read', method: 'image' },
      conceptExtractionState: 'not-started',
    }),
  ];

  it('before the deletion the source reads finished', () => {
    const manifest = manifestOf(settledSource);
    expect(isFullyRead(manifest)).toBe(true);
    expect(hasPendingUnits(manifest)).toBe(false);
  });

  it('after the folder is deleted every source reads unknown, on every reader the census and coverage use', () => {
    const afterDeletion = foldUnitManifests([]);
    expect(afterDeletion.manifests.size).toBe(0);
    expect(afterDeletion.maxClock).toBe(0);

    const handed = manifestsWithUnknown(afterDeletion.manifests, [PATH, OTHER]);
    for (const path of [PATH, OTHER]) {
      const manifest = handed.get(path) as UnitManifest;
      expect(isFullyRead(manifest)).toBe(false);
      expect(hasPendingUnits(manifest)).toBe(true);
      expect(reasonForUnitManifest(manifest)).toBe('not-settled');
      const recorded = readRecordOf(manifest);
      expect(recorded?.readState).toBe('not-attempted');
      expect(recorded?.readingCompleteness).toBe('unsettled');
      expect(recorded?.conceptExtraction).toBe('unfinished');
    }
  });

  it('a partly rebuilt store (the enumeration back, the readings not) is still unfinished, page by page', () => {
    // The text-layer pages are re-derived at once; the image page waits for its reading again.
    const rebuilt = manifestOf([
      enumeratedRecord({ pages: [1, 2, 3], clock: 20 }),
      unitRecord({ page: 1, clock: 21 }),
      unitRecord({ page: 2, clock: 22 }),
    ]);
    expect(isFullyRead(rebuilt)).toBe(false);
    expect(readRecordOf(rebuilt)).toMatchObject({
      readState: 'read',
      readingCompleteness: 'unsettled',
      conceptExtraction: 'unfinished',
    });
    expect(rebuilt.entries.map((e) => absenceGroundingFor(e))).toEqual([
      'groundable',
      'groundable',
      'unknown',
    ]);
  });

  it('the rebuilt state never reports extraction complete: that fact does not come back with the enumeration', () => {
    const rebuilt = manifestOf([
      enumeratedRecord({ pages: [1, 2], clock: 20 }),
      unitRecord({ page: 1, clock: 21 }),
      unitRecord({ page: 2, clock: 22 }),
    ]);
    expect(rebuilt.entries.every((e) => e.conceptExtractionState === 'not-started')).toBe(true);
    expect(readRecordOf(rebuilt)?.conceptExtraction).toBe('unfinished');
  });

  it('deleting only some devices files loses only what those files held', () => {
    const deviceB: UnitManifestRecord[] = [
      enumeratedRecord({ pages: [1, 2], clock: 1, deviceId: 'device-b' }),
      unitRecord({
        page: 2,
        clock: 2,
        deviceId: 'device-b',
        readingState: { kind: 'read', method: 'image' },
      }),
    ];
    const deviceA: UnitManifestRecord[] = [unitRecord({ page: 1, clock: 3, deviceId: 'device-a' })];
    // With device A's file gone the manifest still lists both pages; page 1 falls back to pending.
    const manifest = manifestOf(deviceB);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual(['pending', 'read']);
    expect(manifestOf([...deviceB, ...deviceA]).entries.map((e) => e.readingState.kind)).toEqual([
      'read',
      'read',
    ]);
  });
});
