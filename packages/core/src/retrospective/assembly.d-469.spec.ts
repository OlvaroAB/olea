/**
 * F8.8 "What she had practised by the date" (`[D-469]`, `ol-egov.141.89.11.31`): the counts the
 * line draws. Fixture ids are opaque (INV-3).
 */
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { buildRetrospective } from './build.js';
import type { RetrospectiveInput } from './types.js';

function review(conceptId: string, timestamp: string, eventId: string): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `qa:${conceptId}:1`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/** A graded explain-back that qualifies for the top stage on its own attempt. */
function explainBack(conceptId: string, timestamp: string, eventId: string): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `eb:${conceptId}:1`,
    instrumentType: 'explain-back',
    conceptIds: [conceptId],
    rating: null,
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    supportLevelShown: 'independent',
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: 'correct',
      contentRef: `ref-${eventId}`,
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
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

const DATE = '2026-07-14';

function input(
  entries: readonly ReviewLogEntry[],
  overrides: Partial<RetrospectiveInput> = {},
): RetrospectiveInput {
  return {
    assessmentPath: 'Courses/K1/Midterm.md',
    course: 'K1',
    scope: [
      { conceptId: 'k-a', conceptName: 'Concept A' },
      { conceptId: 'k-b', conceptName: 'Concept B' },
      { conceptId: 'k-c', conceptName: 'Concept C' },
    ],
    scopeOrigin: 'assessment-stated',
    entries,
    scheduler,
    now: new Date('2026-09-01T12:00:00.000Z'),
    holdingCut: 0.9,
    conceptCourses: [],
    assessmentDate: DATE,
    ...overrides,
  };
}

describe('the cutoff: both counts read evidence recorded before the start of the date', () => {
  it('counts practice and an explained stage reached before the date', () => {
    const line = buildRetrospective(
      input([
        review('k-a', '2026-07-01T10:00:00+00:00', 'e1'),
        explainBack('k-b', '2026-07-02T10:00:00+00:00', 'e2'),
      ]),
    ).beforeAssessment;
    expect(line).toEqual({
      kind: 'counts',
      practised: 2,
      scopeSize: 3,
      explained: 1,
      basis: 'assessment-stated',
    });
  });

  it('a stage reached after the date does not count, though the present-day stage is higher', () => {
    const result = buildRetrospective(
      input([
        review('k-a', '2026-07-01T10:00:00+00:00', 'e1'),
        explainBack('k-a', '2026-07-20T10:00:00+00:00', 'e2'),
        explainBack('k-b', '2026-07-30T10:00:00+00:00', 'e3'),
      ]),
    );
    // Today k-a would read as explained, but by the date it was practised only.
    expect(result.beforeAssessment).toEqual({
      kind: 'counts',
      practised: 1,
      scopeSize: 3,
      explained: 0,
      basis: 'assessment-stated',
    });
  });

  it('boundary day: the day before counts for both counts, the assessment day itself counts for neither', () => {
    const dayBefore = buildRetrospective(
      input([explainBack('k-a', '2026-07-13T23:59:59+10:00', 'e1')]),
    ).beforeAssessment;
    expect(dayBefore).toMatchObject({ kind: 'counts', practised: 1, explained: 1 });

    const onTheDay = buildRetrospective(
      input([
        review('k-a', '2026-07-13T09:00:00+00:00', 'e1'),
        explainBack('k-a', '2026-07-14T00:00:01+10:00', 'e2'),
        review('k-b', '2026-07-14T00:00:00+10:00', 'e3'),
      ]),
    ).beforeAssessment;
    // Her local day is the offset timestamp's own day: 14 July at +10:00 is on the day, not before it.
    expect(onTheDay).toMatchObject({ kind: 'counts', practised: 1, explained: 0 });
  });
});

describe('the scope basis', () => {
  it('names the stated basis, so a scope edit after the date is visible as the basis of {m}', () => {
    const entries = [review('k-a', '2026-07-01T10:00:00+00:00', 'e1')];
    const before = buildRetrospective(input(entries)).beforeAssessment;
    // A later edit to the stated scope changes the scope list the provider resolves; {m} follows it
    // and the line says whose scope that is.
    const edited = buildRetrospective(
      input(entries, { scope: [{ conceptId: 'k-a', conceptName: 'Concept A' }] }),
    ).beforeAssessment;
    expect(before).toMatchObject({ scopeSize: 3, basis: 'assessment-stated' });
    expect(edited).toMatchObject({ scopeSize: 1, basis: 'assessment-stated' });
  });

  it('an evidenced scope never yields counts: it is the scope limitation, whatever she practised', () => {
    const line = buildRetrospective(
      input(
        [
          review('k-a', '2026-07-01T10:00:00+00:00', 'e1'),
          explainBack('k-b', '2026-07-02T10:00:00+00:00', 'e2'),
          review('k-c', '2026-08-01T10:00:00+00:00', 'e3'),
        ],
        { scopeOrigin: 'evidenced' },
      ),
    ).beforeAssessment;
    expect(line).toEqual({ kind: 'unavailable', reason: 'scope' });
  });
});

describe('unavailable data states the limitation and never a zero', () => {
  it('an empty scope is a scope limitation', () => {
    expect(buildRetrospective(input([], { scope: [] })).beforeAssessment).toEqual({
      kind: 'unavailable',
      reason: 'scope',
    });
  });

  it('a history read that may be incomplete is a history limitation, whatever the counts would be', () => {
    const result = buildRetrospective(
      input([review('k-a', '2026-07-01T10:00:00+00:00', 'e1')], { historyAvailable: false }),
    );
    expect(result.beforeAssessment).toEqual({ kind: 'unavailable', reason: 'history' });
  });

  it('no practice from before the date is a history limitation, not "0 of 3"', () => {
    const result = buildRetrospective(input([review('k-a', '2026-07-20T10:00:00+00:00', 'e1')]));
    expect(result.beforeAssessment).toEqual({ kind: 'unavailable', reason: 'history' });
  });

  it('is absent without an assessment date', () => {
    const { assessmentDate: _date, ...undated } = input([]);
    expect(buildRetrospective(undated).beforeAssessment).toBeUndefined();
  });
});
