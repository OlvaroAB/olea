/**
 * F2.18/F2.19 on the plain review-queue path (`ol-ua0i`).
 *
 * Every assertion here is mutation-style where practical: a value the test
 * checks would read differently if the feature under test were switched off
 * (block order removed, grouping removed, or the caller-resolved maps
 * omitted), rather than a value that would pass just as well against no
 * implementation at all.
 */

import { describe, expect, it } from 'vitest';
import { addDays } from '../dates.js';
import type { SchedulerState } from '../scheduler/types.js';
import { applyCourseBlocking } from './block-order.js';
import { composeQueue } from './compose.js';
import type { ComposeQueueInput, QueueCandidate, QueueItem } from './types.js';

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

function compose(input: Omit<ComposeQueueInput, 'now'> & { now?: Date }) {
  return composeQueue({ now: NOW, ...input });
}

const idsOf = (result: { items: readonly { instrumentId: string }[] }) =>
  result.items.map((item) => item.instrumentId);
const coursesOf = (
  result: { items: readonly QueueItem[] },
  byId: ReadonlyMap<string, QueueCandidate>,
) => result.items.map((item) => byId.get(item.instrumentId)?.courses[0]);

describe('F2.18 — course blocks on the plain review-queue path', () => {
  it('a session covering more than one course keeps each course contiguous', () => {
    const candidates: readonly QueueCandidate[] = [
      candidate({ instrumentId: 'a1', courses: ['COURSE-A'], state: stateDue(addDays(NOW, -5)) }),
      candidate({ instrumentId: 'b1', courses: ['COURSE-B'], state: stateDue(addDays(NOW, -4)) }),
      candidate({ instrumentId: 'a2', courses: ['COURSE-A'], state: stateDue(addDays(NOW, -3)) }),
      candidate({ instrumentId: 'c1', courses: ['COURSE-C'], state: stateDue(addDays(NOW, -2)) }),
      candidate({ instrumentId: 'a3', courses: ['COURSE-A'], state: stateDue(addDays(NOW, -1)) }),
      candidate({ instrumentId: 'b2', courses: ['COURSE-B'], state: stateDue(NOW) }),
    ];
    const byId = new Map(candidates.map((c) => [c.instrumentId, c]));
    const result = compose({ candidates });

    // Before this bead, plain FSRS order interleaved courses by due date
    // alone — the mutation this asserts against is exactly that: without
    // course blocking, COURSE-A's three instruments would NOT be contiguous
    // (b1 and c1 sit between a1 and a3 in due-date order).
    const courseSequence = coursesOf(result, byId);
    const firstA = courseSequence.indexOf('COURSE-A');
    const lastA = courseSequence.lastIndexOf('COURSE-A');
    for (let i = firstA; i <= lastA; i += 1) {
      expect(courseSequence[i]).toBe('COURSE-A');
    }
    // Every instrument is still offered — blocking reorders, it never drops.
    expect(idsOf(result).sort()).toEqual(candidates.map((c) => c.instrumentId).sort());
  });

  it('block order follows the most urgent due-state present, not alphabetical course order', () => {
    // ZCOURSE carries an overdue instrument, so it must lead ACOURSE even
    // though 'A' < 'Z' — the mutation this catches is a block-order rule
    // that fell back to plain alphabetical (or omitted precedence
    // entirely), which would place ACOURSE first.
    const candidates: readonly QueueCandidate[] = [
      candidate({ instrumentId: 'a-due', courses: ['ACOURSE'], state: stateDue(NOW) }),
      candidate({
        instrumentId: 'z-overdue',
        courses: ['ZCOURSE'],
        state: stateDue(addDays(NOW, -5)),
      }),
      candidate({ instrumentId: 'z-due', courses: ['ZCOURSE'], state: stateDue(NOW) }),
    ];
    const result = compose({ candidates });
    expect(idsOf(result)).toEqual(['z-overdue', 'z-due', 'a-due']);
  });

  it('[D-113] overdue-first primacy holds within a block: the more overdue concept leads', () => {
    const candidates: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'less-overdue',
        conceptIds: ['c1'],
        state: stateDue(addDays(NOW, -1)),
      }),
      candidate({
        instrumentId: 'more-overdue',
        conceptIds: ['c2'],
        state: stateDue(addDays(NOW, -6)),
      }),
    ];
    const result = compose({ candidates });
    expect(idsOf(result)).toEqual(['more-overdue', 'less-overdue']);
  });

  it('selection and dedupe are untouched by blocking — same survivors, same deferrals', () => {
    const twoOnOneConcept: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'mcq-item',
        instrumentType: 'mcq',
        conceptIds: ['action-potential'],
        courses: ['COURSE-A'],
        state: stateDue(addDays(NOW, -2)),
      }),
      candidate({
        instrumentId: 'qa-card',
        instrumentType: 'qa',
        conceptIds: ['action-potential'],
        courses: ['COURSE-B'],
        state: stateDue(addDays(NOW, -1)),
      }),
    ];
    const result = compose({ candidates: twoOnOneConcept });
    expect(idsOf(result)).toEqual(['mcq-item']);
    expect(result.deferred).toEqual([
      { instrumentId: 'qa-card', conceptIds: ['action-potential'], deferredBehind: 'mcq-item' },
    ]);
  });
});

