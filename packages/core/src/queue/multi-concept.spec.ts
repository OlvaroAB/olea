/**
 * F2.17 with a **set-valued** dedupe key (`ol-t3sd`, D-031 successor).
 *
 * One instrument is evidence for every concept its note names, so it occupies
 * every one of those concepts' slots for the session. That is not a new rule —
 * it is F2.17's own rule ("at most one instrument per concept in any one
 * session") applied to a membership relation that is now many-to-many. The
 * change is visible only for a note that names several `topic:` values; every
 * single-concept corpus composes exactly as it did before, and
 * `compose.spec.ts` — unedited — is the evidence for that half.
 *
 * The interesting cases are all here:
 *
 *   - an instrument on {A,B} takes both slots, so a later instrument on B is
 *     deferred rather than offered alongside it;
 *   - F2.5's concept filter matches on membership, so filtering to B now
 *     reaches the {A,B} instrument that bind-to-first hid from it;
 *   - deferral stays accountable: every held-back instrument is still named,
 *     with the instrument that took a slot from it.
 */

import { describe, expect, it } from 'vitest';
import { addDays } from '../dates.js';
import type { SchedulerState } from '../scheduler/types.js';
import { composeQueue } from './compose.js';
import type { ComposeQueueInput, QueueCandidate } from './types.js';

const NOW = new Date('2026-08-10T09:00:00.000Z');

function stateDue(due: Date): SchedulerState {
  return {
    schemaVersion: 1,
    due: due.toISOString(),
    stability: 3,
    difficulty: 5,
    scheduledDays: 1,
    learningStepIndex: 0,
    reps: 2,
    lapses: 0,
    learningState: 'review',
    lastReview: addDays(due, -1).toISOString(),
  };
}

function candidate(
  overrides: Partial<QueueCandidate> & Pick<QueueCandidate, 'instrumentId' | 'conceptIds'>,
): QueueCandidate {
  return {
    instrumentType: 'qa',
    courses: ['COURSE-1'],
    state: stateDue(NOW),
    ...overrides,
  };
}

function compose(input: Omit<ComposeQueueInput, 'now'> & { now?: Date }) {
  return composeQueue({ now: NOW, ...input });
}

const idsOf = (result: { items: readonly { instrumentId: string }[] }) =>
  result.items.map((item) => item.instrumentId);

