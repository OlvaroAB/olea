/**
 * Scenarios: `../../../../olea-service/features/F2-review.md`, the "F2.17
 * amendment — [D-240] item 2" block's `[SESS-7]` scenarios —
 * @auto:core/scheduler/serving.spec
 *
 * This file tests the RULE. The two composers that call it have their own
 * suites for what applying it does to a composed session
 * (`../queue/compose.spec.ts`, `../study-session/build.spec.ts`); what is
 * asserted here is the bound itself, in both of its forms, and that the
 * never-reviewed one is read out of the scheduler rather than written down.
 */

import { describe, expect, it } from 'vitest';
import { addDays } from '../dates.js';
import { createFsrsScheduler } from './fsrs-scheduler.js';
import {
  DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER,
  FINAL_WEEK_DAYS,
  firstIntervalDaysAfterGood,
  hasWaitedItsOwnInterval,
  isWithinFinalWeek,
  recallOutranksFormatPreference,
} from './serving.js';
import type { SchedulerState } from './types.js';

const NOW = new Date('2026-09-14T09:00:00.000Z');

function stateDue(due: Date, scheduledDays: number): SchedulerState {
  return {
    schemaVersion: 1,
    due: due.toISOString(),
    stability: 3,
    difficulty: 5,
    scheduledDays,
    learningStepIndex: 0,
    reps: 2,
    lapses: 0,
    learningState: 'review',
    lastReview: addDays(due, -scheduledDays).toISOString(),
  };
}

/** `daysAgo` days before `NOW`, as a `YYYY-MM-DD` arrival day. */
function arrivedDaysAgo(daysAgo: number): string {
  return addDays(NOW, -daysAgo).toISOString().slice(0, 10);
}

describe('the first interval is read from the scheduler, never written down', () => {
  it('is exactly what the FSRS wrapper assigns on a first good answer', () => {
    const { intervalDays } = createFsrsScheduler().schedule({
      instrumentId: 'probe',
      state: null,
      rating: 'good',
      now: NOW,
    });
    expect(firstIntervalDaysAfterGood()).toBe(intervalDays);
  });

  it('does not depend on the instant it is asked at — fuzz is off', () => {
    const scheduler = createFsrsScheduler();
    const onAnotherDay = scheduler.schedule({
      instrumentId: 'probe',
      state: null,
      rating: 'good',
      now: new Date('2027-03-02T22:41:00.000Z'),
    }).intervalDays;
    expect(firstIntervalDaysAfterGood()).toBe(onAnotherDay);
  });

  it('is a positive whole number of days', () => {
    // The property the never-reviewed branch depends on: a zero or negative
    // interval would make every never-asked card instantly undeferrable,
    // which is not what "waits as long as a first good answer would make it
    // wait" means.
    expect(Number.isInteger(firstIntervalDaysAfterGood())).toBe(true);
    expect(firstIntervalDaysAfterGood()).toBeGreaterThan(0);
  });
});

