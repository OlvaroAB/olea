/**
 * Queue composition v1 (F2.5, F2.8 Phase A, F2.14, F2.17, C5.5 — P2-T07).
 *
 * The load-bearing test in this file is
 * "what dedupe held back returns unpenalised at the next session". It runs two
 * real sessions a day apart, with the real FSRS scheduler advancing the
 * instrument she actually reviewed, and asserts that the deferred one comes
 * back untouched. It is written so that **removing the dedupe makes it fail** —
 * see the mutation evidence on `ol-p2t07`. A dedupe test that still passes
 * against an implementation with no dedupe is worse than no test, because it
 * reports a property nobody is checking.
 */

import { readFileSync } from 'node:fs';
import type { Rating } from 'olea-contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { addDays } from '../dates.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { SchedulerState } from '../scheduler/types.js';
import { composeQueue } from './compose.js';
import type { ComposeQueueInput, QueueCandidate } from './types.js';

const NOW = new Date('2026-08-10T09:00:00.000Z');

/**
 * A scheduler state due at `due`. Every other field is a plausible constant:
 * composition reads `due` and nothing else, and this test asserting on
 * stability or difficulty would be asserting on the FSRS library, not on the
 * queue.
 */
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
  overrides: Partial<QueueCandidate> & Pick<QueueCandidate, 'instrumentId'>,
): QueueCandidate {
  return {
    instrumentType: 'qa',
    conceptIds: [`concept-for-${overrides.instrumentId}`],
    courses: ['COURSE-1'],
    state: stateDue(NOW),
    ...overrides,
  };
}

/** `composeQueue` with the fixed instant, so every test states only what it varies. */
function compose(input: Omit<ComposeQueueInput, 'now'> & { now?: Date }) {
  return composeQueue({ now: NOW, ...input });
}

const idsOf = (result: { items: readonly { instrumentId: string }[] }) =>
  result.items.map((item) => item.instrumentId);

describe('F2.8 Phase A — plain FSRS due order, no prioritisation', () => {
  it('orders by due date alone', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'today', state: stateDue(NOW) }),
        candidate({ instrumentId: 'four-days-late', state: stateDue(addDays(NOW, -4)) }),
        candidate({ instrumentId: 'one-day-late', state: stateDue(addDays(NOW, -1)) }),
      ],
    });
    expect(idsOf(result)).toEqual(['four-days-late', 'one-day-late', 'today']);
  });

  it('never-reviewed instruments come after every due one, and are marked new', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'never-reviewed-a', state: null }),
        candidate({ instrumentId: 'due-today', state: stateDue(NOW) }),
        candidate({ instrumentId: 'never-reviewed-b', state: null }),
      ],
    });
    expect(idsOf(result)).toEqual(['due-today', 'never-reviewed-a', 'never-reviewed-b']);
    expect(result.items.map((i) => i.selectionContext.dueState)).toEqual(['due', 'new', 'new']);
    // `priorState` is passed through untouched, `null` included — the review
    // view hands it straight to `ScheduleInput.state`, where null is the
    // first-exposure case rather than a missing value.
    expect(result.items.map((i) => i.priorState)).toEqual([stateDue(NOW), null, null]);
  });

  it('nothing is drawn early — a future due date is not offered at all', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'tomorrow', state: stateDue(addDays(NOW, 1)) }),
        candidate({ instrumentId: 'today', state: stateDue(NOW) }),
      ],
    });
    expect(idsOf(result)).toEqual(['today']);
    expect(result.deferred).toEqual([]);
    // 'early' exists in the frozen enum for exam-proximity mode; v1 never emits it.
    expect(result.items.map((i) => i.selectionContext.dueState)).not.toContain('early');
  });

  it('an instrument due later today is due today, not tomorrow', () => {
    const laterToday = new Date('2026-08-10T23:30:00.000Z');
    const result = compose({
      candidates: [candidate({ instrumentId: 'evening', state: stateDue(laterToday) })],
    });
    expect(idsOf(result)).toEqual(['evening']);
    expect(result.items[0]?.selectionContext.dueState).toBe('due');
  });

  it('distinguishes due from overdue', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'late', state: stateDue(addDays(NOW, -3)) }),
        candidate({ instrumentId: 'today', state: stateDue(NOW) }),
      ],
    });
    expect(result.items.map((i) => [i.instrumentId, i.selectionContext.dueState])).toEqual([
      ['late', 'overdue'],
      ['today', 'due'],
    ]);
  });

  it('states the absence of prioritisation rather than implying it', () => {
    const result = compose({ candidates: [candidate({ instrumentId: 'a' })] });
    for (const item of result.items) {
      expect(item.selectionContext.yieldRank).toBeNull();
      expect(item.selectionContext.examProximity).toBeNull();
    }
  });

  it("ties keep the caller's order — no tiebreaker this module invented", () => {
    const same = stateDue(NOW);
    const forward = compose({
      candidates: [
        candidate({ instrumentId: 'z', state: same }),
        candidate({ instrumentId: 'a', state: same }),
      ],
    });
    const reversed = compose({
      candidates: [
        candidate({ instrumentId: 'a', state: same }),
        candidate({ instrumentId: 'z', state: same }),
      ],
    });
    expect(idsOf(forward)).toEqual(['z', 'a']);
    expect(idsOf(reversed)).toEqual(['a', 'z']);
  });
});

