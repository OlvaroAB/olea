// `[D-367]` (ol-0r92.118): the review record gains an optional `origin`, present
// only on the review by which an item she deliberately handed over from a
// practice paper entered ordinary review (F4.11), absent on every other record.
// Additive on v5 with no schemaVersion bump, the way `[D-369]`'s offer reference
// was added to the non-attempt record. What this file has to prove:
//
//   1. write: a record carrying it keeps the one ruled value verbatim;
//   2. read: the current union reads it back on a review, in every instrument kind;
//   3. legacy absent: a v5 review line written before the field existed still
//      parses, gains no key, and re-serialises byte-identically (INV-2);
//   4. never a placeholder or a flag: null, an empty string, an unknown value
//      and a boolean are all refused, not stored;
//   5. a reader that does not know the field (the v5 shape as it stood before
//      it) still reads a line carrying it, and reads every other field the same;
//   6. it is a review-record field only: no other kind in the union gains it;
//   7. v6 inherits it by derivation, in the same place on the line, so the
//      v5 -> v6 restamp stays byte-identical apart from the version digit.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  nonAttemptLogRecordV5,
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV6,
  reviewLogRecord,
  reviewLogRecordV5,
  reviewLogRecordV6,
  reviewOrigin,
  suspendLogRecordV5,
  verdictLogRecordV5,
} from './review-log.js';

const SELECTION_CONTEXT = {
  dueState: 'new',
  examProximity: 4,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
} as const;

/** A v5 review line exactly as `appendReviewLogRecord` lays one out, before any optional field. */
function reviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'review-1',
    timestamp: '2026-09-26T09:30:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 5100,
    selectionContext: SELECTION_CONTEXT,
    conceptIds: ['concept-a'],
    ...over,
  };
}

/** Every optional v5 field set at once, in schema order, so key placement is tested against a full line. */
function fullReviewLine(over: Record<string, unknown> = {}) {
  return reviewLine({
    instrumentId: 'mcq:concept-a:1',
    instrumentType: 'mcq',
    conceptIds: ['concept-a', 'concept-b'],
    masteryAtTime: {
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'sprout', 'concept-b': 'seed' },
    },
    supportLevelShown: 'independent',
    schedulingObservation: { neighbourConceptId: 'concept-c' },
    correctness: { chosenIndex: 2, matchedKey: true },
    ...over,
  });
}

