/**
 * Scenarios: `features/F4-oracle.md`, "F4.6 / F4.7 / F4.8 — the session
 * builder" — @auto:core/study-session/build.spec
 *
 * The fill is exercised against hand-built `GapRow`s rather than against a
 * `buildGapView` result, deliberately: this module's contract is "select a
 * prefix of an order you were handed", and constructing the order directly is
 * what makes it possible to assert that it is *inherited* rather than
 * recomputed. `gap/build.spec.ts` already owns the question of whether that
 * order is right.
 */

import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptSize } from '../concept/size.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import {
  DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER,
  firstIntervalDaysAfterGood,
} from '../scheduler/serving.js';
import type { SchedulerState } from '../scheduler/types.js';
import type { McqInstrumentRecord, QaInstrumentRecord } from '../session/types.js';
import type { SessionSupportOutcome, SupportLadderTier } from '../support-level/types.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { shiftCalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudySession, type SupportLevelHistoryLookup } from './build.js';
import {
  type DurationEstimateSource,
  type DurationModel,
  estimateInstrumentDurations,
} from './duration.js';
import type { AcceptedExplainBack } from './explain-back.js';
import { buildConceptInstrumentIndex, type ConceptInstrumentIndex } from './instrument-index.js';
import { chooseSupportLevel } from './support-level-chooser.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly gapScore: number;
  readonly rank?: number;
  readonly course?: string;
  readonly gapClass?: GapClass;
  readonly targetAssessmentPath?: VaultPath | null;
  readonly assessmentFormat?: AssessmentFormat;
  /** `ol-urvq` [SIZE-2] — omitted means no size reading, which prices as `'fine'`. */
  readonly conceptSize?: ConceptSize;
}

function row(spec: RowSpec): GapRow {
  return {
    conceptName: spec.conceptName,
    // `ol-63e1`: `instrumentsFor` is now looked up by `conceptKey`
    // (`build.ts`'s fill loop), so this fixture's key mirrors its name —
    // matching the `qa(...)`/`mcq(...)` fixtures' own `conceptIds`, which are
    // plain letters like `'A'` throughout this suite. This file is about the
    // fill algorithm, not the name/key split.
    conceptKey: spec.conceptName,
    course: spec.course ?? 'CRS101',
    gapClass: spec.gapClass ?? 'mastery-gap',
    rank: spec.rank ?? 1,
    oracleRank: spec.rank ?? 1,
    priorityScore: spec.gapScore,
    gapScore: spec.gapScore,
    readiness: {
      assessmentFormat: spec.assessmentFormat ?? 'unknown',
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'sprout',
    targetAssessmentPath:
      spec.targetAssessmentPath === undefined
        ? ('02 Assignments/quiz-2.md' as VaultPath)
        : spec.targetAssessmentPath,
    assessmentFormat: spec.assessmentFormat ?? 'unknown',
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: [],
    instrumentCount: 1,
    affordances: ['open-concept', 'build-session'],
    ...(spec.conceptSize !== undefined ? { conceptSize: spec.conceptSize } : {}),
  };
}

/** A minimal `ConceptSize` fixture — `build.ts`'s fill only ever reads `.band`. */
function conceptSize(band: ConceptSize['band']): ConceptSize {
  return { band, extent: { noteCount: band === 'coarse' ? 3 : 1, structureCorroborated: false } };
}

/** Rows in descending gapScore, ranked 1..n — the shape `buildGapView` hands over. */
function rankedRows(specs: readonly Omit<RowSpec, 'rank'>[]): readonly GapRow[] {
  return specs.map((spec, index) => row({ ...spec, rank: index + 1 }));
}

function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

function mcq(instrumentId: string, conceptIds: readonly string[]): McqInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'mcq',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    mcq: {
      type: 'mcq',
      id: instrumentId,
      predecessor: null,
      stem: 'Which?',
      answer: 'This one.',
      distractors: ['a', 'b', 'c'],
      feedback: null,
      raw: '```mcq\n```',
      span: { start: 0, end: 10 },
      fence: '```',
      terminator: '\n',
    },
  };
}

/**
 * Every instrument the same length, so a budget assertion is arithmetic on a
 * count rather than on three different constants — the fill order stays the
 * thing under test.
 */
function flatDurations(seconds: number): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds,
    source: 'assumed' as const,
    sampleCount: 0,
  }));
  return {
    estimates,
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: () => seconds,
    sourceFor: () => 'assumed',
  };
}

/** `AcceptedExplainBack` fixture (F2.14a, `[D-126]`) — a given fact, never a `GapRow`-derived candidate. */
function acceptedExplainBack(instrumentId: string, conceptName: string): AcceptedExplainBack {
  return {
    instrumentId,
    conceptName,
    course: 'CRS101',
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
  };
}

/**
 * A `DurationModel` whose candidate estimates (qa/cloze/mcq) and accepted
 * explain-back estimate can be independently sourced 'measured' or
 * 'assumed', for exercising {@link StudySessionModel.durationBasis}'s
 * F2.14a combination rule without a real review-log history.
 */
function durationsWithExplainBack(
  candidateSource: DurationEstimateSource,
  explainBackSource: DurationEstimateSource,
): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds: 90,
    source: candidateSource,
    sampleCount: candidateSource === 'measured' ? 5 : 0,
  }));
  return {
    estimates,
    basis: candidateSource,
    totalSampleCount: candidateSource === 'measured' ? 15 : 0,
    explainBack: {
      instrumentType: 'explain-back',
      seconds: 90,
      source: explainBackSource,
      sampleCount: explainBackSource === 'measured' ? 5 : 0,
    },
    secondsFor: () => 90,
    sourceFor: (instrumentType) =>
      instrumentType === 'explain-back' ? explainBackSource : candidateSource,
  };
}

