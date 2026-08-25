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
import type { RetrievabilityOutput, ScheduleOutput, Scheduler, SchedulerState } from './types.js';

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

describe('createFsrsScheduler — retrievability', () => {
  it('reads at (or extremely close to) 1.0 immediately after the review that produced the state — the trap case documented as the reason RetrievabilityInput.state is non-nullable', () => {
    // Reading retrievability at the exact instant of the review it derives
    // from is uninformative: every instrument reads ~1.0 here regardless of
    // review history, which is exactly the trap `types.ts`'s module doc
    // names — a caller reading this immediately after `schedule()` would see
    // a flat constant and mistake it for a real signal. It is *not* evidence
    // that `state` should be allowed to be `null`; it is the reason a caller
    // must hold a real (non-null) post-review state before asking at all.
    const scheduler = createFsrsScheduler();
    const { state } = scheduler.schedule({
      instrumentId: 'inst-trap',
      state: null,
      rating: 'good',
      now: START,
    });

    const { recallProbability } = scheduler.retrievability({
      instrumentId: 'inst-trap',
      state,
      now: START,
    });

    expect(recallProbability).toBeCloseTo(1, 6);
  });

  it('is monotonically non-increasing in elapsed time for a fixed state', () => {
    // The defining shape of a decay curve: checking later never *raises*
    // the recall estimate for the same underlying state.
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-decay');
    const lastReview = new Date(mature.lastReview);
    const offsetsInDays = [0, 1, 5, 10, 30, 100, 365];

    const readings = offsetsInDays.map(
      (days) =>
        scheduler.retrievability({
          instrumentId: 'inst-decay',
          state: mature,
          now: new Date(lastReview.getTime() + days * DAY),
        }).recallProbability,
    );

    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThanOrEqual(readings[i - 1] as number);
    }
  });

  it('yields a higher recall probability for higher stability at the same elapsed time', () => {
    // Stability is FSRS's "days until retention decays to the request-
    // retention target" (types.ts) — higher stability must mean slower
    // decay, i.e. a higher reading at any fixed elapsed time.
    const scheduler = createFsrsScheduler();
    const baseState: SchedulerState = {
      schemaVersion: 1,
      due: '2026-02-01T00:00:00.000Z',
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      learningStepIndex: 0,
      reps: 3,
      lapses: 0,
      learningState: 'review',
      lastReview: START.toISOString(),
    };
    const moreStableState: SchedulerState = { ...baseState, stability: 30 };
    const now = new Date(START.getTime() + 10 * DAY);

    const lower = scheduler.retrievability({
      instrumentId: 'inst-a',
      state: baseState,
      now,
    }).recallProbability;
    const higher = scheduler.retrievability({
      instrumentId: 'inst-a',
      state: moreStableState,
      now,
    }).recallProbability;

    expect(higher).toBeGreaterThan(lower);
  });

  it('is always in [0, 1] across a spread of states and instants', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-range');
    const lastReview = new Date(mature.lastReview);
    const instants = [0, 1, 10, 100, 1000].map(
      (days) => new Date(lastReview.getTime() + days * DAY),
    );

    for (const now of instants) {
      const { recallProbability } = scheduler.retrievability({
        instrumentId: 'inst-range',
        state: mature,
        now,
      });
      expect(recallProbability).toBeGreaterThanOrEqual(0);
      expect(recallProbability).toBeLessThanOrEqual(1);
    }
  });

  it('is pure: the same input twice yields the same output', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-pure');
    const now = new Date(new Date(mature.lastReview).getTime() + 7 * DAY);
    const input = { instrumentId: 'inst-pure', state: mature, now };

    const first = scheduler.retrievability(input);
    const second = scheduler.retrievability(input);

    expect(second).toStrictEqual(first);
  });

  it('echoes the instrument id given, never a concept id', () => {
    const scheduler = createFsrsScheduler();
    const mature = buildMatureState(scheduler, 'inst-echo');

    const { instrumentId } = scheduler.retrievability({
      instrumentId: 'inst-echo',
      state: mature,
      now: new Date(mature.lastReview),
    });

    expect(instrumentId).toBe('inst-echo');
  });

  it('end-to-end: schedule() a first review, then read retrievability off the resulting state at a later instant', () => {
    // The path the product will actually take: `schedule()` writes
    // `SchedulerState` to her vault, and some later moment (building a
    // queue, or a concept-level rollup computed elsewhere over several
    // instruments' readings — never here, per R3) reads `retrievability()`
    // off that same persisted state, never off `ScheduleInput.state`, which
    // can be `null`.
    const scheduler = createFsrsScheduler();
    const { state } = scheduler.schedule({
      instrumentId: 'inst-e2e',
      state: null,
      rating: 'good',
      now: START,
    });
    const laterInstant = new Date(new Date(state.lastReview).getTime() + 2 * DAY);

    const reading: RetrievabilityOutput = scheduler.retrievability({
      instrumentId: 'inst-e2e',
      state,
      now: laterInstant,
    });

    expect(reading.instrumentId).toBe('inst-e2e');
    // Some time has passed since the review with no further evidence, so
    // recall has decayed off the immediate-post-review ~1.0 but the result
    // is still a valid probability.
    expect(reading.recallProbability).toBeGreaterThan(0);
    expect(reading.recallProbability).toBeLessThan(1);
  });
});
