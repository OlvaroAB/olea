/**
 * The scheduler's declared, versioned configuration and its cold start
 * (`ol-egov.141.89.9.4`; the attainment chain spec's section 2.2 in
 * `olea-service`, failure classes S4 and S5).
 *
 * Three properties are pinned here:
 *
 * 1. **No behaviour change.** Declaring the configuration explicitly must
 *    schedule byte-identically to the library-default engine the scheduler
 *    was built on before (`fsrs({ enable_short_term: false })`), over a long
 *    mixed-rating sequence and for retrievability at many instants.
 * 2. **No silent drift.** The declared weights and retention equal the
 *    library's published defaults at the pinned version, so a library upgrade
 *    that moves them fails here and forces a version change instead of
 *    quietly re-deriving every schedule.
 * 3. **The cold start is the declared set, and says so.** With nothing
 *    delivered, the resolver returns the declared configuration stamped
 *    `declared`; an unreadable delivery falls back to it and records that.
 */

import type { Rating } from 'olea-contracts';
import {
  type Card,
  type CardInput,
  createEmptyCard,
  default_request_retention,
  default_w,
  Rating as FsrsRating,
  fsrs,
} from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { HOLDING_CUT } from '../mastery/rollup.js';
import {
  createFsrsScheduler,
  DECLARED_SCHEDULER_CONFIGURATION,
  resolveSchedulerConfiguration,
  SCHEDULER_CONFIGURATION_VERSION,
} from './fsrs-scheduler.js';
import type { SchedulerConfiguration, SchedulerState } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-01-01T09:00:00.000Z');

const GRADE: Record<Rating, 1 | 2 | 3 | 4> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

/** A fixed, mixed rating sequence with uneven gaps, so lapses and overdue reviews are both exercised. */
const SEQUENCE: readonly { readonly rating: Rating; readonly gapDays: number }[] = [
  { rating: 'good', gapDays: 0 },
  { rating: 'good', gapDays: 2 },
  { rating: 'again', gapDays: 9 },
  { rating: 'hard', gapDays: 1 },
  { rating: 'good', gapDays: 3 },
  { rating: 'easy', gapDays: 12 },
  { rating: 'good', gapDays: 40 },
  { rating: 'again', gapDays: 90 },
  { rating: 'good', gapDays: 1 },
  { rating: 'good', gapDays: 5 },
];

