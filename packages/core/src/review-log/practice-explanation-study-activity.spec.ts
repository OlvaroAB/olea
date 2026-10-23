// D7.1 / `[D-614]` (ol-egov.141.89.6.128): a genuine practice explanation is study activity. Every
// existing reading in olea-core of when she studied that counts review events as days or occasions
// of study counts it the way it counts a review there; a flagged answer and a non-attempt count in
// none; and C5.6's contract-grade session clustering still reads review events only. Scenarios:
// `features/F5-explain-it-back.md` (olea-service), the three tagged
// `core/review-log/practice-explanation-study-activity.spec`.
//
// The readings, each one block below: Today's study days and streak (`today/streak.ts`, and the
// panel that draws it); the absence that decides a re-entry session (`study-session/absence.ts`,
// F6.6 — the one reading of whether she comes back); the spacing insight's occasions and study
// days, pooled and per course (`insights/spacing.ts`, F6.5(a)); and the retrospective's "practised
// by the date" (`retrospective/assembly.ts`, F8.8). The plugin's one such reading, F4.6's course
// activity (`packages/plugin/src/home/provider.ts`), reads the same `isStudyActivity` and is
// asserted in `packages/plugin/test/home/provider.spec.ts`. Ids are structural placeholders (INV-3).
import type {
  NonAttemptLogRecord,
  PracticeExplanationLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { detectSpacing, detectSpacingByCourse } from '../insights/spacing.js';
import { assembleBeforeAssessment } from '../retrospective/assembly.js';
import { clusterReviewSessions, pastSessionsFromReviewLog } from '../session/cluster.js';
import { daysSinceLastReview } from '../study-session/absence.js';
import { buildTodayPanel } from '../today/panel.js';
import { computeStreak, studyDays } from '../today/streak.js';
import {
  isGenuinePracticeExplanation,
  isPracticeExplanation,
  isStudyActivity,
  studiedConceptOf,
} from './practice-explanation.js';

const TODAY = '2026-07-31';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r-default',
    timestamp: '2026-07-01T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 30000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

function practice(
  overrides: Partial<PracticeExplanationLogRecord> = {},
): PracticeExplanationLogRecord {
  return {
    schemaVersion: 6,
    kind: 'practice-explanation',
    eventId: 'p-default',
    timestamp: '2026-07-20T19:00:00-04:00',
    instrumentId: 'explain-back:concept-a',
    attemptId: 'attempt-default',
    conceptIds: ['concept-a'],
    promptShape: 'concept',
    trigger: 'on-demand',
    durationMs: 70000,
    supportLevelShown: 'independent',
    contentRef: 'device-a.content-default',
    ...overrides,
  };
}

function nonAttempt(overrides: Partial<NonAttemptLogRecord> = {}): NonAttemptLogRecord {
  return {
    schemaVersion: 6,
    kind: 'non-attempt',
    eventId: 'na-default',
    timestamp: '2026-07-20T19:00:00-04:00',
    conceptIds: ['concept-a'],
    trigger: 'on-demand',
    ...overrides,
  };
}

/**
 * The same moment as an explain-back review: what a review event would be at that occasion. An
 * explain-back review carries no `examProximity` and no FSRS schedule, so it touches nothing but the
 * occasion itself — the comparison isolates "counts as a review would" from what only a review's
 * selection context can carry.
 */
function asReview(p: PracticeExplanationLogRecord): ReviewLogRecord {
  return review({
    eventId: `as-review-${p.eventId}`,
    timestamp: p.timestamp,
    instrumentId: p.instrumentId,
    instrumentType: 'explain-back',
    conceptIds: [...p.conceptIds],
    rating: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
  });
}

const byTime = (a: ReviewLogEntry, b: ReviewLogEntry) =>
  Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1;

/**
 * A month of daily recall on concept-a, with an assessment on 07-25 visible to each review before it
 * (its `examProximity`), and nothing at all on 07-20, 07-21, 07-22 or after 07-26: the study log a
 * spacing reading can measure.
 */
const DAYS = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')).filter(
  (day) => !['20', '21', '22', '27', '28', '29', '30'].includes(day),
);
const BASE: readonly ReviewLogEntry[] = DAYS.flatMap((day, i) => {
  const proximity = 25 - Number(day);
  const dayReview = (n: number) =>
    review({
      eventId: `r-${day}-${n}`,
      timestamp: `2026-07-${day}T0${n}:00:00-04:00`,
      instrumentId: `qa:concept-a:${n}`,
      selectionContext: {
        dueState: i % 5 === 0 ? 'early' : 'due',
        examProximity: proximity >= 0 ? proximity : null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    });
  return [dayReview(8), dayReview(9)];
});

/** Days whose only study is a genuine practice explanation: three inside the assessment's week, and the last day of the log. */
const GENUINE: readonly PracticeExplanationLogRecord[] = [
  practice({ eventId: 'p-20', timestamp: '2026-07-20T19:00:00-04:00', attemptId: 'attempt-20' }),
  practice({ eventId: 'p-21', timestamp: '2026-07-21T19:00:00-04:00', attemptId: 'attempt-21' }),
  practice({
    eventId: 'p-22',
    timestamp: '2026-07-22T19:00:00-04:00',
    attemptId: 'attempt-22',
    instrumentId: 'explain-back:concept-b',
    conceptIds: ['concept-b', 'concept-a'],
    promptShape: 'relation',
  }),
  practice({ eventId: 'p-30', timestamp: '2026-07-30T19:00:00-04:00', attemptId: 'attempt-30' }),
];

/** The same days holding only a non-attempt and an answer the local check flagged. */
const NOT_STUDY: readonly ReviewLogEntry[] = [
  nonAttempt({ eventId: 'na-20', timestamp: '2026-07-20T19:00:00-04:00' }),
  practice({
    eventId: 'pf-21',
    timestamp: '2026-07-21T19:00:00-04:00',
    attemptId: 'attempt-f21',
    localCheckFlagged: true,
  }),
  nonAttempt({
    eventId: 'na-22',
    timestamp: '2026-07-22T19:00:00-04:00',
    conceptIds: ['concept-b'],
    trigger: 'repeated-failure',
  }),
  practice({
    eventId: 'pf-30',
    timestamp: '2026-07-30T19:00:00-04:00',
    attemptId: 'attempt-f30',
    localCheckFlagged: true,
  }),
];

const WITH_GENUINE = [...BASE, ...GENUINE].sort(byTime);
const AS_REVIEWS = [...BASE, ...GENUINE.map(asReview)].sort(byTime);
const WITH_NOT_STUDY = [...BASE, ...NOT_STUDY].sort(byTime);

const CONCEPT_COURSES = [
  { conceptId: 'concept-a', courses: ['C1'] },
  { conceptId: 'concept-b', courses: ['C2'] },
];

describe('the one rule: a review or a genuine practice explanation is study activity (D7.1)', () => {
  it('a genuine practice explanation is study activity; a flagged one, a non-attempt and every other kind are not', () => {
    expect(GENUINE.every(isStudyActivity)).toBe(true);
    expect(BASE.every(isStudyActivity)).toBe(true);
    expect(NOT_STUDY.some(isStudyActivity)).toBe(false);
    expect(NOT_STUDY.filter(isPracticeExplanation)).toHaveLength(2);
    expect(NOT_STUDY.some(isGenuinePracticeExplanation)).toBe(false);
  });

  it('a practice explanation is study of the concept it explained, the first of its list', () => {
    expect(studiedConceptOf(GENUINE[2] as PracticeExplanationLogRecord)).toBe('concept-b');
    expect(studiedConceptOf(review({ conceptIds: ['concept-a', 'concept-b'] }))).toBe('concept-a');
  });
});

describe('every reading of when she studied counts a genuine practice explanation', () => {
  it('Today: a day whose only study was a practice explanation is a study day, exactly as a review would make it', () => {
    const days = studyDays(WITH_GENUINE);
    for (const day of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-30']) {
      expect(days.has(day), day).toBe(true);
      expect(studyDays(BASE).has(day), day).toBe(false);
    }
    expect(days).toEqual(studyDays(AS_REVIEWS));
  });

  it('Today: the streak and the panel that draws it read the same as with reviews there', () => {
    const streak = (entries: readonly ReviewLogEntry[]) =>
      computeStreak(entries, { today: TODAY, windowDays: 60 });
    expect(streak(WITH_GENUINE)).toEqual(streak(AS_REVIEWS));
    expect(streak(WITH_GENUINE)).not.toEqual(streak(BASE));
    const panel = (entries: readonly ReviewLogEntry[]) =>
      buildTodayPanel({
        entries,
        instruments: null,
        today: TODAY,
        dueThrough: new Date('2026-08-01T03:59:59.999Z'),
        windowDays: 60,
      }).streak;
    expect(panel(WITH_GENUINE)).toEqual(panel(AS_REVIEWS));
  });

  it('absence: a practice explanation is a return — the days since she last studied count from it', () => {
    const now = new Date('2026-08-12T12:00:00Z');
    expect(daysSinceLastReview(WITH_GENUINE, now)).toBe(daysSinceLastReview(AS_REVIEWS, now));
    expect(daysSinceLastReview(WITH_GENUINE, now)).toBeLessThan(daysSinceLastReview(BASE, now));
    // A vault whose only study is one practice explanation has a last study to be away from.
    const only = [GENUINE[3] as PracticeExplanationLogRecord];
    expect(daysSinceLastReview(only, now)).toBe(
      daysSinceLastReview([asReview(only[0] as PracticeExplanationLogRecord)], now),
    );
    expect(daysSinceLastReview(only, now)).toBeGreaterThan(0);
  });

  it('spacing (pooled): each practice explanation is one occasion of work, and its day a study day', () => {
    const base = detectSpacing(BASE);
    const withGenuine = detectSpacing(WITH_GENUINE);
    expect(base.measured).not.toBeNull();
    expect(withGenuine).toEqual(detectSpacing(AS_REVIEWS));
    expect(withGenuine.measured?.reviewCount).toBe(
      (base.measured?.reviewCount ?? 0) + GENUINE.length,
    );
    expect(withGenuine.measured?.nearStudyDayShare).toBeGreaterThan(
      base.measured?.nearStudyDayShare ?? 1,
    );
  });

  it('spacing (per course): a practice explanation belongs to the course of the concept it explained', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      detectSpacingByCourse(entries, CONCEPT_COURSES);
    expect(read(WITH_GENUINE)).toEqual(read(AS_REVIEWS));
    const course = (entries: readonly ReviewLogEntry[], id: string) =>
      read(entries).find((reading) => reading.course === id);
    expect(course(WITH_GENUINE, 'C1')?.reviewCount).toBe(
      (course(BASE, 'C1')?.reviewCount ?? 0) + 3,
    );
    expect(course(WITH_GENUINE, 'C2')?.reviewCount).toBe(1);
    expect(course(BASE, 'C2')?.reviewCount).toBe(0);
  });

  it('the retrospective: a concept practised only by explanation before the date was practised, never demonstrated', () => {
    const assemble = (entries: readonly ReviewLogEntry[]) =>
      assembleBeforeAssessment({
        scope: [
          { conceptId: 'concept-a', conceptName: 'Concept a' },
          { conceptId: 'concept-b', conceptName: 'Concept b' },
        ],
        entries,
        assessmentDate: '2026-07-25',
        stageOptions: {},
      });
    const concept = (entries: readonly ReviewLogEntry[], id: string) =>
      assemble(entries).find((entry) => entry.conceptId === id);
    expect(concept(BASE, 'concept-b')?.attempted).toBe(false);
    expect(concept(WITH_GENUINE, 'concept-b')?.attempted).toBe(true);
    // Practised, not demonstrated: the stage reads reviews only, so concept-b stays unearned.
    expect(concept(WITH_GENUINE, 'concept-b')?.demonstrated).toBe('seed');
    expect(assemble(WITH_GENUINE).map((e) => e.demonstrated)).toEqual(
      assemble(BASE).map((e) => e.demonstrated),
    );
  });
});

