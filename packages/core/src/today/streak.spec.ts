import type { ReviewLogEntry, ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { computeStreak, type StreakSummary, studyDays } from './streak.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:clast-imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['clast-imbrication'],
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
    instrumentId: 'qa:clast-imbrication:1',
    conceptIds: ['clast-imbrication'],
    ...overrides,
  };
}

/** Reviews on each of the given days, at a fixed local time. */
function reviewsOn(days: readonly string[]): ReviewLogEntry[] {
  return days.map((day, i) => review({ eventId: `r${i}`, timestamp: `${day}T20:00:00-04:00` }));
}

const TODAY = '2026-08-10';

describe('studyDays — what counts as having studied', () => {
  it('an empty log is no days', () => {
    expect(studyDays([])).toEqual(new Set());
  });

  it('twelve reviews on one day are one day', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      review({
        eventId: `r${i}`,
        timestamp: `2026-08-10T${String(8 + i).padStart(2, '0')}:00:00-04:00`,
      }),
    );
    expect(studyDays(entries)).toEqual(new Set(['2026-08-10']));
  });

  it('a suspend is not a study session — tidying the deck is not studying', () => {
    expect(studyDays([suspension()])).toEqual(new Set());
    expect(studyDays([suspension({ kind: 'unsuspend', eventId: 'u1' })])).toEqual(new Set());
  });

  it('an explain-back attempt counts, rating or no rating', () => {
    const entries = [
      review({
        instrumentType: 'explain-back',
        rating: null,
        timestamp: `${TODAY}T19:00:00-04:00`,
      }),
    ];
    expect(studyDays(entries)).toEqual(new Set([TODAY]));
  });

  it('the day is the local one the record carries, not the UTC one', () => {
    // 01:00 on the 11th at UTC+2 is the 10th in UTC. It is her 11th.
    const entries = [review({ timestamp: '2026-08-11T01:00:00+02:00' })];
    expect(studyDays(entries)).toEqual(new Set(['2026-08-11']));
  });

  it('one unreadable timestamp costs one record, never the days around it', () => {
    const entries = [
      review({ eventId: 'a', timestamp: `${TODAY}T09:00:00-04:00` }),
      review({ eventId: 'b', timestamp: 'garbage' }),
      review({ eventId: 'c', timestamp: '2026-08-09T09:00:00-04:00' }),
    ];
    expect(studyDays(entries)).toEqual(new Set(['2026-08-10', '2026-08-09']));
  });
});

describe('computeStreak — it counts', () => {
  it('no history is zero, with no complaint about it', () => {
    const summary = computeStreak([], { today: TODAY, windowDays: 30 });
    expect(summary.currentDays).toBe(0);
    expect(summary.studiedToday).toBe(false);
    expect(summary.atWindowEdge).toBe(false);
  });

  it('studying today alone is one day', () => {
    const summary = computeStreak(reviewsOn([TODAY]), { today: TODAY, windowDays: 30 });
    expect(summary.currentDays).toBe(1);
    expect(summary.studiedToday).toBe(true);
  });

  it('an unbroken run through today counts every day of it', () => {
    const days = ['08-04', '08-05', '08-06', '08-07', '08-08', '08-09', '08-10'].map(
      (d) => `2026-${d}`,
    );
    const summary = computeStreak(reviewsOn(days), { today: TODAY, windowDays: 30 });
    expect(summary.currentDays).toBe(7);
  });
});

