// Row 48 of David's 2026-09-29 rulings (`ol-egov.141.89.9.72`): a new grade contest may name the
// review it is about, by that review's event id, in one optional field on the v6 dispute record.
// What this file has to prove:
//
//   1. a dispute carrying `reviewId` parses, keeps it, and reads back through the current union;
//   2. an older dispute (v5, or v6 without the field) still parses, gains no key, and serialises
//      to the identical text — the additive-and-optional guarantee (INV-2's spirit for the log);
//   3. a `reviewId` that is empty is refused, so "no review" and "a review" never look alike;
//   4. the field rides an opening and a resolving record alike, and the resolution pairing rules
//      still hold with it present;
//   5. v5 has no such field: a v5 dispute that carries one drops it, and a v5 line restamped to
//      v6 gains none.
//
// Event and instrument ids are structural placeholders, never fixture vocabulary (INV-3).
import { describe, expect, it } from 'vitest';
import {
  disputeLogRecord,
  disputeLogRecordV5,
  disputeLogRecordV6,
  reviewLogEntry,
  reviewLogEntryV5,
} from './review-log.js';

function disputeLine(version: 5 | 6, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: version,
    kind: 'dispute',
    eventId: 'dispute-1',
    timestamp: '2026-09-29T09:00:00-04:00',
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: ['concept-a'],
    instrumentId: 'eb:1',
    evidenceBasis: 'basis-1',
    effect: 'quarantined',
    ...over,
  };
}

describe('disputeLogRecordV6 — reviewId names the review a grade contest is about (row 48)', () => {
  it('parses an opening grade dispute that names its review, and keeps the id', () => {
    const parsed = disputeLogRecordV6.safeParse(disputeLine(6, { reviewId: 'review-1' }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.reviewId).toBe('review-1');
  });

  it('reads the same line back through the current union, and disputeLogRecord is the v6 shape', () => {
    const line = disputeLine(6, { reviewId: 'review-1' });
    const viaUnion = reviewLogEntry.safeParse(line);
    expect(viaUnion.success).toBe(true);
    if (!viaUnion.success || viaUnion.data.kind !== 'dispute')
      throw new Error('expected a dispute');
    expect(viaUnion.data.reviewId).toBe('review-1');
    expect(disputeLogRecord.safeParse(line).success).toBe(true);
  });

  it('rides a resolving record too, with the pairing rules unchanged', () => {
    const resolved = disputeLogRecordV6.safeParse(
      disputeLine(6, {
        eventId: 'dispute-2',
        resolves: 'dispute-1',
        outcome: 'corrected',
        reviewId: 'review-1',
      }),
    );
    expect(resolved.success).toBe(true);
    // Half of the resolution pair is still refused with the new field present.
    expect(
      disputeLogRecordV6.safeParse(disputeLine(6, { resolves: 'dispute-1', reviewId: 'review-1' }))
        .success,
    ).toBe(false);
  });

  it('refuses an empty reviewId — an empty name would read as no review and as a review at once', () => {
    expect(disputeLogRecordV6.safeParse(disputeLine(6, { reviewId: '' })).success).toBe(false);
  });

  it('a v6 dispute with no reviewId parses, gains no key, and serialises to the identical text', () => {
    const line = disputeLine(6);
    const text = JSON.stringify(line);
    const parsed = disputeLogRecordV6.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('reviewId' in parsed.data).toBe(false);
    expect(JSON.stringify(parsed.data)).toBe(text);
  });

  it('an open-routed v6 dispute with no reviewId is byte-stable too', () => {
    const line = disputeLine(6, {
      claimKind: 'unsorted',
      claimRendering: 'refusal',
      effect: 'held',
      routingStatus: 'open',
    });
    const text = JSON.stringify(line);
    const parsed = reviewLogEntry.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(JSON.stringify(parsed.data)).toBe(text);
  });
});

describe('disputeLogRecordV5 — an older dispute is unchanged and never gains a reviewId', () => {
  it('a v5 dispute parses, and serialises to the identical text', () => {
    const text = JSON.stringify(disputeLine(5));
    const parsed = disputeLogRecordV5.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(JSON.stringify(parsed.data)).toBe(text);
  });

  it('v5 does not know the field: one written on a v5 line is dropped, not kept', () => {
    const parsed = reviewLogEntryV5.safeParse(disputeLine(5, { reviewId: 'review-1' }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('reviewId' in parsed.data).toBe(false);
  });

  it('a v5 dispute restamped to v6 stays without the field', () => {
    const restamped = reviewLogEntry.safeParse({ ...disputeLine(5), schemaVersion: 6 });
    expect(restamped.success).toBe(true);
    if (!restamped.success) return;
    expect('reviewId' in restamped.data).toBe(false);
  });
});
