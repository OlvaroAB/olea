// D7.1 / `[D-614]`, F5.5 (ol-egov.141.89.6.128): a practice explanation is study activity, never
// evidence. Every reading of what she knows folds the same log with and without its practice
// explanations and must come back identical: the evidence fold and growth stage (the rollup and
// the attainment display), readiness, vitality, the misconception projection, scheduling (the FSRS
// replay and the scheduling-observation replay), the support ladder, the registry and the
// retrospective's held/faded groupings. A sensitivity control writes the same moments as graded
// explain-back reviews or failed recall and requires a different reading, so the fixture would move
// each fold if it read practice. Scenarios: `features/F5-explain-it-back.md` (olea-service), "no
// reading of what she knows counts it (strip-invariance)"; `features/F2-review.md`, the two F2.11
// scenarios tagged `core/review-log/practice-explanation-not-evidence.spec`. Ids are structural
// placeholders (INV-3).
import type { PracticeExplanationLogRecord, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { readAllConceptAttainment, readAllConceptReadiness } from '../mastery/attainment.js';
import {
  computeAllConceptMastery,
  conceptIdsInLog,
  HOLDING_CUT,
  readAllConceptVitality,
} from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import {
  type McqMisconceptionPick,
  projectMisconceptionsFromAllSources,
} from '../misconception/store.js';
import { buildRegistryModel } from '../registry/build.js';
import { EMPTY_REGISTRY_OVERRIDES } from '../registry/overrides.js';
import { buildRetrospective } from '../retrospective/build.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import {
  replaySchedulerStates,
  replayUnconsumedSchedulingObservations,
} from '../session/replay.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import { buildSupportLevelHistory } from '../support-level/history.js';
import { isPracticeExplanation } from './practice-explanation.js';

const scheduler = createFsrsScheduler();
const NOW = new Date('2026-08-12T16:00:00Z');
/** concept-c is only ever practised: no review names it. */
const CONCEPTS = ['concept-a', 'concept-b', 'concept-c'] as const;
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
    supportLevelShown: 'independent',
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
    timestamp: '2026-08-09T09:00:00-04:00',
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

/** Real evidence: spaced recall on concept-a, recognition beside it, a lapse and a wrong pick on concept-b. */
const BASE: readonly ReviewLogEntry[] = [
  review({ eventId: 'r1', timestamp: '2026-08-01T09:00:00-04:00' }),
  review({ eventId: 'r2', timestamp: '2026-08-03T09:00:00-04:00' }),
  review({ eventId: 'r3', timestamp: '2026-08-05T09:00:00-04:00', rating: 'easy' }),
  review({
    eventId: 'r-mcq',
    timestamp: '2026-08-06T09:00:00-04:00',
    instrumentId: 'mcq:concept-a:1',
    instrumentType: 'mcq',
    correctness: { chosenIndex: 1, matchedKey: true },
  }),
  review({ eventId: 'r4', timestamp: '2026-08-07T09:00:00-04:00' }),
  review({
    eventId: 'rb1',
    timestamp: '2026-08-02T09:00:00-04:00',
    instrumentId: 'qa:concept-b:1',
    conceptIds: ['concept-b'],
    rating: 'again',
  }),
  review({
    eventId: 'rb-mcq',
    timestamp: '2026-08-04T09:00:00-04:00',
    instrumentId: 'mcq:concept-b:1',
    instrumentType: 'mcq',
    conceptIds: ['concept-b'],
    rating: 'again',
    correctness: { chosenIndex: 2, matchedKey: false },
  }),
  {
    schemaVersion: 6,
    kind: 'misconception-observed',
    eventId: 'mo-1',
    timestamp: '2026-08-04T09:00:01-04:00',
    instrumentId: 'mcq:concept-b:1',
    conceptIds: ['concept-b'],
    reviewEventId: 'rb-mcq',
    misconceptionId: 'misc-1',
    distractor: { text: 'option', believes: 'belief', source_says: 'source' },
  },
  review({
    eventId: 'rb2',
    timestamp: '2026-08-06T10:00:00-04:00',
    instrumentId: 'qa:concept-b:1',
    conceptIds: ['concept-b'],
  }),
  {
    schemaVersion: 6,
    kind: 'non-attempt',
    eventId: 'na-1',
    timestamp: '2026-08-08T09:00:00-04:00',
    conceptIds: ['concept-b'],
    trigger: 'repeated-failure',
  },
  {
    schemaVersion: 6,
    kind: 'explain-back-feedback-shown',
    eventId: 'm-1',
    timestamp: '2026-08-09T08:59:00-04:00',
    instrumentId: 'explain-back:concept-a',
    attemptId: 'attempt-a1',
  },
];

