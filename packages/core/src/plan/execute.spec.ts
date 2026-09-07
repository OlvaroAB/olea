import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type ReviewLogRecordV5,
  reviewLogRecordV5,
  type StudyPlanCourse,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ComposedQueue, QueueItem } from '../queue/types.js';
import { executeStudyPlan, executeStudyPlanOverComposedRows } from './execute.js';

/** Synthetic vocabulary only (INV-3). */
function item(instrumentId: string, conceptIds: readonly string[]): QueueItem {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    priorState: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
    },
  };
}

function rankedCourse(
  course: string,
  concepts: readonly (readonly [
    conceptId: string,
    rank: number,
    weight: number,
    days: number | null,
  ])[],
): StudyPlanCourse {
  return {
    course,
    status: 'ranked',
    concepts: concepts.map(([conceptId, rank, weight, examProximityDays]) => ({
      conceptId,
      rank,
      weight,
      examProximityDays,
      reasoning: `${conceptId} (${course}): derived reasoning.`,
      citations: [{ sourcePath: 'papers/2024.md', questionLabel: 'Q1' }],
    })),
  };
}

function plan(
  courses: readonly StudyPlanCourse[],
  policyVersion = 'sp1-aaaaaaaaaaaaaaaa',
): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion,
    computedAt: '2026-08-16T09:00:00.000Z',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: { asOf: '2026-08-16', courses: [...courses] },
  };
}

function queue(
  items: readonly QueueItem[],
  deferred: ComposedQueue['deferred'] = [],
): ComposedQueue {
  return { items, deferred };
}

describe('executeStudyPlan — C7.6: the plan version reaches every D7.1 record', () => {
  it('stamps the plan version on EVERY offered item, including ones the plan does not rank', () => {
    const executed = executeStudyPlan({
      queue: queue([
        item('i-ranked', ['concept-alpha']),
        item('i-unranked', ['concept-nowhere']),
        item('i-multi', ['concept-nowhere', 'concept-beta']),
      ]),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-alpha', 1, 0.9, 5],
          ['concept-beta', 2, 0.4, 20],
        ]),
      ]),
    });

    expect(executed.items).toHaveLength(3);
    for (const offered of executed.items) {
      expect(offered.selectionContext.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    }
    expect(executed.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
  });

  it('carries the plan version but a null yieldRank for an unranked concept — two different statements', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-unranked', ['concept-nowhere'])]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    const context = executed.items[0]?.selectionContext;
    // "This plan was in force and had no rank for you" — NOT "no plan existed".
    expect(context?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(context?.yieldRank).toBeNull();
    expect(context?.examProximity).toBeNull();
    expect(executed.items[0]?.planWeight).toBeNull();
  });

  it('fills yieldRank and examProximity from the plan for a ranked concept', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-ranked', ['concept-alpha'])]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 3, 0.7, 11]])]),
    });

    expect(executed.items[0]?.selectionContext).toEqual({
      dueState: 'due',
      examProximity: 11,
      yieldRank: 3,
      instrumentTypesOffered: ['qa'],
      planVersion: 'sp1-aaaaaaaaaaaaaaaa',
    });
    expect(executed.items[0]?.planWeight).toBe(0.7);
  });

  it('produces a selection context the frozen v5 record actually accepts', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-ranked', ['concept-alpha'])]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });
    const offered = executed.items[0];
    if (offered === undefined) throw new Error('expected an item');

    const record: ReviewLogRecordV5 = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'evt-1',
      timestamp: '2026-08-16T10:00:00.000Z',
      instrumentId: offered.instrumentId,
      instrumentType: offered.instrumentType,
      rating: 'good',
      wasUnsure: false,
      durationMs: 4200,
      selectionContext: offered.selectionContext,
      conceptIds: [...offered.conceptIds],
    };

    const parsed = reviewLogRecordV5.parse(record);
    // The end of the chain the clause names: the version is in the record the
    // A→B checkpoint will read off her disk.
    expect(parsed.selectionContext.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(JSON.stringify(parsed)).toContain('"planVersion":"sp1-aaaaaaaaaaaaaaaa"');
  });

  it('records explicit nulls, not omissions, when no plan is cached', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha'])]),
      plan: null,
    });

    const context = executed.items[0]?.selectionContext;
    expect(context).toEqual({
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    });
    // Stated, never omitted — D7.1's shape must be identical across the A→B
    // boundary or the checkpoint compares two different records.
    expect(Object.hasOwn(context ?? {}, 'planVersion')).toBe(true);
    expect(executed.planVersion).toBeNull();
  });
});

