import type { ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from './merge.js';

function record(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 4,
    kind: 'review',
    eventId: 'r1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['imbrication'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('mergeReviewLogRecords — basics', () => {
  it('no sources yields an empty, unremarkable result', () => {
    expect(mergeReviewLogRecords()).toEqual({ records: [], duplicateEventIds: [] });
  });

  it('unions distinct records from multiple sources', () => {
    const a = record({ eventId: 'a', timestamp: '2026-08-10T09:00:00-04:00' });
    const b = record({ eventId: 'b', timestamp: '2026-08-10T10:00:00-04:00' });
    const result = mergeReviewLogRecords([a], [b]);
    expect(result.records).toEqual([a, b]);
    expect(result.duplicateEventIds).toEqual([]);
  });

  it('sorts the merged records by timestamp instant, not by input order', () => {
    const early = record({ eventId: 'early', timestamp: '2026-08-10T09:00:00-04:00' });
    const late = record({ eventId: 'late', timestamp: '2026-08-10T11:00:00-04:00' });
    // Deliberately fed in reverse chronological order.
    const result = mergeReviewLogRecords([late, early]);
    expect(result.records).toEqual([early, late]);
  });
});

describe('mergeReviewLogRecords — the same eventId appearing twice', () => {
  it('collapses an identical duplicate into a single record and reports the eventId', () => {
    const original = record({ eventId: 'dup', timestamp: '2026-08-10T09:00:00-04:00' });
    // A byte-for-byte identical duplicate — e.g. a retried sync appending the
    // same already-written event again.
    const duplicate = record({ eventId: 'dup', timestamp: '2026-08-10T09:00:00-04:00' });

    const result = mergeReviewLogRecords([original], [duplicate]);
    expect(result.records).toEqual([original]);
    expect(result.duplicateEventIds).toEqual(['dup']);
  });

  it('collapses a duplicate appearing twice within one single source list too, not just across sources', () => {
    const original = record({ eventId: 'dup' });
    const duplicate = record({ eventId: 'dup' });
    const result = mergeReviewLogRecords([original, duplicate]);
    expect(result.records).toEqual([original]);
    expect(result.duplicateEventIds).toEqual(['dup']);
  });

  it('throws rather than silently picking a winner when the same eventId carries conflicting content', () => {
    const original = record({ eventId: 'dup', rating: 'good' });
    const conflicting = record({ eventId: 'dup', rating: 'again' });
    expect(() => mergeReviewLogRecords([original], [conflicting])).toThrow(/dup/);
  });
});

describe('mergeReviewLogRecords — commutative and idempotent (no coordination between devices)', () => {
  const a = record({ eventId: 'a', timestamp: '2026-08-10T09:00:00-04:00' });
  const b = record({ eventId: 'b', timestamp: '2026-08-10T09:05:00-04:00' });
  const c = record({ eventId: 'c', timestamp: '2026-08-10T09:10:00-04:00' });
  const deviceAlpha = [a, c];
  const deviceBeta = [b];

  it('merge(alpha, beta) equals merge(beta, alpha) — order of devices does not matter', () => {
    const forward = mergeReviewLogRecords(deviceAlpha, deviceBeta);
    const backward = mergeReviewLogRecords(deviceBeta, deviceAlpha);
    expect(forward).toEqual(backward);
  });

  it('merging the same sources twice changes nothing about the resulting records — re-running a merge job is a no-op', () => {
    // `duplicateEventIds` legitimately differs between the two calls — the
    // "twice" call really did see every event twice, and reports that
    // honestly — but the deduplicated `records` themselves, which is what
    // idempotency actually promises, are identical either way.
    const once = mergeReviewLogRecords(deviceAlpha, deviceBeta);
    const twice = mergeReviewLogRecords(deviceAlpha, deviceBeta, deviceAlpha, deviceBeta);
    expect(twice.records).toEqual(once.records);
  });

  it('two events sharing one instant are ordered by eventId, whichever device is merged first', () => {
    // ol-inv2remainder: added because deleting the `(instant, eventId)`
    // tiebreaker — leaving the comparator returning 0, so the sort is merely
    // *stable* — left the entire suite green. Nothing else here feeds merge
    // two events at the same instant, so the second half of the documented
    // sort key was unguarded.
    //
    // Same-instant events are ordinary, not exotic: two devices' clocks agree
    // to the second, or a suspend and the review that preceded it land in the
    // same second. With only a stable sort the merged order would depend on
    // which device's file the caller happened to read first — and "identical
    // result with zero coordination between devices" is the entire promise.
    const instant = '2026-08-10T09:00:00-04:00';
    const aaa = record({ eventId: 'aaa', timestamp: instant });
    const zzz = record({ eventId: 'zzz', timestamp: instant });

    expect(mergeReviewLogRecords([zzz], [aaa]).records.map((r) => r.eventId)).toEqual([
      'aaa',
      'zzz',
    ]);
    expect(mergeReviewLogRecords([aaa], [zzz]).records.map((r) => r.eventId)).toEqual([
      'aaa',
      'zzz',
    ]);
    expect(mergeReviewLogRecords([zzz, aaa]).records).toEqual(
      mergeReviewLogRecords([aaa, zzz]).records,
    );
  });

  it('interleaved event orderings across devices still produce one chronologically sorted result', () => {
    // Alpha's own file order (write order) need not be Beta's, and neither
    // needs to be chronological across devices.
    const interleavedAlpha = [c, a];
    const interleavedBeta = [b];
    const result = mergeReviewLogRecords(interleavedAlpha, interleavedBeta);
    expect(result.records.map((r) => r.eventId)).toEqual(['a', 'b', 'c']);
  });
});