describe('F2.17 dedupe is over the concept SET, not a single id', () => {
  it('an instrument naming two concepts occupies both slots', () => {
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'both',
          conceptIds: ['alpha', 'beta'],
          state: stateDue(addDays(NOW, -2)),
        }),
        candidate({ instrumentId: 'beta-only', conceptIds: ['beta'], state: stateDue(NOW) }),
      ],
    });
    expect(idsOf(result)).toEqual(['both']);
    expect(result.deferred).toEqual([
      { instrumentId: 'beta-only', conceptIds: ['beta'], deferredBehind: 'both' },
    ]);
  });

  it('a concept the multi-concept instrument does NOT name is untouched', () => {
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'both',
          conceptIds: ['alpha', 'beta'],
          state: stateDue(addDays(NOW, -2)),
        }),
        candidate({ instrumentId: 'gamma-only', conceptIds: ['gamma'], state: stateDue(NOW) }),
      ],
    });
    expect(idsOf(result)).toEqual(['both', 'gamma-only']);
    expect(result.deferred).toEqual([]);
  });

  it('the earlier-due instrument claims the shared concept; the later one is deferred behind it', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'later', conceptIds: ['alpha', 'beta'], state: stateDue(NOW) }),
        candidate({
          instrumentId: 'earlier',
          conceptIds: ['beta'],
          state: stateDue(addDays(NOW, -3)),
        }),
      ],
    });
    expect(idsOf(result)).toEqual(['earlier']);
    expect(result.deferred).toEqual([
      { instrumentId: 'later', conceptIds: ['alpha', 'beta'], deferredBehind: 'earlier' },
    ]);
  });

  it('deferring is still never dropping — every eligible instrument is offered or named', () => {
    const candidates = [
      candidate({ instrumentId: 'a', conceptIds: ['x', 'y'], state: stateDue(addDays(NOW, -3)) }),
      candidate({ instrumentId: 'b', conceptIds: ['y'], state: stateDue(addDays(NOW, -2)) }),
      candidate({ instrumentId: 'c', conceptIds: ['x'], state: stateDue(addDays(NOW, -1)) }),
      candidate({ instrumentId: 'd', conceptIds: ['z'], state: stateDue(NOW) }),
    ];
    const result = compose({ candidates });
    const accounted = [
      ...result.items.map((i) => i.instrumentId),
      ...result.deferred.map((d) => d.instrumentId),
    ].sort();
    expect(accounted).toEqual(['a', 'b', 'c', 'd']);
    expect(idsOf(result)).toEqual(['a', 'd']);
  });

  it('dedupeByConcept: false lifts the cap for the set exactly as it did for one id', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'both', conceptIds: ['alpha', 'beta'] }),
        candidate({ instrumentId: 'beta-only', conceptIds: ['beta'] }),
      ],
      dedupeByConcept: false,
    });
    expect(idsOf(result)).toEqual(['both', 'beta-only']);
    expect(result.deferred).toEqual([]);
  });

  it('format preference still decides the winner, and now decides it for every concept it claims', () => {
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'qa-both',
          instrumentType: 'qa',
          conceptIds: ['alpha', 'beta'],
          state: stateDue(addDays(NOW, -5)),
        }),
        candidate({
          instrumentId: 'mcq-alpha',
          instrumentType: 'mcq',
          conceptIds: ['alpha'],
          state: stateDue(addDays(NOW, -1)),
        }),
      ],
      formatPreference: ['mcq'],
    });
    // `mcq-alpha` outranks `qa-both` on alpha, so it wins; `qa-both` then finds
    // alpha taken and is deferred, taking beta with it — beta gets nothing this
    // session because its only eligible instrument was spent on alpha.
    expect(idsOf(result)).toEqual(['mcq-alpha']);
    expect(result.deferred).toEqual([
      { instrumentId: 'qa-both', conceptIds: ['alpha', 'beta'], deferredBehind: 'mcq-alpha' },
    ]);
  });

  // The consequence worth naming out loud, because it is the one that shows up
  // as "the session got shorter" and has no other explanation on screen.
  //
  // With a single-id key, every concept picked its winner independently, so the
  // number of items offered was "one per eligible concept" whatever the format
  // preference was. With a set key that is no longer true in either direction,
  // and this is the mechanism in its smallest form.
  //
  // Restoring the old invariant would mean picking the *largest* set of
  // compatible instruments rather than the preferred one — a
  // maximum-cardinality matching, which is a prioritisation heuristic. This
  // module's doc is explicit that prioritisation belongs to C5.5 and the
  // oracle, and that a "small sensible" one here would quietly become the thing
  // the Phase A→B checkpoint measures. So the count moves, and it is stated.
  it('a format preference can change HOW MANY items are offered, not only which', () => {
    const candidates = [
      candidate({
        instrumentId: 'cloze-both',
        instrumentType: 'cloze',
        conceptIds: ['alpha', 'beta'],
        state: stateDue(NOW),
      }),
      candidate({
        instrumentId: 'qa-alpha',
        instrumentType: 'qa',
        conceptIds: ['alpha'],
        state: stateDue(addDays(NOW, -2)),
      }),
      candidate({
        instrumentId: 'qa-beta',
        instrumentType: 'qa',
        conceptIds: ['beta'],
        state: stateDue(addDays(NOW, -1)),
      }),
    ];

    // Plain FSRS order: the two single-concept instruments are due first, take
    // one concept each, and the multi-concept cloze finds both taken.
    const plain = compose({ candidates });
    expect(idsOf(plain)).toEqual(['qa-alpha', 'qa-beta']);

    // Prefer cloze: `cloze-both` is reached first, claims alpha and beta
    // together, and both single-concept instruments are deferred behind it.
    // Two items become one — the same corpus, the same day, one preference.
    const preferCloze = compose({ candidates, formatPreference: ['cloze'] });
    expect(idsOf(preferCloze)).toEqual(['cloze-both']);
    expect(preferCloze.items.length).toBeLessThan(plain.items.length);

    // What does not change, under either preference: nothing is dropped
    // unnamed, and no concept is offered twice. That is what F2.17 asks for,
    // and it is the property the count invariant was standing in for.
    for (const result of [plain, preferCloze]) {
      const accounted = [
        ...result.items.map((i) => i.instrumentId),
        ...result.deferred.map((d) => d.instrumentId),
      ].sort();
      expect(accounted).toEqual(['cloze-both', 'qa-alpha', 'qa-beta']);
      const offered = result.items.flatMap((i) => i.conceptIds);
      expect(new Set(offered).size).toBe(offered.length);
    }
  });
});

