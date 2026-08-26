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
  const conceptName = overrides.conceptName ?? 'concept-a';
  return {
    conceptName,
    // `ol-63e1`: mirrors `conceptName` by default (never overridden across
    // this suite) — this file's `mastery` maps are keyed by the same literal
    // strings ('concept-a', 'concept-b', ...), the honest case where a
    // vocabulary term's display name and derived key root happen to
    // coincide. `evidence-edge/build.spec.ts` and `oracle/compose.spec.ts`
    // cover the case where they diverge.
    conceptKey: conceptName,
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
      scoredEventCount: state === 'seed' ? 0 : 5,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: false, recall: state !== 'seed', explanation: false },
      recognitionOnly: false,
      recentWindowSize: state === 'seed' ? 0 : 5,
      recentSuccessRate: state === 'seed' ? null : 0.8,
      recentDistinctDays: state === 'seed' ? 0 : 3,
      recentRecallSuccess: state === 'tree',
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

describe('rankOracle — the past-paper yield signal is load-bearing, not decoration (ol-evr1 / [YIELD-1])', () => {
  it('a concept with stronger past-paper salience outranks an otherwise-identical one, and flattening yieldRank collapses that order', () => {
    // Both concepts share the SAME single assessment, so weight, exam
    // proximity and mastery (all omitted/unknown here) are identical for
    // both — yieldRank/confidence (the signal `extractTier3Evidence`/
    // `buildConceptAssessmentEdges` derive from her registered past papers)
    // is the only thing that can drive the order below.
    const sharedAssessment = readReport([assessment()]);
    const withSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({ conceptName: 'concept-a', conceptKey: 'concept-a', yieldRank: 1, confidence: 1 }),
          edge({ conceptName: 'concept-b', conceptKey: 'concept-b', yieldRank: 5, confidence: 1 }),
        ],
        assessmentsRead: sharedAssessment,
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const ranked = rankOracle(withSignal);
    const course = ranked.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
    expect(course.ranked[0]?.priorityScore).toBeGreaterThan(course.ranked[1]?.priorityScore ?? 0);

    // Ablate: flatten yieldRank to the same value for both concepts, holding
    // every other factor fixed. If yield/confidence were decoration — never
    // actually driving the order above — this would still differ. It must
    // not: the two scores collapse to equal, and only the deterministic
    // name-ascending tie-break (never a fabricated preference) decides order.
    const withoutSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({ conceptName: 'concept-a', conceptKey: 'concept-a', yieldRank: 1, confidence: 1 }),
          edge({ conceptName: 'concept-b', conceptKey: 'concept-b', yieldRank: 1, confidence: 1 }),
        ],
        assessmentsRead: sharedAssessment,
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const flattened = rankOracle(withoutSignal);
    const flatCourse = flattened.courses[0];
    if (flatCourse?.status !== 'ranked') throw new Error('expected ranked');
    expect(flatCourse.ranked[0]?.priorityScore).toBeCloseTo(
      flatCourse.ranked[1]?.priorityScore ?? -1,
      10,
    );
    expect(flatCourse.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
  });
});