describe('F2.14 — the queue is instrument-shaped, not card-shaped', () => {
  it('offers Q&A, cloze and MCQ on the same terms', () => {
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'mcq',
          instrumentType: 'mcq',
          state: stateDue(addDays(NOW, -2)),
        }),
        candidate({ instrumentId: 'qa', instrumentType: 'qa', state: stateDue(addDays(NOW, -1)) }),
        candidate({ instrumentId: 'cloze', instrumentType: 'cloze', state: stateDue(NOW) }),
      ],
    });
    // Ordered purely by due date; type had no influence whatsoever.
    expect(idsOf(result)).toEqual(['mcq', 'qa', 'cloze']);
  });

  it('type-level: explain-back cannot be a queue candidate at all', () => {
    expectTypeOf<QueueCandidate['instrumentType']>().toEqualTypeOf<'qa' | 'cloze' | 'mcq'>();
    expectTypeOf<
      Extract<QueueCandidate['instrumentType'], 'explain-back'>
    >().toEqualTypeOf<never>();
  });
});

describe('F2.5 — filter by course or topic (shed floor)', () => {
  const spread: readonly QueueCandidate[] = [
    candidate({
      instrumentId: 'n1',
      conceptIds: ['synapse'],
      courses: ['COURSE-A'],
      state: stateDue(addDays(NOW, -3)),
    }),
    candidate({
      instrumentId: 'l1',
      conceptIds: ['metre'],
      courses: ['COURSE-B'],
      state: stateDue(addDays(NOW, -2)),
    }),
    candidate({
      instrumentId: 'n2',
      conceptIds: ['cementation'],
      courses: ['COURSE-A'],
      state: stateDue(addDays(NOW, -1)),
    }),
  ];

  it('filtering to one course leaves only that course, in the order it already held', () => {
    const result = compose({ candidates: spread, filter: { courses: ['COURSE-A'] } });
    expect(idsOf(result)).toEqual(['n1', 'n2']);
  });

  it('filtering to one topic leaves only that concept', () => {
    const result = compose({ candidates: spread, filter: { conceptIds: ['cementation'] } });
    expect(idsOf(result)).toEqual(['n2']);
  });

  it("a concept shared between two courses appears in both courses' sessions", () => {
    const shared = [
      candidate({
        instrumentId: 'shared',
        conceptIds: ['attention'],
        courses: ['COURSE-A', 'COURSE-B'],
      }),
    ];
    expect(idsOf(compose({ candidates: shared, filter: { courses: ['COURSE-A'] } }))).toEqual([
      'shared',
    ]);
    expect(idsOf(compose({ candidates: shared, filter: { courses: ['COURSE-B'] } }))).toEqual([
      'shared',
    ]);
  });

  it('the filter narrows, it never re-ranks — filtered is a subsequence of unfiltered', () => {
    const unfiltered = idsOf(compose({ candidates: spread }));
    for (const filter of [
      { courses: ['COURSE-A'] },
      { courses: ['COURSE-B'] },
      { conceptIds: ['metre'] },
    ]) {
      const filtered = idsOf(compose({ candidates: spread, filter }));
      // Subsequence: every filtered id appears in the unfiltered order, in order.
      const positions = filtered.map((id) => unfiltered.indexOf(id));
      expect(positions).not.toContain(-1);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it('course matching is exact and verbatim — no case folding (R1/R2)', () => {
    const result = compose({ candidates: spread, filter: { courses: ['course-a'] } });
    expect(idsOf(result)).toEqual([]);
  });

  it('an empty filter object is no filter at all', () => {
    expect(idsOf(compose({ candidates: spread, filter: {} }))).toEqual(
      idsOf(compose({ candidates: spread })),
    );
  });

  it('course and topic filters combine with AND', () => {
    const result = compose({
      candidates: spread,
      filter: { courses: ['COURSE-A'], conceptIds: ['metre'] },
    });
    expect(idsOf(result)).toEqual([]);
  });

  // [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): a caller
  // builds ONE `SessionSteeringRequest` (`../study-session/compose.js`) for
  // "twenty minutes on this course" and hands it, unmodified, to both this
  // queue's `filter` and `buildComposedStudySession` — `QueueFilter` is a
  // documented structural subset of that type (see `types.ts`'s `QueueFilter`
  // doc), so no translation happens here or anywhere. This proves it at the
  // type level (the extra `budgetMinutes`/`focusConceptName` fields compile
  // fine where only `courses`/`conceptIds` are read) and at the value level
  // (the same object narrows the offer identically to a hand-built filter).
  it('a SessionSteeringRequest (the study-session steering shape) narrows identically to a hand-built QueueFilter', () => {
    // Structural, not a runtime import — this is exactly the shape
    // `Pick<BuildComposedStudySessionInput, 'budgetMinutes' | 'courses' |
    // 'conceptIds' | 'focusConceptName'>` produces.
    const steeringRequest = {
      budgetMinutes: 20,
      courses: ['COURSE-A'],
      focusConceptName: 'Some concept name, irrelevant to the queue',
    };
    expectTypeOf(steeringRequest).toMatchTypeOf<ComposeQueueInput['filter']>();

    const result = compose({ candidates: spread, filter: steeringRequest });
    expect(idsOf(result)).toEqual(
      idsOf(compose({ candidates: spread, filter: { courses: ['COURSE-A'] } })),
    );
  });
});

describe('F2.6 — the queue does its half of suspension', () => {
  it('a suspended instrument is never composed into a session', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'suspended', conceptIds: ['shared-concept'] }),
        candidate({ instrumentId: 'active', conceptIds: ['other-concept'] }),
      ],
      suspended: new Set(['suspended']),
    });
    expect(idsOf(result)).toEqual(['active']);
    // Not deferred either: suspended is not "later", it is "not until she says so".
    expect(result.deferred).toEqual([]);
  });

  it("a suspended instrument does not occupy its concept's dedupe slot", () => {
    // The suspended one is FSRS-earlier, so without the exclusion it would win
    // dedupe and the concept would vanish from her session entirely.
    const result = compose({
      candidates: [
        candidate({
          instrumentId: 'suspended',
          conceptIds: ['photosynthesis'],
          state: stateDue(addDays(NOW, -5)),
        }),
        candidate({
          instrumentId: 'sibling',
          conceptIds: ['photosynthesis'],
          state: stateDue(NOW),
        }),
      ],
      suspended: new Set(['suspended']),
    });
    expect(idsOf(result)).toEqual(['sibling']);
    expect(result.deferred).toEqual([]);
    expect(result.items[0]?.selectionContext.instrumentTypesOffered).toEqual(['qa']);
  });

  it('an empty suspended set changes nothing', () => {
    const candidates = [candidate({ instrumentId: 'a' }), candidate({ instrumentId: 'b' })];
    expect(idsOf(compose({ candidates, suspended: new Set() }))).toEqual(
      idsOf(compose({ candidates })),
    );
  });
});