/**
 * Practice explanations interleaved with the reviews, on review days and on otherwise empty days,
 * guided and not, a relation prompt naming both concepts, a flagged answer, and the only records
 * that name concept-c.
 */
const PRACTICE: readonly PracticeExplanationLogRecord[] = [
  practice({ eventId: 'p1', timestamp: '2026-08-03T09:30:00-04:00', attemptId: 'attempt-a0' }),
  practice({ eventId: 'p2', timestamp: '2026-08-09T09:05:00-04:00', attemptId: 'attempt-a1' }),
  practice({
    eventId: 'p3',
    timestamp: '2026-08-09T09:10:00-04:00',
    attemptId: 'attempt-a2',
    supportLevelShown: 'guided',
    passageFingerprints: ['digest-1', 'digest-2'],
  }),
  practice({
    eventId: 'p4',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'explain-back:concept-b',
    attemptId: 'attempt-b1',
    conceptIds: ['concept-b', 'concept-a'],
    promptShape: 'relation',
    trigger: 'repeated-failure',
  }),
  practice({
    eventId: 'p5',
    timestamp: '2026-08-11T09:00:00-04:00',
    instrumentId: 'explain-back:concept-c',
    attemptId: 'attempt-c1',
    conceptIds: ['concept-c'],
  }),
  practice({
    eventId: 'p6',
    timestamp: '2026-08-11T09:10:00-04:00',
    instrumentId: 'explain-back:concept-c',
    attemptId: 'attempt-c2',
    conceptIds: ['concept-c'],
    localCheckFlagged: true,
  }),
];

const byTime = (a: ReviewLogEntry, b: ReviewLogEntry) =>
  Date.parse(a.timestamp) < Date.parse(b.timestamp) ? -1 : 1;

const WITH_PRACTICE: readonly ReviewLogEntry[] = [...BASE, ...PRACTICE].sort(byTime);
/** The same log with every practice explanation stripped out. */
const STRIPPED: readonly ReviewLogEntry[] = WITH_PRACTICE.filter((e) => !isPracticeExplanation(e));

const explainBackSelection = (): ReviewLogRecord['selectionContext'] => ({
  dueState: 'new',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['explain-back'],
  planVersion: null,
});

/** Control: the same moments as accepted, independent, correct and deep graded explain-back reviews. */
const AS_GRADED: readonly ReviewLogEntry[] = [
  ...BASE,
  ...PRACTICE.map((p) =>
    review({
      eventId: `as-graded-${p.eventId}`,
      timestamp: p.timestamp,
      instrumentId: p.instrumentId,
      instrumentType: 'explain-back',
      conceptIds: [...p.conceptIds],
      rating: null,
      selectionContext: explainBackSelection(),
      supportLevelShown: 'independent',
      explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
      explainBackGrade: {
        soloLevel: 'relational',
        contentRef: p.contentRef,
        revisionOf: null,
        artifactProvenance: provenance,
      },
      attemptId: p.attemptId,
    }),
  ),
].sort(byTime);

/** Control for the recall-tier readings: the same moments as failed recall on each concept's card. */
const AS_FAILED_RECALL: readonly ReviewLogEntry[] = [
  ...BASE,
  ...PRACTICE.map((p) =>
    review({
      eventId: `as-recall-${p.eventId}`,
      timestamp: p.timestamp,
      instrumentId: `qa:${p.conceptIds[0]}:1`,
      conceptIds: [p.conceptIds[0] ?? 'concept-a'],
      rating: 'again',
    }),
  ),
].sort(byTime);

