// Scenarios: features/F2-review.md, "F2.14 — Scheduling state is replayed from
// the log, never stored beside it" — @auto:core/session/replay.spec
import type { InstrumentType, Rating, ReviewLogEntry, SelectionContextV4 } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { Scheduler } from '../scheduler/types.js';
import { replayedStateOf, replaySchedulerStates } from './replay.js';

const CONTEXT: SelectionContextV4 = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
};

function review(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  rating: Rating | null,
  instrumentType: InstrumentType = 'qa',
): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId,
    instrumentType,
    conceptIds: ['concept-a'],
    rating,
    wasUnsure: false,
    durationMs: null,
    selectionContext: CONTEXT,
  };
}

function suspend(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  kind: 'suspend' | 'unsuspend' = 'suspend',
): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind,
    eventId,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
  };
}

const scheduler = (): Scheduler => createFsrsScheduler();

describe('what replays, and what never enters', () => {
  it('a never-reviewed instrument has no entry at all — not a zeroed state', () => {
    const result = replaySchedulerStates([], scheduler());
    expect(result.states.size).toBe(0);
    expect(replayedStateOf(result, 'inst-1')).toBeNull();
  });

  it('one rated review produces a state distinguishable from never-reviewed', () => {
    const result = replaySchedulerStates(
      [review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'good')],
      scheduler(),
    );
    const state = replayedStateOf(result, 'inst-1');
    expect(state).not.toBeNull();
    expect(state?.reps).toBe(1);
    expect(Date.parse(state?.due ?? '')).toBeGreaterThan(Date.parse('2026-08-10T09:00:00+00:00'));
    expect(result.replayedCount).toBe(1);
  });

  it('successive reviews compound — three Goods are not one Good', () => {
    const one = replaySchedulerStates(
      [review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'good')],
      scheduler(),
    );
    const three = replaySchedulerStates(
      [
        review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'good'),
        review('e2', '2026-08-12T09:00:00+00:00', 'inst-1', 'good'),
        review('e3', '2026-08-20T09:00:00+00:00', 'inst-1', 'good'),
      ],
      scheduler(),
    );
    expect(three.states.get('inst-1')?.reviewCount).toBe(3);
    expect(three.states.get('inst-1')?.state.reps).toBe(3);
    expect(three.states.get('inst-1')?.state.stability).toBeGreaterThan(
      one.states.get('inst-1')?.state.stability ?? 0,
    );
  });

  it('an explain-back attempt never enters — the instrument is still never-reviewed', () => {
    const result = replaySchedulerStates(
      [review('e1', '2026-08-10T09:00:00+00:00', 'inst-eb', null, 'explain-back')],
      scheduler(),
    );
    expect(replayedStateOf(result, 'inst-eb')).toBeNull();
    expect(result.skippedCount).toBe(1);
  });

  it('a review with a null rating never enters, whatever its type says', () => {
    const result = replaySchedulerStates(
      [review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', null)],
      scheduler(),
    );
    expect(replayedStateOf(result, 'inst-1')).toBeNull();
  });

  it('suspension events move no schedule — F2.6 returns the item exactly as it was', () => {
    const reviewOnly = replaySchedulerStates(
      [review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'hard')],
      scheduler(),
    );
    const withSuspension = replaySchedulerStates(
      [
        review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'hard'),
        suspend('e2', '2026-08-11T09:00:00+00:00', 'inst-1'),
        suspend('e3', '2026-08-12T09:00:00+00:00', 'inst-1', 'unsuspend'),
      ],
      scheduler(),
    );
    expect(withSuspension.states.get('inst-1')?.state).toEqual(
      reviewOnly.states.get('inst-1')?.state,
    );
    expect(withSuspension.skippedCount).toBe(2);
  });

  it('instruments do not contaminate each other', () => {
    const result = replaySchedulerStates(
      [
        review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'again'),
        review('e2', '2026-08-10T09:05:00+00:00', 'inst-2', 'easy'),
      ],
      scheduler(),
    );
    expect(result.states.size).toBe(2);
    expect(result.states.get('inst-1')?.state.due).not.toBe(result.states.get('inst-2')?.state.due);
  });
});

describe('order and purity', () => {
  const entries: readonly ReviewLogEntry[] = [
    review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'good'),
    review('e2', '2026-08-14T09:00:00+00:00', 'inst-1', 'again'),
    review('e3', '2026-08-20T09:00:00+00:00', 'inst-1', 'good'),
  ];

  it('replays chronologically regardless of the order the entries arrived in', () => {
    const forwards = replaySchedulerStates(entries, scheduler());
    const backwards = replaySchedulerStates([...entries].reverse(), scheduler());
    const shuffled = replaySchedulerStates(
      [entries[1] as ReviewLogEntry, entries[2] as ReviewLogEntry, entries[0] as ReviewLogEntry],
      scheduler(),
    );
    expect(backwards.states.get('inst-1')?.state).toEqual(forwards.states.get('inst-1')?.state);
    expect(shuffled.states.get('inst-1')?.state).toEqual(forwards.states.get('inst-1')?.state);
  });

  it('order genuinely matters to the result, so the sort above is not decorative', () => {
    // The same three ratings against three different instants: if replay order
    // did not matter, this could not differ from the run above.
    const relabelled = replaySchedulerStates(
      [
        review('e1', '2026-08-10T09:00:00+00:00', 'inst-1', 'again'),
        review('e2', '2026-08-14T09:00:00+00:00', 'inst-1', 'good'),
        review('e3', '2026-08-20T09:00:00+00:00', 'inst-1', 'good'),
      ],
      scheduler(),
    );
    const forwards = replaySchedulerStates(entries, scheduler());
    expect(relabelled.states.get('inst-1')?.state).not.toEqual(
      forwards.states.get('inst-1')?.state,
    );
  });

  it('ties on the instant are broken by eventId, so two devices agree', () => {
    const a = replaySchedulerStates(
      [
        review('bbb', '2026-08-10T09:00:00+00:00', 'inst-1', 'again'),
        review('aaa', '2026-08-10T09:00:00+00:00', 'inst-1', 'easy'),
      ],
      scheduler(),
    );
    const b = replaySchedulerStates(
      [
        review('aaa', '2026-08-10T09:00:00+00:00', 'inst-1', 'easy'),
        review('bbb', '2026-08-10T09:00:00+00:00', 'inst-1', 'again'),
      ],
      scheduler(),
    );
    expect(a.states.get('inst-1')?.state).toEqual(b.states.get('inst-1')?.state);
  });

  it('is a pure function of the entries it was handed', () => {
    const first = replaySchedulerStates(entries, scheduler());
    const second = replaySchedulerStates(entries, scheduler());
    expect(second.states.get('inst-1')?.state).toEqual(first.states.get('inst-1')?.state);
    // And it did not mutate what it was given.
    expect(entries.map((e) => e.eventId)).toEqual(['e1', 'e2', 'e3']);
  });
});
