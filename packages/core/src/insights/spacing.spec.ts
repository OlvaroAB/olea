/**
 * The spacing detector's own behaviour, on hand-built logs.
 *
 * **This file does not establish that the detector detects cramming.** It
 * establishes that its arithmetic and its three-way status are what the module
 * says they are. The claim that it fires on a crammer and goes quiet on the
 * same student with the pattern removed is a different kind of claim and is
 * asserted where a planted ground truth exists —
 * `packages/workbench/test/trends-scenarios.spec.ts`, against
 * `olea-synthetic`'s personas. Keeping the two apart matters: a detector that
 * passes only its own hand-built fixtures is the `ol-inv2vacuity` shape, and
 * hand-built fixtures are exactly where a detector gets to grade its own
 * homework.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_RATIO,
  CONCENTRATION_RATIO,
  detectSpacing,
  impliedAssessmentDays,
  MIN_NEAR_STUDY_DAYS,
  MIN_REVIEWS,
  PRE_ASSESSMENT_WINDOW_DAYS,
} from './spacing.js';

const DAY_MS = 86_400_000;
const START = Date.parse('2026-09-01T18:00:00.000Z');

function dayOf(offset: number): string {
  return new Date(START + offset * DAY_MS).toISOString().slice(0, 10);
}

interface ReviewOpts {
  readonly dayOffset: number;
  readonly examProximity: number | null;
  readonly index: number;
  readonly dueState?: ReviewLogRecord['selectionContext']['dueState'];
  readonly instrumentType?: ReviewLogRecord['instrumentType'];
}

function review(opts: ReviewOpts): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `e-${opts.dayOffset}-${opts.index}`,
    timestamp: new Date(START + opts.dayOffset * DAY_MS).toISOString().replace('Z', '+00:00'),
    instrumentId: `qa:c${opts.index % 4}:1`,
    instrumentType: opts.instrumentType ?? 'qa',
    conceptIds: [`c${opts.index % 4}`],
    rating: 'good',
    wasUnsure: false,
    durationMs: 5_000,
    selectionContext: {
      dueState: opts.dueState ?? 'due',
      examProximity: opts.examProximity,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/**
 * A 60-day history with one assessment on day 45.
 *
 * `perDay(offset)` decides how many reviews that day carries, so a steady
 * stream and a bursty one differ in exactly one function and nothing else.
 */
function history(
  perDay: (offset: number) => number,
  assessmentOffsets: readonly number[] = [45],
): ReviewLogEntry[] {
  const entries: ReviewLogEntry[] = [];
  let index = 0;
  for (let offset = 0; offset < 60; offset += 1) {
    const count = perDay(offset);
    const next = [...assessmentOffsets].sort((a, b) => a - b).find((at) => at >= offset);
    for (let n = 0; n < count; n += 1) {
      index += 1;
      entries.push(
        review({
          dayOffset: offset,
          examProximity: next === undefined ? null : next - offset,
          index,
        }),
      );
    }
  }
  return entries;
}

describe('impliedAssessmentDays', () => {
  it('reads the assessment dates back out of the log itself', () => {
    expect(impliedAssessmentDays(history(() => 1))).toEqual([dayOf(45)]);
  });

  it('is empty when nothing in the log ever saw an assessment', () => {
    const entries = history(() => 1).map((e) =>
      e.kind === 'review'
        ? { ...e, selectionContext: { ...e.selectionContext, examProximity: null } }
        : e,
    );
    expect(impliedAssessmentDays(entries)).toEqual([]);
  });
});

