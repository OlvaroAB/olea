// `ol-egov.141.89.9.4`: the gap row from relevance and need (the attainment
// chain spec's section 2.5 in `olea-service`; failure classes N3, N4, N6, N7).
// Opt-in: a caller that supplies need gets relevance x need x credit, with
// mastery counted once; absent, the row is today's. Ids are placeholders.
import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { NeedReading } from '../mastery/attainment.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildGapView, type ConceptMaterialPresence, type GapRow } from './build.js';
import { DEFAULT_MCQ_RECOGNITION_WEIGHT } from './readiness.js';

const QUIZ_PATH = '02 Assessments/quiz-1.md' as VaultPath;

function entry(
  conceptName: string,
  rank: number,
  preMasteryScore: number,
  masteryNeedWeight: number,
): ConceptPriority {
  const contribution = {
    assessmentPath: QUIZ_PATH,
    yieldRank: 1,
    yieldScore: 1,
    confidence: 1,
    assessmentWeightKnown: true,
    assessmentWeightScore: 1,
    daysUntilDue: 10,
    examProximityScore: 1,
    evidenceStrength: 1,
    contribution: 1,
  };
  const citation = {
    sourcePath: '03 Research/paper-2024.pdf' as VaultPath,
    questionLabel: 'Q1',
    questionText: 'A question.',
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 10 } },
    } as ConceptPriority['citations'][number]['provenance'],
  };
  const priorityScore = preMasteryScore * masteryNeedWeight;
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'CRS101',
    rank,
    priorityScore,
    factors: {
      citations: [citation],
      distinctSourceCount: 1,
      contributions: [contribution],
      preMasteryScore,
      masteryState: 'sprout',
      masteryNeedWeight,
      priorityScore,
    },
    citations: [citation],
    reasoning: 'Cited once.',
  };
}

function ranking(entries: readonly ConceptPriority[]): RankOracleResult {
  return {
    courses: [{ course: 'CRS101', status: 'ranked', ranked: entries }],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
}

const QUIZ: AssessmentRecord = {
  path: QUIZ_PATH,
  course: 'CRS101',
  type: 'Quiz',
  weight: 20,
  weightRaw: '20',
  due: '2026-09-01',
  status: 'todo',
};

const PRESENCE: ReadonlyMap<string, ConceptMaterialPresence> = new Map([
  ['Alpha', { notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath], instrumentCount: 3 }],
  ['Beta', { notePaths: ['05 Zettelkasten/Beta.md' as VaultPath], instrumentCount: 3 }],
]);

function estimated(recall: number): NeedReading {
  return {
    basis: 'estimated',
    value: 1 - recall,
    readiness: { weakest: { instrumentId: 'qa:x', recallProbability: recall }, instrumentsRead: 1 },
  };
}

function rowsOf(view: ReturnType<typeof buildGapView>): readonly GapRow[] {
  const course = view.courses[0];
  return course?.status === 'ranked' ? course.rows : [];
}

function pastRecognition(conceptId: string): ConceptMasteryResult {
  return {
    conceptId,
    state: 'sprout',
    evidence: {
      scoredEventCount: 1,
      scoredSuccessCount: 1,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: true, recall: false, explanation: false },
      tiersSucceeded: { recognition: true, recall: false, explanation: false },
      gradedExplainBackCount: 0,
      recognitionOnly: true,
      successfulScoredDays: 1,
      deepestSoloLevel: null,
      depthGateCleared: false,
      topStageQualified: false,
    },
  };
}

describe('absent need, the row is today’s', () => {
  it('gapScore is priority x readiness weight, and no need rides the row', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 0.35), entry('Beta', 2, 1, 1)]),
        assessments: [QUIZ],
        materialPresence: PRESENCE,
        sourceCoverage: [],
      }),
    );
    expect(rows.find((row) => row.conceptKey === 'Alpha')?.gapScore).toBeCloseTo(0.35, 12);
    expect(rows.every((row) => row.need === undefined)).toBe(true);
  });
});