describe('executeStudyPlan — C5.5: offline execution against the cached plan', () => {
  it('is a pure function of (queue, plan) — no provider, no store, no clock', () => {
    const input = {
      queue: queue([item('i-a', ['concept-alpha']), item('i-b', ['concept-beta'])]),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-beta', 1, 0.9, 2],
          ['concept-alpha', 2, 0.3, 30],
        ]),
      ]),
    };

    const first = executeStudyPlan(input);
    const second = executeStudyPlan(input);
    expect(second).toEqual(first);
    // The caller's queue is not mutated by the reorder.
    expect(input.queue.items.map((i) => i.instrumentId)).toEqual(['i-a', 'i-b']);
  });

  it('orders by the plan weight, not by the queue order it was handed', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha']), item('i-b', ['concept-beta'])]),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-beta', 1, 0.9, 2],
          ['concept-alpha', 2, 0.3, 30],
        ]),
      ]),
    });

    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-b', 'i-a']);
  });

  it('keeps the queue’s own FSRS order for items the plan cannot separate', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha']), item('i-b', ['concept-beta'])]),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-alpha', 1, 0.5, 4],
          ['concept-beta', 2, 0.5, 4],
        ]),
      ]),
    });

    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-a', 'i-b']);
  });

  it('sorts unranked items after ranked ones, keeping their order among themselves', () => {
    const executed = executeStudyPlan({
      queue: queue([
        item('i-unranked-1', ['concept-nowhere']),
        item('i-unranked-2', ['concept-elsewhere']),
        item('i-ranked', ['concept-alpha']),
      ]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    expect(executed.items.map((i) => i.instrumentId)).toEqual([
      'i-ranked',
      'i-unranked-1',
      'i-unranked-2',
    ]);
  });

  it('leaves the order untouched when there is no plan at all', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha']), item('i-b', ['concept-beta'])]),
      plan: null,
    });
    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-a', 'i-b']);
  });
});

describe('executeStudyPlan — [D-240] item 5: QueueItem.dedupeReason threads through by name (ol-egov.130, ol-2zfj.67 SESS-6)', () => {
  it('carries dedupeReason onto the executed item when the composed queue set one', () => {
    const withReason: QueueItem = {
      ...item('i-ranked', ['concept-alpha']),
      dedupeReason: 'recall-overdue',
    };
    const executed = executeStudyPlan({
      queue: queue([withReason]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });
    expect(executed.items[0]?.dedupeReason).toBe('recall-overdue');
  });

  it('omits dedupeReason (never a fabricated value) when the composed queue item carried none', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-ranked', ['concept-alpha'])]),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });
    expect(executed.items[0]?.dedupeReason).toBeUndefined();
    expect('dedupeReason' in (executed.items[0] ?? {})).toBe(false);
  });
});