describe('computeStreak — no pressure in the number it returns', () => {
  it('a run that ends yesterday is intact, because a morning is not a failure', () => {
    const days = ['2026-08-07', '2026-08-08', '2026-08-09'];
    const summary = computeStreak(reviewsOn(days), { today: TODAY, windowDays: 30 });
    expect(summary.currentDays).toBe(3);
    expect(summary.studiedToday).toBe(false);
  });

  it('two missed days make a smaller number, and that is the whole of the consequence', () => {
    // Nine days ending 2026-08-05, then a gap, then yesterday and today.
    const intactDays = [
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ];
    const brokenDays = intactDays.filter((d) => d !== '2026-08-07' && d !== '2026-08-06');

    const intact = computeStreak(reviewsOn(intactDays), { today: TODAY, windowDays: 30 });
    const broken = computeStreak(reviewsOn(brokenDays), { today: TODAY, windowDays: 30 });

    expect(intact.currentDays).toBe(14);
    expect(broken.currentDays).toBe(3);

    // Display only: every other field is the same, and the shape is identical.
    expect(Object.keys(broken).sort()).toEqual(Object.keys(intact).sort());
    expect(broken.studiedToday).toBe(intact.studiedToday);
    expect(broken.windowDays).toBe(intact.windowDays);
    expect(broken.week).toHaveLength(intact.week.length);
  });

  it('a break writes nothing — the input is untouched and there is nowhere else to write', () => {
    const entries = reviewsOn(['2026-08-01', '2026-08-09']);
    const snapshot = structuredClone(entries);
    computeStreak(entries, { today: TODAY, windowDays: 30 });
    computeStreak(entries, { today: TODAY, windowDays: 30 });
    expect(entries).toEqual(snapshot);
  });

  it('the same input always gives the same answer — no clock is read', () => {
    const entries = reviewsOn(['2026-08-09', '2026-08-10']);
    const first = computeStreak(entries, { today: TODAY, windowDays: 30 });
    const second = computeStreak(entries, { today: TODAY, windowDays: 30 });
    expect(second).toEqual(first);
  });

  it('there is no record to lose: no longest, best, broken or missed field', () => {
    const summary = computeStreak(reviewsOn(['2026-08-09']), { today: TODAY, windowDays: 30 });
    // Asserted as an exact field set, not a set of absences, so a field added
    // later has to come through this test rather than past it.
    expect(Object.keys(summary).sort()).toEqual(
      ['atWindowEdge', 'currentDays', 'studiedToday', 'week', 'windowDays'].sort(),
    );
    const forbidden: readonly string[] = [
      'longest',
      'longestStreak',
      'best',
      'bestEver',
      'record',
      'brokenOn',
      'broken',
      'daysMissed',
      'missed',
      'lost',
    ];
    for (const key of forbidden) {
      expect(summary as unknown as Record<string, unknown>).not.toHaveProperty(key);
    }
  });
});

describe('computeStreak — the week strip', () => {
  it('is the trailing week, oldest first, ending on today', () => {
    const summary = computeStreak([], { today: TODAY, windowDays: 30 });
    expect(summary.week.map((d) => d.day)).toEqual([
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ]);
    expect(summary.week.filter((d) => d.isToday).map((d) => d.day)).toEqual([TODAY]);
  });

  it('a missed day and a day not yet lived carry the same mark — there is no "missed"', () => {
    // She studied on the 8th; the 9th is missed; today is not studied yet. The
    // 9th and today are indistinguishable in the data, which is the point.
    const summary = computeStreak(reviewsOn(['2026-08-08']), { today: TODAY, windowDays: 30 });
    const missed = summary.week.find((d) => d.day === '2026-08-09');
    const today = summary.week.find((d) => d.day === TODAY);
    expect(missed?.studied).toBe(false);
    expect(today?.studied).toBe(false);
    // A StreakDay carries no flag that separates them.
    expect(Object.keys(missed ?? {}).sort()).toEqual(['day', 'isToday', 'studied']);
  });

  it('the strip length is configurable without touching the streak count', () => {
    const summary = computeStreak(reviewsOn(['2026-08-09', TODAY]), {
      today: TODAY,
      windowDays: 30,
      weekLength: 3,
    });
    expect(summary.week).toHaveLength(3);
    expect(summary.currentDays).toBe(2);
  });
});

describe('computeStreak — the window it read', () => {
  it('a run reaching the oldest day read is reported as a floor, not a measurement', () => {
    const days = ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10'];
    const summary = computeStreak(reviewsOn(days), { today: TODAY, windowDays: 5 });
    expect(summary.currentDays).toBe(5);
    expect(summary.atWindowEdge).toBe(true);
  });

  it('a run that stops inside the window is exact', () => {
    const days = ['2026-08-08', '2026-08-09', '2026-08-10'];
    const summary = computeStreak(reviewsOn(days), { today: TODAY, windowDays: 30 });
    expect(summary.currentDays).toBe(3);
    expect(summary.atWindowEdge).toBe(false);
  });

  it('a zero streak is never at the window edge', () => {
    const summary = computeStreak([], { today: TODAY, windowDays: 1 });
    expect(summary.currentDays).toBe(0);
    expect(summary.atWindowEdge).toBe(false);
  });

  it('rejects a malformed today or window rather than guessing', () => {
    expect(() => computeStreak([], { today: '2026-8-10', windowDays: 30 })).toThrow(
      /not a calendar day/,
    );
    expect(() => computeStreak([], { today: TODAY, windowDays: 0 })).toThrow(/positive integer/);
  });
});

describe('StreakSummary is a plain projection', () => {
  it('carries only what the panel draws', () => {
    const summary: StreakSummary = computeStreak([], { today: TODAY, windowDays: 7 });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
