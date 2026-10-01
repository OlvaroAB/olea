/**
 * Attempted and demonstrated by the assessment's date (`ol-egov.141.89.11.4`; vew.md 2.7).
 * Fixture ids are opaque (INV-3): no real course code or concept name.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { buildRetrospective } from './build.js';
import type { RetrospectiveInput } from './types.js';

function review(
  conceptId: string,
  timestamp: string,
  eventId: string,
  instrumentType: 'qa' | 'mcq' = 'qa',
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `${instrumentType}:${conceptId}:1`,
    instrumentType,
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
  };
}

const scheduler: Scheduler = {
  schedule({ instrumentId, now }) {
    const state: SchedulerState = {
      schemaVersion: 1,
      due: now.toISOString(),
      stability: 1,
      difficulty: 5,
      scheduledDays: 1,
      learningStepIndex: 0,
      reps: 1,
      lapses: 0,
      learningState: 'review',
      lastReview: now.toISOString(),
    };
    return { instrumentId, state, intervalDays: 1 };
  },
  retrievability({ instrumentId }) {
    return { instrumentId, recallProbability: 0.5 };
  },
};

/** Four concepts: only after the day, only on the day, a recognition review before, none at all. */
function input(overrides: Partial<RetrospectiveInput> = {}): RetrospectiveInput {
  return {
    assessmentPath: 'Courses/K1/Midterm.md',
    course: 'K1',
    scope: [
      { conceptId: 'a-after', conceptName: 'Concept A1' },
      { conceptId: 'a-same-day', conceptName: 'Concept A2' },
      { conceptId: 'a-recognised', conceptName: 'Concept A3' },
      { conceptId: 'a-never', conceptName: 'Concept A4' },
    ],
    scopeOrigin: 'assessment-stated',
    entries: [
      review('a-after', '2026-07-24T10:00:00+00:00', 'e1'),
      review('a-same-day', '2026-07-14T09:00:00+00:00', 'e2'),
      review('a-recognised', '2026-06-20T09:00:00+00:00', 'e3', 'mcq'),
    ],
    scheduler,
    now: new Date('2026-07-24T12:00:00.000Z'),
    holdingCut: 0.9,
    conceptCourses: [],
    assessmentDate: '2026-07-14',
    ...overrides,
  };
}

describe('attempted and demonstrated by the assessment date (vew.md 2.7)', () => {
  it('reads only evidence from a day strictly before the assessment', () => {
    const { assembly } = buildRetrospective(input());
    const byId = new Map((assembly ?? []).map((a) => [a.conceptId, a]));
    expect(byId.get('a-after')).toMatchObject({ attempted: false, demonstrated: 'seed' });
    expect(byId.get('a-same-day')).toMatchObject({ attempted: false, demonstrated: 'seed' });
    expect(byId.get('a-never')).toMatchObject({ attempted: false, demonstrated: 'seed' });
  });

  it('a scored review on a recognition-tier instrument before the date is an attempt and earns above seed', () => {
    const { assembly } = buildRetrospective(input());
    const entry = assembly?.find((a) => a.conceptId === 'a-recognised');
    expect(entry?.attempted).toBe(true);
    expect(entry?.demonstrated).not.toBe('seed');
  });

  it('is sorted by concept name and covers every concept in scope', () => {
    const { assembly } = buildRetrospective(input());
    expect(assembly?.map((a) => a.conceptName)).toEqual([
      'Concept A1',
      'Concept A2',
      'Concept A3',
      'Concept A4',
    ]);
  });

  it('adds no group: the partition is unchanged by the date, and absent without it', () => {
    const withDate = buildRetrospective(input());
    const { assessmentDate: _date, ...undated } = input();
    const without = buildRetrospective(undated);
    expect(without.assembly).toBeUndefined();
    expect(withDate.held).toEqual(without.held);
    expect(withDate.faded).toEqual(without.faded);
    expect(withDate.tooEarlyCount).toBe(without.tooEarlyCount);
    expect(withDate.held.length + withDate.faded.length + withDate.tooEarlyCount).toBe(
      withDate.scopeCount,
    );
  });

  it('judges the day by her local day, not UTC', () => {
    // 23:30 on the 13th at +02:00 is the 13th for her (before the 14th), though the UTC instant is 21:30 on the 13th too;
    // 01:30 on the 14th at +02:00 is the 14th for her though the UTC instant is the 13th.
    const result = buildRetrospective(
      input({
        entries: [
          review('a-after', '2026-07-13T23:30:00+02:00', 'e1'),
          review('a-same-day', '2026-07-14T01:30:00+02:00', 'e2'),
        ],
      }),
    );
    const byId = new Map((result.assembly ?? []).map((a) => [a.conceptId, a]));
    expect(byId.get('a-after')?.attempted).toBe(true);
    expect(byId.get('a-same-day')?.attempted).toBe(false);
  });
});
