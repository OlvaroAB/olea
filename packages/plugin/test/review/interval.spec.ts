import type { Rating } from 'olea-contracts';
import type { ScheduleInput, Scheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  describeInterval,
  previewQaClozeIntervals,
  previewSingleInterval,
  QA_CLOZE_RATING_ORDER,
} from '../../src/review/interval.js';

const INTERVAL_BY_RATING: Readonly<Record<Rating, number>> = {
  again: 0,
  hard: 2,
  good: 6,
  easy: 14,
};

/** A fake `Scheduler` that echoes a fixed `intervalDays` per rating, so each of the four ratings produces a distinguishable interval without pulling in real FSRS math. */
function fakeScheduler(): Scheduler {
  return {
    schedule: vi.fn(({ instrumentId, rating, now }: ScheduleInput) => {
      const intervalDays = INTERVAL_BY_RATING[rating];
      return {
        instrumentId,
        intervalDays,
        state: {
          schemaVersion: 1 as const,
          due: now.toISOString(),
          stability: 1,
          difficulty: 1,
          scheduledDays: intervalDays,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review' as const,
          lastReview: now.toISOString(),
        },
      };
    }),
  };
}

describe('describeInterval', () => {
  it('renders 0 or negative days as "today"', () => {
    expect(describeInterval(0)).toBe('today');
    expect(describeInterval(-1)).toBe('today');
  });

  it('renders exactly 1 day as "tomorrow"', () => {
    expect(describeInterval(1)).toBe('tomorrow');
  });

  it('renders N>1 days as "in N days"', () => {
    expect(describeInterval(6)).toBe('in 6 days');
    expect(describeInterval(14)).toBe('in 14 days');
  });
});

describe('previewQaClozeIntervals', () => {
  it('returns one preview per rating, in Again/Hard/Good/Easy order, with real Scheduler output', () => {
    const scheduler = fakeScheduler();
    const now = new Date('2026-08-10T09:00:00Z');
    const previews = previewQaClozeIntervals(scheduler, 'inst-1', null, now);

    expect(previews.map((p) => p.rating)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(previews.map((p) => p.label)).toEqual(['today', 'in 2 days', 'in 6 days', 'in 14 days']);
    expect(scheduler.schedule).toHaveBeenCalledTimes(4);
  });

  it('passes the prior state and instant straight through to the scheduler', () => {
    const scheduler = fakeScheduler();
    const now = new Date('2026-08-10T09:00:00Z');
    previewQaClozeIntervals(scheduler, 'inst-1', null, now);

    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentId: 'inst-1', state: null, now }),
    );
  });
});

describe('previewSingleInterval', () => {
  it("computes exactly one rating's interval", () => {
    const scheduler = fakeScheduler();
    const now = new Date('2026-08-10T09:00:00Z');
    const preview = previewSingleInterval(scheduler, 'inst-1', null, 'good', now);

    expect(preview).toEqual({ rating: 'good', intervalDays: 6, label: 'in 6 days' });
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
  });
});

describe('QA_CLOZE_RATING_ORDER', () => {
  // Moved here with the constant itself when `review/rating.ts` was deleted:
  // the ordering is a layout fact about the rating row, not a rating mapping.
  it('is the full four-way rating, in key order 1-4 (F2.16)', () => {
    expect(QA_CLOZE_RATING_ORDER).toEqual(['again', 'hard', 'good', 'easy']);
  });

  it('is the order the previews come back in, so the buttons cannot disagree with it', () => {
    const previews = previewQaClozeIntervals(
      fakeScheduler(),
      'inst-1',
      null,
      new Date('2026-08-10T09:00:00Z'),
    );
    expect(previews.map((p) => p.rating)).toEqual([...QA_CLOZE_RATING_ORDER]);
  });
});