describe('executeStudyPlan — joins and edge cases', () => {
  it('takes the strongest of a multi-concept instrument’s planned entries', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-multi', ['concept-weak', 'concept-strong'])]),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-strong', 1, 0.9, 3],
          ['concept-weak', 2, 0.1, 40],
        ]),
      ]),
    });

    const offered = executed.items[0];
    expect(offered?.planWeight).toBe(0.9);
    expect(offered?.selectionContext.yieldRank).toBe(1);
    // The proximity comes from the SAME entry as the rank — a record whose two
    // fields came from different concepts would describe a selection that
    // never happened.
    expect(offered?.selectionContext.examProximity).toBe(3);
  });

  it('compares across courses by weight, since ranks are ordinals within a course', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-shared', ['concept-shared'])]),
      plan: plan([
        // Rank 1 in a low-weight course, rank 4 in a high-weight one. Taking
        // the better ordinal would pick the wrong entry.
        rankedCourse('COURSE-A', [['concept-shared', 1, 0.2, 25]]),
        rankedCourse('COURSE-B', [['concept-shared', 4, 0.8, 6]]),
      ]),
    });

    expect(executed.items[0]?.planWeight).toBe(0.8);
    expect(executed.items[0]?.selectionContext.yieldRank).toBe(4);
    expect(executed.items[0]?.selectionContext.examProximity).toBe(6);
  });

  it('ignores abstained courses when joining, and never treats an abstention as a ranking', () => {
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha'])]),
      plan: plan([
        {
          course: 'COURSE-B',
          status: 'abstained',
          reason: 'no-evidence',
          detail: 'COURSE-B: 1 assessment with zero evidence edges.',
          assessmentPaths: ['assessments/b.md'],
        },
      ]),
    });

    expect(executed.items[0]?.selectionContext.yieldRank).toBeNull();
    expect(executed.items[0]?.selectionContext.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
  });

  it('passes deferred instruments through untouched — execution reorders, it never drops', () => {
    const deferred = [
      { instrumentId: 'i-deferred', conceptIds: ['concept-alpha'], deferredBehind: 'i-a' },
    ];
    const executed = executeStudyPlan({
      queue: queue([item('i-a', ['concept-alpha'])], deferred),
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    expect(executed.deferred).toEqual(deferred);
    expect(executed.items).toHaveLength(1);
  });

  it('survives an empty queue and an empty plan without inventing either', () => {
    expect(executeStudyPlan({ queue: queue([]), plan: plan([]) })).toEqual({
      items: [],
      deferred: [],
      planVersion: 'sp1-aaaaaaaaaaaaaaaa',
    });
    expect(executeStudyPlan({ queue: queue([]), plan: null })).toEqual({
      items: [],
      deferred: [],
      planVersion: null,
    });
  });

  it('offers exactly the instruments the queue offered — no additions, no removals', () => {
    const items = [
      item('i-a', ['concept-alpha']),
      item('i-b', ['concept-beta']),
      item('i-c', ['concept-nowhere']),
    ];
    const executed = executeStudyPlan({
      queue: queue(items),
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-alpha', 1, 0.9, 5],
          ['concept-beta', 2, 0.4, 15],
        ]),
      ]),
    });

    expect(executed.items.map((i) => i.instrumentId).sort()).toEqual(['i-a', 'i-b', 'i-c']);
  });
});