describe('F2.19 — within-block grouping on the plain review-queue path', () => {
  it('no signal supplied is a byte-for-byte no-op against plain FSRS/course-block order', () => {
    const candidates: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'x1',
        conceptIds: ['x'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
      candidate({
        instrumentId: 'y1',
        conceptIds: ['y'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
      candidate({
        instrumentId: 'z1',
        conceptIds: ['z'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
    ];
    const withoutSignals = compose({ candidates });
    const withEmptyMaps = compose({
      candidates,
      relatedConceptKeys: new Map(),
      assessmentContext: new Map(),
    });
    expect(idsOf(withEmptyMaps)).toEqual(idsOf(withoutSignals));
    // The tie band (all three due at the same instant) keeps the callers'
    // original relative order absent a signal — the same "ties keep the
    // caller's order" invariant `compose.spec.ts` asserts for step 4.
    expect(idsOf(withoutSignals)).toEqual(['x1', 'y1', 'z1']);
  });

  it('relatedness pulls a connected concept toward its neighbour within an exact tie band', () => {
    // Three concepts, all due at the same instant (one exact tie band).
    // With no relation supplied, 'x' keeps the caller's order (last).
    // Once 'x' is related to 'z', it must sort adjacent to 'z' — the value
    // that flips is exactly `idsOf(result)`'s order, not merely its presence.
    const candidates: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'x1',
        conceptIds: ['x'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
      candidate({
        instrumentId: 'y1',
        conceptIds: ['y'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
      candidate({
        instrumentId: 'z1',
        conceptIds: ['z'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
      }),
    ];
    const unrelated = compose({ candidates });
    expect(idsOf(unrelated)).toEqual(['x1', 'y1', 'z1']);

    const related = compose({
      candidates,
      relatedConceptKeys: new Map([
        ['x', new Set(['z'])],
        ['z', new Set(['x'])],
      ]),
    });
    // 'x' and 'z' now share an edge; 'y' has none. Both 'x' and 'z' score
    // strictly higher than 'y' (which scores 0) and sort ahead of it — the
    // mutation this catches is exactly that: with the relatedness formula
    // disabled or the map ignored, 'z' would stay last, as it did above.
    expect(idsOf(related)).toEqual(['x1', 'z1', 'y1']);
  });

  it("an approaching assessment shifts placement toward that assessment's own scope", () => {
    const assessmentPath = 'Assessments/midterm.md';
    const candidates: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'in-scope',
        conceptIds: ['in-scope-concept'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
        targetAssessmentPath: assessmentPath,
      }),
      candidate({
        instrumentId: 'out-of-scope',
        conceptIds: ['out-of-scope-concept'],
        courses: ['COURSE-A'],
        state: stateDue(NOW),
        targetAssessmentPath: assessmentPath,
      }),
    ];

    // No assessment context at all: caller's order holds.
    const noContext = compose({ candidates });
    expect(idsOf(noContext)).toEqual(['in-scope', 'out-of-scope']);

    // A dated, imminent assessment whose scope names only the second
    // concept: placement shifts toward it, flipping the order.
    const [inScope, outOfScope] = candidates;
    const withContext = compose({
      candidates: [outOfScope as QueueCandidate, inScope as QueueCandidate],
      assessmentContext: new Map([
        [
          assessmentPath,
          { dueDay: '2026-08-11', scopeConceptKeys: new Set(['out-of-scope-concept']) },
        ],
      ]),
    });
    expect(idsOf(withContext)).toEqual(['out-of-scope', 'in-scope']);
  });

  it('grouping never crosses an exact tie-band boundary — urgency is never overridden', () => {
    // 'related-but-less-overdue' shares an edge with 'far-more-overdue', but
    // they are NOT in the same tie band (different overdueDays), so no
    // relatedness score can move the more-overdue item out of first place.
    const candidates: readonly QueueCandidate[] = [
      candidate({
        instrumentId: 'related-but-less-overdue',
        conceptIds: ['p'],
        courses: ['COURSE-A'],
        state: stateDue(addDays(NOW, -1)),
      }),
      candidate({
        instrumentId: 'far-more-overdue',
        conceptIds: ['q'],
        courses: ['COURSE-A'],
        state: stateDue(addDays(NOW, -10)),
      }),
    ];
    const result = compose({
      candidates,
      relatedConceptKeys: new Map([
        ['p', new Set(['q'])],
        ['q', new Set(['p'])],
      ]),
    });
    expect(idsOf(result)).toEqual(['far-more-overdue', 'related-but-less-overdue']);
  });
});

describe('applyCourseBlocking — the pure reordering pass, in isolation', () => {
  const candidatesById = new Map<string, QueueCandidate>([
    ['i1', candidate({ instrumentId: 'i1', conceptIds: ['c1'], courses: ['COURSE-B'] })],
    ['i2', candidate({ instrumentId: 'i2', conceptIds: ['c2'], courses: ['COURSE-A'] })],
  ]);
  const items: readonly QueueItem[] = [
    {
      instrumentId: 'i1',
      instrumentType: 'qa',
      conceptIds: ['c1'],
      priorState: stateDue(addDays(NOW, -1)),
      selectionContext: {
        dueState: 'overdue',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
      },
    },
    {
      instrumentId: 'i2',
      instrumentType: 'qa',
      conceptIds: ['c2'],
      priorState: stateDue(addDays(NOW, -1)),
      selectionContext: {
        dueState: 'overdue',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
      },
    },
  ];

  it('returns the same items array reference contents (same set, same length) — never a different set', () => {
    const result = applyCourseBlocking({ items, candidatesById, now: NOW });
    expect(result).toHaveLength(items.length);
    expect(result.map((i) => i.instrumentId).sort()).toEqual(
      items.map((i) => i.instrumentId).sort(),
    );
  });

  it('an empty item list is a no-op', () => {
    expect(applyCourseBlocking({ items: [], candidatesById, now: NOW })).toEqual([]);
  });
});
