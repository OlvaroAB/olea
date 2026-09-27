/**
 * `[D-388]` (ruled 2026-09-27, option (a)): what carries after an assessment
 * is computed for every concept in the assessment's scope, practised or not;
 * each entry names its basis per later course and whether qualifying
 * practice history exists; the held / faded / too-early partition is
 * untouched and what carries adds no fourth group; and history crosses
 * courses only through one identity, never a shared label.
 *
 * Fixture ids are opaque (INV-3): no real course code or concept name
 * anywhere in this file.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  SAME_AS_LINK_RECORD_SCHEMA_VERSION,
  type SameAsLinkRecord,
  type SameAsLinkStatus,
} from '../concept/same-as.js';
import type { ConceptCourses } from '../insights/types.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { buildRetrospective } from './build.js';
import type { RetrospectiveInput } from './types.js';

const NOW = new Date('2026-09-01T09:00:00.000Z');

function review(
  conceptId: string,
  day: string,
  eventId: string,
  instrumentType: 'qa' | 'mcq' = 'qa',
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00+00:00`,
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

/** Recall probability fixed per instrument id, as `build.spec.ts`'s own stub. */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
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
      return { instrumentId, recallProbability: byInstrument[instrumentId] ?? 0.5 };
    },
  };
}

function link(keyA: string, keyB: string, status: SameAsLinkStatus): SameAsLinkRecord {
  return {
    keyA,
    keyB,
    status,
    reason: 'normalisation-collision',
    proposedAt: '2026-08-01T00:00:00.000Z',
    ...(status === 'confirmed' ? { confirmedAt: '2026-08-02T00:00:00.000Z' } : {}),
    ...(status === 'declined' ? { declinedAt: '2026-08-02T00:00:00.000Z' } : {}),
    ...(status === 'severed' ? { severedAt: '2026-08-03T00:00:00.000Z' } : {}),
    schemaVersion: SAME_AS_LINK_RECORD_SCHEMA_VERSION,
  };
}

/**
 * Four concepts in course K1's scope: one holding, one needing tending, one
 * reviewed only on a recognition-tier instrument (too early, T2), and one
 * never reviewed at all (too early). Every one is also held by course K2.
 */
function fourConceptInput(overrides: Partial<RetrospectiveInput> = {}): RetrospectiveInput {
  return {
    assessmentPath: 'Courses/K1/Midterm.md',
    course: 'K1',
    scope: [
      { conceptId: 'p-held', conceptName: 'Concept P1' },
      { conceptId: 'p-faded', conceptName: 'Concept P2' },
      { conceptId: 'p-recognised', conceptName: 'Concept P3' },
      { conceptId: 'p-never', conceptName: 'Concept P4' },
    ],
    scopeOrigin: 'assessment-stated',
    entries: [
      review('p-held', '2026-08-30', 'e1'),
      review('p-faded', '2026-02-10', 'e2'),
      review('p-recognised', '2026-08-20', 'e3', 'mcq'),
    ],
    scheduler: stubScheduler({
      'qa:p-held:1': 0.95,
      'qa:p-faded:1': 0.2,
      'mcq:p-recognised:1': 0.99,
    }),
    now: NOW,
    holdingCut: 0.7,
    conceptCourses: [
      { conceptId: 'p-held', courses: ['K1', 'K2'] },
      { conceptId: 'p-faded', courses: ['K1', 'K2'] },
      { conceptId: 'p-recognised', courses: ['K1', 'K2'] },
      { conceptId: 'p-never', courses: ['K1', 'K2'] },
    ],
    ...overrides,
  };
}