describe('a non-attempt and a flagged answer count in none of them', () => {
  it('Today, absence, spacing and the retrospective read exactly as if those days were empty', () => {
    const now = new Date('2026-08-12T12:00:00Z');
    expect(studyDays(WITH_NOT_STUDY)).toEqual(studyDays(BASE));
    expect(computeStreak(WITH_NOT_STUDY, { today: TODAY, windowDays: 60 })).toEqual(
      computeStreak(BASE, { today: TODAY, windowDays: 60 }),
    );
    expect(daysSinceLastReview(WITH_NOT_STUDY, now)).toBe(daysSinceLastReview(BASE, now));
    expect(detectSpacing(WITH_NOT_STUDY)).toEqual(detectSpacing(BASE));
    expect(detectSpacingByCourse(WITH_NOT_STUDY, CONCEPT_COURSES)).toEqual(
      detectSpacingByCourse(BASE, CONCEPT_COURSES),
    );
    const assemble = (entries: readonly ReviewLogEntry[]) =>
      assembleBeforeAssessment({
        scope: [
          { conceptId: 'concept-a', conceptName: 'Concept a' },
          { conceptId: 'concept-b', conceptName: 'Concept b' },
        ],
        entries,
        assessmentDate: '2026-07-25',
        stageOptions: {},
      });
    expect(assemble(WITH_NOT_STUDY)).toEqual(assemble(BASE));
  });
});