function assessment(path: string, fields: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    path: path as VaultPath,
    course: 'CRS101',
    type: 'Quiz',
    weight: 5,
    weightRaw: '5',
    due: '2026-09-20',
    status: 'upcoming',
    ...fields,
  };
}

function emptyIndex(): ConceptInstrumentIndex {
  return buildConceptInstrumentIndex([]);
}

// ---------------------------------------------------------------------------
// F4.6 — the budget is a declared target, and the order is inherited
// (`[D-091]`, component register §3.7; `ol-zji3` [BUD-1] realigns this suite
// with the ruling — see build.ts's module doc for the semantics)
// ---------------------------------------------------------------------------

describe('the budget is a promise', () => {
  it('keeps filling while under the target, and rounds up to the item that crosses it', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
      { conceptName: 'C', gapScore: 7 },
      { conceptName: 'D', gapScore: 6 },
    ]);
    const index = buildConceptInstrumentIndex([
      qa('a1', ['A']),
      qa('b1', ['B']),
      qa('c1', ['C']),
      qa('d1', ['D']),
    ]);

    // 5 minutes = 300s target; 90s per instrument admits three (270s) while
    // still under target, then a FOURTH — 270 is still below the 300s
    // target, so the fill takes it too and stops only once the running total
    // (360s) has reached the target. A ceiling would have refused this one;
    // the target rounds up to it instead.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 5,
      durations: flatDurations(90),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(4);
    expect(session.plannedSeconds).toBe(360);
    expect(session.plannedSeconds).toBeGreaterThan(session.budgetSeconds);
    // The overshoot is bounded to at most one item: once 360 >= 300, nothing
    // further is offered a slot.
    expect(session.leftOut).toEqual([]);
  });

  it('stops taking instruments once the running total has reached the target', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
      { conceptName: 'C', gapScore: 7 },
    ]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B']), qa('c1', ['C'])]);

    // 2 minutes = 120s target, 60s per instrument: A takes it to 60 (still
    // under target, keep going), B takes it to 120 (AT target — stop). C
    // never gets a look-in, and is left out as did-not-fit rather than
    // silently dropped.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 2,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['A', 'B']);
    expect(session.plannedSeconds).toBe(120);
    expect(session.leftOut).toEqual([
      {
        conceptName: 'C',
        course: 'CRS101',
        gapClass: 'mastery-gap',
        gapRank: 3,
        reason: 'did-not-fit',
      },
    ]);
  });

  it('draws from the highest-priority gaps first, in the order it was handed', () => {
    const rows = rankedRows([
      { conceptName: 'Top', gapScore: 9 },
      { conceptName: 'Middle', gapScore: 5 },
      { conceptName: 'Bottom', gapScore: 1 },
    ]);
    const index = buildConceptInstrumentIndex([
      qa('t1', ['Top']),
      qa('m1', ['Middle']),
      qa('b1', ['Bottom']),
    ]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 2,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['Top', 'Middle']);
    expect(session.items.map((i) => i.position)).toEqual([1, 2]);
    // The ranking itself is untouched: what came in is what is echoed on each
    // item, not a re-derived score.
    expect(session.items.map((i) => i.gapScore)).toEqual([9, 5]);
  });

  it('refuses a caller-flattened multi-course list under the default order rather than comparing gapScore across courses (XCRS-1)', () => {
    // `allGapRows` concatenates course by course; feeding that list straight
    // to `buildStudySession` under the default order used to silently
    // re-sort it by `gapScore` across the course boundary — exactly the
    // comparison `packages/contracts/src/study-plan.ts`'s `weight` doc
    // forbids ("never compared across courses"), and the defect ol-dq1c
    // names. It must fail loudly instead of picking a course by score.
    const rows = [
      row({ conceptName: 'Weak', gapScore: 2, course: 'CRS101', rank: 1 }),
      row({ conceptName: 'Strong', gapScore: 9, course: 'CRS202', rank: 1 }),
    ];
    const index = buildConceptInstrumentIndex([qa('w1', ['Weak']), qa('s1', ['Strong'])]);

    expect(() =>
      buildStudySession({
        rows,
        instruments: index,
        budgetMinutes: 1,
        durations: flatDurations(60),
        asOf: AS_OF,
      }),
    ).toThrow(/rows span 2 courses/i);
  });

  it('allows a multi-course list when the caller supplies its own cross-course-safe order', () => {
    // `order: 'given'` is `composeSessionRows`/`buildComposedStudySession`'s
    // seam (`./compose.ts`, SESS-2): the caller has already allocated across
    // courses without comparing `gapScore`, so this function must not
    // re-derive or reject that order — it only rejects the default.
    const rows = [
      row({ conceptName: 'Strong', gapScore: 9, course: 'CRS202', rank: 1 }),
      row({ conceptName: 'Weak', gapScore: 2, course: 'CRS101', rank: 1 }),
    ];
    const index = buildConceptInstrumentIndex([qa('w1', ['Weak']), qa('s1', ['Strong'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1,
      durations: flatDurations(60),
      asOf: AS_OF,
      order: 'given',
    });

    // The caller's own order is honoured verbatim — 'Strong' first because
    // it was handed first, not because its gapScore is higher.
    expect(session.items.map((i) => i.conceptName)).toEqual(['Strong']);
  });

  it('spreads across her top gaps before giving any one concept a second card', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
    ]);
    const index = buildConceptInstrumentIndex([
      qa('a1', ['A']),
      qa('a2', ['A']),
      qa('b1', ['B']),
      qa('b2', ['B']),
    ]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 4,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    // Breadth before depth: A, B, then A again, then B again.
    expect(session.items.map((i) => i.instrumentId)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('refuses an unusable budget rather than substituting a default', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 1 }]);
    for (const budgetMinutes of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildStudySession({
          rows,
          instruments: emptyIndex(),
          budgetMinutes,
          durations: flatDurations(60),
          asOf: AS_OF,
        }),
      ).toThrow(/budgetMinutes/);
    }
  });

  it('refuses an asOf that is not a calendar day, because the countdown would be silently wrong', () => {
    expect(() =>
      buildStudySession({
        rows: [],
        instruments: emptyIndex(),
        budgetMinutes: 20,
        durations: flatDurations(60),
        asOf: '14 September 2026',
      }),
    ).toThrow(/asOf/);
  });
});

