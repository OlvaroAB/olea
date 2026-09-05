import { describe, expect, it } from 'vitest';
import { disputeAt, misconceptionAt, reviewAt, suspendAt } from './fixtures.js';
import { foldSessionLedgers } from './session-ledger.js';
import type { SessionLedger, SessionLedgerItem } from './types.js';

const GAP_MS = 30 * 60 * 1000;

/** The first session, asserted present — keeps every test below free of `?.`. */
function firstSession(sessions: readonly SessionLedger[]): SessionLedger {
  const session = sessions[0];
  if (session === undefined) throw new Error('expected at least one session');
  return session;
}

/** The nth item of a session, asserted present, for the same reason. */
function item(session: SessionLedger, index: number): SessionLedgerItem {
  const found = session.items[index];
  if (found === undefined) throw new Error(`expected an item at ${index}`);
  return found;
}

describe('foldSessionLedgers', () => {
  it('refuses a gap that is not a positive finite number, rather than guessing one', () => {
    expect(() => foldSessionLedgers([], 0)).toThrow(RangeError);
    expect(() => foldSessionLedgers([], Number.NaN)).toThrow(RangeError);
    expect(() => foldSessionLedgers([], Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('returns nothing when the log holds no review events', () => {
    expect(foldSessionLedgers([suspendAt('e1', '2026-05-13T19:03:00Z', 'i1')], GAP_MS)).toEqual([]);
  });

  it('splits on an inactivity gap and returns sessions newest first', () => {
    const entries = [
      reviewAt('e1', '2026-05-13T19:00:00Z', 'i1'),
      reviewAt('e2', '2026-05-13T19:05:00Z', 'i2'),
      reviewAt('e3', '2026-05-13T21:00:00Z', 'i3'),
    ];

    const sessions = foldSessionLedgers(entries, GAP_MS);

    expect(sessions).toHaveLength(2);
    expect(firstSession(sessions).items.map((i) => i.eventId)).toEqual(['e3']);
    const earlier = sessions[1];
    if (earlier === undefined) throw new Error('expected a second session');
    expect(earlier.items.map((i) => i.eventId)).toEqual(['e1', 'e2']);
    expect(earlier.startedAt).toBe('2026-05-13T19:00:00Z');
    expect(earlier.endedAt).toBe('2026-05-13T19:05:00Z');
  });

  it('orders items by instant and eventId, not by the order the files were read', () => {
    const entries = [
      reviewAt('e2', '2026-05-13T19:05:00Z', 'i2'),
      reviewAt('e1', '2026-05-13T19:00:00Z', 'i1'),
    ];

    expect(firstSession(foldSessionLedgers(entries, GAP_MS)).items.map((i) => i.eventId)).toEqual([
      'e1',
      'e2',
    ]);
  });

  it('links a misconception observation to its own review by the log back-reference', () => {
    const entries = [
      reviewAt('e1', '2026-05-13T19:00:00Z', 'i1', { instrumentType: 'mcq', rating: 'again' }),
      reviewAt('e2', '2026-05-13T19:02:00Z', 'i2'),
      misconceptionAt('m1', '2026-05-13T19:00:01Z', 'i1', 'e1'),
    ];

    const session = firstSession(foldSessionLedgers(entries, GAP_MS));

    expect(item(session, 0).misconceptionEventIds).toEqual(['m1']);
    expect(item(session, 1).misconceptionEventIds).toEqual([]);
  });

  it('carries non-review events inside the span that touch an answered instrument', () => {
    const entries = [
      reviewAt('e1', '2026-05-13T19:00:00Z', 'i1'),
      reviewAt('e2', '2026-05-13T19:10:00Z', 'i2'),
      disputeAt('d1', '2026-05-13T19:05:00Z', 'i1'),
      disputeAt('d2', '2026-05-13T19:05:00Z', 'i-elsewhere'),
      suspendAt('s1', '2026-05-13T23:00:00Z', 'i1'),
    ];

    const session = firstSession(foldSessionLedgers(entries, GAP_MS));

    expect(session.related.map((entry) => entry.eventId)).toEqual(['d1']);
  });

  it('emits no total, percentage or grade-like summary field', () => {
    const session = firstSession(
      foldSessionLedgers(
        [
          reviewAt('e1', '2026-05-13T19:00:00Z', 'i1', { rating: 'again' }),
          reviewAt('e2', '2026-05-13T19:02:00Z', 'i2', { rating: 'good' }),
        ],
        GAP_MS,
      ),
    );

    expect(Object.keys(session).sort()).toEqual(['endedAt', 'items', 'related', 'startedAt']);
    for (const key of Object.keys(item(session, 0))) {
      expect(key).not.toMatch(/count|total|percent|score|accuracy|correct/i);
    }
  });
});
