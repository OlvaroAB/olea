/**
 * The reading record of a transcript, per part (`ol-egov.141.89.8.51`; D-448; PERSISTENCE 2.3).
 * Every string is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { readTranscriptText } from '../extract/transcript.js';
import {
  absenceGroundingFor,
  hasPendingUnits,
  isFullyRead,
  stableUnitId,
} from '../ingestion/unit-manifest/manifest.js';
import { createUnitManifestFold } from '../ingestion/unit-manifest/projection.js';
import {
  UNIT_MANIFEST_RECORD_VERSION,
  type UnitManifestRecord,
} from '../ingestion/unit-manifest/records.js';
import {
  transcriptEnumeration,
  transcriptPartsRead,
  transcriptPartsWaiting,
} from '../ingestion/unit-manifest/transcript-reading.js';
import type { UnitManifest } from '../ingestion/unit-manifest/types.js';
import type { VaultPath } from '../vault/types.js';

const PATH = 'Courses/SYNTH101/Lecture 3 transcript.txt' as VaultPath;
const DIGEST = 'digest-one';

/** Twelve paragraphs of 900 characters: two never fit one 1500-character part, so twelve parts. */
function twelvePartText(): string {
  return Array.from({ length: 12 }, (_, i) => `Topic ${i + 1} ${'word '.repeat(179)}`.trim()).join(
    '\n\n',
  );
}

let clock = 0;
function record(
  partial: Omit<
    UnitManifestRecord,
    'v' | 'deviceId' | 'clock' | 'at' | 'sourcePath' | 'revisionDigest'
  > & {
    [key: string]: unknown;
  },
): UnitManifestRecord {
  clock += 1;
  return {
    v: UNIT_MANIFEST_RECORD_VERSION,
    deviceId: 'olea-devicea0001',
    clock,
    at: '2026-10-02T10:00:00+00:00',
    sourcePath: PATH,
    revisionDigest: DIGEST,
    ...partial,
  } as UnitManifestRecord;
}

function manifestFor(partCount: number): {
  fold: ReturnType<typeof createUnitManifestFold>;
  live: () => UnitManifest;
} {
  const fold = createUnitManifestFold();
  fold.add(record({ kind: 'enumerated', pages: transcriptEnumeration(partCount).pages }));
  return {
    fold,
    live: () => {
      const manifest = fold.manifestOf(PATH);
      if (manifest === undefined) throw new Error('expected a live manifest');
      return manifest;
    },
  };
}

describe('the reading record of a transcript (ol-egov.141.89.8.51)', () => {
  it('each part carries a reading state, keyed by ordinal within one revision', () => {
    const read = readTranscriptText(twelvePartText(), 'plain-text');
    expect(read.ok && read.parts.length).toBe(12);
    const parts = read.ok ? read.parts.length : 0;

    const { fold, live } = manifestFor(parts);
    // Built from the bytes alone: every part is waiting, none is read, none is absent.
    expect(live().entries).toHaveLength(12);
    expect(live().entries.map((entry) => entry.page)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    for (const entry of live().entries) {
      expect(entry.readingState).toEqual({ kind: 'pending', reason: 'queued' });
      expect(entry.unitId).toBe(stableUnitId(PATH, entry.page));
      expect(absenceGroundingFor(entry)).toBe('unknown');
    }
    expect(hasPendingUnits(live())).toBe(true);
    expect(isFullyRead(live())).toBe(false);

    // A part reaches read, or failed with a reason, on its own, and the others keep their state.
    fold.add(
      record({
        kind: 'unit',
        unitId: stableUnitId(PATH, 2),
        page: 2,
        readingState: { kind: 'read', method: 'text-layer' },
        conceptExtractionState: 'not-started',
      }),
    );
    fold.add(
      record({
        kind: 'unit',
        unitId: stableUnitId(PATH, 3),
        page: 3,
        readingState: { kind: 'failed', reason: 'malformed-response-twice', retryable: true },
        conceptExtractionState: 'not-started',
      }),
    );
    const kinds = live().entries.map((entry) => entry.readingState.kind);
    expect(kinds[0]).toBe('pending');
    expect(kinds[1]).toBe('read');
    expect(kinds[2]).toBe('failed');
    expect(kinds.slice(3).every((kind) => kind === 'pending')).toBe(true);
  });

  it('the same bytes cut into the same parts, so the record keys do not move', () => {
    const a = readTranscriptText(twelvePartText(), 'plain-text');
    const b = readTranscriptText(twelvePartText(), 'plain-text');
    expect(a.ok && b.ok && a.parts.map((p) => p.range)).toEqual(
      a.ok && b.ok ? b.parts.map((p) => p.range) : null,
    );
  });

  it('an empty transcript has no parts: a finished read of nothing', () => {
    expect(transcriptEnumeration(0)).toEqual({ pages: [], settled: [] });
  });

  it('a read cut short by the per-read limit leaves the rest waiting, never silently', () => {
    const { fold, live } = manifestFor(12);
    // One concept read reaches the limit after five parts.
    const changes = transcriptPartsRead(live(), [1, 2, 3, 4, 5]);
    expect(changes.map((change) => change.page)).toEqual([1, 2, 3, 4, 5]);
    for (const change of changes) {
      fold.add(
        record({
          kind: 'unit',
          unitId: stableUnitId(PATH, change.page),
          page: change.page,
          readingState: change.readingState,
          conceptExtractionState: 'not-started',
        }),
      );
    }
    expect(transcriptPartsWaiting(live())).toBe(7);
    expect(hasPendingUnits(live())).toBe(true);
    expect(isFullyRead(live())).toBe(false);
    // Nothing anywhere says read or absent for a part that was not read.
    for (const entry of live().entries.slice(5)) {
      expect(entry.readingState.kind).toBe('pending');
      expect(absenceGroundingFor(entry)).toBe('unknown');
    }

    // The next read resumes from the waiting parts: the first five write nothing again.
    const resumed = transcriptPartsRead(live(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(resumed.map((change) => change.page)).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });

  it('an ordinal the manifest does not hold is ignored, never invented', () => {
    const { live } = manifestFor(3);
    expect(transcriptPartsRead(live(), [3, 4, 99]).map((change) => change.page)).toEqual([3]);
  });
});