describe('[D-388] what carries is computed for every concept in scope', () => {
  it('carries every concept in scope, practised or not', () => {
    const result = buildRetrospective(fourConceptInput());
    expect(result.carries.map((c) => c.conceptId).sort()).toEqual([
      'p-faded',
      'p-held',
      'p-never',
      'p-recognised',
    ]);
    for (const entry of result.carries) expect(entry.otherCourses).toEqual(['K2']);
  });

  it('the partition still sums to the scope count, and what carries adds no fourth group', () => {
    const result = buildRetrospective(fourConceptInput());
    expect(result.held.map((c) => c.conceptId)).toEqual(['p-held']);
    expect(result.faded.map((c) => c.conceptId)).toEqual(['p-faded']);
    expect(result.tooEarlyCount).toBe(2);
    expect(result.held.length + result.faded.length + result.tooEarlyCount).toBe(result.scopeCount);
    expect(result.scopeCount).toBe(4);
    // An overlay: every carries entry is a concept already counted in exactly one of the three.
    const scopeIds = new Set(fourConceptInput().scope.map((c) => c.conceptId));
    for (const entry of result.carries) expect(scopeIds.has(entry.conceptId)).toBe(true);
    // Carrying never moves a concept between the three, and never files an unpractised one as faded.
    const withoutCarry = buildRetrospective(fourConceptInput({ conceptCourses: [] }));
    expect(withoutCarry.carries).toEqual([]);
    expect(withoutCarry.held).toEqual(result.held);
    expect(withoutCarry.faded).toEqual(result.faded);
    expect(withoutCarry.tooEarlyCount).toBe(result.tooEarlyCount);
  });

  it('records whether qualifying practice history exists, on the floor that separates held and faded from too early (T2)', () => {
    const result = buildRetrospective(fourConceptInput());
    const practice = Object.fromEntries(
      result.carries.map((c) => [c.conceptId, c.hasQualifyingPractice]),
    );
    expect(practice).toEqual({
      'p-held': true,
      'p-faded': true,
      // One completed review on a recognition-tier instrument is not qualifying practice.
      'p-recognised': false,
      'p-never': false,
    });
    // Consistency with the partition, for every entry: qualifying exactly when held or faded.
    const heldOrFaded = new Set([...result.held, ...result.faded].map((c) => c.conceptId));
    for (const entry of result.carries) {
      expect(entry.hasQualifyingPractice).toBe(heldOrFaded.has(entry.conceptId));
    }
  });

  it('with no other course and no final-assessment scope naming it, an unpractised concept carries nowhere', () => {
    const result = buildRetrospective(
      fourConceptInput({ conceptCourses: [{ conceptId: 'p-never', courses: ['K1'] }] }),
    );
    expect(result.carries).toEqual([]);
  });

  it('an unpractised concept carries into the course’s own final assessment (D-134 Q3), stating no practice', () => {
    const result = buildRetrospective(
      fourConceptInput({
        conceptCourses: [],
        finalAssessmentScope: [{ conceptId: 'p-never', conceptName: 'Concept P4' }],
      }),
    );
    expect(result.carries).toEqual([
      {
        conceptId: 'p-never',
        conceptName: 'Concept P4',
        otherCourses: [],
        carriesToFinalAssessment: true,
        destinations: [],
        finalAssessmentBasis: 'olea-reading',
        hasQualifyingPractice: false,
      },
    ]);
  });
});

describe('[D-388] each carries entry names its basis', () => {
  it('names the declared scope where the later course’s examiner-declared units name it, Olea’s reading otherwise', () => {
    const result = buildRetrospective(
      fourConceptInput({
        conceptCourses: [
          { conceptId: 'p-held', courses: ['K1', 'K2', 'K3'] },
          { conceptId: 'p-never', courses: ['K1', 'K3'] },
        ],
        declaredScopes: [
          { course: 'K2', conceptIds: ['p-held', 'p-never'] },
          { course: 'K1', conceptIds: ['p-held'] },
        ],
      }),
    );
    const byId = new Map(result.carries.map((c) => [c.conceptId, c]));
    expect(byId.get('p-held')?.destinations).toEqual([
      { course: 'K2', basis: 'declared-scope' },
      { course: 'K3', basis: 'olea-reading' },
    ]);
    // A declared scope alone places a concept in the later course, with that basis.
    expect(byId.get('p-never')?.destinations).toEqual([
      { course: 'K2', basis: 'declared-scope' },
      { course: 'K3', basis: 'olea-reading' },
    ]);
    expect(byId.get('p-never')?.otherCourses).toEqual(['K2', 'K3']);
    // The course's own declared scope is never a destination.
    for (const entry of result.carries) {
      expect(entry.destinations.some((d) => d.course === 'K1')).toBe(false);
      expect(entry.destinations.map((d) => d.course)).toEqual(entry.otherCourses);
      expect(entry.finalAssessmentBasis).toBeNull();
    }
  });

  it.each([
    ['assessment-stated', 'declared-scope'],
    ['evidenced', 'olea-reading'],
    [undefined, 'olea-reading'],
  ] as const)(
    'a final-assessment fallback whose scope origin is %s reads as %s',
    (origin, basis) => {
      const result = buildRetrospective(
        fourConceptInput({
          conceptCourses: [],
          finalAssessmentScope: [{ conceptId: 'p-held', conceptName: 'Concept P1' }],
          ...(origin === undefined ? {} : { finalAssessmentScopeOrigin: origin }),
        }),
      );
      expect(result.carries.map((c) => [c.conceptId, c.finalAssessmentBasis])).toEqual([
        ['p-held', basis],
      ]);
    },
  );
});

