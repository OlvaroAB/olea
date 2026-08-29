/**
 * `parseScheduleEventLine` and its field extractors (RHY-3 §9, `ol-4chx`).
 *
 * INV-3: every course code, note title and line of text in this file is
 * coined for the test. None of it comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import {
  extractDatedStamp,
  extractTimeRange,
  extractWeekday,
  isTaskListLine,
  parseScheduleEventLine,
} from './event-line.js';

describe('isTaskListLine', () => {
  it('is true for an unchecked task-list item', () => {
    expect(isTaskListLine('- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12')).toBe(true);
  });

  it('is true for a checked task-list item', () => {
    expect(isTaskListLine('- [x] GEOL101 - Monday 10:00-11:00 📅 2026-01-12')).toBe(true);
  });

  it('is false for a plain paragraph line, even one carrying the same fields', () => {
    expect(isTaskListLine('GEOL101 - Monday 10:00-11:00 📅 2026-01-12')).toBe(false);
  });

  it('is false for a heading or blank line', () => {
    expect(isTaskListLine('## Schedule')).toBe(false);
    expect(isTaskListLine('')).toBe(false);
  });
});

describe('extractDatedStamp — the small tolerant set of marker shapes (RHY-3 §8 stop 3)', () => {
  it('reads the Tasks-plugin emoji marker', () => {
    expect(extractDatedStamp('DANCE310 📅 2026-01-16')?.date).toBe('2026-01-16');
  });

  it('reads a Dataview inline-field marker', () => {
    expect(extractDatedStamp('PHIL220 [due:: 2026-01-14]')?.date).toBe('2026-01-14');
  });

  it('reads a plain "due:" label, case-insensitively', () => {
    expect(extractDatedStamp('PHIL220 DUE: 2026-01-14')?.date).toBe('2026-01-14');
  });

  it('is undefined when no recognised marker shape is present', () => {
    expect(extractDatedStamp('PHIL220 on 2026-01-14')).toBeUndefined();
  });
});

describe('extractWeekday — informational only, full names and abbreviations', () => {
  it('recognises a full weekday name, case-insensitively', () => {
    expect(extractWeekday('GEOL101 - monday 10:00-11:00')?.weekday).toBe('monday');
  });

  it('recognises a common abbreviation', () => {
    expect(extractWeekday('GEOL101 - Wed 10:00-11:00')?.weekday).toBe('wednesday');
  });

  it('is undefined when no weekday token is present', () => {
    expect(extractWeekday('GEOL101 10:00-11:00')).toBeUndefined();
  });
});

describe('extractTimeRange — verbatim, unused for freshness but retained', () => {
  it('reads a 24-hour range', () => {
    expect(extractTimeRange('GEOL101 - Monday 10:00-11:00')).toMatchObject({
      start: '10:00',
      end: '11:00',
    });
  });

  it('reads a range with am/pm suffixes', () => {
    expect(extractTimeRange('DANCE310 - Friday 2:00pm-3:30pm')).toMatchObject({
      start: '2:00pm',
      end: '3:30pm',
    });
  });

  it('is undefined when no time range is present', () => {
    expect(extractTimeRange('GEOL101 - Monday')).toBeUndefined();
  });
});

describe('parseScheduleEventLine — well-formed lines', () => {
  it('parses label, weekday, time range and date together', () => {
    expect(parseScheduleEventLine('- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12')).toEqual({
      label: 'GEOL101',
      weekday: 'monday',
      timeRange: { start: '10:00', end: '11:00' },
      date: '2026-01-12',
    });
  });

  it('parses with the Dataview marker and an abbreviated weekday', () => {
    expect(parseScheduleEventLine('- [ ] PHIL220 - Wed [due:: 2026-01-14]')).toEqual({
      label: 'PHIL220',
      weekday: 'wednesday',
      timeRange: undefined,
      date: '2026-01-14',
    });
  });

  it('parses a checked task item the same as an unchecked one', () => {
    expect(parseScheduleEventLine('- [x] DANCE310 - Friday 14:00-15:30 due: 2026-01-16')).toEqual({
      label: 'DANCE310',
      weekday: 'friday',
      timeRange: { start: '14:00', end: '15:30' },
      date: '2026-01-16',
    });
  });

  it('parses a label with only a date — weekday and time range are optional', () => {
    expect(parseScheduleEventLine('- [ ] HIST210 📅 2026-01-13')).toEqual({
      label: 'HIST210',
      weekday: undefined,
      timeRange: undefined,
      date: '2026-01-13',
    });
  });

  it('accepts `*` as the list marker, not only `-`', () => {
    expect(parseScheduleEventLine('* [ ] HIST210 📅 2026-01-13')?.label).toBe('HIST210');
  });
});

describe('parseScheduleEventLine — malformed or non-matching lines are skipped, never thrown', () => {
  it('returns undefined for a well-shaped line missing the mandatory date', () => {
    expect(parseScheduleEventLine('- [ ] GEOL101 - Monday 10:00-11:00')).toBeUndefined();
  });

  it('returns undefined for a non-task-list line carrying every other field', () => {
    expect(parseScheduleEventLine('GEOL101 - Monday 10:00-11:00 📅 2026-01-12')).toBeUndefined();
  });

  it('returns undefined when the date sits at the very start with nothing to serve as a label', () => {
    expect(parseScheduleEventLine('- [ ] 📅 2026-01-12')).toBeUndefined();
  });

  it('returns undefined for an empty task-list item', () => {
    expect(parseScheduleEventLine('- [ ] ')).toBeUndefined();
  });

  it('returns undefined for an ordinary to-do with no calendar fields at all', () => {
    expect(parseScheduleEventLine('- [ ] buy folders for next semester')).toBeUndefined();
  });

  it('never throws on a pathological line', () => {
    expect(() => parseScheduleEventLine('- [ ] 📅📅📅 -- :: due:: due: 2026')).not.toThrow();
  });
});
