/**
 * Every emitted record is a valid D7.1 record — validated against the frozen
 * contract itself (`olea-contracts`), not against a local copy of what we think
 * it says.
 *
 * The round-trip half matters as much as the validation half. A record that
 * passes `safeParse` can still carry keys zod silently strips, and a stream
 * whose bytes do not survive `toJsonl` → `parseReviewLog` is not a fixture of
 * anything a real reader will ever see. So both directions are checked here,
 * through `olea-core`'s actual parser.
 */

import { REVIEW_LOG_SCHEMA_VERSION, reviewLogEntry, suspendLogRecord } from 'olea-contracts';
import { parseReviewLog } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  generateStream,
  PERSONA_IDS,
  reviewsOf,
  streamSpec,
  toJsonl,
  twoDeviceSameDayStreams,
} from '../src/index.js';

const STREAMS = PERSONA_IDS.map((persona) =>
  generateStream(streamSpec(persona, 'contract', { days: persona === 'single-session' ? 1 : 90 })),
);

describe('contract validity', () => {
  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: every entry validates against the frozen review-log union',
    (_persona, stream) => {
      for (const entry of stream.entries) {
        const parsed = reviewLogEntry.safeParse(entry);
        if (!parsed.success) {
          throw new Error(
            `entry ${entry.eventId} failed the contract: ${parsed.error.message}\n${JSON.stringify(entry)}`,
          );
        }
        // Nothing extra rides along: zod strips unknown keys, so a record that
        // survives validation *unchanged* is a record with no off-schema fields.
        expect(parsed.data).toEqual(entry);
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: round-trips through core’s own JSONL parser with no invalid lines',
    (_persona, stream) => {
      const result = parseReviewLog(toJsonl(stream.entries));
      expect(result.invalidLines).toEqual([]);
      expect(result.records).toEqual(stream.entries);
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: schemaVersion is the current one on every entry',
    (_persona, stream) => {
      for (const entry of stream.entries) {
        expect(entry.schemaVersion).toBe(REVIEW_LOG_SCHEMA_VERSION);
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: planVersion and yieldRank are explicit nulls (pre-P5, Phase A)',
    (_persona, stream) => {
      for (const record of reviewsOf(stream.entries)) {
        // Present-and-null, never omitted — the property that makes a Phase A
        // baseline and a Phase B comparison the same shape (contracts' doc).
        expect(Object.hasOwn(record.selectionContext, 'planVersion')).toBe(true);
        expect(Object.hasOwn(record.selectionContext, 'yieldRank')).toBe(true);
        expect(record.selectionContext.planVersion).toBeNull();
        expect(record.selectionContext.yieldRank).toBeNull();
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: MCQ is never rated easy, and explain-back is never rated at all (F2.16)',
    (_persona, stream) => {
      for (const record of reviewsOf(stream.entries)) {
        if (record.instrumentType === 'mcq') expect(record.rating).not.toBe('easy');
        if (record.instrumentType === 'explain-back') expect(record.rating).toBeNull();
        else expect(record.rating).not.toBeNull();
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: suspend/unsuspend entries carry exactly D-020’s frozen key set',
    (_persona, stream) => {
      const suspensions = stream.entries.filter((e) => e.kind !== 'review');
      for (const entry of suspensions) {
        expect(suspendLogRecord.safeParse(entry).success).toBe(true);
        expect(Object.keys(entry).sort()).toEqual([
          'conceptIds',
          'eventId',
          'instrumentId',
          'kind',
          'schemaVersion',
          'timestamp',
        ]);
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: entries are chronological and every eventId is unique',
    (_persona, stream) => {
      const ids = new Set<string>();
      let previous = Number.NEGATIVE_INFINITY;
      for (const entry of stream.entries) {
        const instant = Date.parse(entry.timestamp);
        expect(instant).toBeGreaterThanOrEqual(previous);
        previous = instant;
        expect(ids.has(entry.eventId)).toBe(false);
        ids.add(entry.eventId);
      }
    },
  );

  it.each(STREAMS.map((s) => [s.spec.persona, s] as const))(
    '%s: every timestamp carries an explicit offset, and its first ten characters are the local day',
    (_persona, stream) => {
      for (const entry of stream.entries) {
        expect(entry.timestamp).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
        );
        expect(entry.timestamp.slice(0, 10)).toBe(entry.timestamp.split('T')[0]);
      }
    },
  );

  it('the two-device edge fixtures are contracts-valid on both devices', () => {
    const { deviceA, deviceB } = twoDeviceSameDayStreams('contract-two-device');
    for (const entry of [...deviceA.entries, ...deviceB.entries]) {
      expect(reviewLogEntry.safeParse(entry).success).toBe(true);
    }
  });
});
