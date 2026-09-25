// `[D-369]` (ol-egov.141.89.6.53): the explain-back non-attempt record gains an
// optional pointer to the offer event behind the prompt she opened and left.
// Additive on v5, no schemaVersion bump — the ruling's own words, and what the
// record's doc comment had anticipated. What this file has to prove:
//
//   1. write: a record naming its offer keeps the offer's own eventId verbatim;
//   2. read: the current union reads it back as a non-attempt carrying it;
//   3. legacy absent: a v5 non-attempt line written before this field existed
//      still parses, gains no key, and re-serialises byte-identically (INV-2);
//   4. never a placeholder: null or an empty string is refused, not stored;
//   5. a self-initiated prompt (`trigger: 'on-demand'`) carries no offer
//      reference at all — there is no offer behind it to point at.
import { describe, expect, it } from 'vitest';
import { nonAttemptLogRecordV5, reviewLogEntry } from './review-log.js';

function nonAttemptLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'non-attempt',
    eventId: 'non-attempt-1',
    timestamp: '2026-09-25T10:15:00-04:00',
    conceptIds: ['concept-a'],
    trigger: 'repeated-failure',
    ...over,
  };
}

describe('nonAttemptLogRecordV5.offerEventId ([D-369])', () => {
  it('write: keeps the offer event’s own eventId verbatim when an offer stands behind the prompt', () => {
    for (const trigger of [
      'repeated-failure',
      'strong-recall-proposal',
      'scheduling-observation',
    ]) {
      const parsed = nonAttemptLogRecordV5.parse(
        nonAttemptLine({ trigger, offerEventId: 'offer-event-7' }),
      );
      expect(parsed.offerEventId).toBe('offer-event-7');
    }
  });

  it('read: the current union returns it as a non-attempt that still names its offer', () => {
    const parsed = reviewLogEntry.parse(nonAttemptLine({ offerEventId: 'offer-event-7' }));
    expect(parsed.kind).toBe('non-attempt');
    if (parsed.kind === 'non-attempt') expect(parsed.offerEventId).toBe('offer-event-7');
  });

  it('lands last on the line, so a record carrying it re-serialises byte-identically', () => {
    const line = JSON.stringify(nonAttemptLine({ offerEventId: 'offer-event-7' }));
    expect(JSON.stringify(reviewLogEntry.parse(JSON.parse(line)))).toBe(line);
  });

  it('legacy absent: a line written before the field existed parses with no such key', () => {
    const parsed = nonAttemptLogRecordV5.parse(nonAttemptLine());
    expect(Object.hasOwn(parsed, 'offerEventId')).toBe(false);
    expect(parsed.schemaVersion).toBe(5);
  });

  it('legacy absent: that line re-serialises byte-identically through the current union (INV-2)', () => {
    const line = JSON.stringify(nonAttemptLine());
    expect(JSON.stringify(reviewLogEntry.parse(JSON.parse(line)))).toBe(line);
  });

  it('never a placeholder: null and an empty string are refused', () => {
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ offerEventId: null })).success).toBe(
      false,
    );
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ offerEventId: '' })).success).toBe(
      false,
    );
  });

  it('a self-initiated prompt carries no offer reference: on-demand with one is refused', () => {
    const result = nonAttemptLogRecordV5.safeParse(
      nonAttemptLine({ trigger: 'on-demand', offerEventId: 'offer-event-7' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'offerEventId')).toBe(
        true,
      );
    }
  });

  it('a self-initiated prompt without one parses exactly as before', () => {
    expect(nonAttemptLogRecordV5.safeParse(nonAttemptLine({ trigger: 'on-demand' })).success).toBe(
      true,
    );
  });

  it('the union refuses the on-demand pairing too, so no reader path admits it', () => {
    expect(
      reviewLogEntry.safeParse(nonAttemptLine({ trigger: 'on-demand', offerEventId: 'offer-1' }))
        .success,
    ).toBe(false);
  });
});
