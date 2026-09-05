import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptMasteryResult, EvidenceTier } from '../mastery/rollup.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildGapView, type ConceptMaterialPresence } from './build.js';
import {
  assessmentFormatOf,
  DEFAULT_MCQ_RECOGNITION_WEIGHT,
  readinessFactorsFor,
} from './readiness.js';

const QUIZ_PATH = '02 Assessments/quiz-1.md' as VaultPath;
const ESSAY_PATH = '02 Assessments/essay-1.md' as VaultPath;

function mastery(
  conceptId: string,
  tiers: Partial<Record<EvidenceTier, boolean>>,
  recognitionOnly = false,
): ConceptMasteryResult {
  return {
    conceptId,
    state: 'sprout',
    evidence: {
      scoredEventCount: 5,
      scoredSuccessCount: 4,
      explainBackAttempts: 0,
      tiersPracticed: {
        recognition: tiers.recognition ?? false,
        recall: tiers.recall ?? false,
        explanation: tiers.explanation ?? false,
      },
      gradedExplainBackCount: 0,
      recognitionOnly,
      successfulScoredDays: 3,
      deepestSoloLevel: null,
      depthGateCleared: false,
    },
  };
}

function entry(conceptName: string, rank: number, assessmentPath: VaultPath): ConceptPriority {
  const contribution = {
    assessmentPath,
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
    // `ol-63e1`: mirrors `conceptName` deliberately — this suite's
    // `masteryMap`/`PRESENCE` fixtures are keyed by the same literal strings,
    // and this file is about the readiness weighting, not the name/key split.
    conceptKey: conceptName,
    course: 'CRS101',
    rank,
    // Identical scores: the ONLY thing that can reorder these two is readiness.
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

function ranking(entries: readonly ConceptPriority[]): RankOracleResult {
  return {
    courses: [{ course: 'CRS101', status: 'ranked', ranked: entries }],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
}

function assessment(path: VaultPath, type: string | undefined): AssessmentRecord {
  return {
    path,
    course: 'CRS101',
    type,
    weight: 20,
    weightRaw: '20',
    due: '2026-09-01',
    status: 'todo',
  };
}

const PRESENCE: ReadonlyMap<string, ConceptMaterialPresence> = new Map([
  ['Alpha', { notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath], instrumentCount: 3 }],
  ['Beta', { notePaths: ['05 Zettelkasten/Beta.md' as VaultPath], instrumentCount: 3 }],
]);

const COVERAGE: readonly SourceCoverage[] = [
  {
    sourcePath: '03 Research/paper-2024.pdf' as VaultPath,
    kinds: ['registered-file'],
    role: 'past-paper',
    format: 'pdf',
    duplicateSourcePaths: [],
    courses: ['CRS101'],
    outcome: 'extracted',
    pages: 2,
    units: 6,
    citations: 2,
    limitations: [],
  },
];

describe('assessmentFormatOf', () => {
  it('resolves a quiz to the MCQ format, case- and whitespace-insensitively', () => {
    expect(assessmentFormatOf('Quiz')).toBe('mcq');
    expect(assessmentFormatOf('  quiz ')).toBe('mcq');
  });

  // The scenario "an assessment type the format map does not recognise weights
  // nothing". Each of F4.8's other three named types is asserted, so widening
  // the map silently is a red test rather than a quiet reordering of her list.
  for (const type of ['Test', 'Assignment', 'Lab', 'Presentation', '']) {
    it(`resolves '${type}' to unknown rather than guessing MCQ`, () => {
      expect(assessmentFormatOf(type)).toBe('unknown');
    });
  }

  it('resolves an absent type to unknown', () => {
    expect(assessmentFormatOf(undefined)).toBe('unknown');
  });
});

describe('readinessFactorsFor', () => {
  it('applies the weight only when the format is MCQ and recognition evidence exists', () => {
    const withMcq = mastery('Alpha', { recognition: true });
    expect(readinessFactorsFor(withMcq, 'mcq').applied).toBe(true);
    expect(readinessFactorsFor(withMcq, 'mcq').weight).toBe(DEFAULT_MCQ_RECOGNITION_WEIGHT);
    expect(readinessFactorsFor(withMcq, 'unknown').applied).toBe(false);
    expect(readinessFactorsFor(withMcq, 'unknown').weight).toBe(1);
  });

  it('weights nothing when the concept has recall evidence but no recognition evidence', () => {
    const recallOnly = mastery('Beta', { recall: true });
    expect(readinessFactorsFor(recallOnly, 'mcq').applied).toBe(false);
    expect(readinessFactorsFor(recallOnly, 'mcq').weight).toBe(1);
  });

  it('weights nothing when there is no mastery entry at all', () => {
    // "No recorded practice" is the absence of evidence either way, not
    // evidence of readiness — and rank.ts already reads that silence.
    expect(readinessFactorsFor(undefined, 'mcq').applied).toBe(false);
    expect(readinessFactorsFor(undefined, 'mcq').weight).toBe(1);
  });

  it('never zeroes a row out, whatever it is configured to', () => {
    expect(() =>
      readinessFactorsFor(mastery('Alpha', { recognition: true }), 'mcq', {
        mcqRecognitionWeight: 0,
      }),
    ).toThrow(/within \(0, 1]/);
    expect(() =>
      readinessFactorsFor(mastery('Alpha', { recognition: true }), 'mcq', {
        mcqRecognitionWeight: 1.5,
      }),
    ).toThrow(/within \(0, 1]/);
  });
});

describe('R7 in the gap view — the readiness/knowledge split', () => {
  const entries = [entry('Alpha', 1, QUIZ_PATH), entry('Beta', 2, QUIZ_PATH)];
  const masteryMap = new Map([['Alpha', mastery('Alpha', { recognition: true })]]);

  it('sorts a concept with recognition evidence below an identically-ranked one, for an MCQ paper', () => {
    const model = buildGapView({
      ranking: ranking(entries),
      assessments: [assessment(QUIZ_PATH, 'Quiz')],
      mastery: masteryMap,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
    });
    const course = model.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected a ranked course');
    // Alpha was ranked FIRST by the oracle and is second here: the only
    // difference between the two entries is its recognition evidence.
    expect(course.rows.map((r) => r.conceptName)).toEqual(['Beta', 'Alpha']);
    expect(course.rows[1]?.oracleRank).toBe(1);
    expect(course.rows[1]?.gapScore).toBeCloseTo(DEFAULT_MCQ_RECOGNITION_WEIGHT, 10);
    expect(course.rows[1]?.readiness.applied).toBe(true);
  });

  it('leaves the oracle order untouched for a non-MCQ assessment', () => {
    const model = buildGapView({
      ranking: ranking([entry('Alpha', 1, ESSAY_PATH), entry('Beta', 2, ESSAY_PATH)]),
      assessments: [assessment(ESSAY_PATH, 'Assignment')],
      mastery: masteryMap,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
    });
    const course = model.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected a ranked course');
    expect(course.rows.map((r) => r.conceptName)).toEqual(['Alpha', 'Beta']);
    expect(course.rows.every((r) => r.readiness.weight === 1)).toBe(true);
  });

  it('does not touch mastery — the state is identical whichever format is in play', () => {
    const mcq = buildGapView({
      ranking: ranking(entries),
      assessments: [assessment(QUIZ_PATH, 'Quiz')],
      mastery: masteryMap,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
    });
    const written = buildGapView({
      ranking: ranking([entry('Alpha', 1, ESSAY_PATH), entry('Beta', 2, ESSAY_PATH)]),
      assessments: [assessment(ESSAY_PATH, 'Assignment')],
      mastery: masteryMap,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
    });
    const alphaIn = (m: typeof mcq): string => {
      const course = m.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected a ranked course');
      const row = course.rows.find((r) => r.conceptName === 'Alpha');
      if (row === undefined) throw new Error('expected Alpha');
      return row.masteryState;
    };
    // R7: mastery describes knowledge, the gap view describes readiness, and
    // one may never rewrite the other.
    expect(alphaIn(mcq)).toBe(alphaIn(written));
    expect(alphaIn(mcq)).toBe('sprout');
  });

  it('is reversible from the outside — weight 1 returns the oracle ordering exactly', () => {
    const model = buildGapView({
      ranking: ranking(entries),
      assessments: [assessment(QUIZ_PATH, 'Quiz')],
      mastery: masteryMap,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
      readiness: { mcqRecognitionWeight: 1 },
    });
    const course = model.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected a ranked course');
    expect(course.rows.map((r) => r.conceptName)).toEqual(['Alpha', 'Beta']);
    expect(course.rows.map((r) => r.gapScore)).toEqual(course.rows.map((r) => r.priorityScore));
  });
});
