// Concept, course and assessment ids below are structural placeholders
// ("concept-a", "COURSEA", "Assessments/Quiz1.md"), never fixture
// vocabulary — INV-3.
//
// F4.2 acceptance (`ol-p5t04`): "every ranking carries reasoning + citations
// or abstains; adversarial no-evidence course test refuses." This suite
// proves both halves without a model call — `rankOracle` needs none.
import type { MasteryState } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { AssessmentReadReport, AssessmentRecord } from '../assessment/types.js';
import type { ConceptAssessmentEdge, EvidenceQuestionCitation } from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import { rankOracle } from './rank.js';
import type { RankOracleInput } from './types.js';

function citation(overrides: Partial<EvidenceQuestionCitation> = {}): EvidenceQuestionCitation {
  return {
    sourcePath: 'Past Papers/2025.md',
    questionLabel: 'Q1',
    questionText: 'placeholder question text',
    provenance: {
      sourcePath: overrides.sourcePath ?? 'Past Papers/2025.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
    ...overrides,
  };
}

function edge(overrides: Partial<ConceptAssessmentEdge> = {}): ConceptAssessmentEdge {
  return {
    conceptName: 'concept-a',
    assessmentPath: 'Assessments/Quiz1.md',
    course: 'COURSEA',
    yieldRank: 1,
    confidence: 1,
    citations: [citation()],
    ...overrides,
  };
}

function assessment(overrides: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    path: 'Assessments/Quiz1.md',
    course: 'COURSEA',
    type: 'Quiz',
    weight: 20,
    weightRaw: '20',
    due: '2026-09-01',
    status: 'upcoming',
    ...overrides,
  };
}

function readReport(records: readonly AssessmentRecord[]): AssessmentReadReport {
  return {
    records,
    sourceFolders: [],
    notesScanned: records.map((r) => r.path),
    notesWithoutFrontmatter: [],
    columns: [],
    unresolvedFields: [],
    unrecognizedColumns: [],
    configErrors: [],
  };
}

function masteryResult(conceptId: string, state: MasteryState): ConceptMasteryResult {
  return {
    conceptId,
    state,
    evidence: {
      scoredEventCount: state === 'new' ? 0 : 5,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: false, recall: state !== 'new', explanation: false },
      recognitionOnly: false,
      recentWindowSize: state === 'new' ? 0 : 5,
      recentSuccessRate: state === 'new' ? null : 0.8,
      recentDistinctDays: state === 'new' ? 0 : 3,
      recentRecallSuccess: state === 'yours',
    },
  };
}

const ASOF = '2026-08-16';

describe('rankOracle — a single well-evidenced concept', () => {
  it('carries reasoning and citations, and the score is exactly the documented formula', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked).toHaveLength(1);
    const entry = course.ranked[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(entry.citations).toEqual([citation()]);
    expect(entry.reasoning.length).toBeGreaterThan(0);
    expect(entry.rank).toBe(1);

    // Independently recomputed, not copied from the implementation.
    const yieldScore = 1 / 1; // yieldRank 1
    const confidence = 1;
    const weightScore = 20 / 100; // AssessmentRecord.weight / default divisor
    const daysUntilDue = Math.round(
      (Date.parse('2026-09-01T00:00:00.000Z') - Date.parse('2026-08-16T00:00:00.000Z')) /
        86_400_000,
    );
    const proximityScore = 1 / (1 + daysUntilDue / 14); // default half-life
    const expectedPreMastery = yieldScore * confidence * weightScore * proximityScore;
    const expectedPriority = expectedPreMastery * 1; // mastery omitted => 'unknown' => neutral 1

    expect(entry.factors.masteryState).toBe('unknown');
    expect(entry.priorityScore).toBeCloseTo(expectedPriority, 10);
    expect(entry.reasoning).toContain(`Priority score ${expectedPriority.toFixed(3)}`);
    expect(entry.reasoning).toContain('Strongest link: Assessments/Quiz1.md');
    expect(entry.reasoning).toContain(`due in ${daysUntilDue} days`);
  });
});