// ---------------------------------------------------------------------------
// F2.17 — a coarse concept's slot is priced as worth more than a fine one's
// (`[D-066]`; `ol-urvq` [SIZE-2])
// ---------------------------------------------------------------------------

describe('a coarse concept costs more of the budget than a fine one', () => {
  it('prices a coarse row at 1.5x a fine row of the same instrument type', () => {
    const rows = rankedRows([
      { conceptName: 'Coarse', gapScore: 9, conceptSize: conceptSize('coarse') },
      { conceptName: 'Fine', gapScore: 8, conceptSize: conceptSize('fine') },
    ]);
    const index = buildConceptInstrumentIndex([qa('c1', ['Coarse']), qa('f1', ['Fine'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    const coarseItem = session.items.find((i) => i.conceptName === 'Coarse');
    const fineItem = session.items.find((i) => i.conceptName === 'Fine');
    expect(coarseItem?.estimatedSeconds).toBe(90); // 60 * 1.5
    expect(fineItem?.estimatedSeconds).toBe(60); // 60 * 1
    expect(session.plannedSeconds).toBe(150);
  });

  it('a row with no size reading prices as fine — the same err-fine asymmetry `concept/size.ts` uses', () => {
    const rows = rankedRows([{ conceptName: 'Unsized', gapScore: 9 }]);
    const index = buildConceptInstrumentIndex([qa('u1', ['Unsized'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items[0]?.estimatedSeconds).toBe(60);
  });

  it('a coarse concept fits fewer instruments into the same target than an all-fine session would', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9, conceptSize: conceptSize('coarse') },
      { conceptName: 'B', gapScore: 8, conceptSize: conceptSize('coarse') },
      { conceptName: 'C', gapScore: 7, conceptSize: conceptSize('coarse') },
    ]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B']), qa('c1', ['C'])]);

    // 3 minutes = 180s target; 60s * 1.5 = 90s per coarse instrument admits
    // two (180s, at target) where three fine instruments would have fit.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 3,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(2);
    expect(session.plannedSeconds).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// F4.6 — leaving out is information
// ---------------------------------------------------------------------------

describe('what is left out is stated, never silently truncated', () => {
  it('names every considered concept that contributed nothing, and why', () => {
    const rows = rankedRows([
      { conceptName: 'Fits', gapScore: 9 },
      { conceptName: 'NoCards', gapScore: 8, gapClass: 'coverage-gap' },
      { conceptName: 'TooLate', gapScore: 7 },
    ]);
    const index = buildConceptInstrumentIndex([qa('f1', ['Fits']), qa('l1', ['TooLate'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['Fits']);
    expect(session.leftOut).toEqual([
      {
        conceptName: 'NoCards',
        course: 'CRS101',
        gapClass: 'coverage-gap',
        gapRank: 2,
        reason: 'no-instruments',
      },
      {
        conceptName: 'TooLate',
        course: 'CRS101',
        gapClass: 'mastery-gap',
        gapRank: 3,
        reason: 'did-not-fit',
      },
    ]);
    expect(session.leftOutInstrumentCount).toBe(1);
  });

  it('a target smaller than the shortest instrument still admits it, rounding up rather than refusing it (`[D-091]`)', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
    ]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);

    // One minute of target, two minutes per instrument: A is still taken —
    // the fill rounds up to the item that crosses the target rather than
    // refusing an instrument that alone exceeds it — and B is left out once
    // the target has been reached.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1,
      durations: flatDurations(120),
      asOf: AS_OF,
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['A']);
    expect(session.plannedSeconds).toBe(120);
    expect(session.plannedSeconds).toBeGreaterThan(session.budgetSeconds);
    expect(session.consideredRowCount).toBe(2);
    expect(session.leftOut.map((o) => o.reason)).toEqual(['did-not-fit']);
  });

  it('nothing to build from is a DIFFERENT state from nothing fitting', () => {
    const nothingToRank = buildStudySession({
      rows: [],
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(nothingToRank.consideredRowCount).toBe(0);
    expect(nothingToRank.items).toEqual([]);
    expect(nothingToRank.leftOut).toEqual([]);
    expect(nothingToRank.nextAssessment).toBeNull();

    // The other emptiness — rows exist, and at least one does not fit even
    // though the target rounds up to admit what it can — is distinguishable
    // by exactly these two fields, which is the whole point of carrying
    // them. (Under `[D-091]`'s target semantics a *lone* row is always
    // admitted — see the "target smaller than the shortest instrument" case
    // above — so demonstrating "something left out" needs a second row the
    // target has no room left for.)
    const nothingFits = buildStudySession({
      rows: rankedRows([
        { conceptName: 'A', gapScore: 9 },
        { conceptName: 'B', gapScore: 8 },
      ]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]),
      budgetMinutes: 1,
      durations: flatDurations(120),
      asOf: AS_OF,
    });
    expect(nothingFits.consideredRowCount).toBe(2);
    expect(nothingFits.leftOut).toHaveLength(1);
  });

  it('an instrument practising two ranked concepts is offered once, to the higher-ranked of them', () => {
    const rows = rankedRows([
      { conceptName: 'Higher', gapScore: 9 },
      { conceptName: 'Lower', gapScore: 8 },
    ]);
    const shared = qa('shared', ['Higher', 'Lower']);
    const index = buildConceptInstrumentIndex([shared]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(1);
    expect(session.items[0]?.conceptName).toBe('Higher');
    expect(session.leftOut).toEqual([
      {
        conceptName: 'Lower',
        course: 'CRS101',
        gapClass: 'mastery-gap',
        gapRank: 2,
        reason: 'already-in-session',
      },
    ]);
    expect(session.leftOutInstrumentCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4.7 — the countdown, surfaced not re-derived
// ---------------------------------------------------------------------------

describe('the exam countdown (F4.7)', () => {
  it('names the assessment she meets next by DATE, not the one that drove the score', () => {
    // The ranking's strongest contributor is the heavily-weighted final; the
    // thing she actually sits next is a small quiz tomorrow.
    const rows = rankedRows([
      {
        conceptName: 'A',
        gapScore: 9,
        targetAssessmentPath: '02 Assignments/final.md' as VaultPath,
        assessmentFormat: 'unknown',
      },
    ]);

    const session = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [
        assessment('02 Assignments/final.md', { due: '2026-11-20', type: 'Test', weight: 40 }),
        assessment('02 Assignments/quiz.md', { due: '2026-09-15', type: 'Quiz', weight: 5 }),
      ],
    });

    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/quiz.md');
    expect(session.nextAssessment?.daysUntil).toBe(1);
    expect(session.formatPreference).toBe('mcq');
  });

  it('ignores an assessment in a course none of the rows belong to', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, course: 'CRS101' }]);

    const session = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [
        assessment('02 Assignments/other-course-quiz.md', {
          course: 'CRS999',
          due: '2026-09-15',
          type: 'Quiz',
        }),
        assessment('02 Assignments/mine.md', {
          course: 'CRS101',
          due: '2026-10-01',
          type: 'Assignment',
        }),
      ],
    });

    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/mine.md');
    expect(session.formatPreference).toBe('unknown');
  });

  it('names the soonest assessment still ahead, with whole days to it', () => {
    const rows = rankedRows([
      {
        conceptName: 'A',
        gapScore: 9,
        targetAssessmentPath: '02 Assignments/far.md' as VaultPath,
      },
      {
        conceptName: 'B',
        gapScore: 8,
        targetAssessmentPath: '02 Assignments/near.md' as VaultPath,
      },
    ]);

    const session = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [
        assessment('02 Assignments/far.md', { due: '2026-11-20' }),
        assessment('02 Assignments/near.md', { due: '2026-09-18' }),
      ],
    });

    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/near.md');
    expect(session.nextAssessment?.daysUntil).toBe(4);
    expect(session.nextAssessment?.due).toBe('2026-09-18');
    expect(session.nextAssessment?.type).toBe('Quiz');
  });

  it('never counts down to an assessment already behind her', () => {
    const rows = rankedRows([
      {
        conceptName: 'A',
        gapScore: 9,
        targetAssessmentPath: '02 Assignments/past.md' as VaultPath,
      },
      {
        conceptName: 'B',
        gapScore: 8,
        targetAssessmentPath: '02 Assignments/ahead.md' as VaultPath,
      },
    ]);

    const session = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [
        assessment('02 Assignments/past.md', { due: '2026-08-14' }),
        assessment('02 Assignments/ahead.md', { due: '2026-10-09' }),
      ],
    });

    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/ahead.md');
    expect(session.nextAssessment?.daysUntil).toBe(25);
  });

  it('an unreadable due date is a null countdown, never a zero', () => {
    const rows = rankedRows([
      {
        conceptName: 'A',
        gapScore: 9,
        targetAssessmentPath: '02 Assignments/vague.md' as VaultPath,
      },
    ]);

    const missing = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/vague.md', { due: undefined })],
    });
    expect(missing.nextAssessment?.assessmentPath).toBe('02 Assignments/vague.md');
    expect(missing.nextAssessment?.daysUntil).toBeNull();
    expect(missing.nextAssessment?.due).toBeNull();

    const unparseable = buildStudySession({
      rows,
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/vague.md', { due: 'end of term' })],
    });
    expect(unparseable.nextAssessment?.daysUntil).toBeNull();
    expect(unparseable.nextAssessment?.due).toBe('end of term');
  });

  it('with no assessment records at all there is still a named target and an explicit null countdown', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });
    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/quiz-2.md');
    expect(session.nextAssessment?.daysUntil).toBeNull();
  });

  it('a row with no target assessment at all contributes no countdown', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9, targetAssessmentPath: null }]),
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });
    expect(session.nextAssessment).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F4.8 — format matching