describe("mergeReviewLogRecords — one device's file is a strict prefix of another's", () => {
  it("merging an earlier snapshot with a later, superset snapshot yields exactly the later snapshot's records", () => {
    const r1 = record({ eventId: 'r1', timestamp: '2026-08-10T09:00:00-04:00' });
    const r2 = record({ eventId: 'r2', timestamp: '2026-08-10T09:05:00-04:00' });
    const r3 = record({ eventId: 'r3', timestamp: '2026-08-10T09:10:00-04:00' });
    // "earlier" is a strict prefix of "later" (same device, read mid-sync;
    // or two sync replicas at different points in time).
    const earlierSnapshot = [r1];
    const laterSnapshot = [r1, r2, r3];

    const result = mergeReviewLogRecords(earlierSnapshot, laterSnapshot);
    expect(result.records).toEqual(laterSnapshot);
    expect(result.duplicateEventIds).toEqual(['r1']);
  });
});

// D-020: suspension events merge alongside review events with no special case.
describe('mergeReviewLogRecords — suspension events (D-020, F2.6)', () => {
  function suspension(overrides: Partial<SuspendLogRecord> = {}): SuspendLogRecord {
    return {
      schemaVersion: 4,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-10T09:20:00-04:00',
      instrumentId: 'cloze:bioturbation:1',
      conceptIds: ['bioturbation'],
      ...overrides,
    };
  }

  it('two devices suspending the same instrument on the same day merge to one event', () => {
    const alpha = suspension();
    const beta = suspension();
    const result = mergeReviewLogRecords([alpha], [beta]);
    expect(result.records).toEqual([alpha]);
    expect(result.duplicateEventIds).toEqual(['s1']);
  });

  it('a suspend on one device and an unsuspend on another both survive', () => {
    // Two distinct events, not a conflict. Which of them *won* is the
    // projection's business (./suspension.ts), not the merger's — all the
    // merger owes is that neither is lost and they come back in time order.
    const suspend = suspension({ eventId: 's1', timestamp: '2026-08-10T09:20:00-04:00' });
    const unsuspend = suspension({
      eventId: 'u1',
      kind: 'unsuspend',
      timestamp: '2026-08-10T13:00:00-04:00',
    });
    const result = mergeReviewLogRecords([unsuspend], [suspend]);
    expect(result.records).toEqual([suspend, unsuspend]);
    expect(result.duplicateEventIds).toEqual([]);
  });

  it('interleaves suspension and review events by timestamp, in one list', () => {
    const early = record({ eventId: 'r-early', timestamp: '2026-08-10T09:00:00-04:00' });
    const middle = suspension({ eventId: 's1', timestamp: '2026-08-10T09:20:00-04:00' });
    const late = record({ eventId: 'r-late', timestamp: '2026-08-10T10:00:00-04:00' });
    const result = mergeReviewLogRecords([late, early], [middle]);
    expect(result.records.map((r) => r.eventId)).toEqual(['r-early', 's1', 'r-late']);
  });

  it('still throws when one eventId carries a suspend on one device and an unsuspend on another', () => {
    // An id collision between two genuinely different events is a correctness
    // bug, and "pick one" would make it invisible and unrecoverable (INV-4).
    const suspend = suspension({ eventId: 'clash' });
    const unsuspend = suspension({ eventId: 'clash', kind: 'unsuspend' });
    expect(() => mergeReviewLogRecords([suspend], [unsuspend])).toThrow(/clash/);
  });

  it('a suspend and a review sharing an eventId is a collision too, not a union member coincidence', () => {
    const suspend = suspension({ eventId: 'clash' });
    const reviewed = record({ eventId: 'clash' });
    expect(() => mergeReviewLogRecords([suspend], [reviewed])).toThrow(/clash/);
  });
});