describe('reviewLogRecordV5.origin ([D-367])', () => {
  it('declares exactly one value today, the practice-paper hand-off, and is not a boolean', () => {
    expect(reviewOrigin.options).toEqual(['practice-paper']);
  });

  it('write: keeps the ruled value verbatim on a review of every instrument kind', () => {
    for (const instrumentType of ['qa', 'cloze', 'mcq'] as const) {
      const parsed = reviewLogRecordV5.parse(
        reviewLine({
          instrumentType,
          instrumentId: `${instrumentType}:1`,
          origin: 'practice-paper',
        }),
      );
      expect(parsed.origin).toBe('practice-paper');
    }
    const explainBack = reviewLogRecordV5.parse(
      reviewLine({
        instrumentType: 'explain-back',
        instrumentId: 'explain-back:concept-a',
        rating: null,
        origin: 'practice-paper',
      }),
    );
    expect(explainBack.origin).toBe('practice-paper');
  });

  it('read: the current union returns it as a review that still carries its origin', () => {
    const parsed = reviewLogEntry.parse(reviewLine({ origin: 'practice-paper' }));
    expect(parsed.kind).toBe('review');
    if (parsed.kind === 'review') expect(parsed.origin).toBe('practice-paper');
  });

  it('is part of the current record, with no version bump: the writers still stamp 5', () => {
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(5);
    expect(reviewLogRecord).toBe(reviewLogRecordV5);
    expect(Object.keys(reviewLogRecordV5.shape)).toContain('origin');
  });

  it('lands last on the line, after every earlier optional field, so a full line re-serialises byte-identically', () => {
    const line = JSON.stringify(fullReviewLine({ origin: 'practice-paper' }));
    const reparsed = reviewLogEntry.parse(JSON.parse(line));
    expect(JSON.stringify(reparsed)).toBe(line);
    const keys = Object.keys(reparsed);
    expect(keys[keys.length - 1]).toBe('origin');
    expect(Object.keys(reviewLogRecordV5.shape).at(-1)).toBe('origin');
  });

  it('legacy absent: a line written before the field existed parses with no such key', () => {
    for (const line of [reviewLine(), fullReviewLine()]) {
      const parsed = reviewLogRecordV5.parse(line);
      expect(Object.hasOwn(parsed, 'origin')).toBe(false);
      expect(parsed.origin).toBeUndefined();
    }
  });

  it('legacy absent: those lines re-serialise byte-identically through the current union (INV-2)', () => {
    for (const record of [reviewLine(), fullReviewLine()]) {
      const line = JSON.stringify(record);
      expect(JSON.stringify(reviewLogEntry.parse(JSON.parse(line)))).toBe(line);
    }
  });

  it('never a placeholder or a flag: null, empty, an unknown value and a boolean are refused', () => {
    for (const bad of [null, '', 'paper', 'from a practice paper', true, false, 1]) {
      const result = reviewLogRecordV5.safeParse(reviewLine({ origin: bad }));
      expect(result.success, `origin ${JSON.stringify(bad)}`).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join('.') === 'origin')).toBe(true);
      }
    }
  });

  it('a reader that predates the field still reads a line carrying it, and reads every other field the same', () => {
    // The v5 review shape as it stood before `[D-367]`: every key but `origin`,
    // parsed the way zod's default object parse runs (unknown keys stripped,
    // never an error). This is what an older build on her other device does.
    const { origin: _origin, ...before } = reviewLogRecordV5.shape;
    const readerBefore = z.object(before);
    const line = fullReviewLine({ origin: 'practice-paper' });
    const old = readerBefore.safeParse(line);
    expect(old.success).toBe(true);
    if (!old.success) return;
    expect(Object.hasOwn(old.data, 'origin')).toBe(false);
    const { origin: _dropped, ...rest } = reviewLogRecordV5.parse(line);
    expect(old.data).toEqual(rest);
  });

  it('is a review-record field only: no other kind gains it', () => {
    for (const schema of [suspendLogRecordV5, verdictLogRecordV5, nonAttemptLogRecordV5]) {
      expect(Object.keys(schema.shape)).not.toContain('origin');
    }
    const suspend = reviewLogEntry.parse({
      schemaVersion: 5,
      kind: 'suspend',
      eventId: 's-1',
      timestamp: '2026-09-26T09:30:00-04:00',
      instrumentId: 'qa:concept-a:1',
      conceptIds: ['concept-a'],
      origin: 'practice-paper',
    });
    expect(Object.hasOwn(suspend, 'origin')).toBe(false);
  });
});

describe('reviewLogRecordV6.origin — inherited from v5, not a v6 addition', () => {
  it('v6 carries it by derivation, and keeps it when a v5 line is restamped', () => {
    expect(Object.keys(reviewLogRecordV6.shape)).toContain('origin');
    const line = JSON.stringify(fullReviewLine({ origin: 'practice-paper', schemaVersion: 6 }));
    const parsed = reviewLogRecordV6.parse(JSON.parse(line));
    expect(parsed.origin).toBe('practice-paper');
    expect(JSON.stringify(parsed)).toBe(line);
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('sits after the last v5 field and before the first field new at v6, as the v6 key-order rule requires', () => {
    const keys = Object.keys(reviewLogRecordV6.shape);
    const at = keys.indexOf('origin');
    expect(at).toBe(keys.indexOf('answerEdits') + 1);
    expect(at).toBeLessThan(keys.indexOf('explainBackCorrectness'));
    expect(at).toBeLessThan(keys.indexOf('hintOpened'));
    expect(at).toBeLessThan(keys.indexOf('presentedPassageDigest'));
  });

  it('a v6 line with the v6 fields and an origin re-serialises byte-identically', () => {
    const line = JSON.stringify(
      reviewLine({
        schemaVersion: 6,
        origin: 'practice-paper',
        hintOpened: false,
        presentedPassageDigest: 'digest-1',
      }),
    );
    expect(JSON.stringify(reviewLogRecordV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('v6 refuses the same non-values v5 does', () => {
    for (const bad of [null, '', true]) {
      expect(
        reviewLogRecordV6.safeParse(reviewLine({ schemaVersion: 6, origin: bad })).success,
      ).toBe(false);
    }
  });
});
