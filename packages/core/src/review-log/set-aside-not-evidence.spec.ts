// `[D-416]` (ol-egov.141.89.6.63): an explain-back attempt she set aside with
// Try again is kept in her log, and nothing that reports what she knows reads
// it. One block per fold: the growth stage and its award (attainment),
// vitality, the support ladder's top-stage admission, the registry, the
// retrospective and Today. Each block folds the same log with and without
// set-aside records and requires the identical reading.
//
// The set-aside records are built to be as tempting as possible: a `correct`
// verdict at the `independent` rung (which the top stage admits if it were
// evidence), on days with no other activity (which a streak would count), on
// the same instrument as real evidence, and for a concept nothing else names.
// Ids are structural placeholders (INV-3).
import type { ExplainBackSetAsideLogRecord, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { readAllConceptAttainment, readAllEligibleConceptVitality } from '../mastery/attainment.js';
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

function setAside(
  overrides: Partial<ExplainBackSetAsideLogRecord> = {},
): ExplainBackSetAsideLogRecord {
  return {
    schemaVersion: 6,
    kind: 'explain-back-set-aside',
    eventId: 's-default',
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId: 'explain-back:concept-a',
    conceptIds: ['concept-a'],
    attemptId: 'attempt-1',
    outcome: { kind: 'graded', verdict: 'correct', artifactProvenance: provenance },
    acceptance: 'not-accepted',
    supportLevelShown: 'independent',
    durationMs: 30000,
    ...overrides,
  };
}

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
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    supportLevelShown: 'guided',
    explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
    followsAttemptId: 'attempt-1',
  }),
];

/** Set-aside attempts: tempting verdicts and rungs, on otherwise empty days, and for a concept nothing else names. */
const SET_ASIDE: readonly ExplainBackSetAsideLogRecord[] = [
  setAside({ eventId: 's1', timestamp: '2026-08-07T09:55:00-04:00' }),
  // An explain-back opened from a card carries that card's own id, so a
  // set-aside attempt can name a recall-tier instrument (the modal's
  // `prompt.originInstrumentId`).
  setAside({
    eventId: 's2',
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    attemptId: 'attempt-2',
    followsAttemptId: 'attempt-1',
  }),
  setAside({
    eventId: 's3',
    timestamp: '2026-08-10T08:00:00-04:00',
    instrumentId: 'explain-back:concept-b',
    conceptIds: ['concept-b'],
    attemptId: 'attempt-3',
  }),
  setAside({
    eventId: 's4',
    timestamp: '2026-08-10T08:05:00-04:00',
    instrumentId: 'explain-back:concept-b',
    conceptIds: ['concept-b'],
    attemptId: 'attempt-4',
    followsAttemptId: 'attempt-3',
    outcome: { kind: 'unable-to-assess' },
  }),
];

/** The same log with every set-aside record interleaved in timestamp order. */
const WITH_SET_ASIDE: readonly ReviewLogEntry[] = [...BASE, ...SET_ASIDE].sort((a, b) =>
  Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1,
);

const CONCEPTS = ['concept-a', 'concept-b'] as const;

/**
 * The sensitivity control: the same attempts written as ordinary accepted
 * explain-back reviews. Each fold below must read THIS log differently from
 * the base log, which proves the fixture would move the fold if the fold
 * read set-aside records as evidence.
 */
const AS_REVIEWS: readonly ReviewLogEntry[] = [
  ...BASE,
  ...SET_ASIDE.map((s) =>
    review({
      eventId: `as-review-${s.eventId}`,
      timestamp: s.timestamp,
      instrumentId: s.instrumentId,
      instrumentType: 'explain-back',
      conceptIds: [...s.conceptIds],
      rating: null,
      selectionContext: {
        dueState: 'new',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['explain-back'],
        planVersion: null,
      },
      supportLevelShown: 'independent',
      explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
    }),
  ),
].sort((a, b) => (Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1));

/**
 * The control for the recall-tier readings (vitality, and the retrospective
 * that reads it): the same moments written as failed recall on the card, the
 * kind of record those readings do fold.
 */