// Scenarios: features/F4-oracle.md — "[SESS-8.3] `ol-egov.132.3`" block, added
// beside the `executeStudyPlan` scenarios above (DF-20).
describe('executeStudyPlanOverComposedRows — [SESS-8.3] ol-egov.132.3: composed rows, given order preserved', () => {
  it('serves the exact given order — course blocks intact, no cross-course reorder by weight (F2.18, C5.7)', () => {
    // A weight-based cross-course sort would put i-b (weight 0.9) before
    // i-a (weight 0.2). The composed session put COURSE-A's block first;
    // this entry must leave it there.
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-a', ['concept-alpha']), item('i-b', ['concept-beta'])],
      plan: plan([
        rankedCourse('COURSE-A', [['concept-alpha', 1, 0.2, 25]]),
        rankedCourse('COURSE-B', [['concept-beta', 1, 0.9, 3]]),
      ]),
    });

    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-a', 'i-b']);
  });

  it('leaves unranked items interleaved at their given position, never moved after the ranked ones', () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-unranked', ['concept-nowhere']), item('i-ranked', ['concept-alpha'])],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    // Under executeStudyPlan's own sort this would come back
    // ['i-ranked', 'i-unranked'] — the composed-rows entry must not do that.
    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-unranked', 'i-ranked']);
  });

  it("stamps yieldRank/examProximity/planVersion from the plan, exactly as executeStudyPlan does — never the composition's own rank", () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-ranked', ['concept-alpha'])],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 3, 0.7, 11]])]),
    });

    expect(executed.items[0]?.selectionContext).toEqual({
      dueState: 'due',
      examProximity: 11,
      yieldRank: 3,
      instrumentTypesOffered: ['qa'],
      planVersion: 'sp1-aaaaaaaaaaaaaaaa',
    });
    expect(executed.items[0]?.planWeight).toBe(0.7);
    expect(executed.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
  });

  it('carries the plan version but a null yieldRank for an unranked concept', () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-unranked', ['concept-nowhere'])],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    expect(executed.items[0]?.selectionContext.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(executed.items[0]?.selectionContext.yieldRank).toBeNull();
    expect(executed.items[0]?.selectionContext.examProximity).toBeNull();
  });

  it('records explicit nulls and the given order, with no plan cached', () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-b', ['concept-beta']), item('i-a', ['concept-alpha'])],
      plan: null,
    });

    expect(executed.items.map((i) => i.instrumentId)).toEqual(['i-b', 'i-a']);
    expect(executed.planVersion).toBeNull();
    for (const offered of executed.items) {
      expect(offered.selectionContext.planVersion).toBeNull();
      expect(offered.selectionContext.yieldRank).toBeNull();
    }
  });

  it('carries dedupeReason through by name, same as executeStudyPlan', () => {
    const withReason: QueueItem = {
      ...item('i-ranked', ['concept-alpha']),
      dedupeReason: 'recall-overdue',
    };
    const executed = executeStudyPlanOverComposedRows({
      items: [withReason],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    expect(executed.items[0]?.dedupeReason).toBe('recall-overdue');
  });

  it('always reports an empty deferred list — a composed session has no DeferredInstrument-shaped fact to restate', () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-a', ['concept-alpha'])],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });

    expect(executed.deferred).toEqual([]);
  });

  it('is a pure function of (items, plan) — no provider, no store, no clock, and does not mutate the input array', () => {
    const input = {
      items: [item('i-b', ['concept-beta']), item('i-a', ['concept-alpha'])],
      plan: plan([
        rankedCourse('COURSE-A', [
          ['concept-beta', 1, 0.9, 2],
          ['concept-alpha', 2, 0.3, 30],
        ]),
      ]),
    };

    const first = executeStudyPlanOverComposedRows(input);
    const second = executeStudyPlanOverComposedRows(input);
    expect(second).toEqual(first);
    expect(input.items.map((i) => i.instrumentId)).toEqual(['i-b', 'i-a']);
  });

  it('produces a selection context the frozen v5 record actually accepts', () => {
    const executed = executeStudyPlanOverComposedRows({
      items: [item('i-ranked', ['concept-alpha'])],
      plan: plan([rankedCourse('COURSE-A', [['concept-alpha', 1, 0.9, 5]])]),
    });
    const offered = executed.items[0];
    if (offered === undefined) throw new Error('expected an item');

    const record: ReviewLogRecordV5 = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'evt-1',
      timestamp: '2026-08-16T10:00:00.000Z',
      instrumentId: offered.instrumentId,
      instrumentType: offered.instrumentType,
      rating: 'good',
      wasUnsure: false,
      durationMs: 4200,
      selectionContext: offered.selectionContext,
      conceptIds: [...offered.conceptIds],
    };

    const parsed = reviewLogRecordV5.parse(record);
    expect(parsed.selectionContext.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
  });
});