describe('detectSpacing — the three statuses are three different statements', () => {
  it('declines on a history too short to say anything, and says which floor it hit', () => {
    const result = detectSpacing(history((offset) => (offset < 3 ? 2 : 0)));
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
    expect(result.reason).toContain(String(MIN_REVIEWS));
  });

  it('declines rather than reporting a negative when no assessment was ever visible', () => {
    const entries = history(() => 3).map((e) =>
      e.kind === 'review'
        ? { ...e, selectionContext: { ...e.selectionContext, examProximity: null } }
        : e,
    );
    const result = detectSpacing(entries);
    expect(result.status).toBe('not-enough-history');
    expect(result.reason).toContain('assessment');
  });

  it('a flat reviewer is not-observed — she was measured, and the pattern is not there', () => {
    const result = detectSpacing(history(() => 4));
    expect(result.status).toBe('not-observed');
    expect(result.measured).not.toBeNull();
    // A rate divided by an identical rate. Not "close to 1" — exactly 1, because
    // the statistic carries its own control and nothing about volume enters it.
    expect(result.measured?.concentration).toBeCloseTo(1, 10);
  });

  it('volume does not move the statistic: ten times the work, same answer', () => {
    const thin = detectSpacing(history(() => 1));
    const thick = detectSpacing(history(() => 10));
    expect(thin.status).toBe('not-observed');
    expect(thick.status).toBe('not-observed');
    expect(thick.measured?.concentration).toBeCloseTo(thin.measured?.concentration ?? -1, 10);
  });

  it('fires when she both works harder and turns up more in the days before an assessment', () => {
    const result = detectSpacing(
      history((offset) =>
        offset > 45 - PRE_ASSESSMENT_WINDOW_DAYS && offset <= 45 ? 20 : offset % 4 === 0 ? 2 : 0,
      ),
    );
    expect(result.status).toBe('observed');
    expect(result.measured?.concentration).toBeGreaterThan(CONCENTRATION_RATIO);
    expect(result.measured?.attendanceRatio).toBeGreaterThan(ATTENDANCE_RATIO);
    expect(result.measured?.nearReviewsPerDay).toBeGreaterThan(
      result.measured?.farReviewsPerDay ?? 0,
    );
  });

  it('does NOT fire on a daily reviewer who merely does more that week — the documented miss', () => {
    // Both conditions are required, and this is the cost of that. She studies
    // every day either way, so nothing says the assessment is what brought her
    // to the desk; the log cannot separate her from someone whose deck simply
    // had more due. Asserted rather than described so the trade-off is visible
    // if anyone later drops the second condition. See `ATTENDANCE_RATIO`.
    const result = detectSpacing(
      history((offset) => (offset > 45 - PRE_ASSESSMENT_WINDOW_DAYS && offset <= 45 ? 20 : 1)),
    );
    expect(result.status).toBe('not-observed');
    expect(result.measured?.concentration).toBeGreaterThan(CONCENTRATION_RATIO);
    expect(result.measured?.attendanceRatio).toBe(1);
    expect(result.reason).toContain('attendance');
  });

  it('counts calendar days, not study days — a fortnight off is a fortnight of low density', () => {
    // She works only in the two pre-assessment windows and nowhere else.
    // Counting only the days she opened the app would report her as perfectly
    // even; counting calendar days reports what actually happened.
    const near = (offset: number, at: number): boolean =>
      offset > at - PRE_ASSESSMENT_WINDOW_DAYS && offset <= at;
    const result = detectSpacing(
      history((offset) => (near(offset, 10) || near(offset, 45) ? 30 : 0), [10, 45]),
    );
    expect(result.status).toBe('observed');
    expect(result.measured?.farReviewsPerDay).toBe(0);
    expect(result.measured?.concentration).toBe(Number.POSITIVE_INFINITY);
  });

  it('declines when the whole logged history sits inside one pre-assessment window', () => {
    // The most extreme cramming shape available is also the one this detector
    // must refuse: with seven days of log and nothing either side, "she crams"
    // and "she installed Olea the week before the exam" produce the same bytes,
    // and only one of them is a finding.
    const result = detectSpacing(
      history((offset) => (offset > 45 - PRE_ASSESSMENT_WINDOW_DAYS && offset <= 45 ? 30 : 0)),
    );
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
  });

  it('earlyShare counts scheduled items only — explain-back has no due date to be pulled from', () => {
    const entries: ReviewLogEntry[] = [];
    for (let offset = 0; offset < 60; offset += 1) {
      entries.push(
        review({
          dayOffset: offset,
          examProximity: 45 - offset,
          index: offset * 2,
          dueState: 'early',
        }),
        review({
          dayOffset: offset,
          examProximity: 45 - offset,
          index: offset * 2 + 1,
          instrumentType: 'explain-back',
          dueState: 'new',
        }),
      );
    }
    // Half the records are explain-back. Every scheduled record is early, so an
    // honest share is 1 — a share computed over all records would read 0.5.
    expect(detectSpacing(entries).measured?.earlyShare).toBe(1);
  });

  it('SPC-1 (ol-5xg9): one busy evening in an otherwise-idle pre-assessment week no longer reads as a pattern', () => {
    // The neutralised-twin shape from `ol-cahv`, built by hand: a reviewer who
    // is sparse everywhere, including in the week before her assessment,
    // except for one evening that lands inside the near window. Before this
    // gate existed, that single day was enough to clear BOTH conditions —
    // concentration and attendance — on its own, because the near window's
    // "rate" is a rate over almost nothing.
    const perDay = (offset: number): number => {
      if (offset === 3 || offset === 15 || offset === 30) return 6; // far, spread thin
      if (offset === 45) return 15; // the one busy evening — inside the near window
      return 0;
    };
    const result = detectSpacing(history(perDay));

    // AFTER: the gate declines rather than reporting the pattern.
    expect(result.status).toBe('not-enough-history');
    expect(result.reason).toContain(String(MIN_NEAR_STUDY_DAYS));
    expect(result.reason).toContain('pre-assessment window');

    // The gate silences the VERDICT, not the arithmetic (`abstain`'s doc): the
    // same numbers the old, ungated rule would have called `observed` on are
    // still visible in `measured`, which is the "shows its working" property
    // `InsightResult`'s doc asks for. This is the BEFORE half of the
    // before/after, recovered from the one call rather than a second one,
    // because there is no separate "ungated" function to call — the ratios
    // are computed identically either way and only the status differs.
    expect(result.measured).not.toBeNull();
    expect(result.measured?.concentration).toBeGreaterThanOrEqual(CONCENTRATION_RATIO);
    expect(result.measured?.attendanceRatio).toBeGreaterThanOrEqual(ATTENDANCE_RATIO);
    // And the actual failing floor: exactly one distinct near study-day.
    const measured = result.measured;
    expect(measured).not.toBeNull();
    if (measured !== null) {
      expect(measured.nearStudyDayShare).toBeCloseTo(1 / measured.nearDayCount, 10);
    }
  });

  it('SPC-1: a genuine week of near-daily study still clears the floor and fires', () => {
    // Regression guard on the floor itself: `MIN_NEAR_STUDY_DAYS` must not
    // suppress the ordinary case the detector exists to catch. Same shape as
    // "fires when she both works harder and turns up more" above, asserted
    // here specifically against the new constant so a future change to it is
    // caught by name rather than only by a pre-existing test going red.
    const result = detectSpacing(
      history((offset) =>
        offset > 45 - PRE_ASSESSMENT_WINDOW_DAYS && offset <= 45 ? 20 : offset % 4 === 0 ? 2 : 0,
      ),
    );
    expect(result.status).toBe('observed');
    expect(result.measured?.nearDayCount).toBeGreaterThanOrEqual(MIN_NEAR_STUDY_DAYS);
  });

  it('is pure and leaves the log untouched', () => {
    const entries = history(() => 3);
    const snapshot = JSON.stringify(entries);
    const first = detectSpacing(entries);
    const second = detectSpacing(entries);
    expect(second).toEqual(first);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
