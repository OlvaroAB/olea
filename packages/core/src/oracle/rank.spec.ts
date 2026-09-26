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
import type {
  ConceptAssessmentEdge,
  EvidenceObjectivesCitation,
  EvidenceQuestionCitation,
} from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { RankOracleTiebreakInput } from './rank.js';
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

function objectivesCitation(
  overrides: Partial<EvidenceObjectivesCitation> = {},
): EvidenceObjectivesCitation {
  return {
    sourcePath: '03 Research/objectives.md',
    provenance: {
      sourcePath: overrides.sourcePath ?? '03 Research/objectives.md',
      location: { page: 1 },
    },
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
      scoredSuccessCount: state === 'seed' ? 0 : 4,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: false, recall: state !== 'seed', explanation: false },
      gradedExplainBackCount: state === 'tree' ? 1 : 0,
      recognitionOnly: false,
      successfulScoredDays: state === 'seed' ? 0 : 3,
      deepestSoloLevel: state === 'tree' ? 'relational' : null,
      topStageQualified: false,
      depthGateCleared: state === 'tree',
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
    // `20` is percentage-basis, so [D-143] normalizes it to 0.2 and the
    // default divisor is then the identity (1) — the same 0.2 the old
    // 20/100 produced, which is why percentage-basis fixtures are unaffected
    // by the divisor's move.
    const weightScore = 20 / 100;
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

// `[D-226]` ruling 2 / `ol-oxa2` — the downstream half of `ol-af3j`'s
// objectives-basis admission: `buildReasoning` must name which evidence
// actually drove a score, never a misleading "0 citations" line, and never
// borrow the past-paper clause's frequency framing for objectives evidence.
describe('rankOracle — objectives-basis reasoning ([D-226] ruling 2 / ol-oxa2)', () => {
  it('an objectives-only concept never reads "0 citations" and names its own basis', () => {
    const objectivesEdge = edge({
      citations: [],
      basis: 'objectives',
      objectivesCitations: [objectivesCitation()],
    });
    const input: RankOracleInput = {
      evidence: {
        edges: [objectivesEdge],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    // Data half: `citations` stays empty (never fabricated), and the
    // objectives-basis sibling carries the real evidence.
    expect(entry.citations).toEqual([]);
    expect(entry.factors.citations).toEqual([]);
    expect(entry.factors.objectivesCitations).toEqual([objectivesCitation()]);
    expect(entry.factors.distinctObjectivesSourceCount).toBe(1);

    // Presentation half — the bug this bead fixes.
    expect(entry.reasoning).not.toContain('0 citations');
    expect(entry.reasoning).not.toContain('0 past paper');
    expect(entry.reasoning).toContain('declared in scope by 1 objectives document');
    // Never wears a past paper's clothes: no invented citation count for
    // objectives evidence, and no examiner-frequency framing.
    expect(entry.reasoning).not.toContain('across 1 past paper');
  });

  it('a concept cited by both bases states each one, never blended', () => {
    const pastPaperEdge = edge({ citations: [citation()] });
    const objectivesEdge = edge({
      assessmentPath: 'Assessments/Quiz1.md',
      citations: [],
      basis: 'objectives',
      objectivesCitations: [
        objectivesCitation({ sourcePath: '03 Research/objectives.md' }),
        objectivesCitation({ sourcePath: '03 Research/syllabus.md' }),
      ],
    });
    const input: RankOracleInput = {
      evidence: {
        edges: [pastPaperEdge, objectivesEdge],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(entry.factors.distinctSourceCount).toBe(1);
    expect(entry.factors.distinctObjectivesSourceCount).toBe(2);
    expect(entry.reasoning).toContain('1 citation across 1 past paper');
    expect(entry.reasoning).toContain('declared in scope by 2 objectives documents');
  });

  it('a plain past-paper concept keeps the pre-existing sentence unchanged (regression)', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.objectivesCitations).toEqual([]);
    expect(entry?.factors.distinctObjectivesSourceCount).toBe(0);
    expect(entry?.reasoning).toContain('1 citation across 1 past paper');
    expect(entry?.reasoning).not.toContain('objectives document');
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

describe('rankOracle — verbatim-duplicate assessment edges are deduplicated (R5, pln.md §5, ol-egov.141.89.10.4 part 3)', () => {
  it('a literal duplicate of an existing edge (same assessment, same basis) does not double-count toward preMasteryScore', () => {
    const original = edge({
      assessmentPath: 'Assessments/Quiz1.md',
      yieldRank: 1,
      confidence: 0.8,
    });
    const verbatimDuplicate = { ...original };

    const single: RankOracleInput = {
      evidence: {
        edges: [original],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const withDuplicate: RankOracleInput = {
      evidence: {
        edges: [original, verbatimDuplicate],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };

    const singleResult = rankOracle(single);
    const duplicatedResult = rankOracle(withDuplicate);
    const singleCourse = singleResult.courses[0];
    const duplicatedCourse = duplicatedResult.courses[0];
    if (singleCourse?.status !== 'ranked' || duplicatedCourse?.status !== 'ranked') {
      throw new Error('expected ranked');
    }
    const singleEntry = singleCourse.ranked[0];
    const duplicatedEntry = duplicatedCourse.ranked[0];
    expect(singleEntry).toBeDefined();
    expect(duplicatedEntry).toBeDefined();
    if (singleEntry === undefined || duplicatedEntry === undefined) return;

    // The defect this bead fixes: before the fix, a verbatim-duplicate edge
    // doubled `contributions.length` and `preMasteryScore`.
    expect(duplicatedEntry.factors.contributions).toHaveLength(1);
    expect(duplicatedEntry.factors.preMasteryScore).toBeCloseTo(
      singleEntry.factors.preMasteryScore,
      9,
    );
  });

  it('two edges on the same assessment but different bases are never merged — each basis still counts (control for the fix above)', () => {
    const pastPaperEdge = edge({ assessmentPath: 'Assessments/Quiz1.md', citations: [citation()] });
    const objectivesEdge = edge({
      assessmentPath: 'Assessments/Quiz1.md',
      citations: [],
      basis: 'objectives',
      objectivesCitations: [objectivesCitation()],
    });
    const input: RankOracleInput = {
      evidence: {
        edges: [pastPaperEdge, objectivesEdge],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.factors.contributions).toHaveLength(2);
  });

  it('a real repeat assessment (same assessmentPath, distinct concept) is unaffected — dedup is scoped per concept', () => {
    const a = edge({ conceptName: 'concept-a', assessmentPath: 'Assessments/Quiz1.md' });
    const b = edge({ conceptName: 'concept-b', assessmentPath: 'Assessments/Quiz1.md' });
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
    expect(course.ranked).toHaveLength(2);
    expect(course.ranked.map((r) => r.factors.contributions.length)).toEqual([1, 1]);
  });
});

describe('rankOracle — R6 (pln.md §5): distinct, identically-scored dated edges still sum by count — UNRESOLVED, ol-egov.141.89.10.4 part 3', () => {
  // The frozen target (`eval/data/ilb/pln/targets.dev.json`, case
  // PLN-cc6e4c20b6fb639a, assertion r6-count) requires a concept's relevance
  // AND priority score to be numerically UNCHANGED whether it carries one
  // dated edge or four edges that are individually indistinguishable in
  // score (same yieldRank, confidence, weight and days-to-assessment, on
  // four DIFFERENT real assessments). Today `preMasteryScore` is `sum of
  // contributions`, so four identical contributions score 4x one — this
  // test pins that current, failing behaviour (`it.fails`, not `it`) rather
  // than silently going red, because no ruling settles HOW multiple edges
  // should combine once they are not verbatim duplicates (R5's fix, above,
  // dedupes an accidental REPEAT of the same real assessment; these are
  // four DISTINCT real assessments that only coincide in score). Collapsing
  // them the way R5 collapses a repeat would mean "she has four upcoming
  // exams that happen to be equally weighted" scores the same as "she has
  // one" — which contradicts this file's own documented reading of F4.2
  // ("a concept examined by three assessments accumulates more priority
  // than one examined by a single low-weight quiz") for every case where
  // the accumulating edges are not literal repeats. A general fix here
  // requires deciding a combination rule (see this bead's proposed decision
  // in its close evidence) — max, a saturating sum, or some other function
  // — none of which pln.md or a ruling names; changing it changes what she
  // is shown first, so this bead reports rather than picks one.
  it.fails('preMasteryScore and priorityScore are unchanged between one edge and four identically-scored edges (currently fails — see note above)', () => {
    const asOf = '2026-01-01';
    const manydatesEdges = [0, 1, 2, 3].map((i) =>
      edge({
        conceptName: 'dev-cpt-manydates',
        assessmentPath: `Assessments/Dup${i}.md`,
        yieldRank: 1,
        confidence: 0.7,
        citations: [],
      }),
    );
    const dueDay = '2026-01-06'; // 5 days after asOf, matching daysToAssessment: 5

    const buildInput = (edges: readonly ConceptAssessmentEdge[]): RankOracleInput => ({
      evidence: {
        edges,
        assessmentsRead: readReport(
          edges.map((e) => assessment({ path: e.assessmentPath, due: dueDay, weight: undefined })),
        ),
        assessmentsWithNoEvidence: [],
      },
      asOf,
    });

    const four = rankOracle(buildInput(manydatesEdges));
    const one = rankOracle(buildInput([manydatesEdges[0] as ConceptAssessmentEdge]));
    const fourCourse = four.courses[0];
    const oneCourse = one.courses[0];
    if (fourCourse?.status !== 'ranked' || oneCourse?.status !== 'ranked') {
      throw new Error('expected ranked');
    }
    const fourEntry = fourCourse.ranked.find((r) => r.conceptName === 'dev-cpt-manydates');
    const oneEntry = oneCourse.ranked.find((r) => r.conceptName === 'dev-cpt-manydates');
    expect(fourEntry?.factors.preMasteryScore).toBeCloseTo(
      oneEntry?.factors.preMasteryScore ?? -1,
      9,
    );
    expect(fourEntry?.priorityScore).toBeCloseTo(oneEntry?.priorityScore ?? -1, 9);
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

describe('rankOracle — assessment weight basis ([D-143] / ol-3ux7.30)', () => {
  const weightScoreFor = (weight: number): number => {
    const result = rankOracle({
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ weight, weightRaw: String(weight) })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    });
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const score = course.ranked[0]?.factors.contributions[0]?.assessmentWeightScore;
    if (score === undefined) throw new Error('expected a contribution');
    return score;
  };

  // The defect `ol-3ux7.17` found: with the old divisor of 100, a
  // fraction-basis weight scored ~1/100th of what it meant, and the factor
  // was effectively dead. This is the assertion that fails if the divisor is
  // ever put back.
  it('a fraction-basis weight scores as itself, not as a hundredth of itself', () => {
    expect(weightScoreFor(0.5)).toBeCloseTo(0.5, 10);
    expect(weightScoreFor(0.05)).toBeCloseTo(0.05, 10);
    // Half the course grade must outscore a twentieth of it by 10x, not by
    // a difference invisible at the two decimal places `buildReasoning`
    // renders.
    expect(weightScoreFor(0.5) / weightScoreFor(0.05)).toBeCloseTo(10, 6);
  });

  it('a percentage-basis weight is converted, and lands where the old divisor put it — so percentage fixtures are unaffected', () => {
    expect(weightScoreFor(20)).toBeCloseTo(20 / 100, 10);
    expect(weightScoreFor(100)).toBeCloseTo(1, 10);
  });

  it('the basis boundary is inclusive-to-fraction at exactly 1 — the whole course grade, not one percent', () => {
    expect(weightScoreFor(1)).toBeCloseTo(1, 10);
    // Just above the boundary reads as a percentage, so the score drops
    // sharply. That discontinuity is the ruling's, made visible rather than
    // smoothed over: [D-143] chose a predictable rule over a per-note guess.
    expect(weightScoreFor(1.01)).toBeCloseTo(0.0101, 10);
  });

  it('a zero weight still scores 0 and stays KNOWN, on either basis', () => {
    expect(weightScoreFor(0)).toBe(0);
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

  it("an already-past due date is now a VETO, not a floored weight (ol-plxu / C5.10) — the edge is removed, and since it is this concept's only evidence, the concept itself is removed and reported", () => {
    // Ruled semantics changed here: C5.10 separates vetoes from the blend, and
    // "an assessment has passed" is one of the three veto facts, not a signal
    // that floors to zero in place. Superseded assertions this replaces: this
    // used to assert `contribution.examProximityScore === 0` and
    // `priorityScore === 0` on a STILL-PRESENT ranked entry — that is now the
    // defect C5.10 names ("a gate that should have been a weight... silently
    // deletes candidates, and a weight that should have been a gate silently
    // admits them" read backwards): a veto must remove, not merely floor.
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
    // The concept has no surviving evidence at all, so it is NOT in `ranked`.
    expect(course.ranked).toHaveLength(0);
    // It is reported, not silently dropped.
    expect(course.vetoedConcepts).toHaveLength(1);
    const vetoedConcept = course.vetoedConcepts?.[0];
    expect(vetoedConcept?.conceptKey).toBe('concept-a');
    expect(vetoedConcept?.vetoedEdges).toEqual([
      { assessmentPath: 'Assessments/Quiz1.md', reason: 'assessment-passed', daysUntilDue: -227 },
    ]);
  });

  it('an unparseable due date is now the exam-proximity FLOOR (0), never the maximum — the defect this bead fixes (ol-plxu)', () => {
    // This test previously locked in the bug: it asserted
    // `examProximityScore === 1` (the function's MAXIMUM, tied with
    // due-today) for a date this reader could not parse. That is exactly
    // "an unreadable date outranks a real deadline" — the ruled semantics
    // this bead adopts is the opposite: no known deadline floors to 0, the
    // same value the decay formula itself approaches as a real due date
    // recedes to infinity, so it can never tie or outrank a dated one.
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
    // This is a SIGNAL, not a veto: the edge and the concept both survive.
    expect(course.ranked).toHaveLength(1);
    const contribution = course.ranked[0]?.factors.contributions[0];
    expect(contribution?.daysUntilDue).toBeNull();
    expect(contribution?.examProximityScore).toBe(0);
    // Reported loudly and distinctly from a simply-absent `due`.
    expect(contribution?.dueDateIssue).toBe('unparseable');
  });

  it('a missing due date (never recorded, not malformed) floors the same way but carries no dueDateIssue flag — absence is not itself news', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ due: undefined })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const contribution = course.ranked[0]?.factors.contributions[0];
    expect(contribution?.daysUntilDue).toBeNull();
    expect(contribution?.examProximityScore).toBe(0);
    expect(contribution?.dueDateIssue).toBeUndefined();
  });
});

describe('rankOracle — vetoes are separated from the blend (C5.10, ol-plxu)', () => {
  it('(a) a veto REMOVES the edge from the blend — it is absent from `contributions`, present only in `vetoedEdges`, and the concept still ranks on its other, surviving evidence', () => {
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

    // Removed, not down-weighted: no contribution names the passed assessment.
    expect(
      entry?.factors.contributions.some((c) => c.assessmentPath === 'Assessments/Passed.md'),
    ).toBe(false);
    // Reported with a stated reason instead.
    expect(entry?.factors.vetoedEdges).toEqual([
      { assessmentPath: 'Assessments/Passed.md', reason: 'assessment-passed', daysUntilDue: -227 },
    ]);
    // The still-relevant assessment's evidence is untouched — the veto is
    // scoped to the one edge it applies to, not the whole concept.
    const upcomingContribution = entry?.factors.contributions.find(
      (c) => c.assessmentPath === 'Assessments/Upcoming.md',
    );
    expect(upcomingContribution?.contribution).toBeGreaterThan(0);
    expect(entry?.priorityScore).toBeCloseTo(upcomingContribution?.contribution ?? -1, 10);
  });

  it('(b) a SIGNAL — however low it scores — can never remove a candidate the way a veto does: an unparseable-date edge stays in `contributions` and the concept still ranks, even as its sole evidence', () => {
    const input: RankOracleInput = {
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ due: 'not-a-date' })]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    // Present, not vetoed away, even though its examProximityScore floors to 0.
    expect(course.ranked).toHaveLength(1);
    expect(course.vetoedConcepts ?? []).toHaveLength(0);
    expect(course.ranked[0]?.factors.contributions).toHaveLength(1);
    expect(course.ranked[0]?.factors.vetoedEdges ?? []).toHaveLength(0);
  });

  it('(c) a malformed due date ranks below both a due-today and a due-in-N-days assessment on the same terms, and is named in the structured report', () => {
    const dueToday = assessment({ path: 'Assessments/Today.md', due: ASOF });
    const dueInTen = assessment({
      path: 'Assessments/TenDays.md',
      due: '2026-08-26', // 10 days from ASOF
    });
    const malformed = assessment({ path: 'Assessments/Malformed.md', due: 'sometime soon' });
    const input: RankOracleInput = {
      evidence: {
        edges: [
          edge({
            conceptName: 'concept-today',
            conceptKey: 'concept-today',
            assessmentPath: 'Assessments/Today.md',
          }),
          edge({
            conceptName: 'concept-ten-days',
            conceptKey: 'concept-ten-days',
            assessmentPath: 'Assessments/TenDays.md',
          }),
          edge({
            conceptName: 'concept-malformed',
            conceptKey: 'concept-malformed',
            assessmentPath: 'Assessments/Malformed.md',
          }),
        ],
        assessmentsRead: readReport([dueToday, dueInTen, malformed]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual([
      'concept-today',
      'concept-ten-days',
      'concept-malformed',
    ]);

    const malformedEntry = course.ranked.find((e) => e.conceptName === 'concept-malformed');
    const malformedContribution = malformedEntry?.factors.contributions[0];
    // Named in the structured report — not a silent floor, not a throw.
    expect(malformedContribution?.dueDateIssue).toBe('unparseable');
    expect(malformedContribution?.daysUntilDue).toBeNull();
    expect(malformedContribution?.examProximityScore).toBe(0);
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

describe('rankOracle — retrievability weight: absence vs. a genuine neutral value (ol-v7r5.52, C5.6/[D-264] producer work)', () => {
  const input = (retrievability?: ReadonlyMap<string, number>): RankOracleInput => ({
    evidence: {
      edges: [edge()],
      assessmentsRead: readReport([assessment()]),
      assessmentsWithNoEvidence: [],
    },
    ...(retrievability !== undefined ? { retrievability } : {}),
    asOf: ASOF,
  });

  it('retrievability omitted entirely => the stored factor is absent, never a defaulted 1', () => {
    const result = rankOracle(input(undefined));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.retrievabilityWeight).toBeUndefined();
    // The blend still reads neutral — only the stored factor changed shape.
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) * (entry?.factors.masteryNeedWeight ?? 0),
      10,
    );
  });

  it('retrievability supplied but this concept absent from it => same absence, same neutral blend', () => {
    const retrievability = new Map([['some-other-concept', 0.5]]);
    const result = rankOracle(input(retrievability));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.retrievabilityWeight).toBeUndefined();
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) * (entry?.factors.masteryNeedWeight ?? 0),
      10,
    );
  });

  it('retrievability supplied for this concept as a genuine 1.0 => the stored factor is a DEFINED 1, distinguishable from absence though numerically identical to the neutral fallback', () => {
    const retrievability = new Map([['concept-a', 1]]);
    const result = rankOracle(input(retrievability));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.retrievabilityWeight).toBe(1);
    expect('retrievabilityWeight' in (entry?.factors ?? {})).toBe(true);
    expect(Object.hasOwn(entry?.factors ?? {}, 'retrievabilityWeight')).toBe(true);
  });

  it('retrievability supplied for this concept as a non-neutral value moves the score, and the stored factor carries it verbatim', () => {
    const retrievability = new Map([['concept-a', 0.4]]);
    const result = rankOracle(input(retrievability));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.retrievabilityWeight).toBe(0.4);
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) * (entry?.factors.masteryNeedWeight ?? 0) * 0.4,
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
    it('yes for a passed assessment: it is VETOED — removed from `contributions` entirely, reported in `vetoedEdges` — and that removal is scoped to the one edge it applies to, not the concept: a still-relevant assessment on the same concept keeps its full weight (ruled semantics updated by ol-plxu/C5.10 — a passed assessment previously floored `examProximityScore` to 0 IN PLACE, still counted as a "contribution"; C5.10 requires it removed outright, which this test now asserts)', () => {
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
      // Removed, not floored: `contributions` names only the surviving edge.
      expect(entry?.factors.contributions).toHaveLength(1);
      const upcomingContribution = entry?.factors.contributions.find(
        (c) => c.assessmentPath === 'Assessments/Upcoming.md',
      );
      expect(upcomingContribution?.contribution).toBeGreaterThan(0);
      // The veto silences the one edge it applies to, not the concept as a
      // whole — the still-relevant assessment's evidence must keep counting
      // toward the concept's priority.
      expect(entry?.priorityScore).toBeCloseTo(upcomingContribution?.contribution ?? -1, 10);
      // Reported with a stated reason, never silently.
      expect(entry?.factors.vetoedEdges).toEqual([
        {
          assessmentPath: 'Assessments/Passed.md',
          reason: 'assessment-passed',
          daysUntilDue: -227,
        },
      ]);
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

describe('rankOracle — C5.10 ruling 1 comparable-observation tiebreak ([D-265], ol-egov.141.52)', () => {
  // `RankOracleTiebreakInput.tiebreakEligible` is exported alongside
  // `rankOracle` from `./rank.js`. This module never computes disagreement
  // or instrument eligibility itself (see rank.ts's module doc) — these
  // tests treat `tiebreakEligible` exactly as a caller-supplied fact, the
  // same way `mastery`/`retrievability` are treated elsewhere in this file.
  const tiedEdges = [
    edge({
      conceptName: 'concept-b',
      conceptKey: 'concept-b',
      assessmentPath: 'Assessments/Quiz1.md',
    }),
    edge({
      conceptName: 'concept-a',
      conceptKey: 'concept-a',
      assessmentPath: 'Assessments/Quiz1.md',
    }),
  ];
  const tiedInput = (
    tiebreakEligible?: ReadonlySet<string>,
  ): RankOracleInput & RankOracleTiebreakInput => ({
    evidence: {
      edges: tiedEdges,
      assessmentsRead: readReport([assessment()]),
      assessmentsWithNoEvidence: [],
    },
    asOf: ASOF,
    ...(tiebreakEligible !== undefined ? { tiebreakEligible } : {}),
  });

  it('an eligible disagreeing concept is served ahead of a tied, tidy one — even against conceptName order', () => {
    // concept-b is alphabetically SECOND, so this can only pass if the
    // eligibility flag — not the name fallback — decided the order.
    const result = rankOracle(tiedInput(new Set(['concept-b'])));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked[0]?.priorityScore).toBe(course.ranked[1]?.priorityScore);
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-b', 'concept-a']);
  });

  it('with neither concept eligible, the ordinary conceptName-ascending tie-break stands unchanged', () => {
    const omitted = rankOracle(tiedInput());
    const emptySet = rankOracle(tiedInput(new Set()));
    const neitherEligible = rankOracle(tiedInput(new Set(['concept-nonexistent'])));
    for (const result of [omitted, emptySet, neitherEligible]) {
      const course = result.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected ranked');
      expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
    }
    // And all three are byte-identical to each other and to the pre-D-265
    // baseline ('rankOracle — deterministic tie-break' above) — an absent,
    // empty, or non-matching eligibility set is exactly the tidy case.
    expect(omitted).toEqual(emptySet);
    expect(omitted).toEqual(neitherEligible);
  });

  it('with BOTH tied concepts eligible, conceptName ascending still decides between them', () => {
    const result = rankOracle(tiedInput(new Set(['concept-a', 'concept-b'])));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
  });

  it('NEVER re-weights: flagging the already-losing concept eligible in an UNTIED case leaves the ranking byte-identical', () => {
    // Same shape as the "assessment weight is load-bearing" suite above:
    // concept-a's assessment is weighted far higher, so the blend alone
    // already decides the order — no tie for a tiebreak to act on.
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
    const untiedEvidence = {
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
    };
    const without = rankOracle({ evidence: untiedEvidence, asOf: ASOF });
    // concept-b is the lower-scoring, losing concept here — flagging it
    // eligible must change NOTHING, since the blend never tied it with
    // concept-a in the first place.
    const withLoserFlagged = rankOracle({
      evidence: untiedEvidence,
      asOf: ASOF,
      tiebreakEligible: new Set(['concept-b']),
    });
    expect(withLoserFlagged).toEqual(without);
    const course = withLoserFlagged.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked.map((e) => e.conceptName)).toEqual(['concept-a', 'concept-b']);
    expect(course.ranked[0]?.priorityScore).toBeGreaterThan(course.ranked[1]?.priorityScore ?? 0);
  });

  it('is purely a function of its input: the same tied+eligible input run twice is byte-identical', () => {
    const input = tiedInput(new Set(['concept-b']));
    expect(rankOracle(input)).toEqual(rankOracle(input));
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

  it('with no options supplied, resolves to the declared fallback (half-life 14, divisor 1 since [D-143])', () => {
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
      // Fraction-basis now that [D-143] normalizes on ingest: 0.5 halves the
      // weight score relative to the identity default, the same *direction*
      // the old percentage-basis 50-vs-100 pair expressed.
      assessmentWeightDivisor: 0.5,
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

    // A smaller divisor (0.5 vs the identity 1) scores the same 20%-weighted
    // assessment higher, and a shorter half-life (7 vs 14 days) decays
    // proximity faster for the same days-until-due — so the delivered
    // priority score must differ from the fallback one, proving the input
    // actually drives the arithmetic rather than being silently ignored.
    expect(deliveredEntry?.factors.contributions[0]?.assessmentWeightScore).toBeCloseTo(
      0.2 / 0.5,
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