// ---------------------------------------------------------------------------

describe('assessment-format matching (F4.8)', () => {
  it('prefers the format of the nearest assessment, and records the match on every item', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, assessmentFormat: 'mcq' }]);
    // Vault order puts the Q&A card first; the format preference must move the
    // MCQ ahead of it.
    const index = buildConceptInstrumentIndex([qa('a-qa', ['A']), mcq('a-mcq', ['A'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Quiz' })],
    });

    expect(session.formatPreference).toBe('mcq');
    expect(session.items.map((i) => i.instrumentId)).toEqual(['a-mcq', 'a-qa']);
    expect(session.items.map((i) => i.formatMatch)).toEqual(['preferred-format', 'other-format']);
  });

  it('an unrecognised assessment type expresses no preference and reorders nothing', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, assessmentFormat: 'unknown' }]);
    const index = buildConceptInstrumentIndex([qa('a-qa', ['A']), mcq('a-mcq', ['A'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Seminar' })],
    });

    expect(session.formatPreference).toBe('unknown');
    // Vault order, untouched.
    expect(session.items.map((i) => i.instrumentId)).toEqual(['a-qa', 'a-mcq']);
    expect(session.items.every((i) => i.formatMatch === 'no-preference')).toBe(true);
  });

  it('the preference follows the NEAREST assessment, not the highest-ranked row', () => {
    const rows = rankedRows([
      {
        conceptName: 'Top',
        gapScore: 9,
        targetAssessmentPath: '02 Assignments/essay.md' as VaultPath,
        assessmentFormat: 'unknown',
      },
      {
        conceptName: 'Next',
        gapScore: 8,
        targetAssessmentPath: '02 Assignments/quiz.md' as VaultPath,
        assessmentFormat: 'mcq',
      },
    ]);

    const session = buildStudySession({
      rows,
      instruments: buildConceptInstrumentIndex([qa('t1', ['Top']), mcq('n1', ['Next'])]),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [
        assessment('02 Assignments/essay.md', { due: '2026-11-06', type: 'Assignment' }),
        assessment('02 Assignments/quiz.md', { due: '2026-09-16', type: 'Quiz' }),
      ],
    });

    expect(session.nextAssessment?.assessmentPath).toBe('02 Assignments/quiz.md');
    expect(session.formatPreference).toBe('mcq');
  });
});