describe('DECLARED_SCHEDULER_CONFIGURATION — declared, not delivered', () => {
  it('carries a version, and the version constant is that version', () => {
    expect(DECLARED_SCHEDULER_CONFIGURATION.version).toBe(SCHEDULER_CONFIGURATION_VERSION);
    expect(SCHEDULER_CONFIGURATION_VERSION.length).toBeGreaterThan(0);
  });

  it('pins the library defaults at the pinned version, so an upgrade that moves them fails here (S4)', () => {
    expect([...DECLARED_SCHEDULER_CONFIGURATION.weights]).toEqual([...default_w]);
    expect(DECLARED_SCHEDULER_CONFIGURATION.requestRetention).toBe(default_request_retention);
  });

  it('keeps same-day steps and fuzz off', () => {
    expect(DECLARED_SCHEDULER_CONFIGURATION.sameDaySteps).toBe(false);
    expect(DECLARED_SCHEDULER_CONFIGURATION.fuzz).toBe(false);
  });

  it('retention is identity with the holding cut ([D-115])', () => {
    expect(DECLARED_SCHEDULER_CONFIGURATION.requestRetention).toBe(HOLDING_CUT);
  });

  it('is frozen: no caller can edit the declared set in place', () => {
    expect(Object.isFrozen(DECLARED_SCHEDULER_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(DECLARED_SCHEDULER_CONFIGURATION.weights)).toBe(true);
  });
});

describe('createFsrsScheduler — the declared configuration schedules exactly as before', () => {
  // The engine exactly as `createFsrsScheduler()` built it before the
  // configuration was declared: library defaults, same-day steps off.
  const reference = fsrs({ enable_short_term: false });

  function referenceRun(): readonly Card[] {
    let card: Card = createEmptyCard(START);
    let now = START;
    const cards: Card[] = [];
    for (const step of SEQUENCE) {
      now = new Date(now.getTime() + step.gapDays * DAY);
      const next: Card = reference.next(card, now, GRADE[step.rating]).card;
      card = next;
      cards.push(next);
    }
    return cards;
  }

  it('produces identical states over a mixed sequence, with and without the explicit declared set', () => {
    const expected = referenceRun();
    for (const scheduler of [
      createFsrsScheduler(),
      createFsrsScheduler(resolveSchedulerConfiguration(DECLARED_SCHEDULER_CONFIGURATION)),
    ]) {
      let state: SchedulerState | null = null;
      let now = START;
      SEQUENCE.forEach((step, index) => {
        now = new Date(now.getTime() + step.gapDays * DAY);
        state = scheduler.schedule({ instrumentId: 'inst', state, rating: step.rating, now }).state;
        const card = expected[index] as Card;
        expect(state.due).toBe(card.due.toISOString());
        expect(state.stability).toBe(card.stability);
        expect(state.difficulty).toBe(card.difficulty);
        expect(state.lapses).toBe(card.lapses);
      });
    }
  });

  it('reads identical retrievability at many instants', () => {
    const scheduler = createFsrsScheduler();
    const state = scheduler.schedule({
      instrumentId: 'inst',
      state: null,
      rating: 'good',
      now: START,
    }).state;
    const card: CardInput = {
      due: state.due,
      stability: state.stability,
      difficulty: state.difficulty,
      elapsed_days: 0,
      scheduled_days: state.scheduledDays,
      learning_steps: state.learningStepIndex,
      reps: state.reps,
      lapses: state.lapses,
      state: 2,
      last_review: state.lastReview,
    };
    for (const days of [0, 1, 3, 7, 30, 365]) {
      const now = new Date(START.getTime() + days * DAY);
      expect(scheduler.retrievability({ instrumentId: 'inst', state, now }).recallProbability).toBe(
        reference.get_retrievability(card, now, false),
      );
    }
  });
});

describe('resolveSchedulerConfiguration — the cold start (S5)', () => {
  it('with nothing delivered, returns the declared set stamped "declared"', () => {
    const resolved = resolveSchedulerConfiguration();
    expect(resolved.configuration).toBe(DECLARED_SCHEDULER_CONFIGURATION);
    expect(resolved.source).toBe('declared');
  });

  it('null reads as nothing delivered, never as an error', () => {
    expect(resolveSchedulerConfiguration(null).source).toBe('declared');
  });

  it('a well-formed delivered set is used and stamped "delivered"', () => {
    const delivered: SchedulerConfiguration = {
      ...DECLARED_SCHEDULER_CONFIGURATION,
      version: 'delivered-test-1',
      requestRetention: 0.85,
    };
    const resolved = resolveSchedulerConfiguration(delivered);
    expect(resolved.source).toBe('delivered');
    expect(resolved.configuration.version).toBe('delivered-test-1');
  });

  it('an unreadable delivered set falls back to the declared set and records the fallback', () => {
    for (const bad of [
      { version: '' },
      { ...DECLARED_SCHEDULER_CONFIGURATION, weights: [1, 2, 3] },
      { ...DECLARED_SCHEDULER_CONFIGURATION, requestRetention: 1.2 },
      { ...DECLARED_SCHEDULER_CONFIGURATION, maximumIntervalDays: 0 },
      { ...DECLARED_SCHEDULER_CONFIGURATION, fuzz: 'no' },
      'not an object',
      42,
    ]) {
      const resolved = resolveSchedulerConfiguration(bad);
      expect(resolved.configuration).toBe(DECLARED_SCHEDULER_CONFIGURATION);
      expect(resolved.source).toBe('declared-fallback');
    }
  });

  it('every scheduler says which configuration produced its readings', () => {
    expect(createFsrsScheduler().configuration).toEqual({
      version: SCHEDULER_CONFIGURATION_VERSION,
      source: 'declared',
    });
    const fallback = createFsrsScheduler(resolveSchedulerConfiguration({ version: '' }));
    expect(fallback.configuration).toEqual({
      version: SCHEDULER_CONFIGURATION_VERSION,
      source: 'declared-fallback',
    });
  });

  it('a delivered retention different from the declared one really changes the schedule (the version is not decorative)', () => {
    const delivered = createFsrsScheduler(
      resolveSchedulerConfiguration({
        ...DECLARED_SCHEDULER_CONFIGURATION,
        version: 'delivered-test-2',
        requestRetention: 0.8,
      }),
    );
    const declared = createFsrsScheduler();
    const a = declared.schedule({ instrumentId: 'i', state: null, rating: 'good', now: START });
    const b = delivered.schedule({ instrumentId: 'i', state: null, rating: 'good', now: START });
    expect(b.intervalDays).toBeGreaterThan(a.intervalDays);
    expect(delivered.configuration?.version).toBe('delivered-test-2');
  });
});
