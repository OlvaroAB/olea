import type { ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from './merge.js';

function record(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
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
      schemaVersion: 5,
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

// ol-egov.20, ruled 2026-08-26: the total order is (instant, deviceId,
// eventId). No `[D-*]` alias exists yet for this ruling — cite the bead id.
function tagged(deviceId: string, records: readonly ReviewLogRecord[]) {
  return { deviceId, records };
}

/** Every ordering of `items`, for a small property-style sweep over file order. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const [head, ...rest] = items;
  const withoutHead = permutations(rest);
  const result: T[][] = [];
  for (const perm of withoutHead) {
    for (let i = 0; i <= perm.length; i += 1) {
      result.push([...perm.slice(0, i), head as T, ...perm.slice(i)]);
    }
  }
  return result;
}

describe('mergeReviewLogRecords — deviceId tiebreak (ol-egov.20)', () => {
  it('two records sharing an instant are ordered by deviceId, whichever source is merged first', () => {
    const instant = '2026-08-10T09:00:00-04:00';
    const fromZeta = record({ eventId: 'e-from-zeta', timestamp: instant });
    const fromAlpha = record({ eventId: 'e-from-alpha', timestamp: instant });

    // eventId alone (zeta's 'e-from-zeta' vs alpha's 'e-from-alpha') would
    // already sort alpha-first here, so this only proves the point if the
    // deviceId tiebreak is checked *before* falling through to eventId —
    // which it is, since both orderings below agree with deviceId order,
    // not with whichever source happened to be merged first.
    const forward = mergeReviewLogRecords(tagged('zeta', [fromZeta]), tagged('alpha', [fromAlpha]));
    const backward = mergeReviewLogRecords(
      tagged('alpha', [fromAlpha]),
      tagged('zeta', [fromZeta]),
    );
    expect(forward.records.map((r) => r.eventId)).toEqual(['e-from-alpha', 'e-from-zeta']);
    expect(backward.records).toEqual(forward.records);
  });

  it('an untagged (bare-array) source behaves exactly as before this ruling: empty-string deviceId, eventId decides', () => {
    const instant = '2026-08-10T09:00:00-04:00';
    const aaa = record({ eventId: 'aaa', timestamp: instant });
    const zzz = record({ eventId: 'zzz', timestamp: instant });
    // Same assertion as the pre-ruling "two events sharing one instant" test
    // above, unchanged: passing bare arrays must still produce the old order.
    expect(mergeReviewLogRecords([zzz], [aaa]).records.map((r) => r.eventId)).toEqual([
      'aaa',
      'zzz',
    ]);
  });

  it('a bare (untagged) source and a tagged source can be mixed in one call', () => {
    const instant = '2026-08-10T09:00:00-04:00';
    const untaggedRecord = record({ eventId: 'untagged', timestamp: instant });
    const taggedRecord = record({ eventId: 'tagged', timestamp: instant });
    // '' (untagged) sorts before any non-empty deviceId lexicographically.
    const result = mergeReviewLogRecords([untaggedRecord], tagged('alpha', [taggedRecord]));
    expect(result.records.map((r) => r.eventId)).toEqual(['untagged', 'tagged']);
  });

  it('a duplicate eventId seen under two different deviceIds is tiebroken by the smaller id, regardless of argument order', () => {
    const instant = '2026-08-10T09:00:00-04:00';
    const dup = record({ eventId: 'dup', timestamp: instant });
    const third = record({ eventId: 'mmm', timestamp: instant }); // sorts between 'alpha' and 'zeta' by eventId alone — irrelevant here

    // 'dup' is seen (identical content) tagged both 'zeta' and 'alpha'; the
    // smaller, 'alpha', must win the tiebreak no matter which occurrence the
    // merge happens to encounter first.
    const orderOne = mergeReviewLogRecords(
      tagged('zeta', [dup]),
      tagged('alpha', [dup]),
      tagged('alpha', [third]),
    );
    const orderTwo = mergeReviewLogRecords(
      tagged('alpha', [dup]),
      tagged('zeta', [dup]),
      tagged('alpha', [third]),
    );
    expect(orderOne.records).toEqual(orderTwo.records);
    // 'dup' tagged 'alpha' sorts before 'third' also tagged 'alpha' because
    // eventId 'dup' < 'mmm'.
    expect(orderOne.records.map((r) => r.eventId)).toEqual(['dup', 'mmm']);
  });
});

// THE acceptance test, exactly as ruled on ol-egov.20 2026-08-26: two device
// files, interleaved in any file order, fold to byte-identical state.
describe('mergeReviewLogRecords — acceptance: any file order folds to byte-identical state (ol-egov.20)', () => {
  it('two device files, fed in either order, produce a deep-equal fold', () => {
    const deviceAlpha = [
      record({ eventId: 'a1', timestamp: '2026-08-10T09:00:00-04:00' }),
      record({ eventId: 'a2', timestamp: '2026-08-10T09:04:00-04:00' }),
    ];
    const deviceBeta = [record({ eventId: 'b1', timestamp: '2026-08-10T09:02:00-04:00' })];

    const forward = mergeReviewLogRecords(tagged('alpha', deviceAlpha), tagged('beta', deviceBeta));
    const backward = mergeReviewLogRecords(
      tagged('beta', deviceBeta),
      tagged('alpha', deviceAlpha),
    );
    expect(forward.records.map((r) => r.eventId)).toEqual(['a1', 'b1', 'a2']);
    expect(backward).toEqual(forward);
  });

  it('property sweep: three device files fold to the identical array under every one of their 6 argument orderings', () => {
    const sources = [
      tagged('alpha', [
        record({ eventId: 'a1', timestamp: '2026-08-10T09:00:00-04:00' }),
        record({ eventId: 'a2', timestamp: '2026-08-10T09:07:00-04:00' }),
      ]),
      tagged('beta', [record({ eventId: 'b1', timestamp: '2026-08-10T09:03:00-04:00' })]),
      tagged('gamma', [
        record({ eventId: 'g1', timestamp: '2026-08-10T09:00:00-04:00' }), // ties alpha's a1 on instant
        record({ eventId: 'g2', timestamp: '2026-08-10T09:05:00-04:00' }),
      ]),
    ];

    const results = permutations(sources).map((order) => mergeReviewLogRecords(...order));
    const [first, ...rest] = results;
    expect(first).toBeDefined();
    for (const other of rest) {
      expect(other).toEqual(first);
    }
    // Pin the actual order down too, not just "all orderings agree with each
    // other" — alpha < gamma lexically, so a1 (alpha) precedes g1 (gamma) at
    // their shared instant.
    expect(first?.records.map((r) => r.eventId)).toEqual(['a1', 'g1', 'b1', 'g2', 'a2']);
  });
});

// Clock skew: the module doc's claim, pinned down by a test rather than left
// as prose. See merge.ts's "Clock skew" doc section.
describe('mergeReviewLogRecords — clock skew does not make the fold depend on file order (ol-egov.20)', () => {
  it('a device running minutes fast has its whole run shifted wholesale, but the fold is still order-independent', () => {
    // A "sitting": three quick reviews on the laptop, true local time
    // 09:00–09:02. The phone's clock runs 5 minutes fast, so a review taken
    // at true time 09:01 (mid-sitting) is stamped 09:06 by the phone itself —
    // landing *after* the laptop's whole burst in wall-clock order. That is
    // the skew shifting the phone's event wholesale, not the merge doing
    // anything special with it.
    const laptop = [
      record({ eventId: 'laptop-1', timestamp: '2026-08-10T09:00:00-04:00' }),
      record({ eventId: 'laptop-2', timestamp: '2026-08-10T09:01:00-04:00' }),
      record({ eventId: 'laptop-3', timestamp: '2026-08-10T09:02:00-04:00' }),
    ];
    const phone = [record({ eventId: 'phone-1', timestamp: '2026-08-10T09:06:00-04:00' })]; // true 09:01, +5min skew

    const forward = mergeReviewLogRecords(tagged('laptop', laptop), tagged('phone', phone));
    const backward = mergeReviewLogRecords(tagged('phone', phone), tagged('laptop', laptop));

    // The skewed phone event lands after the whole laptop burst — the merge
    // does not (cannot, and does not try to) put it "back" mid-sitting.
    expect(forward.records.map((r) => r.eventId)).toEqual([
      'laptop-1',
      'laptop-2',
      'laptop-3',
      'phone-1',
    ]);
    // The property this ruling actually guarantees: whichever file a
    // clustering consumer happens to read first, it sees the exact same
    // folded array — so a skewed device can shift where a cluster boundary
    // falls, but it cannot make that boundary flip depending on file order.
    expect(backward).toEqual(forward);
  });

  it("skew that lands exactly on another device's instant is still broken by deviceId, not by read order", () => {
    // The unlucky case: the phone's skew happens to put one of its events at
    // exactly the same instant as a laptop event. Without a deviceId
    // tiebreak this would fall through to eventId, which is still
    // deterministic — but this pins down that the deviceId step is reached
    // and is itself order-independent, which is the property clock skew
    // makes it easy to stop noticing is being tested at all.
    const instant = '2026-08-10T09:01:00-04:00';
    const laptopEvent = record({ eventId: 'zzz-laptop', timestamp: instant });
    const phoneEvent = record({ eventId: 'aaa-phone', timestamp: instant });

    const forward = mergeReviewLogRecords(
      tagged('laptop', [laptopEvent]),
      tagged('phone', [phoneEvent]),
    );
    const backward = mergeReviewLogRecords(
      tagged('phone', [phoneEvent]),
      tagged('laptop', [laptopEvent]),
    );
    // 'laptop' < 'phone' lexically, so the laptop event wins the tie despite
    // its eventId ('zzz-laptop') sorting after the phone's ('aaa-phone') —
    // proof the deviceId step actually fires ahead of eventId.
    expect(forward.records.map((r) => r.eventId)).toEqual(['zzz-laptop', 'aaa-phone']);
    expect(backward).toEqual(forward);
  });
});