// ---------------------------------------------------------------------------
// The duration model, seen through the session
// ---------------------------------------------------------------------------

describe('the session says where its times came from', () => {
  it('carries the model basis and each item’s own source', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9 }]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A'])]);
    const history = Array.from({ length: 6 }, (_, n) => ({
      schemaVersion: 5 as const,
      kind: 'review' as const,
      eventId: `e${n}`,
      timestamp: '2026-09-13T09:00:00.000+00:00',
      instrumentId: 'a1',
      instrumentType: 'qa' as const,
      conceptIds: ['A'],
      rating: 'good' as const,
      wasUnsure: false,
      durationMs: 20_000,
      selectionContext: {
        dueState: 'due' as const,
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa' as const],
        planVersion: null,
      },
    }));

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: estimateInstrumentDurations(history),
      asOf: AS_OF,
    });

    // qa measured at 20s; cloze and mcq still assumed.
    expect(session.durationBasis).toBe('mixed');
    expect(session.items[0]?.estimatedSeconds).toBe(20);
    expect(session.items[0]?.durationSource).toBe('measured');
  });

  it('an all-assumed model says so, so the surface cannot present a guess as a measurement', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 20,
      durations: estimateInstrumentDurations([]),
      asOf: AS_OF,
    });
    expect(session.durationBasis).toBe('assumed');
    expect(session.items[0]?.durationSource).toBe('assumed');
  });
});

// ---------------------------------------------------------------------------
// Accepted explain-back (F2.14a, `[D-126]`) — priced, never a candidate the
// fill selects. See ol-2jod.16, `./explain-back.ts`'s module doc, and the
// F4.6 scenarios "an accepted explain-back is priced against the declared
// budget" et al. in `features/F4-oracle.md` (olea-service).
// ---------------------------------------------------------------------------

describe('accepted explain-back is priced, never selected (F2.14a, `[D-126]`)', () => {
  it('prices an accepted explain-back into plannedSeconds and explainBackItems, never into items', () => {
    const session = buildStudySession({
      rows: [],
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(90),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'Alpha')],
    });

    expect(session.items).toEqual([]);
    expect(session.explainBackItems).toHaveLength(1);
    expect(session.explainBackItems?.[0]).toMatchObject({
      instrumentId: 'eb1',
      conceptName: 'Alpha',
      instrumentType: 'explain-back',
      estimatedSeconds: 90,
      durationSource: 'assumed',
    });
    expect(session.plannedSeconds).toBe(90);
  });

  it("an accepted explain-back's cost comes out of the declared target before the candidate fill runs", () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
    ]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);

    // 3 minutes = 180s target. The explain-back alone costs 90s, leaving 90s
    // of room for the candidate fill — exactly one 90s candidate, not two.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 3,
      durations: flatDurations(90),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'Gamma')],
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['A']);
    expect(session.plannedSeconds).toBe(180);
    expect(session.leftOut.map((o) => o.conceptName)).toEqual(['B']);
  });

  it('an explain-back costing more than the whole target still admits it — the declared target is never a cap (`[D-091]`)', () => {
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9 }]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1, // 60s target
      durations: flatDurations(90),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'Solo')],
    });

    expect(session.explainBackItems).toHaveLength(1);
    // No room left for the candidate fill (90s already spent against a 60s
    // target, clamped at zero rather than negative) — A is left out, never
    // silently dropped.
    expect(session.items).toEqual([]);
    expect(session.plannedSeconds).toBe(90);
    expect(session.leftOut.map((o) => o.conceptName)).toEqual(['A']);
  });

  it('no accepted explain-backs reads as an empty list, never an absent field', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });
    expect(session.explainBackItems).toEqual([]);
  });

  it('several accepted explain-backs are each priced independently and summed', () => {
    const session = buildStudySession({
      rows: [],
      instruments: emptyIndex(),
      budgetMinutes: 20,
      durations: flatDurations(90),
      asOf: AS_OF,
      acceptedExplainBacks: [
        acceptedExplainBack('eb1', 'Alpha'),
        acceptedExplainBack('eb2', 'Beta'),
      ],
    });
    expect(session.explainBackItems).toHaveLength(2);
    expect(session.plannedSeconds).toBe(180);
  });

  it('an accepted explain-back never enters the gap-row candidate fill: F2.21 still holds structurally', () => {
    // Same concept name as a real row, to prove the explain-back event and
    // the row's own candidate instrument are never merged or deduped
    // against each other — they are different mechanisms entirely.
    const rows = rankedRows([{ conceptName: 'Alpha', gapScore: 9 }]);
    const index = buildConceptInstrumentIndex([qa('a1', ['Alpha'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'Alpha')],
    });

    expect(session.items).toHaveLength(1);
    expect(session.items[0]?.instrumentType).toBe('qa');
    expect(session.explainBackItems).toHaveLength(1);
    expect(session.explainBackItems?.[0]?.instrumentType).toBe('explain-back');
  });

  it('a mixed session honestly reads mixed when candidates are measured and the accepted explain-back price is still assumed', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 20,
      durations: durationsWithExplainBack('measured', 'assumed'),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'A')],
    });
    expect(session.durationBasis).toBe('mixed');
  });

  it('an all-measured session, candidates and the accepted explain-back alike, reads measured — not mixed', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 20,
      durations: durationsWithExplainBack('measured', 'measured'),
      asOf: AS_OF,
      acceptedExplainBacks: [acceptedExplainBack('eb1', 'A')],
    });
    expect(session.durationBasis).toBe('measured');
  });

  it('with no accepted explain-back this session, durationBasis describes the candidates alone even when the explain-back estimate itself is assumed', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 20,
      durations: durationsWithExplainBack('measured', 'assumed'),
      asOf: AS_OF,
    });
    expect(session.durationBasis).toBe('measured');
  });
});