describe("C5.6's session clustering is unchanged", () => {
  /** Two reviews 80 minutes apart (over the 45-minute gap), with practice explanations between and around them. */
  const SPLIT: readonly ReviewLogEntry[] = [
    review({ eventId: 'c1', timestamp: '2026-07-10T09:00:00-04:00' }),
    review({ eventId: 'c2', timestamp: '2026-07-10T10:20:00-04:00' }),
    review({ eventId: 'c3', timestamp: '2026-07-11T09:00:00-04:00', durationMs: 900000 }),
  ];
  const AROUND: readonly PracticeExplanationLogRecord[] = [
    practice({ eventId: 'pc-before', timestamp: '2026-07-10T08:40:00-04:00', attemptId: 'a-1' }),
    practice({ eventId: 'pc-between', timestamp: '2026-07-10T09:40:00-04:00', attemptId: 'a-2' }),
    practice({ eventId: 'pc-after', timestamp: '2026-07-10T10:50:00-04:00', attemptId: 'a-3' }),
    practice({ eventId: 'pc-alone', timestamp: '2026-07-12T09:00:00-04:00', attemptId: 'a-4' }),
  ];
  const WITH_AROUND = [...SPLIT, ...AROUND].sort(byTime);

  it('practice explanations neither join, split nor start a session', () => {
    expect(clusterReviewSessions(WITH_AROUND)).toEqual(clusterReviewSessions(SPLIT));
    expect(clusterReviewSessions(WITH_AROUND)).toHaveLength(3);
    // The control: had they been review events, the one between would have joined the first two
    // reviews into one session, and the lone one would have started a session of its own.
    const asReviews = clusterReviewSessions([...SPLIT, ...AROUND.map(asReview)].sort(byTime));
    expect(asReviews.map((session) => session.reviews.length)).toEqual([5, 1, 1]);
    expect(clusterReviewSessions(WITH_AROUND).map((session) => session.reviews.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('the fairness window it feeds reads the same sessions', () => {
    const input = {
      coursesOfConcept: new Map([['concept-a', ['C1']]]),
      runningCourses: ['C1'],
    };
    expect(pastSessionsFromReviewLog(WITH_AROUND, input)).toEqual(
      pastSessionsFromReviewLog(SPLIT, input),
    );
  });
});
