/**
 * Scenarios: `features/F6-today.md` (olea-service), F6.6 re-entry composition
 * — the absence-signal producer `composeReentrySession`'s own reachability
 * note names as missing (`ol-v7r5.18`, discovered from `ol-blwb` /
 * `[BKLG-1]`). No `@auto:<testID>` tag of its own: this is the data-layer
 * fact `isReentryDue`/`composeReentrySession` consume, exercised end to end
 * by `reentry.spec.ts`'s own suite and by `session-builder/provider.spec.ts`
 * (the production wiring).
 */
import type { ReviewLogEntry, ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { daysSinceLastReview } from './absence.js';

function review(timestamp: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${timestamp}`,
    timestamp,
    instrumentId: 'i1',
    instrumentType: 'qa',
    conceptIds: ['Widget theory'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1000,
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

function suspend(timestamp: string, overrides: Partial<SuspendLogRecord> = {}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: `s-${timestamp}`,
    timestamp,
    instrumentId: 'i1',
    conceptIds: ['Widget theory'],
    ...overrides,
  };
}

describe('daysSinceLastReview', () => {
  it('is 0 on the same UTC calendar day as the last review', () => {
    const entries = [review('2026-08-10T09:00:00-04:00')];
    expect(daysSinceLastReview(entries, new Date('2026-08-10T20:00:00Z'))).toBe(0);
  });

  it('counts whole UTC days between the last review and now', () => {
    const entries = [review('2026-08-01T09:00:00-04:00')];
    expect(daysSinceLastReview(entries, new Date('2026-08-22T09:00:00-04:00'))).toBe(21);
  });

  it('uses the MOST RECENT review, not the first or an arbitrary one', () => {
    const entries = [
      review('2026-08-01T09:00:00-04:00'),
      review('2026-08-15T09:00:00-04:00'),
      review('2026-08-05T09:00:00-04:00'),
    ];
    expect(daysSinceLastReview(entries, new Date('2026-08-22T09:00:00-04:00'))).toBe(7);
  });

  it('is 0 when the log holds no review entry at all — never reviewed is not an absence', () => {
    expect(daysSinceLastReview([], new Date('2026-08-22T09:00:00-04:00'))).toBe(0);
  });

  it('ignores suspend/unsuspend entries — a suspension is a decision about her deck, not a review', () => {
    const entries = [suspend('2026-08-21T09:00:00-04:00')];
    // No review entry at all, so this is the "never reviewed" branch, not "reviewed yesterday".
    expect(daysSinceLastReview(entries, new Date('2026-08-22T09:00:00-04:00'))).toBe(0);
  });

  it('a suspend after the last real review does not reset the absence clock', () => {
    const entries = [review('2026-08-01T09:00:00-04:00'), suspend('2026-08-20T09:00:00-04:00')];
    expect(daysSinceLastReview(entries, new Date('2026-08-22T09:00:00-04:00'))).toBe(21);
  });

  it('skips a record whose timestamp does not parse, rather than throwing', () => {
    const entries = [review('2026-08-01T09:00:00-04:00'), review('not-a-timestamp')];
    expect(daysSinceLastReview(entries, new Date('2026-08-08T09:00:00-04:00'))).toBe(7);
  });

  it('floors at 0 rather than reporting a negative absence for a review logged after "now"', () => {
    const entries = [review('2026-08-22T09:00:00-04:00')];
    expect(daysSinceLastReview(entries, new Date('2026-08-01T09:00:00-04:00'))).toBe(0);
  });

  it('is >= REENTRY_ABSENCE_THRESHOLD_DAYS after three weeks of silence — the F6.6 case this producer exists for', () => {
    const entries = [review('2026-08-01T09:00:00-04:00')];
    expect(
      daysSinceLastReview(entries, new Date('2026-08-22T09:00:00-04:00')),
    ).toBeGreaterThanOrEqual(7);
  });
});