// ---------------------------------------------------------------------------
// Row 3.9's chooser, wired into composition ([SUPP-2], `ol-95vv.4`)
// ---------------------------------------------------------------------------

/** A fixed answer for every cell — the fill's own plumbing is what's under test, not the chooser's fold (`support-level-chooser.spec.ts` owns that). */
function fixedHistory(outcomes: readonly SessionSupportOutcome[]): SupportLevelHistoryLookup & {
  readonly asked: Array<{ conceptKey: string; tier: SupportLadderTier }>;
} {
  const asked: Array<{ conceptKey: string; tier: SupportLadderTier }> = [];
  return {
    asked,
    outcomesFor(conceptKey, tier) {
      asked.push({ conceptKey, tier });
      return outcomes;
    },
  };
}

describe('the support-level chooser, wired into the fill (row 3.9, [SUPP-2])', () => {
  it('every StudySessionItem carries no supportLevel at all when no supportHistory is supplied — unchanged, pre-`ol-95vv.4` behaviour', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(1);
    expect(Object.hasOwn(session.items[0] ?? {}, 'supportLevel')).toBe(false);
  });

  it('a recall-tier item (qa/cloze) is scored at the recall tier, keyed by the row’s own conceptKey, strictly from the history it was handed', () => {
    const history = fixedHistory([{ failureShape: 'wrong-concept', hintUptake: false }]);
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      supportHistory: history,
    });

    expect(session.items).toHaveLength(1);
    // One wrong-concept failure from cold start escalates straight to 'guided'
    // (`support-level-chooser.spec.ts`'s own fixture for the same input).
    expect(session.items[0]?.supportLevel).toEqual({
      level: 'guided',
      provenance: 'evidence-thin',
    });
    expect(history.asked).toEqual([{ conceptKey: 'A', tier: 'recall' }]);
  });

  it('an mcq item is never scored — recognition has no ladder ([D-094]), so no lookup is even made for it', () => {
    const history = fixedHistory([{ failureShape: 'wrong-concept', hintUptake: false }]);
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([mcq('a1', ['A'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      supportHistory: history,
    });

    expect(session.items).toHaveLength(1);
    expect(Object.hasOwn(session.items[0] ?? {}, 'supportLevel')).toBe(false);
    expect(history.asked).toEqual([]);
  });

  it('the session’s one self-assessment is applied to every eligible item’s offer, never the folded evidence', () => {
    const history = fixedHistory([]); // cold start: evidence-derived level is 'prompted'
    const session = buildStudySession({
      rows: rankedRows([
        { conceptName: 'A', gapScore: 9 },
        { conceptName: 'B', gapScore: 8 },
      ]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      supportHistory: history,
      supportSelfAssessment: 'unsure',
    });

    expect(session.items.map((i) => i.supportLevel)).toEqual([
      { level: 'guided', provenance: 'self-requested' },
      { level: 'guided', provenance: 'self-requested' },
    ]);
  });

  it('reversal ([D-186]): two reviews on the same concept in ONE composed session get the identical frozen level, never one advanced by the other', () => {
    // The evidence-derived level from sessions closed BEFORE this one — held
    // fixed for the whole fill, per F2.20 (Amended Sep 2026 — `[D-186]`).
    const cleanOutcome: SessionSupportOutcome = { failureShape: 'none', hintUptake: false };
    const historyClosedBeforeThisSession: SessionSupportOutcome[] = [cleanOutcome, cleanOutcome];
    const history = fixedHistory(historyClosedBeforeThisSession);

    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('a2', ['A'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      supportHistory: history,
    });

    // Both instruments practise concept A at the recall tier, and both are
    // composed in this one fill call — the same step that composes the rest
    // of the session's contents, never at review time.
    expect(session.items).toHaveLength(2);
    const levels = session.items.map((i) => i.supportLevel);
    expect(levels[0]).toEqual({ level: 'independent', provenance: 'not-offered' });
    // Item 2 reads the SAME frozen `outcomesFor` result item 1 did — never a
    // version advanced by item 1's own (in-progress, not-yet-real) outcome.
    expect(levels[1]).toEqual(levels[0]);
    expect(history.asked).toEqual([
      { conceptKey: 'A', tier: 'recall' },
      { conceptKey: 'A', tier: 'recall' },
    ]);

    // The counterfactual a mid-session (per-review) reading would produce:
    // item 1's own outcome, already known, folded in before item 2 is
    // scored. It differs from what item 2 actually got — proof the fill's
    // single frozen `supportHistory` is what stands between this session
    // and the drift `[D-186]` forbids.
    const wronglyAdvancedMidSession = chooseSupportLevel([
      ...historyClosedBeforeThisSession,
      { failureShape: 'blank', hintUptake: false },
    ]);
    expect(wronglyAdvancedMidSession).not.toEqual(levels[1]);
  });
});

// ---------------------------------------------------------------------------
// SESS-2's obligation class, threaded through verbatim (F6.7, `ol-y237`)
// ---------------------------------------------------------------------------

describe('obligationClasses threaded onto each StudySessionItem (F6.7, `ol-y237`)', () => {
  it('every StudySessionItem carries no obligationClass at all when no obligationClasses map is supplied — unchanged, pre-`ol-y237` behaviour', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(1);
    expect(Object.hasOwn(session.items[0] ?? {}, 'obligationClass')).toBe(false);
  });

  it("attaches the supplied map's class for the item's own conceptKey, verbatim — never re-derived", () => {
    const session = buildStudySession({
      rows: rankedRows([
        { conceptName: 'A', gapScore: 9 },
        { conceptName: 'B', gapScore: 8 },
      ]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      obligationClasses: new Map([
        ['A', 'unmet'],
        ['B', 'recall-due'],
      ]),
    });

    expect(session.items.map((i) => [i.conceptName, i.obligationClass])).toEqual([
      ['A', 'unmet'],
      ['B', 'recall-due'],
    ]);
  });

  it('a conceptKey absent from the map behaves the same as an absent map, for that one item only', () => {
    const session = buildStudySession({
      rows: rankedRows([
        { conceptName: 'A', gapScore: 9 },
        { conceptName: 'B', gapScore: 8 },
      ]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]),
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
      obligationClasses: new Map([['A', 'baseline-due']]),
    });

    const byName = new Map(session.items.map((i) => [i.conceptName, i]));
    expect(byName.get('A')?.obligationClass).toBe('baseline-due');
    expect(Object.hasOwn(byName.get('B') ?? {}, 'obligationClass')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gap view's `build-session` affordance
// ---------------------------------------------------------------------------

describe('focusing on one concept (the build-session affordance)', () => {
  it('starts the session from that concept without changing anything else', () => {
    const rows = rankedRows([
      { conceptName: 'Top', gapScore: 9 },
      { conceptName: 'Middle', gapScore: 5 },
      { conceptName: 'Bottom', gapScore: 1 },
    ]);
    const index = buildConceptInstrumentIndex([
      qa('t1', ['Top']),
      qa('m1', ['Middle']),
      qa('b1', ['Bottom']),
    ]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 3,
      durations: flatDurations(60),
      asOf: AS_OF,
      focusConceptName: 'Bottom',
    });

    expect(session.items.map((i) => i.conceptName)).toEqual(['Bottom', 'Top', 'Middle']);
    expect(session.focusConcept).toBe('Bottom');
    // The scores are echoed unchanged — focusing moves a row, it does not
    // promote it.
    expect(session.items.map((i) => i.gapScore)).toEqual([1, 9, 5]);
  });

  it('a focus concept absent from the rows is honoured as "not found", not as an error', () => {
    const session = buildStudySession({
      rows: rankedRows([{ conceptName: 'Top', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('t1', ['Top'])]),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      focusConceptName: 'NotHere',
    });

    expect(session.focusConcept).toBe('NotHere');
    expect(session.items.map((i) => i.conceptName)).toEqual(['Top']);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('the fill is pure', () => {
  it('the same inputs give the same session, and the caller’s rows are not mutated', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
    ]);
    const before = JSON.stringify(rows);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);
    const input = {
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    };

    expect(JSON.stringify(buildStudySession(input))).toEqual(
      JSON.stringify(buildStudySession(input)),
    );
    expect(JSON.stringify(rows)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// `[D-240]` item 2 on this composer — `ol-2zfj.71` [SESS-7]
// Scenarios: `../../../../olea-service/features/F2-review.md`, the "F2.17
// amendment" block's [SESS-7] scenarios — @auto:core/study-session/build.spec
// ---------------------------------------------------------------------------

describe('[SESS-7] — the serving rule on the study-session composer ([D-240] item 2)', () => {
  /** The course-B pre-flight shape: 23 concepts, each with an MCQ matching the quiz format and a recall card. */
  const CONCEPTS = Array.from({ length: 23 }, (_, index) => `B${index + 1}`);
  const ARRIVED = '2026-08-05'; // Weeks before AS_OF — every concept's material is long since here.
  const SITTINGS = 6;

  const preflightRows = rankedRows(
    CONCEPTS.map((conceptName, index) => ({
      conceptName,
      gapScore: 100 - index,
      assessmentFormat: 'mcq' as const,
    })),
  );
  // MCQ first in vault order too, so nothing in the result can be an artefact
  // of the enumeration happening to favour the recall card.
  const preflightInstruments = buildConceptInstrumentIndex(
    CONCEPTS.flatMap((c) => [mcq(`${c}-mcq`, [c]), qa(`${c}-qa`, [c])]),
  );
  const arrivalDays = new Map(CONCEPTS.map((c) => [c, ARRIVED]));

  function stateDueOn(day: CalendarDay, scheduledDays = 3): SchedulerState {
    return {
      schemaVersion: 1,
      due: `${day}T09:00:00.000Z`,
      stability: 3,
      difficulty: 5,
      scheduledDays,
      learningStepIndex: 0,
      reps: 2,
      lapses: 0,
      learningState: 'review',
      lastReview: `${shiftCalendarDay(day, -scheduledDays)}T09:00:00.000Z`,
    };
  }

  /**
   * Six sittings on six consecutive days, each composing a session and then
   * rating everything it served `good` through the REAL scheduler — so the
   * second sitting sees the state the first one earned, exactly as the term
   * loop does. Returns what each sitting served.
   */
  function sixSittings(servingPolicy: 'today' | 'interval-bound' | 'preference-off') {
    const scheduler = createFsrsScheduler();
    // Every MCQ is in her rotation and due; every recall card has never once
    // been asked — the null state `[D-240]` item 2's ratified reading covers.
    const states = new Map<string, SchedulerState>(
      CONCEPTS.map((c) => [`${c}-mcq`, stateDueOn(AS_OF)] as const),
    );
    const served: string[][] = [];
    for (let day = 0; day < SITTINGS; day += 1) {
      const asOf = shiftCalendarDay(AS_OF, day);
      const session = buildStudySession({
        rows: preflightRows,
        instruments: preflightInstruments,
        // 23 concepts x 60s = exactly one instrument per concept per sitting.
        budgetMinutes: CONCEPTS.length,
        durations: flatDurations(60),
        asOf,
        assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Quiz' })],
        arrivalDays,
        schedulerStates: new Map(states),
        servingPolicy,
      });
      served.push(session.items.map((item) => item.instrumentId));
      for (const item of session.items) {
        const { state } = scheduler.schedule({
          instrumentId: item.instrumentId,
          state: states.get(item.instrumentId) ?? null,
          rating: 'good',
          now: new Date(`${asOf}T09:00:00.000Z`),
        });
        states.set(item.instrumentId, state);
      }
    }
    return served;
  }

  it("serves every concept's never-asked recall card within its first interval", () => {
    const served = sixSittings('interval-bound');
    // Sitting one: every one of the 23 concepts is practised with its recall
    // card, not its MCQ. The first interval is 3 days
    // (`firstIntervalDaysAfterGood`), so "within its first interval" is
    // satisfied on the very first sitting — the material arrived weeks ago
    // and the card has been waiting ever since.
    expect(served[0]).toEqual(CONCEPTS.map((c) => `${c}-qa`));
    expect(served[0]).toHaveLength(CONCEPTS.length);
    // And every concept met its recall card at least once inside the window
    // the pre-flight measured, which is the property that was false before.
    const everServed = new Set(served.flat());
    for (const c of CONCEPTS) expect(everServed.has(`${c}-qa`)).toBe(true);
  });

  it("reproduces the pre-flight defect under the pre-amendment arm, so the sweep's arms differ", () => {
    // `today` is the un-amended rule: format preference defers the recall
    // card unconditionally, and since a card that is never served never earns
    // an interval, it is deferred for ever. Not one recall card in six
    // sittings — the exact shape `ol-3ux7.5.57.14.21` diagnosed, and the
    // reason the three arms were byte-identical while the flag was inert.
    const served = sixSittings('today');
    expect(served[0]).toEqual(CONCEPTS.map((c) => `${c}-mcq`));
    expect(served.flat().some((id) => id.endsWith('-qa'))).toBe(false);
  });

  it('ignores the format preference entirely under preference-off', () => {
    // Vault order puts the recall card first here, so this arm is
    // distinguishable from both of the others: `today` would move the MCQ
    // ahead of it, and with no arrival day and no state the interval bound
    // has nothing to say either.
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, assessmentFormat: 'mcq' }]);
    const index = buildConceptInstrumentIndex([qa('a-qa', ['A']), mcq('a-mcq', ['A'])]);
    const input = {
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Quiz' })],
    } as const;

    expect(
      buildStudySession({ ...input, servingPolicy: 'preference-off' }).items.map(
        (i) => i.instrumentId,
      ),
    ).toEqual(['a-qa', 'a-mcq']);
    expect(
      buildStudySession({ ...input, servingPolicy: 'today' }).items.map((i) => i.instrumentId),
    ).toEqual(['a-mcq', 'a-qa']);
  });

  it('leaves a concept with no arrival day exactly as it was', () => {
    // The no-op posture both composers take for an absent `arrivalDays`: with
    // no day to measure the wait from, F2.17's un-amended preference rule
    // stays in charge rather than the composer guessing.
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, assessmentFormat: 'mcq' }]);
    const index = buildConceptInstrumentIndex([mcq('a-mcq', ['A']), qa('a-qa', ['A'])]);
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Quiz' })],
    });
    expect(session.items.map((i) => i.instrumentId)).toEqual(['a-mcq', 'a-qa']);
  });

  it('applies the same rule the queue applies, from the same function', () => {
    // Not a behavioural assertion but a structural one, and it is the point
    // of the bead: `orderedForFormat` and `dedupeRank` both delegate to
    // `recallOutranksFormatPreference`, so a change to the rule cannot land
    // on one composer and not the other. Asserted by agreeing on the boundary
    // case rather than by inspecting source: material arrived exactly the
    // first interval ago flips both, one day short flips neither.
    const bound = firstIntervalDaysAfterGood() * DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER;
    const atBound = shiftCalendarDay(AS_OF, -bound);
    const insideBound = shiftCalendarDay(AS_OF, -(bound - 1));
    const rows = rankedRows([{ conceptName: 'A', gapScore: 9, assessmentFormat: 'mcq' }]);
    const index = buildConceptInstrumentIndex([mcq('a-mcq', ['A']), qa('a-qa', ['A'])]);
    const at = (arrived: string) =>
      buildStudySession({
        rows,
        instruments: index,
        budgetMinutes: 20,
        durations: flatDurations(60),
        asOf: AS_OF,
        assessments: [assessment('02 Assignments/quiz-2.md', { type: 'Quiz' })],
        arrivalDays: new Map([['A', arrived]]),
      }).items.map((i) => i.instrumentId);

    expect(at(atBound)).toEqual(['a-qa', 'a-mcq']);
    expect(at(insideBound)).toEqual(['a-mcq', 'a-qa']);
  });
});
