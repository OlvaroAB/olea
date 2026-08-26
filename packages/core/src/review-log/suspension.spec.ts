import type { ReviewLogEntry, ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { isInstrumentSuspended, suspendedInstrumentIds } from './suspension.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
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

function suspension(overrides: Partial<SuspendLogRecord> = {}): SuspendLogRecord {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    conceptIds: ['imbrication'],
    ...overrides,
  };
}

describe('suspendedInstrumentIds — the fold', () => {
  it('an empty log suspends nothing', () => {
    expect(suspendedInstrumentIds([])).toEqual(new Set());
  });

  it('a log of reviews only suspends nothing — reviewing is not an opinion about suspension', () => {
    const entries = [review({ eventId: 'a' }), review({ eventId: 'b' })];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set());
  });

  it('a suspend with no later event puts the instrument in the set', () => {
    expect(suspendedInstrumentIds([suspension()])).toEqual(new Set(['qa:imbrication:1']));
  });

  it('a later unsuspend takes it back out — the last event per instrument wins', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1', timestamp: '2026-08-10T09:00:00-04:00' }),
      suspension({
        eventId: 'u1',
        kind: 'unsuspend',
        timestamp: '2026-08-10T11:00:00-04:00',
      }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set());
  });

  it('a re-suspend after an unsuspend puts it back — the history is a sequence, not a toggle read once', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1', timestamp: '2026-08-10T09:00:00-04:00' }),
      suspension({ eventId: 'u1', kind: 'unsuspend', timestamp: '2026-08-10T11:00:00-04:00' }),
      suspension({ eventId: 's2', timestamp: '2026-08-10T15:00:00-04:00' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set(['qa:imbrication:1']));
  });

  it('tracks each instrument independently', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1', instrumentId: 'a' }),
      suspension({ eventId: 's2', instrumentId: 'b' }),
      suspension({
        eventId: 'u1',
        kind: 'unsuspend',
        instrumentId: 'b',
        timestamp: '2026-08-10T12:00:00-04:00',
      }),
      suspension({ eventId: 's3', instrumentId: 'c' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set(['a', 'c']));
  });

  it('ignores review events interleaved with suspension events for the same instrument', () => {
    // Reviewing a suspended instrument (e.g. finishing the item she was on
    // before suspending it) must not quietly unsuspend it.
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1', timestamp: '2026-08-10T09:00:00-04:00' }),
      review({ eventId: 'r1', timestamp: '2026-08-10T18:00:00-04:00' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set(['qa:imbrication:1']));
  });
});

describe('suspendedInstrumentIds — out-of-order input', () => {
  // The list comes from several devices' files. A caller that read them in a
  // different order, or handed them over unsorted, must not get a different
  // answer about what she is currently studying — so "last" is resolved by
  // timestamp, not by array position.
  const chronological: ReviewLogEntry[] = [
    suspension({ eventId: 's1', timestamp: '2026-08-10T09:00:00-04:00' }),
    suspension({ eventId: 'u1', kind: 'unsuspend', timestamp: '2026-08-10T11:00:00-04:00' }),
  ];

  it('reversed input gives the identical projection', () => {
    const reversed = [...chronological].reverse();
    expect(suspendedInstrumentIds(reversed)).toEqual(suspendedInstrumentIds(chronological));
    expect(suspendedInstrumentIds(reversed)).toEqual(new Set());
  });

  it('an unsuspend listed before the suspend it follows in time still wins', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 'u1', kind: 'unsuspend', timestamp: '2026-08-10T11:15:00-04:00' }),
      suspension({ eventId: 's1', timestamp: '2026-08-10T09:40:00-04:00' }),
    ];
    // A positional fold would answer `suspended` here. That is the bug this
    // test exists to keep out.
    expect(suspendedInstrumentIds(entries)).toEqual(new Set());
  });

  it('every permutation of the same events projects to the same set', () => {
    const events: ReviewLogEntry[] = [
      suspension({ eventId: 's1', instrumentId: 'a', timestamp: '2026-08-10T09:00:00-04:00' }),
      suspension({
        eventId: 'u1',
        kind: 'unsuspend',
        instrumentId: 'a',
        timestamp: '2026-08-10T10:00:00-04:00',
      }),
      suspension({ eventId: 's2', instrumentId: 'a', timestamp: '2026-08-10T11:00:00-04:00' }),
      suspension({ eventId: 's3', instrumentId: 'b', timestamp: '2026-08-10T12:00:00-04:00' }),
    ];
    const expected = new Set(['a', 'b']);
    const permutations = (xs: ReviewLogEntry[]): ReviewLogEntry[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
          );
    for (const order of permutations(events)) {
      expect(suspendedInstrumentIds(order)).toEqual(expected);
    }
  });

  it('two events on the same instrument at the same instant resolve deterministically by eventId', () => {
    // Not a real scenario so much as a "never returns a different answer on a
    // different day" guarantee: the tiebreaker matches ./merge.ts's.
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 'aaa', timestamp: '2026-08-10T09:00:00-04:00' }),
      suspension({ eventId: 'zzz', kind: 'unsuspend', timestamp: '2026-08-10T09:00:00-04:00' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set());
    expect(suspendedInstrumentIds([...entries].reverse())).toEqual(new Set());
  });
});

describe('suspendedInstrumentIds — an unsuspend with no preceding suspend', () => {
  it('is a no-op, not an error', () => {
    // The suspend may simply be in a file that has not synced yet, or in a day
    // file this caller did not read. An append-only distributed log cannot
    // promise paired events, so treating this as corruption would turn an
    // ordinary sync state into a failure.
    const lone = suspension({ eventId: 'u1', kind: 'unsuspend' });
    expect(() => suspendedInstrumentIds([lone])).not.toThrow();
    expect(suspendedInstrumentIds([lone])).toEqual(new Set());
  });

  it('does not affect any other instrument', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1', instrumentId: 'a' }),
      suspension({ eventId: 'u1', kind: 'unsuspend', instrumentId: 'orphan' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set(['a']));
  });

  it('a later real suspend for the same instrument still takes effect', () => {
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 'u1', kind: 'unsuspend', timestamp: '2026-08-10T09:00:00-04:00' }),
      suspension({ eventId: 's1', timestamp: '2026-08-10T10:00:00-04:00' }),
    ];
    expect(suspendedInstrumentIds(entries)).toEqual(new Set(['qa:imbrication:1']));
  });
});

describe('suspension writes no scheduling state (F2.6, R3)', () => {
  it('the projection is derived from entries alone — it takes and returns no scheduler state', () => {
    // A structural assertion, deliberately: F2.6 promises that suspending and
    // unsuspending leaves an instrument's due date and interval exactly as they
    // were. The way that promise is kept is that this whole module cannot
    // express a change to `SchedulerState` — it never receives one.
    const entries: ReviewLogEntry[] = [
      suspension({ eventId: 's1' }),
      suspension({ eventId: 'u1', kind: 'unsuspend', timestamp: '2026-08-10T12:00:00-04:00' }),
    ];
    const before = JSON.stringify(entries);
    suspendedInstrumentIds(entries);
    expect(JSON.stringify(entries)).toBe(before);
    expect(suspendedInstrumentIds.length).toBe(1);
  });
});

describe('isInstrumentSuspended', () => {
  it('answers the queue’s one question against a projected set', () => {
    const suspended = suspendedInstrumentIds([suspension({ instrumentId: 'a' })]);
    expect(isInstrumentSuspended(suspended, 'a')).toBe(true);
    expect(isInstrumentSuspended(suspended, 'b')).toBe(false);
  });
});
