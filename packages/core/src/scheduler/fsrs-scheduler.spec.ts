/**
 * Scheduling scenario tests (P2-T02 acceptance) plus the JSON round-trip
 * `SchedulerState` needs because it is what actually gets written to her
 * vault (module doc, `types.ts`).
 *
 * Every scenario supplies its own fixed `now` rather than letting anything
 * read the wall clock — the bead's own point: "scheduling tests are
 * worthless otherwise."
 */

import type { Rating } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from './fsrs-scheduler.js';
import type { ScheduleOutput, Scheduler, SchedulerState } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-01-01T09:00:00.000Z');

/** Runs a fixed sequence of `good` reviews from a fresh instrument to build up a "mature" (multi-review, `review`-state) `SchedulerState`, so lapse/overdue scenarios exercise realistic stability and difficulty rather than hand-picked numbers a real card could never reach. */
function buildMatureState(scheduler: Scheduler, instrumentId: string): SchedulerState {
  let state: SchedulerState | null = null;
  let now = START;
  // Five consecutive "good" reviews, each one taken exactly on the due date,
  // is enough to graduate out of `new`/`learning` into `review` state with
  // non-trivial stability under FSRS's default weights.
  for (let i = 0; i < 5; i++) {
    const result = scheduler.schedule({ instrumentId, state, rating: 'good', now });
    state = result.state;
    now = new Date(state.due);
  }
  if (!state) throw new Error('unreachable: loop above always assigns state');
  return state;
}

describe('createFsrsScheduler — new item', () => {
  const scheduler = createFsrsScheduler();
  const ratings: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

  const outcomes = new Map<Rating, ScheduleOutput>(
    ratings.map((rating) => [
      rating,
      scheduler.schedule({ instrumentId: 'inst-new', state: null, rating, now: START }),
    ]),
  );

  it('schedules all four ratings without error on a never-reviewed instrument', () => {
    for (const rating of ratings) {
      const outcome = outcomes.get(rating);
      expect(outcome).toBeDefined();
      expect(outcome?.state.reps).toBe(1);
      expect(outcome?.state.lapses).toBe(0);
    }
  });

  it('orders the resulting intervals again < hard < good < easy', () => {
    const [again, hard, good, easy] = ratings.map((r) => outcomes.get(r)?.intervalDays);
    expect(again).toBeLessThan(hard as number);
    expect(hard).toBeLessThan(good as number);
    expect(good).toBeLessThan(easy as number);
  });

  it('echoes the instrument id given, never a concept id', () => {
    for (const rating of ratings) {
      expect(outcomes.get(rating)?.instrumentId).toBe('inst-new');
    }
  });

  it('every state.due lands strictly after `now`', () => {
    for (const rating of ratings) {
      const due = new Date(outcomes.get(rating)?.state.due as string).getTime();
      expect(due).toBeGreaterThan(START.getTime());
    }
  });
});

describe('createFsrsScheduler — lapse', () => {
  it('rating a mature item `again` collapses the interval and moves difficulty/stability the wrong-for-recall way', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-mature');
    const reviewedOn = new Date(mature.due);

    const passed = scheduler.schedule({
      instrumentId: 'inst-mature',
      state: mature,
      rating: 'good',
      now: reviewedOn,
    });
    const lapsed = scheduler.schedule({
      instrumentId: 'inst-mature',
      state: mature,
      rating: 'again',
      now: reviewedOn,
    });

    // Interval collapses: a lapse is scheduled back far sooner than another
    // successful review from the same prior state would have been.
    expect(lapsed.intervalDays).toBeLessThan(passed.intervalDays);

    // Stability drops (a lapse is FSRS's signal that memory decayed faster
    // than modelled) and difficulty rises (this item is now modelled as
    // harder for her specifically) — the two moves the "wrong for recall"
    // direction names.
    expect(lapsed.state.stability).toBeLessThan(mature.stability);
    expect(lapsed.state.difficulty).toBeGreaterThan(mature.difficulty);

    // The event itself is recorded as a lapse. `learningState` stays
    // `'review'` rather than moving to `'relearning'`: that transition is
    // part of ts-fsrs's short-term (Anki-style) stepping, which this
    // scheduler disables (see fsrs-scheduler.ts's module doc) — with it
    // off, a lapse is modelled entirely through `lapses`/stability/
    // difficulty, never a state-machine detour.
    expect(lapsed.state.lapses).toBe(mature.lapses + 1);
    expect(lapsed.state.learningState).toBe('review');
  });
});

describe('createFsrsScheduler — overdue tolerance', () => {
  it('credits the extra elapsed time rather than penalising a late-but-successful review', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-overdue');
    const dueOnTime = new Date(mature.due);
    const reviewedLate = new Date(dueOnTime.getTime() + 20 * DAY);

    const onTime = scheduler.schedule({
      instrumentId: 'inst-overdue',
      state: mature,
      rating: 'good',
      now: dueOnTime,
    });
    const overdue = scheduler.schedule({
      instrumentId: 'inst-overdue',
      state: mature,
      rating: 'good',
      now: reviewedLate,
    });

    // Passing after a longer gap is *stronger* evidence of retention, not
    // weaker: FSRS grants a bigger stability increase for a successful
    // recall the longer retrievability had decayed beforehand. A scheduler
    // that instead punished lateness (e.g. treating "overdue" like a mild
    // lapse) would produce the opposite inequality here.
    expect(overdue.state.stability).toBeGreaterThan(onTime.state.stability);

    // Not a lapse: rated `good` and recalled, so it must not be routed
    // through the lapse machinery just because it was late.
    expect(overdue.state.lapses).toBe(mature.lapses);
    expect(overdue.state.learningState).toBe('review');

    // The next interval is measured forward from the actual review instant,
    // not shrunk to "make up for" the delay.
    const nextDue = new Date(overdue.state.due).getTime();
    expect(nextDue).toBeGreaterThan(reviewedLate.getTime());
  });
});

describe('createFsrsScheduler — SchedulerState JSON round-trip', () => {
  it('preserves scheduling behaviour exactly across a JSON round-trip', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-roundtrip');

    const roundTripped = JSON.parse(JSON.stringify(mature)) as SchedulerState;
    expect(roundTripped).toStrictEqual(mature);

    const now = new Date(mature.due);
    const fromOriginal = scheduler.schedule({
      instrumentId: 'inst-roundtrip',
      state: mature,
      rating: 'good',
      now,
    });
    const fromRoundTripped = scheduler.schedule({
      instrumentId: 'inst-roundtrip',
      state: roundTripped,
      rating: 'good',
      now,
    });

    expect(fromRoundTripped).toStrictEqual(fromOriginal);
  });

  it('round-trips a freshly-scheduled (never-before-reviewed) state the same way', () => {
    const scheduler = createFsrsScheduler();
    const fresh = scheduler.schedule({
      instrumentId: 'inst-fresh',
      state: null,
      rating: 'good',
      now: START,
    }).state;

    const roundTripped = JSON.parse(JSON.stringify(fresh)) as SchedulerState;
    expect(roundTripped).toStrictEqual(fresh);
  });
});