describe('F2.17 — per-session concept dedupe', () => {
  /** One concept, two due instruments of different types. The MCQ is FSRS-earlier. */
  const twoOnOneConcept: readonly QueueCandidate[] = [
    candidate({
      instrumentId: 'mcq-item',
      instrumentType: 'mcq',
      conceptIds: ['action-potential'],
      state: stateDue(addDays(NOW, -2)),
    }),
    candidate({
      instrumentId: 'qa-card',
      instrumentType: 'qa',
      conceptIds: ['action-potential'],
      state: stateDue(addDays(NOW, -1)),
    }),
  ];

  it('presents at most one instrument per concept', () => {
    const result = compose({ candidates: twoOnOneConcept });
    expect(idsOf(result)).toEqual(['mcq-item']);
    expect(result.items).toHaveLength(1);
  });

  it('defers, it never drops — the other instrument is named, with what it lost to', () => {
    const result = compose({ candidates: twoOnOneConcept });
    expect(result.deferred).toEqual([
      { instrumentId: 'qa-card', conceptIds: ['action-potential'], deferredBehind: 'mcq-item' },
    ]);
    // Nothing due went missing: offered + deferred accounts for every candidate.
    expect(result.items.length + result.deferred.length).toBe(twoOnOneConcept.length);
  });

  it("prefers the instrument matching the nearest assessment's format (F4.8), when told", () => {
    const result = compose({ candidates: twoOnOneConcept, formatPreference: ['qa'] });
    expect(idsOf(result)).toEqual(['qa-card']);
    expect(result.deferred.map((d) => d.instrumentId)).toEqual(['mcq-item']);
  });

  it('with no preference supplied, plain FSRS order decides — not a hidden type preference', () => {
    const result = compose({ candidates: twoOnOneConcept, formatPreference: [] });
    expect(idsOf(result)).toEqual(['mcq-item']);
    // Flip only the due dates: the winner flips with them, proving the choice
    // is made on order and not on the type.
    const flipped = compose({
      candidates: [
        { ...twoOnOneConcept[0], state: stateDue(addDays(NOW, -1)) } as QueueCandidate,
        { ...twoOnOneConcept[1], state: stateDue(addDays(NOW, -2)) } as QueueCandidate,
      ],
    });
    expect(idsOf(flipped)).toEqual(['qa-card']);
  });

  it('does not reorder what it keeps', () => {
    const result = compose({
      candidates: [
        candidate({ instrumentId: 'a1', conceptIds: ['a'], state: stateDue(addDays(NOW, -5)) }),
        candidate({ instrumentId: 'b1', conceptIds: ['b'], state: stateDue(addDays(NOW, -4)) }),
        candidate({ instrumentId: 'a2', conceptIds: ['a'], state: stateDue(addDays(NOW, -3)) }),
        candidate({ instrumentId: 'c1', conceptIds: ['c'], state: stateDue(addDays(NOW, -2)) }),
        candidate({ instrumentId: 'b2', conceptIds: ['b'], state: stateDue(addDays(NOW, -1)) }),
      ],
    });
    // Survivors in exactly the plain-FSRS relative order they held before dedupe.
    expect(idsOf(result)).toEqual(['a1', 'b1', 'c1']);
    expect(result.deferred.map((d) => d.instrumentId)).toEqual(['a2', 'b2']);
  });

  it('reports every type the concept could have offered, not only the one she saw (D7.1)', () => {
    const result = compose({ candidates: twoOnOneConcept });
    expect(result.items[0]?.selectionContext.instrumentTypesOffered).toEqual(['mcq', 'qa']);
  });

  it('a concept with one due instrument reports exactly that one type', () => {
    const result = compose({
      candidates: [candidate({ instrumentId: 'solo', instrumentType: 'cloze' })],
    });
    expect(result.items[0]?.selectionContext.instrumentTypesOffered).toEqual(['cloze']);
  });

  it("the cap can be relaxed deliberately — F2.17's exam-proximity seam", () => {
    const result = compose({ candidates: twoOnOneConcept, dedupeByConcept: false });
    expect(idsOf(result)).toEqual(['mcq-item', 'qa-card']);
    expect(result.deferred).toEqual([]);
  });
});

