// `ol-egov.141.89.9.4`: the recognition credit (`[D-278]`'s 0.60 weight)
// reads a correct, CURRENT, standing quiz answer when the caller supplies that
// fact, so a stale or invalid answer never lowers need (the attainment chain
// spec's section 2.5 in `olea-service`, failure classes N1 and N2). Absent the
// input, the credit reads exactly as today. Ids are placeholders (INV-3).
import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildGapView, type ConceptMaterialPresence } from './build.js';
import { DEFAULT_MCQ_RECOGNITION_WEIGHT, readinessFactorsFor } from './readiness.js';

const QUIZ_PATH = '02 Assessments/quiz-1.md' as VaultPath;

function masteryWithPastRecognition(conceptId: string): ConceptMasteryResult {
  return {
    conceptId,
    state: 'sprout',
    evidence: {
      scoredEventCount: 2,
      scoredSuccessCount: 2,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: true, recall: false, explanation: false },
      tiersSucceeded: { recognition: true, recall: false, explanation: false },
      gradedExplainBackCount: 0,
      recognitionOnly: true,
      successfulScoredDays: 2,
      deepestSoloLevel: null,
      depthGateCleared: false,
      topStageQualified: false,
    },
  };
}

function entry(conceptName: string, rank: number): ConceptPriority {
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
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'CRS101',
    rank,
    priorityScore: 1,
    factors: {
      citations: [citation],
      distinctSourceCount: 1,
      contributions: [contribution],
      preMasteryScore: 1,
      masteryState: 'sprout',
      masteryNeedWeight: 1,
      priorityScore: 1,
    },
    citations: [citation],
    reasoning: 'Cited once.',
  };
}

const RANKING: RankOracleResult = {
  courses: [{ course: 'CRS101', status: 'ranked', ranked: [entry('Alpha', 1), entry('Beta', 2)] }],
  unattributableAssessments: [],
  asOf: '2026-08-16',
};

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

const MASTERY = new Map([
  ['Alpha', masteryWithPastRecognition('Alpha')],
  ['Beta', masteryWithPastRecognition('Beta')],
]);

describe('readinessFactorsFor — the current-recognition input', () => {
  const past = masteryWithPastRecognition('Alpha');

  it('absent, the credit reads past success exactly as today', () => {
    expect(readinessFactorsFor(past, 'recall-style').applied).toBe(true);
  });

  it('a stale, wrong or invalid answer (current = false) never lowers need, whatever succeeded before (N1)', () => {
    const factors = readinessFactorsFor(past, 'recall-style', {}, false);
    expect(factors.applied).toBe(false);
    expect(factors.weight).toBe(1);
    expect(factors.recognitionEvidence).toBe(false);
  });

  it('a correct, current, standing answer earns the credit on a recall-style assessment (N2)', () => {
    const factors = readinessFactorsFor(past, 'recall-style', {}, true);
    expect(factors.applied).toBe(true);
    expect(factors.weight).toBe(DEFAULT_MCQ_RECOGNITION_WEIGHT);
  });

  it('never off format: a current answer earns nothing against a written assessment (N2)', () => {
    expect(readinessFactorsFor(past, 'written', {}, true).applied).toBe(false);
  });

  it('the weight is the ratified baseline ([D-278])', () => {
    expect(DEFAULT_MCQ_RECOGNITION_WEIGHT).toBe(0.6);
  });
});

describe('buildGapView — current recognition per concept key', () => {
  it('absent, both past-recognition rows are credited and the oracle order stands', () => {
    const view = buildGapView({
      ranking: RANKING,
      assessments: [QUIZ],
      mastery: MASTERY,
      materialPresence: PRESENCE,
      sourceCoverage: [],
    });
    const rows = view.courses[0]?.status === 'ranked' ? view.courses[0].rows : [];
    expect(rows.map((row) => row.conceptKey)).toEqual(['Alpha', 'Beta']);
    expect(rows.every((row) => row.readiness.applied)).toBe(true);
  });

  it('supplied, only the current answer is credited; a concept missing from the map is not', () => {
    const view = buildGapView({
      ranking: RANKING,
      assessments: [QUIZ],
      mastery: MASTERY,
      materialPresence: PRESENCE,
      sourceCoverage: [],
      currentRecognition: new Map([['Alpha', true]]),
    });
    const rows = view.courses[0]?.status === 'ranked' ? view.courses[0].rows : [];
    expect(rows.map((row) => row.conceptKey)).toEqual(['Beta', 'Alpha']);
    expect(rows.find((row) => row.conceptKey === 'Beta')?.readiness.applied).toBe(false);
    expect(rows.find((row) => row.conceptKey === 'Alpha')?.readiness.applied).toBe(true);
  });
});