function picksOf(entries: readonly ReviewLogEntry[]): McqMisconceptionPick[] {
  // The review-log half of the misconception projection, read the way the plugin's store reads it.
  return entries.flatMap((entry) =>
    entry.kind === 'misconception-observed'
      ? [
          {
            eventId: entry.eventId,
            timestamp: entry.timestamp,
            instrumentId: entry.instrumentId,
            conceptIds: entry.conceptIds,
            reviewEventId: entry.reviewEventId,
            distractor: entry.distractor,
          },
        ]
      : [],
  );
}

describe('no reading of what she knows counts a practice explanation (F5.5, [D-614])', () => {
  it('the fixture really does interleave practice explanations, and stripping removes exactly them', () => {
    expect(WITH_PRACTICE.filter(isPracticeExplanation)).toHaveLength(PRACTICE.length);
    expect(STRIPPED).toHaveLength(BASE.length);
  });

  it('the evidence fold: every concept’s mastery result is identical, and no concept is named by practice alone', () => {
    expect(computeAllConceptMastery(WITH_PRACTICE, CONCEPTS)).toEqual(
      computeAllConceptMastery(STRIPPED, CONCEPTS),
    );
    expect(conceptIdsInLog(WITH_PRACTICE)).toEqual(conceptIdsInLog(STRIPPED));
    expect(conceptIdsInLog(WITH_PRACTICE)).not.toContain('concept-c');
    expect(computeAllConceptMastery(AS_GRADED, CONCEPTS)).not.toEqual(
      computeAllConceptMastery(STRIPPED, CONCEPTS),
    );
  });

  it('the growth stage: the displayed stage, its award and its correction are identical', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptAttainment(entries, CONCEPTS, projectInstrumentValidity(entries));
    expect(read(WITH_PRACTICE)).toEqual(read(STRIPPED));
    expect(read(AS_GRADED)).not.toEqual(read(STRIPPED));
  });

  it('readiness: identical for every concept', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptReadiness(
        entries,
        CONCEPTS,
        scheduler,
        NOW,
        projectInstrumentValidity(entries),
      );
    expect(read(WITH_PRACTICE)).toEqual(read(STRIPPED));
    expect(read(AS_FAILED_RECALL)).not.toEqual(read(STRIPPED));
  });

  it('vitality: identical for every concept', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      readAllConceptVitality(entries, CONCEPTS, scheduler, NOW, HOLDING_CUT);
    expect(read(WITH_PRACTICE)).toEqual(read(STRIPPED));
    expect(read(AS_FAILED_RECALL)).not.toEqual(read(STRIPPED));
  });

  it('the misconception projection: identical records', () => {
    const read = (entries: readonly ReviewLogEntry[]) =>
      projectMisconceptionsFromAllSources([], picksOf(entries));
    expect(read(WITH_PRACTICE)).toEqual(read(STRIPPED));
    expect(read(STRIPPED)).toHaveLength(1);
  });

  it('scheduling: every instrument’s replayed state, and the waiting scheduling observations, are identical', () => {
    const withPractice = replaySchedulerStates(WITH_PRACTICE, scheduler);
    const stripped = replaySchedulerStates(STRIPPED, scheduler);
    expect(withPractice.states).toEqual(stripped.states);
    expect(withPractice.replayedCount).toBe(stripped.replayedCount);
    // Only the diagnostic count of skipped lines sees them, as it sees every non-review line.
    expect(withPractice.skippedCount - stripped.skippedCount).toBe(PRACTICE.length);
    // No practice explanation is ever an instrument with a schedule.
    for (const p of PRACTICE) expect(withPractice.states.has(p.instrumentId)).toBe(false);
    expect(replayUnconsumedSchedulingObservations(WITH_PRACTICE)).toEqual(
      replayUnconsumedSchedulingObservations(STRIPPED),
    );
    expect(replaySchedulerStates(AS_FAILED_RECALL, scheduler).states).not.toEqual(stripped.states);
  });

  it('the support ladder: every concept’s outcomes on every tier are identical', () => {
    const read = (entries: readonly ReviewLogEntry[]) => {
      const history = buildSupportLevelHistory(entries);
      return CONCEPTS.flatMap((id) =>
        (['recall', 'explanation'] as const).map((tier) => history.outcomesFor(id, tier)),
      );
    };
    expect(read(WITH_PRACTICE)).toEqual(read(STRIPPED));
    expect(read(STRIPPED).some((outcomes) => outcomes.length > 0)).toBe(true);
    expect(read(AS_FAILED_RECALL)).not.toEqual(read(STRIPPED));
  });

  it('the registry: rows, explain-back summary, mastery and vitality are identical', () => {
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
    expect(build(WITH_PRACTICE)).toEqual(build(STRIPPED));
    expect(build(AS_GRADED)).not.toEqual(build(STRIPPED));
  });

  it('the retrospective: held, faded and too-early groupings are identical', () => {
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
    expect(build(WITH_PRACTICE)).toEqual(build(STRIPPED));
    expect(build(AS_FAILED_RECALL)).not.toEqual(build(STRIPPED));
  });
});