describe('F2.17 — what dedupe held back returns unpenalised at the next session', () => {
  /**
   * Two real sessions a day apart, with the real FSRS scheduler advancing the
   * instrument she actually reviewed.
   *
   * This is the test the acceptance criterion names, and it is the one that
   * must be able to go red: with dedupe removed, session one offers both
   * instruments and the deferral it asserts on does not exist. See the
   * mutation evidence on `ol-p2t07`.
   */
  it('is deferred today and offered as an ordinary due item tomorrow, untouched', () => {
    const scheduler = createFsrsScheduler();
    const day1 = NOW;
    const day2 = addDays(NOW, 1);

    const deferredState = stateDue(addDays(day1, -1));
    const winnerState = stateDue(addDays(day1, -2));

    const session1 = composeQueue({
      now: day1,
      candidates: [
        candidate({ instrumentId: 'winner', conceptIds: ['osmosis'], state: winnerState }),
        candidate({
          instrumentId: 'deferred',
          conceptIds: ['osmosis'],
          instrumentType: 'mcq',
          state: deferredState,
        }),
      ],
    });

    // Session one: exactly one offered, the other deferred and named.
    expect(idsOf(session1)).toEqual(['winner']);
    expect(session1.deferred).toEqual([
      { instrumentId: 'deferred', conceptIds: ['osmosis'], deferredBehind: 'winner' },
    ]);

    // She reviews the offered one. FSRS advances it past tomorrow; the
    // deferred one is not touched by anything, because nothing happened to it.
    const rating: Rating = 'good';
    const advanced = scheduler.schedule({
      instrumentId: 'winner',
      state: winnerState,
      rating,
      now: day1,
    });
    expect(new Date(advanced.state.due).getTime()).toBeGreaterThan(day2.getTime());

    const session2 = composeQueue({
      now: day2,
      candidates: [
        candidate({ instrumentId: 'winner', conceptIds: ['osmosis'], state: advanced.state }),
        candidate({
          instrumentId: 'deferred',
          conceptIds: ['osmosis'],
          instrumentType: 'mcq',
          state: deferredState,
        }),
      ],
    });

    // Late, not lost: offered as an ordinary due item the next session.
    expect(idsOf(session2)).toEqual(['deferred']);
    expect(session2.deferred).toEqual([]);
    // Overdue by two days now, and not penalised for it: composition never
    // wrote to its state, so it is byte-identical to the day it was deferred.
    expect(session2.items[0]?.selectionContext.dueState).toBe('overdue');
    expect(deferredState).toEqual(stateDue(addDays(day1, -1)));
    expect(session2.items[0]?.priorState).toEqual(deferredState);
    expect(session2.items[0]?.selectionContext.yieldRank).toBeNull();
  });
});

