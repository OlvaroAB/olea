// `[D-460]` (ol-egov.141.89.6.86): the explain-back feedback exposure marker is a persisted fact
// beside the review event and never one (knowledge model §4), so nothing that reports what she
// knows reads it. One block per fold: the growth stage and its award (attainment), vitality, the
// support ladder's top-stage admission, the registry, the retrospective and Today. Each block folds
// the same log with and without markers and requires the identical reading; a sensitivity control
// writes the same moments as reviews and requires a different one, so the fixture would move the
// fold if the fold read markers. Markers fall on otherwise empty days (which a streak would count)
// and name the same questions as real evidence. Ids are structural placeholders (INV-3).
import type {
  ExplainBackFeedbackShownLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { readAllConceptAttainment } from '../mastery/attainment.js';
import {
  computeAllConceptMastery,
  conceptIdsInLog,
  HOLDING_CUT,
  readAllConceptVitality,
} from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import { buildRegistryModel } from '../registry/build.js';
import { EMPTY_REGISTRY_OVERRIDES } from '../registry/overrides.js';
import { buildRetrospective } from '../retrospective/build.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import { buildTodayPanel } from '../today/panel.js';
import { computeStreak, studyDays } from '../today/streak.js';

const scheduler = createFsrsScheduler();
const NOW = new Date('2026-08-10T16:00:00Z');
const TODAY = '2026-08-10';
const provenance = { taskId: 'explain-back.judge.v1', promptVersion: '3', modelId: 'model-x' };
const CONCEPTS = ['concept-a', 'concept-b'] as const;

/** The concept each question in the fixture is about, for the sensitivity controls only. */
const CONCEPT_OF: Readonly<Record<string, string>> = {
  'explain-back:concept-a': 'concept-a',
  'qa:concept-a:1': 'concept-a',
  'explain-back:concept-b': 'concept-b',
};

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r-default',
    timestamp: '2026-08-01T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
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

function marker(
  overrides: Partial<ExplainBackFeedbackShownLogRecord> = {},
): ExplainBackFeedbackShownLogRecord {
  return {
    schemaVersion: 6,
    kind: 'explain-back-feedback-shown',
    eventId: 'm-default',
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId: 'explain-back:concept-a',
    attemptId: 'attempt-1',
    ...overrides,
  };
}

const explainBackSelection = (): ReviewLogRecord['selectionContext'] => ({
  dueState: 'new',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['explain-back'],
  planVersion: null,
});

/** Real evidence: qa reviews on four days and one accepted explain-back retry at the guided rung. */
const BASE: readonly ReviewLogEntry[] = [
  review({ eventId: 'r1', timestamp: '2026-08-01T09:00:00-04:00' }),
  review({ eventId: 'r2', timestamp: '2026-08-03T09:00:00-04:00' }),
  review({ eventId: 'r3', timestamp: '2026-08-05T09:00:00-04:00', rating: 'easy' }),
  review({ eventId: 'r4', timestamp: '2026-08-07T09:00:00-04:00' }),
  review({
    eventId: 'r-eb',
    timestamp: '2026-08-07T10:00:00-04:00',
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    selectionContext: explainBackSelection(),
    supportLevelShown: 'guided',
    explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
    attemptId: 'attempt-2',
    followsAttemptId: 'attempt-1',
  }),
];

/** Markers: one before the accepted retry, a duplicate of it, and others on otherwise empty days. */
const MARKERS: readonly ExplainBackFeedbackShownLogRecord[] = [
  marker({ eventId: 'm1', timestamp: '2026-08-07T09:55:00-04:00' }),
  marker({ eventId: 'm1-again', timestamp: '2026-08-07T09:55:00-04:00' }),
  // An explain-back opened from a card carries that card's own id.
  marker({
    eventId: 'm2',
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    attemptId: 'attempt-3',
  }),
  marker({
    eventId: 'm3',
    timestamp: '2026-08-10T08:00:00-04:00',
    instrumentId: 'explain-back:concept-b',
    attemptId: 'attempt-4',
  }),
];

const byTime = (a: ReviewLogEntry, b: ReviewLogEntry) =>
  Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1;

const WITH_MARKERS: readonly ReviewLogEntry[] = [...BASE, ...MARKERS].sort(byTime);

/** Control: the same moments as accepted, independent, correct explain-back reviews. */
const AS_REVIEWS: readonly ReviewLogEntry[] = [
  ...BASE,
  ...MARKERS.map((m) =>
    review({
      eventId: `as-review-${m.eventId}`,
      timestamp: m.timestamp,
      instrumentId: m.instrumentId,
      instrumentType: 'explain-back',
      conceptIds: [CONCEPT_OF[m.instrumentId] ?? 'concept-a'],
      rating: null,
      selectionContext: explainBackSelection(),
      supportLevelShown: 'independent',
      explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
    }),
  ),
].sort(byTime);

/** Control for the recall-tier readings: the same moments as failed recall on the card. */
const AS_RECALL_REVIEWS: readonly ReviewLogEntry[] = [
  ...BASE,
  ...MARKERS.map((m) =>
    review({
      eventId: `as-recall-${m.eventId}`,
      timestamp: m.timestamp,
      instrumentId: `qa:${CONCEPT_OF[m.instrumentId] ?? 'concept-a'}:1`,
      conceptIds: [CONCEPT_OF[m.instrumentId] ?? 'concept-a'],
      rating: 'again',
    }),
  ),
].sort(byTime);

describe('the explain-back feedback exposure marker is never evidence ([D-460])', () => {
  it('the fixture really does interleave markers', () => {
    expect(WITH_MARKERS.filter((e) => e.kind === 'explain-back-feedback-shown')).toHaveLength(4);
    expect(WITH_MARKERS).toHaveLength(BASE.length + MARKERS.length);
  });

  it('attainment: displayed stage, historical award and correction are unchanged', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptAttainment(entries, CONCEPTS, projectInstrumentValidity(entries));
    expect(read(WITH_MARKERS)).toEqual(read(BASE));
    expect(read(AS_REVIEWS)).not.toEqual(read(BASE));
  });

  it('vitality: every concept reads the same', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptVitality(entries, CONCEPTS, scheduler, NOW, HOLDING_CUT);
    expect(read(WITH_MARKERS)).toEqual(read(BASE));
    expect(read(AS_RECALL_REVIEWS)).not.toEqual(read(BASE));
  });

  it('support ladder: a marker admits nothing toward the top stage and names no concept', () => {
    expect(computeAllConceptMastery(WITH_MARKERS, CONCEPTS)).toEqual(
      computeAllConceptMastery(BASE, CONCEPTS),
    );
    expect(conceptIdsInLog(WITH_MARKERS)).toEqual(conceptIdsInLog(BASE));
    expect(conceptIdsInLog(WITH_MARKERS)).not.toContain('concept-b');
    expect(computeAllConceptMastery(AS_REVIEWS, CONCEPTS)).not.toEqual(
      computeAllConceptMastery(BASE, CONCEPTS),
    );
  });

  it('registry: browse rows, explain-back history and vitality are unchanged', () => {
    const concept = (key: string): ConceptRecord => ({
      key,
      name: `Concept ${key}`,
      tier: 2,
      courses: ['C1'],
      sourcePaths: ['Courses/C1/note.md'],
    });
    const instrument = {
      instrumentId: 'qa:concept-a:1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      courses: ['C1'],
      notePath: 'Courses/C1/note.md',
      noteTitle: 'note',
      noteUid: null,
      blockId: 'abc123',
      heading: null,
      ordinal: 1,
      card: {
        raw: 'Q: x\nA: y',
        span: { start: 0, end: 10 },
        blockId: 'abc123',
        foreignScheduling: null,
        type: 'qa',
        style: 'single-line',
        front: 'x',
        back: 'y',
        reversed: false,
      },
    } as VaultInstrumentRecord;
    const build = (entries: readonly ReviewLogEntry[]) =>
      buildRegistryModel({
        concepts: CONCEPTS.map(concept),
        instrumentRecords: [instrument],
        entries,
        scheduler,
        now: NOW,
        holdingCut: HOLDING_CUT,
        overrides: EMPTY_REGISTRY_OVERRIDES,
        suspendedInstrumentIds: new Set(),
      });
    expect(build(WITH_MARKERS)).toEqual(build(BASE));
    expect(build(AS_REVIEWS)).not.toEqual(build(BASE));
  });

  it('retrospective: held, faded and too-early groupings are unchanged', () => {
    const build = (entries: readonly ReviewLogEntry[]) =>
      buildRetrospective({
        assessmentPath: 'Courses/C1/Final.md',
        course: 'C1',
        scope: CONCEPTS.map((conceptId) => ({ conceptId, conceptName: `Concept ${conceptId}` })),
        scopeOrigin: 'evidenced',
        entries,
        scheduler,
        now: NOW,
        holdingCut: HOLDING_CUT,
        conceptCourses: CONCEPTS.map((conceptId) => ({ conceptId, courses: ['C1'] })),
      });
    expect(build(WITH_MARKERS)).toEqual(build(BASE));
    expect(build(AS_RECALL_REVIEWS)).not.toEqual(build(BASE));
  });

  it('Today: study days, streak and the whole panel are unchanged, though markers fall on otherwise empty days', () => {
    expect(studyDays(WITH_MARKERS)).toEqual(studyDays(BASE));
    expect(studyDays(WITH_MARKERS).has('2026-08-09')).toBe(false);
    expect(studyDays(WITH_MARKERS).has(TODAY)).toBe(false);
    expect(computeStreak(WITH_MARKERS, { today: TODAY, windowDays: 30 })).toEqual(
      computeStreak(BASE, { today: TODAY, windowDays: 30 }),
    );
    const panel = (entries: readonly ReviewLogEntry[]) =>
      buildTodayPanel({
        entries,
        instruments: [],
        today: TODAY,
        dueThrough: new Date('2026-08-11T03:59:59.999Z'),
        windowDays: 30,
        concepts: CONCEPTS.map((conceptId) => ({ conceptId, courses: ['C1'] })),
        vitality: { scheduler, now: NOW, holdingCut: HOLDING_CUT },
      });
    expect(panel(WITH_MARKERS)).toEqual(panel(BASE));
    expect(panel(AS_REVIEWS)).not.toEqual(panel(BASE));
  });
});