describe('rankOracle — assessment weight is load-bearing, not decoration ([YIELD-2] / ol-3ux7.7)', () => {
  it('a concept examined by a heavier-weighted assessment outranks an otherwise-identical one, and flattening the weights collapses that order', () => {
    // Each concept is tied to its OWN single assessment (assessment weight
    // is a per-assessment property, not a per-edge one), but both
    // assessments share the same due date and both edges share the same
    // yieldRank/confidence — so assessment weight is the only thing that
    // can drive the order below.
    const heavyAssessment = assessment({
      path: 'Assessments/Heavy.md',
      weight: 80,
      due: '2026-09-01',
    });
    const lightAssessment = assessment({
      path: 'Assessments/Light.md',
      weight: 5,
      due: '2026-09-01',
    });
    const withSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({
            conceptName: 'concept-a',
            conceptKey: 'concept-a',
            assessmentPath: 'Assessments/Heavy.md',
          }),
          edge({
            conceptName: 'concept-b',
            conceptKey: 'concept-b',
            assessmentPath: 'Assessments/Light.md',
          }),
        ],
        assessmentsRead: readReport([heavyAssessment, lightAssessment]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const ranked = rankOracle(withSignal);
    const course = ranked.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
    expect(course.ranked[0]?.priorityScore).toBeGreaterThan(course.ranked[1]?.priorityScore ?? 0);

    // Ablate: flatten both assessments to the same weight, holding every
    // other factor fixed. If assessment weight were decoration — never
    // actually driving the order above — this would still differ. It must
    // not: the two scores collapse to equal, and only the deterministic
    // name-ascending tie-break decides order.
    const flattenedLight = assessment({
      path: 'Assessments/Light.md',
      weight: 80,
      due: '2026-09-01',
    });
    const withoutSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({
            conceptName: 'concept-a',
            conceptKey: 'concept-a',
            assessmentPath: 'Assessments/Heavy.md',
          }),
          edge({
            conceptName: 'concept-b',
            conceptKey: 'concept-b',
            assessmentPath: 'Assessments/Light.md',
          }),
        ],
        assessmentsRead: readReport([heavyAssessment, flattenedLight]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const flattened = rankOracle(withoutSignal);
    const flatCourse = flattened.courses[0];
    if (flatCourse?.status !== 'ranked') throw new Error('expected ranked');
    expect(flatCourse.ranked[0]?.priorityScore).toBeCloseTo(
      flatCourse.ranked[1]?.priorityScore ?? -1,
      10,
    );
    expect(flatCourse.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
  });
});

describe('rankOracle — exam proximity is load-bearing, not decoration ([YIELD-2] / ol-3ux7.7)', () => {
  it('a concept tied to a nearer-due assessment outranks an otherwise-identical one, and flattening the due dates collapses that order', () => {
    // Each concept is tied to its OWN single assessment (due date is a
    // per-assessment property), but both assessments carry the same weight
    // and both edges share the same yieldRank/confidence — so exam
    // proximity is the only thing that can drive the order below.
    const nearAssessment = assessment({
      path: 'Assessments/Near.md',
      weight: 20,
      due: '2026-08-18', // 2 days from ASOF
    });
    const farAssessment = assessment({
      path: 'Assessments/Far.md',
      weight: 20,
      due: '2026-12-01', // months from ASOF
    });
    const withSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({
            conceptName: 'concept-a',
            conceptKey: 'concept-a',
            assessmentPath: 'Assessments/Near.md',
          }),
          edge({
            conceptName: 'concept-b',
            conceptKey: 'concept-b',
            assessmentPath: 'Assessments/Far.md',
          }),
        ],
        assessmentsRead: readReport([nearAssessment, farAssessment]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const ranked = rankOracle(withSignal);
    const course = ranked.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
    expect(course.ranked[0]?.priorityScore).toBeGreaterThan(course.ranked[1]?.priorityScore ?? 0);

    // Ablate: flatten both assessments to the same due date, holding every
    // other factor fixed. If exam proximity were decoration, this would
    // still differ; it must not.
    const flattenedFar = assessment({
      path: 'Assessments/Far.md',
      weight: 20,
      due: '2026-08-18',
    });
    const withoutSignal: RankOracleInput = {
      evidence: {
        edges: [
          edge({
            conceptName: 'concept-a',
            conceptKey: 'concept-a',
            assessmentPath: 'Assessments/Near.md',
          }),
          edge({
            conceptName: 'concept-b',
            conceptKey: 'concept-b',
            assessmentPath: 'Assessments/Far.md',
          }),
        ],
        assessmentsRead: readReport([nearAssessment, flattenedFar]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const flattened = rankOracle(withoutSignal);
    const flatCourse = flattened.courses[0];
    if (flatCourse?.status !== 'ranked') throw new Error('expected ranked');
    expect(flatCourse.ranked[0]?.priorityScore).toBeCloseTo(
      flatCourse.ranked[1]?.priorityScore ?? -1,
      10,
    );
    expect(flatCourse.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
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

  it('mastery supplied but this concept absent from it => seed, per P4-T06 contract', () => {
    const mastery = new Map([
      ['some-other-concept', masteryResult('some-other-concept', 'sapling')],
    ]);
    const result = rankOracle(input(mastery));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.factors.masteryState).toBe('seed');
  });

  it('mastery present and high (`tree`) discounts, but never zeroes, the score', () => {
    const mastery = new Map([['concept-a', masteryResult('concept-a', 'tree')]]);
    const result = rankOracle(input(mastery));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.masteryState).toBe('tree');
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

describe(
  'rankOracle — floor-correctness audit (component register 3.3: "for each ' +
    'factor, is silence-at-floor correct?" [YIELD-2] / ol-3ux7.7)',
  () => {
    it('yes for a passed assessment: its contribution floors to exactly zero, but that floor is scoped to the one contribution it applies to — a still-relevant assessment on the same concept keeps its full weight', () => {
      const passed = assessment({ path: 'Assessments/Passed.md', weight: 30, due: '2026-01-01' });
      const upcoming = assessment({
        path: 'Assessments/Upcoming.md',
        weight: 30,
        due: '2026-09-01',
      });
      const passedEdge = edge({ assessmentPath: 'Assessments/Passed.md' });
      const upcomingEdge = edge({
        assessmentPath: 'Assessments/Upcoming.md',
        citations: [citation({ questionLabel: 'Q2' })],
      });
      const input: RankOracleInput = {
        evidence: {
          edges: [passedEdge, upcomingEdge],
          assessmentsRead: readReport([passed, upcoming]),
          assessmentsWithNoEvidence: [],
        },
        asOf: ASOF,
      };
      const result = rankOracle(input);
      const course = result.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected ranked');
      const entry = course.ranked[0];
      expect(entry).toBeDefined();
      const passedContribution = entry?.factors.contributions.find(
        (c) => c.assessmentPath === 'Assessments/Passed.md',
      );
      const upcomingContribution = entry?.factors.contributions.find(
        (c) => c.assessmentPath === 'Assessments/Upcoming.md',
      );
      expect(passedContribution?.examProximityScore).toBe(0);
      expect(passedContribution?.contribution).toBe(0);
      expect(upcomingContribution?.contribution).toBeGreaterThan(0);
      // The floor silences the one contribution it applies to, not the
      // concept as a whole — the still-relevant assessment's evidence must
      // keep counting toward the concept's priority.
      expect(entry?.priorityScore).toBeCloseTo(upcomingContribution?.contribution ?? -1, 10);
    });

    it('no for no-evidence-yet: a course with zero evidence never surfaces as a floored (zero-score) ranking — abstention is a status a floored-but-present concept never carries', () => {
      // Contrast case first: an assessment worth 0% of the grade genuinely
      // floors that edge's contribution to zero, and the concept still
      // RANKS — evidence is present, only weighted to nothing. This is the
      // legitimate floor: silence is correct here because a 0%-weighted
      // assessment cannot inform priority, whatever its yield/confidence.
      const zeroWeightInput: RankOracleInput = {
        evidence: {
          edges: [edge()],
          assessmentsRead: readReport([assessment({ weight: 0 })]),
          assessmentsWithNoEvidence: [],
        },
        asOf: ASOF,
      };
      const zeroWeightResult = rankOracle(zeroWeightInput);
      const zeroWeightCourse = zeroWeightResult.courses[0];
      expect(zeroWeightCourse?.status).toBe('ranked');
      if (zeroWeightCourse?.status !== 'ranked') return;
      expect(zeroWeightCourse.ranked[0]?.priorityScore).toBe(0);

      // No-evidence case: the course must NOT collapse to the same shape (a
      // ranked entry sitting at the floor). It must abstain explicitly, so
      // "we found nothing worth studying" (a real, floored-to-zero verdict)
      // is never confused with "we could not judge this course at all"
      // (silence would be WRONG here, per the component register).
      const noEvidenceInput: RankOracleInput = {
        evidence: {
          edges: [],
          assessmentsRead: readReport([assessment({ path: 'Assessments/NoEvidence.md' })]),
          assessmentsWithNoEvidence: ['Assessments/NoEvidence.md'],
        },
        asOf: ASOF,
      };
      const noEvidenceResult = rankOracle(noEvidenceInput);
      const noEvidenceCourse = noEvidenceResult.courses[0];
      expect(noEvidenceCourse?.status).toBe('abstained');
      expect((noEvidenceCourse as { ranked?: unknown }).ranked).toBeUndefined();
    });
  },
);

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

describe('rankOracle — declared fallback vs. delivered weights (D-110, ol-egov.28)', () => {
  // Component 3.3's weights are now DERIVED-DELIVERED: `options` is where a
  // production caller threads a decoded artifact-envelope body in (see
  // `resolveOptions`'s doc in rank.ts). No `options` at all must still
  // produce a sane ranking — that is the DECLARED_FALLBACK_* path this test
  // asserts explicitly, distinct from every other test in this file that
  // exercises it only incidentally.
  const singleEdgeInput = (options?: RankOracleInput['options']): RankOracleInput => ({
    evidence: {
      edges: [edge()],
      assessmentsRead: readReport([assessment()]),
      assessmentsWithNoEvidence: [],
    },
    asOf: ASOF,
    ...(options !== undefined ? { options } : {}),
  });

  it('with no options supplied, resolves to the declared fallback (half-life 14, divisor 100)', () => {
    const result = rankOracle(singleEdgeInput());
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.contributions[0]?.assessmentWeightScore).toBeCloseTo(20 / 100, 10);

    const daysUntilDue = Math.round(
      (Date.parse('2026-09-01T00:00:00.000Z') - Date.parse('2026-08-16T00:00:00.000Z')) /
        86_400_000,
    );
    expect(entry?.factors.contributions[0]?.examProximityScore).toBeCloseTo(
      1 / (1 + daysUntilDue / 14),
      10,
    );
  });

  it('a delivered options object (as if decoded from an artifact envelope) overrides every field it supplies', () => {
    const delivered: RankOracleInput['options'] = {
      proximityHalfLifeDays: 7,
      assessmentWeightDivisor: 50,
      masteryNeedWeight: { seed: 1, sprout: 0.9, sapling: 0.5, tree: 0.3, unknown: 1 },
    };
    const withFallback = rankOracle(singleEdgeInput());
    const withDelivered = rankOracle(singleEdgeInput(delivered));

    const fallbackEntry = (() => {
      const course = withFallback.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected ranked');
      return course.ranked[0];
    })();
    const deliveredEntry = (() => {
      const course = withDelivered.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected ranked');
      return course.ranked[0];
    })();

    // A smaller divisor (50 vs 100) scores the same 20%-weighted assessment
    // higher, and a shorter half-life (7 vs 14 days) decays proximity faster
    // for the same days-until-due — so the delivered priority score must
    // differ from the fallback one, proving the input actually drives the
    // arithmetic rather than being silently ignored.
    expect(deliveredEntry?.factors.contributions[0]?.assessmentWeightScore).toBeCloseTo(
      20 / 50,
      10,
    );
    expect(deliveredEntry?.priorityScore).not.toBeCloseTo(fallbackEntry?.priorityScore ?? 0, 5);
  });

  it('a delivered mastery-need ladder is honored end to end', () => {
    const mastery = new Map([['concept-a', masteryResult('concept-a', 'tree')]]);
    const delivered: RankOracleInput['options'] = {
      masteryNeedWeight: { seed: 1, sprout: 1, sapling: 1, tree: 0.9, unknown: 1 },
    };
    const result = rankOracle({ ...singleEdgeInput(delivered), mastery });
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.factors.masteryNeedWeight).toBe(0.9);
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
      mastery: new Map([['concept-a', masteryResult('concept-a', 'sprout')]]),
      asOf: ASOF,
    };
    expect(rankOracle(input)).toEqual(rankOracle(input));
  });
});