describe('need supplied: relevance x need x credit, mastery counted once (N7)', () => {
  it('reads relevance, never the ranking’s priority, so the stage ladder is not counted a second time', () => {
    // Same relevance and the same need; the ranking's priorities differ only by
    // its stage-keyed ladder. The gap must not read that ladder.
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 0.15), entry('Beta', 2, 1, 1)]),
        assessments: [QUIZ],
        materialPresence: PRESENCE,
        sourceCoverage: [],
        need: new Map([
          ['Alpha', estimated(0.5)],
          ['Beta', estimated(0.5)],
        ]),
      }),
    );
    const alpha = rows.find((row) => row.conceptKey === 'Alpha');
    const beta = rows.find((row) => row.conceptKey === 'Beta');
    expect(alpha?.gapScore).toBeCloseTo(0.5, 12);
    expect(beta?.gapScore).toBeCloseTo(0.5, 12);
    expect(alpha?.need?.basis).toBe('estimated');
  });

  it('higher current recall means lower need and a later row', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 1), entry('Beta', 2, 1, 1)]),
        assessments: [QUIZ],
        materialPresence: PRESENCE,
        sourceCoverage: [],
        need: new Map([
          ['Alpha', estimated(0.95)],
          ['Beta', estimated(0.4)],
        ]),
      }),
    );
    expect(rows.map((row) => row.conceptKey)).toEqual(['Beta', 'Alpha']);
  });

  it('a concept missing from the need map reads unknown at the declared value, never as weakness (N6)', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 1), entry('Beta', 2, 1, 1)]),
        assessments: [QUIZ],
        materialPresence: PRESENCE,
        sourceCoverage: [],
        need: new Map([['Alpha', estimated(0.8)]]),
      }),
    );
    const beta = rows.find((row) => row.conceptKey === 'Beta');
    expect(beta?.need?.basis).toBe('unknown');
    expect(beta?.need?.value).toBe(1);
    expect(beta?.gapScore).toBe(1);
  });

  it('the recognition credit multiplies need, on format only (N3)', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 1)]),
        assessments: [QUIZ],
        mastery: new Map([['Alpha', pastRecognition('Alpha')]]),
        materialPresence: PRESENCE,
        sourceCoverage: [],
        need: new Map([['Alpha', estimated(0.5)]]),
        currentRecognition: new Map([['Alpha', true]]),
      }),
    );
    expect(rows[0]?.gapScore).toBeCloseTo(0.5 * DEFAULT_MCQ_RECOGNITION_WEIGHT, 12);
  });
});

describe('unmet declared demands withhold the recognition credit (N4, [D-349] open)', () => {
  it('a concept with an unmet demand gets no credit, and the row names what is unmet', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 1)]),
        assessments: [QUIZ],
        mastery: new Map([['Alpha', pastRecognition('Alpha')]]),
        materialPresence: PRESENCE,
        sourceCoverage: [],
        currentRecognition: new Map([['Alpha', true]]),
        unmetDemands: new Map([['Alpha', ['apply-to-unfamiliar-case'] as const]]),
      }),
    );
    expect(rows[0]?.readiness.applied).toBe(false);
    expect(rows[0]?.unmetDemands).toEqual(['apply-to-unfamiliar-case']);
  });

  it('nothing unmet leaves the credit as it was', () => {
    const rows = rowsOf(
      buildGapView({
        ranking: ranking([entry('Alpha', 1, 1, 1)]),
        assessments: [QUIZ],
        mastery: new Map([['Alpha', pastRecognition('Alpha')]]),
        materialPresence: PRESENCE,
        sourceCoverage: [],
        currentRecognition: new Map([['Alpha', true]]),
        unmetDemands: new Map([['Alpha', []]]),
      }),
    );
    expect(rows[0]?.readiness.applied).toBe(true);
    expect(rows[0]?.unmetDemands).toEqual([]);
  });
});