describe('rankOracle — accumulation across multiple assessments', () => {
  it('a concept examined by two assessments outranks one examined by a single low-weight quiz', () => {
    const strong = edge({
      conceptName: 'concept-strong',
      citations: [citation({ questionLabel: 'Q1' })],
    });
    const strongSecond = edge({
      conceptName: 'concept-strong',
      assessmentPath: 'Assessments/Final.md',
      yieldRank: 2,
      confidence: 0.9,
      citations: [citation({ sourcePath: 'Past Papers/2024.md', questionLabel: 'Q3' })],
    });
    const weak = edge({
      conceptName: 'concept-weak',
      assessmentPath: 'Assessments/Quiz2.md',
      yieldRank: 3,
      confidence: 0.3,
      citations: [citation({ questionLabel: 'Q2' })],
    });
    const input: RankOracleInput = {
      evidence: {
        edges: [strong, strongSecond, weak],
        assessmentsRead: readReport([
          assessment(),
          assessment({ path: 'Assessments/Final.md', weight: 40, due: '2026-09-10' }),
          assessment({ path: 'Assessments/Quiz2.md', weight: 5 }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-strong', 'concept-weak']);
    expect(course.ranked[0]?.factors.contributions).toHaveLength(2);
  });
});

describe('rankOracle — reasoning cites the actual strongest contributor (derived, not decorated)', () => {
  it('names the assessment with the highest `contribution`, not the first or last edge in insertion order', () => {
    // Deliberately inserted weakest-first so a bug that trusted array order
    // (rather than actually finding the max contribution) would pass this
    // test for the wrong reason if the assertion were looser than it is.
    const weakFirst = edge({
      assessmentPath: 'Assessments/Weak.md',
      yieldRank: 5,
      confidence: 0.2,
      citations: [citation({ questionLabel: 'Q9' })],
    });
    const strongLast = edge({
      assessmentPath: 'Assessments/Strong.md',
      yieldRank: 1,
      confidence: 1,
      citations: [citation({ sourcePath: 'Past Papers/2023.md', questionLabel: 'Q1' })],
    });
    const input: RankOracleInput = {
      evidence: {
        edges: [weakFirst, strongLast],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/Weak.md', weight: 5 }),
          assessment({ path: 'Assessments/Strong.md', weight: 100, due: '2026-08-17' }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.contributions[0]?.assessmentPath).toBe('Assessments/Strong.md');
    expect(entry?.reasoning).toContain('Strongest link: Assessments/Strong.md');
    expect(entry?.reasoning).not.toContain('Strongest link: Assessments/Weak.md');
  });
});

describe('rankOracle — assessment weight and exam proximity, unknown vs. known', () => {
  it('an unresolved weight is neutral (1), never a silent zero', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ weight: undefined, weightRaw: undefined })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const contribution = course.ranked[0]?.factors.contributions[0];
    expect(contribution?.assessmentWeightKnown).toBe(false);
    expect(contribution?.assessmentWeightScore).toBe(1);
  });

  it('an already-past due date scores zero proximity', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ due: '2026-01-01' })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const contribution = course.ranked[0]?.factors.contributions[0];
    expect(contribution?.daysUntilDue).toBeLessThan(0);
    expect(contribution?.examProximityScore).toBe(0);
    expect(course.ranked[0]?.priorityScore).toBe(0);
  });

  it('an unparseable due date is neutral (1), distinct from an already-past one', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ due: 'TBD' })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const contribution = course.ranked[0]?.factors.contributions[0];
    expect(contribution?.daysUntilDue).toBeNull();
    expect(contribution?.examProximityScore).toBe(1);
  });
});

describe('rankOracle — mastery join, two distinct absences', () => {
  const input = (mastery?: ReadonlyMap<string, ConceptMasteryResult>): RankOracleInput => ({
    evidence: {
      edges: [edge()],
      assessmentsRead: readReport([assessment()]),
      assessmentsWithNoEvidence: [],
    },
    ...(mastery !== undefined ? { mastery } : {}),
    asOf: ASOF,
  });

  it('mastery omitted entirely => unknown, neutral weight', () => {
    const result = rankOracle(input(undefined));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.factors.masteryState).toBe('unknown');
    expect(course.ranked[0]?.factors.masteryNeedWeight).toBe(1);
  });

  it('mastery supplied but this concept absent from it => new, per P4-T06 contract', () => {
    const mastery = new Map([['some-other-concept', masteryResult('some-other-concept', 'solid')]]);
    const result = rankOracle(input(mastery));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.factors.masteryState).toBe('new');
  });

  it('mastery present and high (`yours`) discounts, but never zeroes, the score', () => {
    const mastery = new Map([['concept-a', masteryResult('concept-a', 'yours')]]);
    const result = rankOracle(input(mastery));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.masteryState).toBe('yours');
    expect(entry?.factors.masteryNeedWeight).toBeGreaterThan(0);
    expect(entry?.factors.masteryNeedWeight).toBeLessThan(1);
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) * (entry?.factors.masteryNeedWeight ?? 0),
      10,
    );
  });
});