const AS_RECALL_REVIEWS: readonly ReviewLogEntry[] = [
  ...BASE,
  ...SET_ASIDE.map((s) =>
    review({
      eventId: `as-recall-${s.eventId}`,
      timestamp: s.timestamp,
      instrumentId: `qa:${s.conceptIds[0]}:1`,
      conceptIds: [...s.conceptIds],
      rating: 'again',
    }),
  ),
].sort((a, b) => (Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1));

describe('an explain-back set-aside attempt is never evidence ([D-416])', () => {
  it('the fixture really does interleave set-aside records', () => {
    expect(WITH_SET_ASIDE.filter((e) => e.kind === 'explain-back-set-aside')).toHaveLength(4);
    expect(WITH_SET_ASIDE).toHaveLength(BASE.length + SET_ASIDE.length);
  });

  it('attainment: displayed stage, historical award and correction are unchanged', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptAttainment(entries, CONCEPTS, projectInstrumentValidity(entries));
    const without = read(BASE);
    const withSetAside = read(WITH_SET_ASIDE);
    expect(withSetAside).toEqual(without);
    expect(read(AS_REVIEWS)).not.toEqual(without);
    expect(withSetAside.get('concept-b')?.displayed).toEqual(without.get('concept-b')?.displayed);
  });

  it('vitality: every concept reads the same, and a concept named only by set-aside attempts has no instruments', () => {
    const readRollup = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptVitality(entries, CONCEPTS, scheduler, NOW, HOLDING_CUT);
    const readEligible = (entries: readonly ReviewLogEntry[]) =>
      readAllEligibleConceptVitality(
        entries,
        CONCEPTS,
        scheduler,
        NOW,
        HOLDING_CUT,
        projectInstrumentValidity(entries),
      );
    expect(readRollup(WITH_SET_ASIDE)).toEqual(readRollup(BASE));
    expect(readEligible(WITH_SET_ASIDE)).toEqual(readEligible(BASE));
    expect(readRollup(AS_RECALL_REVIEWS)).not.toEqual(readRollup(BASE));
    expect(readEligible(AS_RECALL_REVIEWS)).not.toEqual(readEligible(BASE));
    expect(readRollup(WITH_SET_ASIDE).get('concept-b')).toEqual(readRollup([]).get('concept-b'));
  });

  it('support ladder: an independent, correct set-aside attempt admits nothing toward the top stage', () => {
    const without = computeAllConceptMastery(BASE, CONCEPTS);
    const withSetAside = computeAllConceptMastery(WITH_SET_ASIDE, CONCEPTS);
    expect(withSetAside).toEqual(without);
    // The only accepted explain-back is guided, so the top stage stays out of
    // reach whatever the set-aside attempts claim.
    expect(withSetAside.get('concept-a')?.state).not.toBe('tree');
    // A concept named only by set-aside attempts is not a concept in the log.
    expect(conceptIdsInLog(WITH_SET_ASIDE)).toEqual(conceptIdsInLog(BASE));
    expect(conceptIdsInLog(WITH_SET_ASIDE)).not.toContain('concept-b');
    expect(computeAllConceptMastery(WITH_SET_ASIDE)).toEqual(computeAllConceptMastery(BASE));
    expect(computeAllConceptMastery(AS_REVIEWS, CONCEPTS)).not.toEqual(without);
    expect(conceptIdsInLog(AS_REVIEWS)).toContain('concept-b');
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
    expect(build(WITH_SET_ASIDE)).toEqual(build(BASE));
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
    expect(build(WITH_SET_ASIDE)).toEqual(build(BASE));
    expect(build(AS_RECALL_REVIEWS)).not.toEqual(build(BASE));
  });

  it('Today: study days, streak and the whole panel are unchanged, though set-aside attempts fall on otherwise empty days', () => {
    expect(studyDays(WITH_SET_ASIDE)).toEqual(studyDays(BASE));
    expect(studyDays(WITH_SET_ASIDE).has('2026-08-09')).toBe(false);
    expect(studyDays(WITH_SET_ASIDE).has(TODAY)).toBe(false);
    expect(computeStreak(WITH_SET_ASIDE, { today: TODAY, windowDays: 30 })).toEqual(
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
    expect(panel(WITH_SET_ASIDE)).toEqual(panel(BASE));
    expect(panel(AS_REVIEWS)).not.toEqual(panel(BASE));
    expect(studyDays(AS_REVIEWS).has(TODAY)).toBe(true);
  });
});