describe('[D-388] condition 4: history carries across courses only through a justified identity link', () => {
  // The [D-402] shape: one identity per course, the two sharing only a label.
  const scope = [{ conceptId: 'k1-topic', conceptName: 'Shared label' }];
  const conceptCourses: readonly ConceptCourses[] = [
    { conceptId: 'k1-topic', courses: ['K1'] },
    { conceptId: 'k2-topic', courses: ['K2'] },
  ];
  const input = (overrides: Partial<RetrospectiveInput> = {}): RetrospectiveInput =>
    fourConceptInput({
      scope,
      entries: [review('k1-topic', '2026-08-30', 'e1')],
      scheduler: stubScheduler({ 'qa:k1-topic:1': 0.95 }),
      conceptCourses,
      declaredScopes: [{ course: 'K2', conceptIds: ['k2-topic'] }],
      ...overrides,
    });

  it('two concepts sharing only a label do not carry, by reading or by declared scope', () => {
    expect(buildRetrospective(input()).carries).toEqual([]);
    expect(buildRetrospective(input({ sameAsLinks: [] })).carries).toEqual([]);
  });

  it.each(['proposed', 'declined', 'severed'] as const)(
    'a %s same-as link joins nothing',
    (status) => {
      const result = buildRetrospective(
        input({ sameAsLinks: [link('k1-topic', 'k2-topic', status)] }),
      );
      expect(result.carries).toEqual([]);
    },
  );

  it('her confirmed link carries it, on the later course’s declared scope', () => {
    const result = buildRetrospective(
      input({ sameAsLinks: [link('k1-topic', 'k2-topic', 'confirmed')] }),
    );
    expect(result.carries).toEqual([
      {
        conceptId: 'k1-topic',
        conceptName: 'Shared label',
        otherCourses: ['K2'],
        carriesToFinalAssessment: false,
        destinations: [{ course: 'K2', basis: 'declared-scope' }],
        finalAssessmentBasis: null,
        hasQualifyingPractice: true,
      },
    ]);
  });

  it('a confirmed link changes what carries and nothing in the partition', () => {
    const unlinked = buildRetrospective(input());
    const linked = buildRetrospective(
      input({ sameAsLinks: [link('k1-topic', 'k2-topic', 'confirmed')] }),
    );
    expect(linked.held).toEqual(unlinked.held);
    expect(linked.faded).toEqual(unlinked.faded);
    expect(linked.tooEarlyCount).toBe(unlinked.tooEarlyCount);
  });
});

describe('[D-388] determinism', () => {
  it('shuffled scope, join and declared-scope order give an identical reading', () => {
    const base = fourConceptInput({
      declaredScopes: [
        { course: 'K2', conceptIds: ['p-never', 'p-held'] },
        { course: 'K3', conceptIds: ['p-faded'] },
      ],
    });
    const shuffled: RetrospectiveInput = {
      ...base,
      scope: [...base.scope].reverse(),
      conceptCourses: [...base.conceptCourses].reverse(),
      declaredScopes: [...(base.declaredScopes ?? [])].reverse(),
    };
    expect(buildRetrospective(shuffled)).toEqual(buildRetrospective(base));
  });
});