describe('F2.11 under [D-612] and [D-603]: practice alone awards no stage', () => {
  const stages = (entries: readonly ReviewLogEntry[]) =>
    new Map(
      [...readAllConceptAttainment(entries, CONCEPTS, projectInstrumentValidity(entries))].map(
        ([id, reading]) => [id, reading.displayed.state],
      ),
    );

  it('folding a log with a practice explanation moves no stage', () => {
    // One practice explanation of one of its concepts added, then several, then of a concept with no review at all.
    for (const added of [PRACTICE.slice(0, 1), PRACTICE.slice(0, 3), PRACTICE]) {
      const withAdded = [...BASE, ...added].sort(byTime);
      expect(stages(withAdded)).toEqual(stages(BASE));
      expect(computeAllConceptMastery(withAdded, CONCEPTS)).toEqual(
        computeAllConceptMastery(BASE, CONCEPTS),
      );
    }
    // concept-c has only practice: it is not even practised in the stage's sense.
    expect(stages(WITH_PRACTICE).get('concept-c')).toBe('seed');
    // The control: the same moments graded would have moved stages.
    expect(stages(AS_GRADED)).not.toEqual(stages(BASE));
  });

  it('no concept reaches the top stage in v0.9: extensive recognition and recall plus practice is at most sapling', () => {
    const days = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];
    const extensive: ReviewLogEntry[] = days.flatMap((day, i) => [
      review({ eventId: `q-${day}`, timestamp: `2026-08-${day}T09:00:00-04:00`, rating: 'easy' }),
      review({
        eventId: `m-${day}`,
        timestamp: `2026-08-${day}T09:05:00-04:00`,
        instrumentId: 'mcq:concept-a:1',
        instrumentType: 'mcq',
        correctness: { chosenIndex: 0, matchedKey: true },
      }),
      practice({
        eventId: `pe-${day}`,
        timestamp: `2026-08-${day}T09:10:00-04:00`,
        attemptId: `attempt-x${i}`,
        ...(i % 2 === 1
          ? { supportLevelShown: 'independent' as const }
          : { promptShape: 'relation' as const, conceptIds: ['concept-a', 'concept-b'] }),
      }),
    ]);
    const reading = readAllConceptAttainment(
      extensive,
      CONCEPTS,
      projectInstrumentValidity(extensive),
    ).get('concept-a');
    expect(reading?.displayed.state).toBe('sapling');
    expect(computeAllConceptMastery(extensive, CONCEPTS).get('concept-a')?.state).toBe('sapling');
    for (const [, stage] of stages(extensive)) expect(stage).not.toBe('tree');
    // The gate itself is unchanged: the same days with one graded, deep, correct, unaided
    // explanation do open it.
    const graded = [
      ...extensive,
      review({
        eventId: 'graded-1',
        timestamp: '2026-08-11T10:00:00-04:00',
        instrumentId: 'explain-back:concept-a',
        instrumentType: 'explain-back',
        rating: null,
        selectionContext: explainBackSelection(),
        supportLevelShown: 'independent',
        explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'device-a.content-graded',
          revisionOf: null,
          artifactProvenance: provenance,
        },
      }),
    ];
    expect(computeAllConceptMastery(graded, CONCEPTS).get('concept-a')?.state).toBe('tree');
  });
});