describe('rankOracle — the abstain path (INV-5 shape)', () => {
  it('a course whose assessments have zero evidence edges abstains, and never fabricates an empty ranking', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [], // no evidence at all for this course
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/NoEvidence1.md' }),
          assessment({ path: 'Assessments/NoEvidence2.md' }),
        ]),
        assessmentsWithNoEvidence: ['Assessments/NoEvidence1.md', 'Assessments/NoEvidence2.md'],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];
    expect(course?.status).toBe('abstained');
    if (course?.status !== 'abstained') return;
    expect(course.reason).toBe('no-evidence');
    expect(course.assessmentPaths).toEqual([
      'Assessments/NoEvidence1.md',
      'Assessments/NoEvidence2.md',
    ]);
    expect(course.detail).toContain('Assessments/NoEvidence1.md');
    expect(course.detail).toContain('Assessments/NoEvidence2.md');
    // The load-bearing negative: this is NOT the same object shape as a
    // ranked-but-empty course. `status` alone must disambiguate.
    expect((course as { ranked?: unknown }).ranked).toBeUndefined();
  });

  it('a course with some evidenced and some unevidenced assessments still ranks (partial evidence is not abstention)', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([
          assessment(),
          assessment({ path: 'Assessments/NoEvidence.md' }),
        ]),
        assessmentsWithNoEvidence: ['Assessments/NoEvidence.md'],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    expect(course?.status).toBe('ranked');
  });
});

describe('rankOracle — multiple courses and unattributable assessments', () => {
  it('ranks each course independently, sorted by course name, and surfaces course-less assessments separately', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [
          edge({ course: 'COURSEB', assessmentPath: 'Assessments/B1.md' }),
          edge({ course: 'COURSEA', assessmentPath: 'Assessments/A1.md' }),
        ],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/A1.md', course: 'COURSEA' }),
          assessment({ path: 'Assessments/B1.md', course: 'COURSEB' }),
          assessment({ path: 'Assessments/NoCourse.md', course: undefined }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    expect(result.courses.map((c) => c.course)).toEqual(['COURSEA', 'COURSEB']);
    expect(result.unattributableAssessments).toEqual(['Assessments/NoCourse.md']);
  });
});

describe('rankOracle — deterministic tie-break', () => {
  it('equal priority scores break by conceptName ascending', () => {
    const a = edge({ conceptName: 'concept-b', assessmentPath: 'Assessments/Quiz1.md' });
    const b = edge({ conceptName: 'concept-a', assessmentPath: 'Assessments/Quiz1.md' });
    const input: RankOracleInput = {
      evidence: {
        edges: [a, b],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
  });
});

describe('rankOracle — option validation', () => {
  it('rejects a non-positive proximityHalfLifeDays', () => {
    const input: RankOracleInput = {
      evidence: { edges: [], assessmentsRead: readReport([]), assessmentsWithNoEvidence: [] },
      asOf: ASOF,
      options: { proximityHalfLifeDays: 0 },
    };
    expect(() => rankOracle(input)).toThrow(/proximityHalfLifeDays/);
  });

  it('rejects a malformed asOf', () => {
    const input: RankOracleInput = {
      evidence: { edges: [], assessmentsRead: readReport([]), assessmentsWithNoEvidence: [] },
      asOf: 'not-a-date',
    };
    expect(() => rankOracle(input)).toThrow(/asOf/);
  });
});

describe('rankOracle — purity / rebuild equivalence', () => {
  it('the same input produces byte-identical output run twice', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge(), edge({ conceptName: 'concept-b', yieldRank: 2, confidence: 0.5 })],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      mastery: new Map([['concept-a', masteryResult('concept-a', 'shaky')]]),
      asOf: ASOF,
    };
    expect(rankOracle(input)).toEqual(rankOracle(input));
  });
});
