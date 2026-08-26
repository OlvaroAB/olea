/**
 * The provenance stamp: present on every record, and — the part that matters —
 * still present after every transformation a record can undergo on its way
 * through the system.
 *
 * A stamp that a `JSON.parse` → schema-validate round trip erases is worse than
 * no stamp, because it looks like a control right up until the moment somebody
 * needs it. So the assertions below deliberately follow the record through
 * `olea-core`'s parser, through the v2 union, and through a merge with a
 * real-shaped record, and check the stamp survives each.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { mergeReviewLogRecords, parseReviewLog } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  assertNoSyntheticRecords,
  generateStream,
  isSyntheticRecord,
  PERSONA_IDS,
  SYNTHETIC_EVENT_ID_PREFIX,
  SYNTHETIC_GENERATOR,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_ID_PREFIX,
  SYNTHETIC_NOTICE,
  streamSpec,
  toJsonl,
  twoDeviceSameDayStreams,
} from '../src/index.js';

const STREAMS = PERSONA_IDS.map((persona) =>
  generateStream(
    streamSpec(persona, 'provenance', { days: persona === 'single-session' ? 1 : 60 }),
  ),
);

/** A record with the same shape as a real one: contracts-valid, and not ours. */
const REAL_SHAPED: ReviewLogEntry = {
  schemaVersion: 5,
  kind: 'review',
  eventId: '0f0b8b0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
  timestamp: '2027-02-01T19:00:00.000+01:00',
  instrumentId: 'some-instrument',
  instrumentType: 'qa',
  conceptIds: ['some-concept'],
  rating: 'good',
  wasUnsure: false,
  durationMs: 4200,
  selectionContext: {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['qa'],
    planVersion: null,
  },
};

describe('synthetic provenance', () => {
  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: every entry carries the stamp',
    (_persona, stream) => {
      for (const entry of stream.entries) {
        expect(entry.eventId.startsWith(SYNTHETIC_EVENT_ID_PREFIX)).toBe(true);
        expect(isSyntheticRecord(entry)).toBe(true);
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: the stream manifest names the generator, its version, the persona and the seed',
    (_persona, stream) => {
      expect(stream.provenance).toEqual({
        generator: SYNTHETIC_GENERATOR,
        generatorVersion: SYNTHETIC_GENERATOR_VERSION,
        persona: stream.spec.persona,
        seed: stream.spec.seed,
        notice: SYNTHETIC_NOTICE,
      });
    },
  );

  it('every invented concept and instrument id is namespaced too', () => {
    for (const stream of STREAMS) {
      for (const entry of stream.entries) {
        for (const conceptId of entry.conceptIds) {
          expect(conceptId.startsWith(SYNTHETIC_ID_PREFIX)).toBe(true);
        }
        expect(entry.instrumentId.startsWith(SYNTHETIC_ID_PREFIX)).toBe(true);
      }
    }
  });

  it('the stamp survives a JSONL round trip through core’s parser', () => {
    const stream = generateStream(streamSpec('struggler', 'roundtrip', { days: 30 }));
    const { records, invalidLines } = parseReviewLog(toJsonl(stream.entries));
    expect(invalidLines).toEqual([]);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(isSyntheticRecord(record)).toBe(true);
  });

  it('the stamp survives a merge with real-shaped records, and only ours are flagged', () => {
    const stream = generateStream(streamSpec('steady-reviewer', 'merge-stamp', { days: 20 }));
    const merged = mergeReviewLogRecords(stream.entries, [REAL_SHAPED]);
    expect(merged.records).toHaveLength(stream.entries.length + 1);
    const flagged = merged.records.filter(isSyntheticRecord);
    expect(flagged).toHaveLength(stream.entries.length);
    expect(isSyntheticRecord(REAL_SHAPED)).toBe(false);
  });

  it('assertNoSyntheticRecords lets a real log through and stops a poisoned one', () => {
    const stream = generateStream(streamSpec('steady-reviewer', 'poison', { days: 20 }));
    expect(stream.entries.length).toBeGreaterThan(0);
    expect(() => assertNoSyntheticRecords([REAL_SHAPED], "today's vault log")).not.toThrow();
    expect(() =>
      assertNoSyntheticRecords([REAL_SHAPED, ...stream.entries], "today's vault log"),
    ).toThrow(/synthetic record\(s\) found in today's vault log/);
  });

  it('both devices of the two-device fixture are stamped', () => {
    const { deviceA, deviceB } = twoDeviceSameDayStreams('provenance-two-device');
    for (const entry of [...deviceA.entries, ...deviceB.entries]) {
      expect(isSyntheticRecord(entry)).toBe(true);
    }
  });
});