describe('composition is pure', () => {
  const candidates: readonly QueueCandidate[] = [
    candidate({ instrumentId: 'a', conceptIds: ['x'], state: stateDue(addDays(NOW, -1)) }),
    candidate({ instrumentId: 'b', conceptIds: ['x'], state: stateDue(NOW) }),
    candidate({ instrumentId: 'c', conceptIds: ['y'], state: null }),
  ];

  it('same inputs, same output', () => {
    expect(compose({ candidates })).toEqual(compose({ candidates }));
  });

  it('does not mutate the candidate list or the candidates in it', () => {
    const input = candidates.map((c) => ({ ...c }));
    const snapshot = JSON.stringify(input);
    composeQueue({ candidates: input, now: NOW });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('reads no clock and no I/O — `now` is the only source of time', () => {
    const source = readFileSync(new URL('./compose.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of ['Date.now', 'Math.random', "'node:", 'readFile', 'writeFile']) {
      expect(source).not.toContain(forbidden);
    }
    // `new Date(...)` appears only to parse a stored ISO due date, never bare.
    expect(source).not.toMatch(/new Date\(\s*\)/);
  });

  it('an empty candidate list composes an empty session, not an error', () => {
    expect(compose({ candidates: [] })).toEqual({ items: [], deferred: [] });
  });
});