describe("F2.5's concept filter matches membership, not a chosen primary", () => {
  it('filtering to a co-listed concept reaches the instrument that names it second', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'both', conceptIds: ['alpha', 'beta'] }),
        candidate({ instrumentId: 'gamma', conceptIds: ['gamma'] }),
      ],
      filter: { conceptIds: ['beta'] },
    });
    expect(idsOf(result)).toEqual(['both']);
  });

  it('a filtered session is still a subsequence of the unfiltered one', () => {
    const candidates = [
      candidate({ instrumentId: 'a', conceptIds: ['x', 'y'], state: stateDue(addDays(NOW, -3)) }),
      candidate({ instrumentId: 'b', conceptIds: ['y'], state: stateDue(addDays(NOW, -2)) }),
      candidate({ instrumentId: 'c', conceptIds: ['z'], state: stateDue(addDays(NOW, -1)) }),
    ];
    const unfiltered = idsOf(compose({ candidates }));
    const filtered = idsOf(compose({ candidates, filter: { conceptIds: ['x', 'z'] } }));
    let cursor = 0;
    for (const id of filtered) {
      cursor = unfiltered.indexOf(id, cursor) + 1;
      expect(cursor).toBeGreaterThan(0);
    }
  });
});

describe("D7.1's instrumentTypesOffered spans every concept the item claims", () => {
  it('unions the types eligible for each of the item concepts, deferred ones included', () => {
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'both',
          instrumentType: 'qa',
          conceptIds: ['alpha', 'beta'],
          state: stateDue(addDays(NOW, -5)),
        }),
        candidate({
          instrumentId: 'cloze-beta',
          instrumentType: 'cloze',
          conceptIds: ['beta'],
          state: stateDue(addDays(NOW, -1)),
        }),
        candidate({
          instrumentId: 'mcq-alpha',
          instrumentType: 'mcq',
          conceptIds: ['alpha'],
          state: stateDue(NOW),
        }),
      ],
    });
    expect(idsOf(result)).toEqual(['both']);
    // In queue order — FSRS order over the eligible set, not her concept order:
    // `both` (qa, -5d), `cloze-beta` (cloze, -1d), `mcq-alpha` (mcq, today).
    expect(result.items[0]?.selectionContext.instrumentTypesOffered).toEqual([
      'qa',
      'cloze',
      'mcq',
    ]);
  });

  it('a single-concept item reports exactly what it did before — one concept, its own types', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'qa1', instrumentType: 'qa', conceptIds: ['solo'] }),
        candidate({ instrumentId: 'mcq1', instrumentType: 'mcq', conceptIds: ['solo'] }),
      ],
    });
    expect(result.items[0]?.selectionContext.instrumentTypesOffered).toEqual(['qa', 'mcq']);
  });
});

describe('the offered item carries its whole concept set to the log', () => {
  it('QueueItem.conceptIds is what the review-log record will persist (v3)', () => {
    const result = compose({
      candidates: [candidate({ instrumentId: 'both', conceptIds: ['alpha', 'beta'] })],
    });
    expect(result.items[0]?.conceptIds).toEqual(['alpha', 'beta']);
  });

  it('her authored order survives composition — the queue never re-sorts a concept set', () => {
    const result = compose({
      candidates: [candidate({ instrumentId: 'both', conceptIds: ['zeta', 'alpha'] })],
    });
    expect(result.items[0]?.conceptIds).toEqual(['zeta', 'alpha']);
  });
});
