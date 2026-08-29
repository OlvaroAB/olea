/**
 * `matchCourseLabel` / `associateScheduleEvents` (RHY-3 §9, `ol-r6s0`).
 *
 * INV-3: every course code, note title, path and line of text in this file
 * is coined for the test. None of it comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { associateScheduleEvents, matchCourseLabel } from './associate.js';
import type { ScheduleEventRecord } from './types.js';

function event(label: string, overrides: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord {
  return {
    sourcePath: 'Imports/synced.md',
    lineNumber: 1,
    label,
    weekday: undefined,
    timeRange: undefined,
    date: '2026-01-12',
    ...overrides,
  };
}

describe('matchCourseLabel — one label against the roster, in isolation', () => {
  const roster = new Set(['GEOL101', 'PHIL220', 'DANCE310']);

  it('matches case-insensitively, returning the roster spelling — not the label casing', () => {
    expect(matchCourseLabel('Geol101', roster)).toEqual({
      status: 'matched',
      courseCode: 'GEOL101',
    });
  });

  it('matches when the label is already an exact case match', () => {
    expect(matchCourseLabel('PHIL220', roster)).toEqual({
      status: 'matched',
      courseCode: 'PHIL220',
    });
  });

  it('is unmatched with reason "no-match" when the label matches no known course', () => {
    expect(matchCourseLabel('buy folders', roster)).toEqual({
      status: 'unmatched',
      reason: 'no-match',
    });
  });

  it('is unmatched with reason "no-match" for a near-miss that is not an exact match once case-folded', () => {
    // Deliberately not a prefix or substring match — RHY-3 §9 asks for exact
    // case-insensitive comparison, not fuzzy matching.
    expect(matchCourseLabel('GEOL10', roster)).toEqual({ status: 'unmatched', reason: 'no-match' });
    expect(matchCourseLabel('GEOL1010', roster)).toEqual({
      status: 'unmatched',
      reason: 'no-match',
    });
  });

  it('is unmatched with reason "ambiguous" when the label case-folds to more than one roster entry', () => {
    // Not observed in the reference vault (RHY-3 §9), but named rather than
    // assumed impossible: a roster carrying two distinct-cased spellings of
    // what collapses to the same code must not guess between them.
    const collidingRoster = new Set(['Stat1', 'STAT1']);
    expect(matchCourseLabel('stat1', collidingRoster)).toEqual({
      status: 'unmatched',
      reason: 'ambiguous',
    });
  });

  it('is unmatched with reason "no-match" against an empty roster', () => {
    expect(matchCourseLabel('GEOL101', new Set())).toEqual({
      status: 'unmatched',
      reason: 'no-match',
    });
  });
});

describe('associateScheduleEvents — a whole event list, degrading per event', () => {
  const roster = new Set(['GEOL101', 'PHIL220']);

  it('associates every event whose label matches exactly one course, roster-cased', () => {
    const events = [event('geol101'), event('Phil220')];
    const report = associateScheduleEvents(events, roster);

    expect(report.matched).toEqual([
      { event: events[0], courseCode: 'GEOL101' },
      { event: events[1], courseCode: 'PHIL220' },
    ]);
    expect(report.unmatched).toEqual([]);
  });

  it("an unmatched event never affects another event's match — both buckets fill independently", () => {
    const events = [event('geol101'), event('personal errand'), event('Phil220')];
    const report = associateScheduleEvents(events, roster);

    expect(report.matched.map((m) => m.courseCode)).toEqual(['GEOL101', 'PHIL220']);
    expect(report.unmatched).toEqual([{ event: events[1], reason: 'no-match' }]);
  });

  it('an ambiguous label is bucketed as unmatched, distinct from a no-match', () => {
    const collidingRoster = new Set(['Stat1', 'STAT1']);
    const events = [event('stat1')];
    const report = associateScheduleEvents(events, collidingRoster);

    expect(report.matched).toEqual([]);
    expect(report.unmatched).toEqual([{ event: events[0], reason: 'ambiguous' }]);
  });

  it('a zero-course roster leaves every event unmatched, never throws', () => {
    const events = [event('geol101'), event('Phil220')];
    const report = associateScheduleEvents(events, new Set());

    expect(report.matched).toEqual([]);
    expect(report.unmatched).toHaveLength(2);
  });

  it('an empty event list produces an empty report either way', () => {
    expect(associateScheduleEvents([], roster)).toEqual({ matched: [], unmatched: [] });
  });

  it('a personal or non-course label degrades to unusable, never an error', () => {
    const events = [event('dentist appointment')];
    const report = associateScheduleEvents(events, roster);
    expect(() => associateScheduleEvents(events, roster)).not.toThrow();
    expect(report.unmatched).toEqual([{ event: events[0], reason: 'no-match' }]);
  });
});
