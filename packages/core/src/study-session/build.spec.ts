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
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { McqInstrumentRecord, QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudySession } from './build.js';
import { type DurationModel, estimateInstrumentDurations } from './duration.js';
import { buildConceptInstrumentIndex, type ConceptInstrumentIndex } from './instrument-index.js';

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
}

function row(spec: RowSpec): GapRow {
  return {
    conceptName: spec.conceptName,
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
    masteryState: 'shaky',
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
  };
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
// F4.6 — the budget is a ceiling, and the order is inherited
// ---------------------------------------------------------------------------

describe('the budget is a promise', () => {
  it('never exceeds the minutes she asked for', () => {
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

    // 5 minutes = 300s; 90s per instrument admits three, not 3.33.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 5,
      durations: flatDurations(90),
      asOf: AS_OF,
    });

    expect(session.items).toHaveLength(3);
    expect(session.plannedSeconds).toBe(270);
    expect(session.plannedSeconds).toBeLessThanOrEqual(session.budgetSeconds);
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

  it('re-sorts a caller-flattened multi-course list rather than inheriting the flatten order', () => {
    // `allGapRows` concatenates course by course, so a course-2 row with a
    // higher gapScore arrives AFTER a weaker course-1 row.
    const rows = [
      row({ conceptName: 'Weak', gapScore: 2, course: 'CRS101', rank: 1 }),
      row({ conceptName: 'Strong', gapScore: 9, course: 'CRS202', rank: 1 }),
    ];
    const index = buildConceptInstrumentIndex([qa('w1', ['Weak']), qa('s1', ['Strong'])]);

    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

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

  it('a budget too small for even one instrument is an empty session with a stated reason', () => {
    const rows = rankedRows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
    ]);
    const index = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);

    // One minute of budget, two minutes per instrument.
    const session = buildStudySession({
      rows,
      instruments: index,
      budgetMinutes: 1,
      durations: flatDurations(120),
      asOf: AS_OF,
    });

    expect(session.items).toEqual([]);
    expect(session.plannedSeconds).toBe(0);
    expect(session.consideredRowCount).toBe(2);
    expect(session.leftOut.map((o) => o.reason)).toEqual(['did-not-fit', 'did-not-fit']);
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

    // The other emptiness — rows exist, nothing fits — is distinguishable by
    // exactly these two fields, which is the whole point of carrying them.
    const nothingFits = buildStudySession({
      rows: rankedRows([{ conceptName: 'A', gapScore: 9 }]),
      instruments: buildConceptInstrumentIndex([qa('a1', ['A'])]),
      budgetMinutes: 1,
      durations: flatDurations(120),
      asOf: AS_OF,
    });
    expect(nothingFits.consideredRowCount).toBe(1);
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
      schemaVersion: 4 as const,
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
