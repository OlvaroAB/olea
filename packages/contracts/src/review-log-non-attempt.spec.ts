// `[D-273]` (F5.7) and `[D-306]`: the explain-back non-attempt, additive to
// the v5 discriminated union the same way `explainBackOfferLogRecordV5` is —
// no schemaVersion bump for this kind's own arrival. What this file has to
// prove:
//
//   1. `reviewLogEntry` discriminates the new kind alongside every other one;
//   2. `kind` is required and is ONE literal: a named skip and a prompt closed
//      without an answer are the same event (`[D-306]`), so neither `skip` nor
//      any exit name is a kind of its own;
//   3. D7.1's fields are present and required: the trigger (the same four
//      routes the offer record carries) and a non-empty concept list;
//   4. nothing outside D7.1's set survives a parse — no grade, no answer
//      reference, no field saying which exit she took, no instrument, no
//      pointer to the offer.
import { describe, expect, it } from 'vitest';
import {
  explainBackOfferTrigger,
  type NonAttemptLogRecord,
  nonAttemptLogRecord,
  nonAttemptLogRecordV5,
  reviewLogEntry,
} from './review-log.js';

function nonAttemptLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'non-attempt',
    eventId: 'non-attempt-1',
    timestamp: '2026-09-25T10:15:00-04:00',
    conceptIds: ['concept-a', 'concept-b'],
    trigger: 'repeated-failure',
    ...over,
  };
}

describe('nonAttemptLogRecordV5', () => {
  it('parses a well-formed line at the current version', () => {
    const parsed = nonAttemptLogRecordV5.safeParse(nonAttemptLine());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.schemaVersion).toBe(5);
  });

  it('requires `kind` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = nonAttemptLine();
    expect(nonAttemptLogRecordV5.safeParse(rest).success).toBe(false);
  });

  it('is one kind for both exits: neither `skip` nor an exit name is a kind (`[D-306]`)', () => {
    for (const kind of ['skip', 'closed', 'skipped', 'abandoned', 'explain-back-declined']) {
      expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ kind })).success).toBe(false);
    }
  });

  it('rejects any other schemaVersion — the version literal is 5', () => {
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ schemaVersion: 6 })).success).toBe(
      false,
    );
  });

  it('rejects a missing or empty conceptIds, and an empty concept id', () => {
    const { conceptIds: _drop, ...rest } = nonAttemptLine();
    expect(nonAttemptLogRecordV5.safeParse(rest).success).toBe(false);
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ conceptIds: [] })).success).toBe(false);
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ conceptIds: [''] })).success).toBe(
      false,
    );
  });

  it('requires the trigger, and accepts exactly the four routes the offer record carries', () => {
    const { trigger: _drop, ...rest } = nonAttemptLine();
    expect(nonAttemptLogRecordV5.safeParse(rest).success).toBe(false);
    for (const trigger of explainBackOfferTrigger.options) {
      expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ trigger })).success).toBe(true);
    }
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ trigger: 'skip' })).success).toBe(
      false,
    );
  });

  it('reuses the offer record’s trigger enum rather than redeclaring it', () => {
    expect(nonAttemptLogRecordV5.shape.trigger).toBe(explainBackOfferTrigger);
  });

  it('requires an ISO-8601 timestamp with an offset', () => {
    const { timestamp: _drop, ...rest } = nonAttemptLine();
    expect(nonAttemptLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      nonAttemptLogRecordV5.safeParse(nonAttemptLine({ timestamp: '2026-09-25' })).success,
    ).toBe(false);
    expect(
      nonAttemptLogRecordV5.safeParse(nonAttemptLine({ timestamp: '2026-09-25T10:15:00' })).success,
    ).toBe(false);
  });

  it('carries exactly D7.1’s fields: no grade, no answer, no exit, no instrument, no offer pointer', () => {
    // Every key a writer might wrongly reach for, on one line. Unknown keys are
    // stripped rather than refused — the same tolerance every record in this
    // union has, so an older build can still read a line a newer one wrote —
    // so the proof is the parsed shape: none of them survives into the record.
    const parsed = nonAttemptLogRecordV5.parse(
      nonAttemptLine({
        rating: null,
        explainBackGrade: { soloLevel: 'prestructural' },
        contentRef: 'content-1',
        exit: 'closed',
        manner: 'dismissed',
        reason: 'anything',
        instrumentId: 'explain-back:1',
        instrumentType: 'explain-back',
        answers: 'offer-1',
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(
      ['schemaVersion', 'kind', 'eventId', 'timestamp', 'conceptIds', 'trigger'].sort(),
    );
  });

  it('keeps her concept order verbatim — nothing sorts or deduplicates it', () => {
    const parsed = nonAttemptLogRecordV5.parse(
      nonAttemptLine({ conceptIds: ['concept-b', 'concept-a', 'concept-b'] }),
    );
    expect(parsed.conceptIds).toEqual(['concept-b', 'concept-a', 'concept-b']);
  });

  it('`nonAttemptLogRecord` is the v5 alias', () => {
    expect(nonAttemptLogRecord).toBe(nonAttemptLogRecordV5);
  });
});

describe('reviewLogEntry discriminates the non-attempt kind alongside every other one', () => {
  it('parses a non-attempt line as a member of the current union', () => {
    const parsed = reviewLogEntry.safeParse(nonAttemptLine());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('non-attempt');
  });

  it('a non-attempt line without its trigger fails the union the same way it fails the record', () => {
    const { trigger: _drop, ...rest } = nonAttemptLine();
    expect(reviewLogEntry.safeParse(rest).success).toBe(false);
  });

  it('the union narrows on the literal to the record type (compile-time check)', () => {
    const entry = reviewLogEntry.parse(nonAttemptLine());
    if (entry.kind !== 'non-attempt') throw new Error('expected a non-attempt');
    const record: NonAttemptLogRecord = entry;
    expect(record.trigger).toBe('repeated-failure');
  });
});