describe('one bound, one multiplier, two ways of knowing the interval', () => {
  it('measures a reviewed instrument against its own scheduled interval', () => {
    const scheduledDays = 5;
    const bound = scheduledDays * DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER;
    expect(
      hasWaitedItsOwnInterval(
        { instrumentType: 'qa', state: stateDue(addDays(NOW, -bound), scheduledDays) },
        NOW,
      ),
    ).toBe(true);
    expect(
      hasWaitedItsOwnInterval(
        { instrumentType: 'qa', state: stateDue(addDays(NOW, -(bound - 1)), scheduledDays) },
        NOW,
      ),
    ).toBe(false);
  });

  it('measures a never-reviewed instrument against the first interval, from its arrival day', () => {
    const bound = firstIntervalDaysAfterGood() * DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER;
    expect(
      hasWaitedItsOwnInterval(
        { instrumentType: 'qa', state: null, arrivalDay: arrivedDaysAgo(bound) },
        NOW,
      ),
    ).toBe(true);
    expect(
      hasWaitedItsOwnInterval(
        { instrumentType: 'qa', state: null, arrivalDay: arrivedDaysAgo(bound - 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it('says no when a never-reviewed instrument has no arrival day to measure from', () => {
    expect(hasWaitedItsOwnInterval({ instrumentType: 'qa', state: null }, NOW)).toBe(false);
    expect(
      hasWaitedItsOwnInterval({ instrumentType: 'qa', state: null, arrivalDay: null }, NOW),
    ).toBe(false);
    // And on a malformed day rather than throwing: this runs inside a
    // composition loop over caller-supplied maps, and one bad string must
    // never cost the session around it.
    expect(
      hasWaitedItsOwnInterval({ instrumentType: 'qa', state: null, arrivalDay: 'soon' }, NOW),
    ).toBe(false);
  });

  it('says no for an instrument that is not yet due at all', () => {
    expect(
      hasWaitedItsOwnInterval({ instrumentType: 'qa', state: stateDue(addDays(NOW, 2), 3) }, NOW),
    ).toBe(false);
    expect(
      hasWaitedItsOwnInterval(
        { instrumentType: 'qa', state: null, arrivalDay: arrivedDaysAgo(0) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('the rule both composers call', () => {
  const overdueRecall = {
    instrumentType: 'qa',
    state: stateDue(addDays(NOW, -6), 3),
  } as const;

  it('fires only under interval-bound serving', () => {
    expect(recallOutranksFormatPreference(overdueRecall, NOW, 'interval-bound', true)).toBe(true);
    expect(recallOutranksFormatPreference(overdueRecall, NOW, 'today', true)).toBe(false);
    expect(recallOutranksFormatPreference(overdueRecall, NOW, 'preference-off', true)).toBe(false);
  });

  it('fires only where a format preference exists to defer against', () => {
    // With no preference in force both composers already run on plain order,
    // which `[D-240]` item 2 does not touch.
    expect(recallOutranksFormatPreference(overdueRecall, NOW, 'interval-bound', false)).toBe(false);
  });

  it('fires only for recall-tier instruments — R3 tier filter, not a fourth list', () => {
    expect(
      recallOutranksFormatPreference(
        { instrumentType: 'cloze', state: overdueRecall.state },
        NOW,
        'interval-bound',
        true,
      ),
    ).toBe(true);
    expect(
      recallOutranksFormatPreference(
        { instrumentType: 'mcq', state: overdueRecall.state },
        NOW,
        'interval-bound',
        true,
      ),
    ).toBe(false);
  });

  it('is the declared multiplier, pinned per its pre-commitment', () => {
    // `[D-240]` item 3 / `[D-194]` bucket two: it moves only through
    // `findings/precommitment-dedupe-interval.md` (private repo), never by
    // someone editing the number.
    expect(DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F2.17's final week (`[HARD-2b]`, `ol-3ux7.5.57.14.33`) — the one judgment
// shared by both composers once each resolves its own countdown; see
// `../study-session/build.ts`'s `courseNextAssessmentDays` for the
// study-session composer's own resolution of the number this takes.
// ---------------------------------------------------------------------------

describe("F2.17's final week", () => {
  it('is seven days, the declared default', () => {
    expect(FINAL_WEEK_DAYS).toBe(7);
  });

  it('is false with no readable countdown at all', () => {
    expect(isWithinFinalWeek(null)).toBe(false);
  });

  it('is false more than seven days out', () => {
    expect(isWithinFinalWeek(8)).toBe(false);
  });

  it('is true at exactly seven days out, and at every day inside that', () => {
    expect(isWithinFinalWeek(7)).toBe(true);
    expect(isWithinFinalWeek(1)).toBe(true);
    expect(isWithinFinalWeek(0)).toBe(true);
  });

  it('is false for a negative countdown — an assessment already behind her never opens the final week (F4.7)', () => {
    expect(isWithinFinalWeek(-1)).toBe(false);
  });
});
