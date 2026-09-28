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
import type {
  OracleProximityFactors,
  RankBlendWeightsWithProximity,
  RankOracleEligibilityInput,
  RankOracleTiebreakInput,
} from './rank.js';
import {
  conceptEligibilityVeto,
  decidingFactors,
  RANK_REASON_PHRASES,
  rankOracle,
} from './rank.js';
import type { ConceptPriority, RankOracleInput } from './types.js';

/** `[D-410]`'s per-concept proximity term, typed in `./rank.ts` beside `OracleConceptFactors`. */
function proximityOf(entry: ConceptPriority | undefined): number {
  const value = (entry?.factors as Partial<OracleProximityFactors> | undefined)?.proximityScore;
  if (value === undefined) throw new Error('expected a proximityScore on the entry');
  return value;
}

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
    // [D-410]: proximity is no longer a factor of relevance...
    const expectedPreMastery = yieldScore * confidence * weightScore;
    // ...it is the blend's third term. [D-332]: relevance ADDED to need at
    // the declared fallback weights (1, 1, 1). No recall supplied => need
    // unknown, ordered at the declared provisional maximum 1 ([D-348]).
    const expectedPriority = 1 * expectedPreMastery + 1 * 1 + 1 * proximityScore;

    expect(entry.factors.masteryState).toBe('unknown');
    expect(entry.factors.needBasis).toBe('unknown');
    expect(entry.factors.need).toBeUndefined();
    expect(entry.factors.needOrderingInput).toBe(1);
    expect(entry.factors.preMasteryScore).toBeCloseTo(expectedPreMastery, 12);
    expect(proximityOf(entry)).toBeCloseTo(proximityScore, 12);
    expect(entry.priorityScore).toBeCloseTo(expectedPriority, 10);
    // `[D-417]`: the reason carries no score, weight, decimal or count — those stay on
    // `factors`. The only concept ranked says so; its evidence basis and its unknown need are
    // stated in words.
    expect(entry.reasoning).toBe(
      'concept-a (COURSEA) is the only concept ranked in this course. It appears in past ' +
        'papers. How well you recall it is not known yet.',
    );
    expect(entry.reasoning).not.toMatch(/\d+\.\d+/);
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
    // `[D-417]`: the basis is named in words, with no count of documents.
    expect(entry.reasoning).toContain('Its course objectives name it.');
    // Never wears a past paper's clothes: no past-paper claim and no
    // examiner-frequency framing for objectives evidence.
    expect(entry.reasoning).not.toContain('past paper');
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
    // `[D-417]`: each basis stated for what it is, in words, never a count.
    expect(entry.reasoning).toContain(
      'It appears in past papers, and its course objectives name it.',
    );
    expect(entry.reasoning).not.toMatch(/\b\d+ (citations?|past papers?|objectives documents?)\b/);
  });

  it('a plain past-paper concept names only its past-paper basis', () => {
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
    expect(entry?.reasoning).toContain('It appears in past papers.');
    expect(entry?.reasoning).not.toContain('objectives');
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

describe('rankOracle — R6 (pln.md §5, [D-403]): distinct, identically-scored dated edges add by count; a verbatim repeat still does not', () => {
  // D-403 (ruled 2026-09-27, off this bead's proposed decision): genuinely
  // DISTINCT assessments' contributions ADD — "she has four upcoming exams
  // that happen to be equally weighted" is strictly more relevant/urgent
  // than "she has one" — while a verbatim REPEAT of the same edge (R5,
  // above) still counts once. This replaces the old expected-failure test
  // that pinned the REJECTED "unchanged by count" reading (the frozen
  // target's amended `r6-count`/`r6-verbatim-duplicate` assertions,
  // `eval/data/ilb/pln/targets.dev.json` case PLN-cc6e4c20b6fb639a, encode
  // the same two facts on the harness side).
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

  function entryFor(result: ReturnType<typeof rankOracle>) {
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    return course.ranked.find((r) => r.conceptName === 'dev-cpt-manydates');
  }

  it('four distinct dated edges score strictly HIGHER (relevance and priority) than one of them alone', () => {
    const four = entryFor(rankOracle(buildInput(manydatesEdges)));
    const one = entryFor(rankOracle(buildInput([manydatesEdges[0] as ConceptAssessmentEdge])));
    expect(four?.factors.preMasteryScore).toBeGreaterThan(one?.factors.preMasteryScore ?? Infinity);
    expect(four?.priorityScore).toBeGreaterThan(one?.priorityScore ?? Infinity);
    // Not merely higher — exactly 4x, since the four edges are individually
    // indistinguishable in score: pins the "add by count" reading precisely,
    // not just "some combination that happens to increase".
    expect(four?.factors.preMasteryScore).toBeCloseTo((one?.factors.preMasteryScore ?? 0) * 4, 9);
  });

  it('a verbatim copy of one of the four edges (same assessment, same basis) leaves relevance and priority UNCHANGED — R5s rule applied here too', () => {
    const four = entryFor(rankOracle(buildInput(manydatesEdges)));
    const withDuplicate = entryFor(
      rankOracle(
        buildInput([...manydatesEdges, { ...manydatesEdges[0] } as ConceptAssessmentEdge]),
      ),
    );
    expect(withDuplicate?.factors.contributions).toHaveLength(4);
    expect(withDuplicate?.factors.preMasteryScore).toBeCloseTo(
      four?.factors.preMasteryScore ?? -1,
      9,
    );
    expect(withDuplicate?.priorityScore).toBeCloseTo(four?.priorityScore ?? -1, 9);
  });
});

describe('rankOracle — every contribution keeps its existing date, weight and scope rules alongside D-403s addition', () => {
  it('among several assessments on one concept: a passed one contributes nothing (vetoed), an undated one adds nothing to proximity, and the dated ones still add', () => {
    const passed = edge({
      conceptName: 'concept-mixed',
      assessmentPath: 'Assessments/Passed.md',
      citations: [],
    });
    const undated = edge({
      conceptName: 'concept-mixed',
      assessmentPath: 'Assessments/Undated.md',
      citations: [],
    });
    const datedA = edge({
      conceptName: 'concept-mixed',
      assessmentPath: 'Assessments/DatedA.md',
      citations: [],
    });
    const datedB = edge({
      conceptName: 'concept-mixed',
      assessmentPath: 'Assessments/DatedB.md',
      citations: [],
    });
    const asOf = '2026-01-01';
    const input: RankOracleInput = {
      evidence: {
        edges: [passed, undated, datedA, datedB],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/Passed.md', due: '2025-12-20', weight: undefined }),
          assessment({ path: 'Assessments/Undated.md', due: undefined, weight: undefined }),
          assessment({ path: 'Assessments/DatedA.md', due: '2026-01-06', weight: undefined }),
          assessment({ path: 'Assessments/DatedB.md', due: '2026-01-11', weight: undefined }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      asOf,
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked.find((r) => r.conceptName === 'concept-mixed');

    // The passed assessment is REMOVED (vetoed), not merely scored low —
    // C5.10's rule, unchanged by this bead.
    expect(entry?.factors.vetoedEdges).toEqual([
      expect.objectContaining({
        assessmentPath: 'Assessments/Passed.md',
        reason: 'assessment-passed',
      }),
    ]);
    // The undated edge SURVIVES (it is a signal, not a veto) and adds
    // exactly 0 to proximity — but since [D-410] its evidence still counts in
    // full toward relevance: proximity is no longer a factor of the edge.
    const undatedContribution = entry?.factors.contributions.find(
      (c) => c.assessmentPath === 'Assessments/Undated.md',
    );
    expect(undatedContribution?.examProximityScore).toBe(0);
    expect(undatedContribution?.contribution).toBe(1);
    // The two dated edges both still contribute a positive share, and both
    // are present — D-403's "distinct assessments add" alongside the
    // pre-existing date/weight/scope rules, not instead of them.
    const datedContributions = entry?.factors.contributions.filter((c) =>
      ['Assessments/DatedA.md', 'Assessments/DatedB.md'].includes(c.assessmentPath),
    );
    expect(datedContributions).toHaveLength(2);
    for (const c of datedContributions ?? []) expect(c.contribution).toBeGreaterThan(0);
    expect(entry?.factors.preMasteryScore).toBeCloseTo(
      (datedContributions ?? []).reduce((sum, c) => sum + c.contribution, 0) +
        (undatedContribution?.contribution ?? Number.NaN),
      9,
    );
    // The concept's proximity is its soonest dated assessment (DatedA, five
    // days out), never a sum over its edges.
    expect(proximityOf(entry)).toBeCloseTo(1 / (1 + 5 / 14), 12);
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
    // `[D-417]`: the strongest link stays on `factors` for any auditing caller; the reason
    // itself names no assessment path, score or count.
    expect(entry?.reasoning).not.toContain('Assessments/');
    expect(entry?.reasoning).not.toMatch(/\d/);
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
    expect(entry?.factors.preMasteryScore).toBeCloseTo(
      upcomingContribution?.contribution ?? -1,
      10,
    );
    // [D-332]/[D-410]: relevance plus unknown need (ordered at 1) plus the
    // surviving edge's proximity, at weights (1, 1, 1) — the passed edge adds
    // nothing to proximity either.
    expect(proximityOf(entry)).toBeCloseTo(upcomingContribution?.examProximityScore ?? -1, 12);
    expect(entry?.priorityScore).toBeCloseTo(
      (upcomingContribution?.contribution ?? -1) +
        1 +
        (upcomingContribution?.examProximityScore ?? -1),
      10,
    );
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

describe('rankOracle — the eligibility veto: a concept vetoed only once none of its practice instruments is eligible ([D-404], ol-egov.141.89.10.5)', () => {
  type Eligibility = RankOracleEligibilityInput['conceptInstrumentEligibility'];

  function courseFor(
    edges: readonly ConceptAssessmentEdge[],
    assessments: readonly AssessmentRecord[],
    conceptInstrumentEligibility: Eligibility,
  ) {
    const input: RankOracleInput & RankOracleEligibilityInput = {
      evidence: {
        edges,
        assessmentsRead: readReport(assessments),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
      ...(conceptInstrumentEligibility !== undefined ? { conceptInstrumentEligibility } : {}),
    };
    const result = rankOracle(input);
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    return course;
  }

  const twoAssessments = [
    assessment({ path: 'Assessments/A.md', due: '2026-09-01', weight: undefined }),
    assessment({ path: 'Assessments/B.md', due: '2026-09-10', weight: undefined }),
  ];
  const edgesOf = (conceptName: string) => [
    edge({ conceptName, assessmentPath: 'Assessments/A.md', citations: [] }),
    edge({ conceptName, assessmentPath: 'Assessments/B.md', citations: [] }),
  ];

  it('a concept with one of two instruments suspended ranks EXACTLY as with no eligibility input: its evidence is untouched', () => {
    const edges = edgesOf('concept-a');
    const baseline = courseFor(edges, twoAssessments, undefined);
    const oneSuspended = courseFor(
      edges,
      twoAssessments,
      new Map([
        [
          'concept-a',
          [
            { instrumentId: 'card-1', ineligible: 'suspended' as const },
            { instrumentId: 'card-2' },
          ],
        ],
      ]),
    );
    expect(oneSuspended.vetoedConcepts ?? []).toHaveLength(0);
    expect(oneSuspended.ranked).toEqual(baseline.ranked);
    expect(oneSuspended.ranked[0]?.factors.contributions).toHaveLength(2);
    expect(oneSuspended.ranked[0]?.factors.vetoedEdges).toEqual([]);
  });

  it('her own suspension of every instrument vetoes the concept as "suspended", on every edge and on the concept — matching the locked R4 target', () => {
    const course = courseFor(
      edgesOf('concept-a'),
      twoAssessments,
      new Map([
        [
          'concept-a',
          [
            { instrumentId: 'card-1', ineligible: 'suspended' as const },
            { instrumentId: 'card-2', ineligible: 'suspended' as const },
          ],
        ],
      ]),
    );
    expect(course.ranked).toHaveLength(0);
    expect(course.vetoedConcepts).toEqual([
      {
        conceptName: 'concept-a',
        conceptKey: 'concept-a',
        eligibilityVeto: 'suspended',
        vetoedEdges: [
          expect.objectContaining({ assessmentPath: 'Assessments/A.md', reason: 'suspended' }),
          expect.objectContaining({ assessmentPath: 'Assessments/B.md', reason: 'suspended' }),
        ],
      },
    ]);
  });

  it('a mix of causes (one suspended, one with a changed citation) is "instrument-ineligible", kept APART from "suspended"', () => {
    const course = courseFor(
      edgesOf('concept-a'),
      twoAssessments,
      new Map([
        [
          'concept-a',
          [
            { instrumentId: 'card-1', ineligible: 'suspended' as const },
            { instrumentId: 'card-2', ineligible: 'instrument-ineligible' as const },
          ],
        ],
      ]),
    );
    expect(course.ranked).toHaveLength(0);
    const vetoed = course.vetoedConcepts?.[0];
    expect(vetoed?.eligibilityVeto).toBe('instrument-ineligible');
    expect(vetoed?.vetoedEdges.map((e) => e.reason)).toEqual([
      'instrument-ineligible',
      'instrument-ineligible',
    ]);
  });

  it('vetoing one concept never touches another concept examined by the SAME assessments', () => {
    const edges = [...edgesOf('concept-a'), ...edgesOf('concept-b')];
    const baseline = courseFor(edges, twoAssessments, undefined);
    const course = courseFor(
      edges,
      twoAssessments,
      new Map([['concept-a', [{ instrumentId: 'card-1', ineligible: 'suspended' as const }]]]),
    );
    expect(course.vetoedConcepts?.map((v) => v.conceptKey)).toEqual(['concept-a']);
    const survivor = course.ranked.find((r) => r.conceptKey === 'concept-b');
    const survivorBaseline = baseline.ranked.find((r) => r.conceptKey === 'concept-b');
    expect(survivor?.factors).toEqual(survivorBaseline?.factors);
    expect(survivor?.priorityScore).toBe(survivorBaseline?.priorityScore);
  });

  it('a concept with no instruments yet (an empty list, or absent from the map) is never vetoed by this rule', () => {
    const edges = [...edgesOf('concept-a'), ...edgesOf('concept-b')];
    const course = courseFor(edges, twoAssessments, new Map([['concept-a', []]]));
    expect(course.vetoedConcepts ?? []).toHaveLength(0);
    expect(course.ranked.map((r) => r.conceptKey).sort()).toEqual(['concept-a', 'concept-b']);
  });

  it('a date veto on one edge and the eligibility veto together: the passed edge keeps its own reason', () => {
    const assessments = [
      assessment({ path: 'Assessments/A.md', due: '2026-07-01', weight: undefined }),
      assessment({ path: 'Assessments/B.md', due: '2026-09-10', weight: undefined }),
    ];
    const course = courseFor(
      edgesOf('concept-a'),
      assessments,
      new Map([['concept-a', [{ instrumentId: 'card-1', ineligible: 'suspended' as const }]]]),
    );
    const vetoed = course.vetoedConcepts?.[0];
    expect(vetoed?.eligibilityVeto).toBe('suspended');
    expect(vetoed?.vetoedEdges.map((e) => [e.assessmentPath, e.reason])).toEqual([
      ['Assessments/A.md', 'assessment-passed'],
      ['Assessments/B.md', 'suspended'],
    ]);
  });

  it('a concept of unknown relevance ([D-329]) whose every instrument is ineligible is vetoed and listed with its reason, never ranked', () => {
    const input: RankOracleInput &
      RankOracleEligibilityInput & {
        readonly courseConcepts?: ReadonlyMap<string, ReadonlyMap<string, string>>;
      } = {
      evidence: {
        edges: [],
        assessmentsRead: readReport([]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
      conceptInstrumentEligibility: new Map([
        ['concept-noedge', [{ instrumentId: 'card-9', ineligible: 'suspended' as const }]],
      ]),
      courseConcepts: new Map([
        [
          'COURSEA',
          new Map([
            ['concept-noedge', 'concept-noedge'],
            ['concept-other', 'concept-other'],
          ]),
        ],
      ]),
    };
    const course = rankOracle(input).courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.vetoedConcepts).toEqual([
      {
        conceptName: 'concept-noedge',
        conceptKey: 'concept-noedge',
        vetoedEdges: [],
        eligibilityVeto: 'suspended',
      },
    ]);
    expect(course.ranked.map((r) => r.conceptKey)).toEqual(['concept-other']);
  });

  it('the veto lifts as soon as one instrument becomes eligible again, with nothing recorded against her — purely a function of the current call', () => {
    const edges = edgesOf('concept-a');
    const vetoed = courseFor(
      edges,
      twoAssessments,
      new Map([['concept-a', [{ instrumentId: 'card-1', ineligible: 'suspended' as const }]]]),
    );
    expect(vetoed.vetoedConcepts).toHaveLength(1);

    const eligibleAgain = courseFor(
      edges,
      twoAssessments,
      new Map([['concept-a', [{ instrumentId: 'card-1' }]]]),
    );
    expect(eligibleAgain.vetoedConcepts ?? []).toHaveLength(0);
    expect(eligibleAgain.ranked).toEqual(courseFor(edges, twoAssessments, undefined).ranked);
  });
});

describe('conceptEligibilityVeto — the rollup ([D-404])', () => {
  it('rolls a concept up only when every instrument is ineligible', () => {
    expect(conceptEligibilityVeto(undefined)).toBeNull();
    expect(conceptEligibilityVeto([])).toBeNull();
    expect(conceptEligibilityVeto([{ instrumentId: 'x' }])).toBeNull();
    expect(
      conceptEligibilityVeto([
        { instrumentId: 'x', ineligible: 'suspended' },
        { instrumentId: 'y' },
      ]),
    ).toBeNull();
    expect(conceptEligibilityVeto([{ instrumentId: 'x', ineligible: 'suspended' }])).toBe(
      'suspended',
    );
    expect(
      conceptEligibilityVeto([
        { instrumentId: 'x', ineligible: 'suspended' },
        { instrumentId: 'y', ineligible: 'instrument-ineligible' },
      ]),
    ).toBe('instrument-ineligible');
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

  it('mastery present and high (`tree`) is REPORTED, but since [D-332] the stage never moves the score', () => {
    const mastery = new Map([['concept-a', masteryResult('concept-a', 'tree')]]);
    const result = rankOracle(input(mastery));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.masteryState).toBe('tree');
    // The ladder rung is still reported (the delivered envelope carries it)...
    expect(entry?.factors.masteryNeedWeight).toBeGreaterThan(0);
    expect(entry?.factors.masteryNeedWeight).toBeLessThan(1);
    // ...and moves nothing: the score equals the one with no mastery at all.
    const noMastery = rankOracle(input(undefined)).courses[0];
    if (noMastery?.status !== 'ranked') throw new Error('expected ranked');
    expect(entry?.priorityScore).toBe(noMastery.ranked[0]?.priorityScore);
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) + 1 + proximityOf(entry),
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
    // [D-332]/[D-348]: no reading is unknown need, ordered at 1, never a number.
    expect(entry?.factors.needBasis).toBe('unknown');
    expect(entry?.factors.need).toBeUndefined();
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) + 1 + proximityOf(entry),
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
    expect(entry?.factors.needBasis).toBe('unknown');
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) + 1 + proximityOf(entry),
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

  it('retrievability supplied for this concept as a non-neutral value moves the score through need, and the stored factor carries it verbatim', () => {
    const retrievability = new Map([['concept-a', 0.4]]);
    const result = rankOracle(input(retrievability));
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    expect(entry?.factors.retrievabilityWeight).toBe(0.4);
    // [D-332]: need = 1 - recall, ADDED to relevance (and to [D-410]'s
    // proximity) at weights (1, 1, 1).
    expect(entry?.factors.need).toBeCloseTo(0.6, 12);
    expect(entry?.factors.needBasis).toBe('estimated');
    expect(entry?.factors.needSource).toBe('current-recall');
    expect(entry?.priorityScore).toBeCloseTo(
      (entry?.factors.preMasteryScore ?? 0) + 0.6 + proximityOf(entry),
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
      // toward the concept's priority (relevance, plus unknown need at 1,
      // plus the surviving edge's proximity, [D-410]).
      expect(entry?.factors.preMasteryScore).toBeCloseTo(
        upcomingContribution?.contribution ?? -1,
        10,
      );
      expect(entry?.priorityScore).toBeCloseTo(
        (upcomingContribution?.contribution ?? -1) + 1 + proximityOf(entry),
        10,
      );
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
      // RANKS — evidence is present, only weighted to nothing. The floor is
      // the RELEVANCE term's: a 0%-weighted assessment cannot inform
      // relevance, whatever its yield/confidence. Since [D-332] the blend
      // adds, so the concept keeps its need term (unknown, ordered at 1) and
      // no single low factor silences it (C5.10).
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
      expect(zeroWeightCourse.ranked[0]?.factors.preMasteryScore).toBe(0);
      expect(zeroWeightCourse.ranked[0]?.priorityScore).toBeCloseTo(
        1 + proximityOf(zeroWeightCourse.ranked[0]),
        12,
      );

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

describe('rankOracle — the [D-332] blend: need from current recall, the stage out, the terms added (ol-egov.141.89.10.78)', () => {
  // `pln.md` §5 R1's construction: three concepts with identical evidence
  // (one edge each, same assessment), differing only in growth stage and
  // current recall. Placeholder ids — INV-3.
  const r1Input = (
    stages: readonly [MasteryState, MasteryState, MasteryState],
    extra: Partial<RankOracleInput> = {},
  ): RankOracleInput => ({
    evidence: {
      edges: [
        edge({ conceptName: 'faded' }),
        edge({ conceptName: 'strong' }),
        edge({ conceptName: 'unread' }),
      ],
      assessmentsRead: readReport([assessment()]),
      assessmentsWithNoEvidence: [],
    },
    mastery: new Map([
      ['faded', masteryResult('faded', stages[0])],
      ['strong', masteryResult('strong', stages[1])],
      ['unread', masteryResult('unread', stages[2])],
    ]),
    retrievability: new Map([
      ['faded', 0.05],
      ['strong', 0.9],
    ]),
    asOf: ASOF,
    ...extra,
  });
  const ranked = (input: Parameters<typeof rankOracle>[0]) => {
    const course = rankOracle(input).courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    return course.ranked;
  };
  const byKey = (input: Parameters<typeof rankOracle>[0], key: string) => {
    const entry = ranked(input).find((e) => e.conceptKey === key);
    if (entry === undefined) throw new Error(`no entry for ${key}`);
    return entry;
  };
  const weighted = (relevance: number, need: number, proximity?: number) => {
    const blendWeights: RankBlendWeightsWithProximity | { relevance: number; need: number } =
      proximity === undefined ? { relevance, need } : { relevance, need, proximity };
    return r1Input(['seed', 'seed', 'seed'], { options: { blendWeights } });
  };

  it('R1: the faded top-stage concept ranks ABOVE the strongly recalled lower-stage one, and the unread one first', () => {
    const input = r1Input(['tree', 'sprout', 'tree']);
    expect(ranked(input).map((e) => e.conceptKey)).toEqual(['unread', 'faded', 'strong']);
    expect(byKey(input, 'faded').factors.need).toBeCloseTo(0.95, 12);
    expect(byKey(input, 'faded').factors.needBasis).toBe('estimated');
    expect(byKey(input, 'faded').factors.needSource).toBe('current-recall');
    expect(byKey(input, 'strong').factors.need).toBeCloseTo(0.1, 12);
  });

  it('R1: no recall reading is unknown need — no number, ordered at the declared provisional maximum, never worded as weakness ([D-348])', () => {
    const unread = byKey(r1Input(['tree', 'sprout', 'tree']), 'unread');
    expect(unread.factors.needBasis).toBe('unknown');
    expect(unread.factors.need).toBeUndefined();
    expect('need' in unread.factors).toBe(false);
    expect(unread.factors.needOrderingInput).toBe(1);
    expect(unread.factors.retrievabilityWeight).toBeUndefined();
    // `[D-417]`: unknown need decided its place over `faded` — worded as unknown, no number.
    expect(unread.reasoning).toContain(
      'is ranked above the next concept because there is no evidence yet of how well you recall it.',
    );
    expect(unread.reasoning).not.toMatch(/\d/);
    expect(unread.reasoning).not.toMatch(
      /\b(weak|weakness|struggling|forgotten|behind|low recall|needs work)\b/i,
    );
  });

  it('R1: the growth stage never enters — every stage assignment leaves need, basis, score and order unchanged ([D-281])', () => {
    const stages: readonly MasteryState[] = ['seed', 'sprout', 'sapling', 'tree'];
    const reference = ranked(r1Input(['tree', 'sprout', 'tree']));
    for (const a of stages) {
      for (const b of stages) {
        for (const c of stages) {
          const run = ranked(r1Input([a, b, c]));
          expect(run.map((e) => e.conceptKey)).toEqual(reference.map((e) => e.conceptKey));
          for (const [index, entry] of run.entries()) {
            expect(entry.priorityScore).toBe(reference[index]?.priorityScore);
            expect(entry.factors.need).toBe(reference[index]?.factors.need);
            expect(entry.factors.needBasis).toBe(reference[index]?.factors.needBasis);
          }
        }
      }
    }
  });

  it('the terms ADD: priority is w_relevance × relevance + w_need × need + w_proximity × proximity, at the declared fallback (1, 1, 1) and at delivered weights', () => {
    const fallback = byKey(r1Input(['tree', 'sprout', 'tree']), 'faded');
    expect(fallback.factors.blendWeights).toEqual({ relevance: 1, need: 1, proximity: 1 });
    expect(fallback.priorityScore).toBeCloseTo(
      fallback.factors.preMasteryScore + 0.95 + proximityOf(fallback),
      12,
    );
    // `[D-417]`: only need separates `faded` from `strong`, so need alone is named, in words.
    expect(fallback.reasoning).toContain(
      'is ranked above the next concept because you need to practise it more.',
    );
    expect(fallback.reasoning).not.toMatch(/\d|relevance|proximity/);

    const delivered = byKey(weighted(3, 0.5, 2), 'faded');
    expect(delivered.factors.blendWeights).toEqual({ relevance: 3, need: 0.5, proximity: 2 });
    expect(delivered.priorityScore).toBeCloseTo(
      3 * delivered.factors.preMasteryScore + 0.5 * 0.95 + 2 * proximityOf(delivered),
      12,
    );
    // The weights move the score, never the words: no weight is quoted.
    expect(delivered.reasoning).not.toMatch(/weight|\d/);
    expect(delivered.reasoning).toBe(fallback.reasoning);
  });

  it('a delivered two-weight object ([D-332] shape) keeps the declared proximity weight ([D-410])', () => {
    const delivered = byKey(weighted(3, 0.5), 'faded');
    expect(delivered.factors.blendWeights).toEqual({ relevance: 3, need: 0.5, proximity: 1 });
    expect(delivered.priorityScore).toBeCloseTo(
      3 * delivered.factors.preMasteryScore + 0.5 * 0.95 + 1 * proximityOf(delivered),
      12,
    );
  });

  it('only the ratios of the weights change the order: scaling all three leaves the order identical', () => {
    const base = ranked(weighted(2, 1, 3)).map((e) => e.conceptKey);
    expect(ranked(weighted(20, 10, 30)).map((e) => e.conceptKey)).toEqual(base);
  });

  it('no single low factor silences a concept: zero relevance still ranks on need, and full recall still ranks on relevance (C5.10)', () => {
    const zeroRelevance = ranked({
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ weight: 0 })]),
        assessmentsWithNoEvidence: [],
      },
      retrievability: new Map([['concept-a', 0.3]]),
      asOf: ASOF,
    })[0];
    expect(zeroRelevance?.factors.preMasteryScore).toBe(0);
    expect(zeroRelevance?.priorityScore).toBeCloseTo(0.7 + proximityOf(zeroRelevance), 12);

    const fullRecall = ranked({
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      retrievability: new Map([['concept-a', 1]]),
      asOf: ASOF,
    })[0];
    expect(fullRecall?.factors.need).toBe(0);
    expect(fullRecall?.priorityScore).toBeGreaterThan(0);
    expect(fullRecall?.priorityScore).toBeCloseTo(
      (fullRecall?.factors.preMasteryScore ?? -1) + proximityOf(fullRecall),
      12,
    );
  });

  it('R11: demand-aware readiness, when supplied, replaces recall — recall is counted once, so perturbing it moves neither need nor score', () => {
    const withRecall = (recall: number) =>
      ranked({
        evidence: {
          edges: [edge()],
          assessmentsRead: readReport([assessment()]),
          assessmentsWithNoEvidence: [],
        },
        retrievability: new Map([['concept-a', recall]]),
        demandAwareReadiness: new Map([['concept-a', 0.4]]),
        asOf: ASOF,
      })[0];
    const base = withRecall(0.4);
    expect(base?.factors.need).toBeCloseTo(0.6, 12);
    expect(base?.factors.needSource).toBe('demand-aware-readiness');
    // `[D-417]`: the reason names no need source and no number; `needSource` above is the audit.
    expect(base?.reasoning).not.toMatch(/readiness|recall of it|\d/);
    for (const recall of [0.01, 0.2, 0.9, 1]) {
      const perturbed = withRecall(recall);
      expect(perturbed?.factors.need).toBe(base?.factors.need);
      expect(perturbed?.priorityScore).toBe(base?.priorityScore);
    }
  });

  it('[D-329] unknown relevance blends the same way: the declared middle ADDED to need', () => {
    const course = rankOracle({
      evidence: { edges: [], assessmentsRead: readReport([]), assessmentsWithNoEvidence: [] },
      courseConcepts: new Map([['COURSEA', new Map([['concept-a', 'concept-a']])]]),
      retrievability: new Map([['concept-a', 0.25]]),
      asOf: ASOF,
    }).courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    const entry = course.ranked[0];
    // The frozen middle, 1/8 ([D-410] sweep), and no edge so no proximity.
    expect(entry?.factors.preMasteryScore).toBe(0.125);
    expect(proximityOf(entry)).toBe(0);
    expect(entry?.factors.need).toBeCloseTo(0.75, 12);
    expect(entry?.priorityScore).toBeCloseTo(0.125 + 0.75, 12);
  });

  it('rejects blend weights that are zero, negative or not finite, and a readiness outside [0, 1]', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rankOracle(weighted(bad, 1))).toThrow(/blendWeights\.relevance/);
      expect(() => rankOracle(weighted(1, bad))).toThrow(/blendWeights\.need/);
      expect(() => rankOracle(weighted(1, 1, bad))).toThrow(/blendWeights\.proximity/);
    }
    expect(() =>
      rankOracle({
        ...r1Input(['seed', 'seed', 'seed']),
        demandAwareReadiness: new Map([['faded', 1.2]]),
      }),
    ).toThrow(/demandAwareReadiness/);
  });
});

describe('rankOracle — proximity is its own blend term; undated evidence is never silenced ([D-410], ol-egov.141.89.10.82)', () => {
  const ranked = (input: Parameters<typeof rankOracle>[0]) => {
    const course = rankOracle(input).courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    return course.ranked;
  };

  it('R2: evidence on an undated assessment keeps its full relevance, and outranks a concept with no evidence at equal need ([D-329])', () => {
    // pln.md §5 R2's construction: one concept with an objectives edge on an
    // assessment that has no date, one with no edge at all; neither has a
    // recall reading, so both read unknown need, ordered at 1.
    const rows = ranked({
      evidence: {
        edges: [
          edge({
            conceptName: 'hasedge',
            assessmentPath: 'Assessments/Undated.md',
            yieldRank: 2,
            confidence: 0.6,
            citations: [],
            basis: 'objectives',
            objectivesCitations: [objectivesCitation()],
          }),
        ],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/Undated.md', due: undefined, weight: undefined }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      courseConcepts: new Map([
        [
          'COURSEA',
          new Map([
            ['hasedge', 'hasedge'],
            ['a-noedge', 'a-noedge'],
          ]),
        ],
      ]),
      asOf: ASOF,
    });
    const hasEdge = rows.find((r) => r.conceptKey === 'hasedge');
    const noEdge = rows.find((r) => r.conceptKey === 'a-noedge');
    // Before [D-410] this was exactly 0: proximity 0 multiplied the edge away.
    expect(hasEdge?.factors.preMasteryScore).toBeCloseTo(0.5 * 0.6, 12);
    expect(proximityOf(hasEdge)).toBe(0);
    expect(noEdge?.factors.preMasteryScore).toBe(0.125);
    // Score-driven, not a name tie: 'a-noedge' sorts first by name.
    expect(hasEdge?.priorityScore).toBeGreaterThan(
      noEdge?.priorityScore ?? Number.POSITIVE_INFINITY,
    );
    expect(rows.map((r) => r.conceptKey)).toEqual(['hasedge', 'a-noedge']);
    // `[D-417]`: relevance alone separates them (need and proximity equal), so relevance alone
    // is named; the no-edge concept, last, says it has no evidence yet.
    expect(hasEdge?.reasoning).toContain(
      'is ranked above the next concept because it counts for more in your assessments.',
    );
    expect(hasEdge?.reasoning).not.toMatch(/sooner|need to practise/);
    expect(noEdge?.reasoning).toContain('is ranked last in this course.');
    expect(noEdge?.reasoning).toContain('It has no assessment evidence recorded yet.');
  });

  it('R13: every arrival with an evidence edge precedes every arrival with none, at equal (unknown) need', () => {
    const withEdge = ['z-e1', 'z-e2', 'z-e3'];
    const noEdge = ['a-u1', 'a-u2'];
    const rows = ranked({
      evidence: {
        edges: withEdge.map((k) => edge({ conceptName: k, yieldRank: 2, confidence: 0.6 })),
        assessmentsRead: readReport([assessment({ weight: undefined, due: '2026-09-05' })]),
        assessmentsWithNoEvidence: [],
      },
      courseConcepts: new Map([
        ['COURSEA', new Map([...withEdge, ...noEdge].map((k) => [k, k] as const))],
      ]),
      asOf: ASOF,
    });
    const order = rows.map((r) => r.conceptKey);
    const lastWithEdge = Math.max(...withEdge.map((k) => order.indexOf(k)));
    const firstNoEdge = Math.min(...noEdge.map((k) => order.indexOf(k)));
    expect(lastWithEdge).toBeLessThan(firstNoEdge);
  });

  it('R3: a missing date adds nothing to proximity and never outranks a real deadline; dating it never lowers its priority', () => {
    const input = (undatedDue: string | undefined) => ({
      evidence: {
        edges: [
          edge({ conceptName: 'a-undated', assessmentPath: 'Assessments/A.md' }),
          edge({ conceptName: 'b-dated', assessmentPath: 'Assessments/B.md' }),
        ],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/A.md', due: undatedDue }),
          assessment({ path: 'Assessments/B.md', due: '2026-08-20' }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    });
    const missing = ranked(input(undefined));
    // Equal evidence and need; only proximity differs, and it decides —
    // against name order, so this is the score, not the tie-break.
    expect(missing.map((r) => r.conceptKey)).toEqual(['b-dated', 'a-undated']);
    const undated = missing.find((r) => r.conceptKey === 'a-undated');
    const dated = missing.find((r) => r.conceptKey === 'b-dated');
    expect(proximityOf(undated)).toBe(0);
    expect(undated?.factors.preMasteryScore).toBe(dated?.factors.preMasteryScore);
    const withDate = ranked(input('2026-08-20')).find((r) => r.conceptKey === 'a-undated');
    expect(withDate?.priorityScore).toBeGreaterThan(
      undated?.priorityScore ?? Number.POSITIVE_INFINITY,
    );
  });

  it("a concept's proximity is its soonest dated assessment, not a sum: a later or undated assessment changes relevance only", () => {
    const withEdges = (paths: readonly string[]) =>
      ranked({
        evidence: {
          edges: paths.map((path) => edge({ assessmentPath: path, citations: [] })),
          assessmentsRead: readReport([
            assessment({ path: 'Assessments/Soon.md', due: '2026-08-21', weight: undefined }),
            assessment({ path: 'Assessments/Later.md', due: '2026-10-15', weight: undefined }),
            assessment({ path: 'Assessments/Undated.md', due: undefined, weight: undefined }),
          ]),
          assessmentsWithNoEvidence: [],
        },
        asOf: ASOF,
      })[0];
    const soon = withEdges(['Assessments/Soon.md']);
    const all = withEdges([
      'Assessments/Soon.md',
      'Assessments/Later.md',
      'Assessments/Undated.md',
    ]);
    expect(proximityOf(soon)).toBeCloseTo(1 / (1 + 5 / 14), 12);
    expect(proximityOf(all)).toBe(proximityOf(soon));
    // Every distinct assessment's evidence still adds to relevance ([D-403]).
    expect(all?.factors.preMasteryScore).toBeCloseTo(3 * (soon?.factors.preMasteryScore ?? 0), 12);
  });

  it('only undated evidence: the concept ranks on relevance and need, and its reasoning claims nothing about a date', () => {
    const entry = ranked({
      evidence: {
        edges: [edge()],
        assessmentsRead: readReport([assessment({ due: undefined })]),
        assessmentsWithNoEvidence: [],
      },
      retrievability: new Map([['concept-a', 0.5]]),
      asOf: ASOF,
    })[0];
    expect(entry?.factors.preMasteryScore).toBeCloseTo(0.2, 12);
    expect(proximityOf(entry)).toBe(0);
    expect(entry?.priorityScore).toBeCloseTo(0.2 + 0.5, 12);
    expect(entry?.reasoning).not.toMatch(/sooner|due|\d/);
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

// `[D-417]` (ruled 2026-09-28, `ol-egov.141.89.10.92`): the reason names a single deciding factor
// only when that factor alone put the concept above the next one, every favouring factor when
// several did, and carries no score, decimal or count. Words of each factor's phrase are checked
// the way the planning benchmark's sentence check reads them (a factor's own word, or the
// phrase's plain words).
describe('rankOracle — the reason names what decided, from the actual factor values ([D-417])', () => {
  const FACTOR_WORDS = {
    need: /\bneed\b|\brecall it\b/i,
    relevance: /\brelevance\b|counts for more|assessment evidence yet and/i,
    proximity: /\bproximity\b|\bsooner\b/i,
  } as const;
  const named = (text: string) =>
    (Object.keys(FACTOR_WORDS) as (keyof typeof FACTOR_WORDS)[]).filter((f) =>
      FACTOR_WORDS[f].test(text),
    );
  // The planning benchmark's committed ban on a count of unmet material, and the ruling's
  // "no raw scores or decimals".
  const COUNT_OF_UNMET = /\b\d+\b(?:\s+\S+){0,3}?\s+(more|left|remaining|unmet|not\s+yet\s+met)\b/i;

  function twoConcepts(opts: {
    readonly recall?: readonly [number, number];
    readonly due?: readonly [string, string];
    readonly yieldRank?: readonly [number, number];
  }) {
    const due = opts.due ?? ['2026-09-01', '2026-09-01'];
    const yieldRank = opts.yieldRank ?? [1, 1];
    const result = rankOracle({
      evidence: {
        edges: [
          edge({
            conceptName: 'target',
            assessmentPath: 'Assessments/T.md',
            yieldRank: yieldRank[0],
          }),
          edge({
            conceptName: 'reference',
            assessmentPath: 'Assessments/R.md',
            yieldRank: yieldRank[1],
          }),
        ],
        assessmentsRead: readReport([
          assessment({ path: 'Assessments/T.md', due: due[0] }),
          assessment({ path: 'Assessments/R.md', due: due[1] }),
        ]),
        assessmentsWithNoEvidence: [],
      },
      ...(opts.recall !== undefined
        ? {
            retrievability: new Map([
              ['target', opts.recall[0]],
              ['reference', opts.recall[1]],
            ]),
          }
        : {}),
      asOf: ASOF,
    });
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    return course.ranked;
  }

  it('need alone moved it (the planning benchmark R10 construction): need alone is named', () => {
    const [first, second] = twoConcepts({ recall: [0.3, 0.9] });
    expect(first?.conceptKey).toBe('target');
    expect(first?.reasoning).toBe(
      'target (COURSEA) is ranked above the next concept because you need to practise it more. ' +
        'It appears in past papers.',
    );
    expect(named(first?.reasoning ?? '')).toEqual(['need']);
    expect(second?.reasoning).toBe(
      'reference (COURSEA) is ranked last in this course. It appears in past papers.',
    );
  });

  it('proximity alone moved it: only its sooner assessment is named', () => {
    const [first] = twoConcepts({ recall: [0.5, 0.5], due: ['2026-08-20', '2026-10-30'] });
    expect(first?.conceptKey).toBe('target');
    expect(first?.reasoning).toContain(`because ${RANK_REASON_PHRASES.proximity}.`);
    expect(named(first?.reasoning ?? '')).toEqual(['proximity']);
  });

  it('relevance alone moved it: only relevance is named', () => {
    const [first] = twoConcepts({ recall: [0.5, 0.5], yieldRank: [1, 4] });
    expect(first?.conceptKey).toBe('target');
    expect(first?.reasoning).toContain(`because ${RANK_REASON_PHRASES.relevance}.`);
    expect(named(first?.reasoning ?? '')).toEqual(['relevance']);
  });

  it('need and proximity both favour it: they decide jointly, and both are named', () => {
    const [first] = twoConcepts({ recall: [0.3, 0.9], due: ['2026-08-20', '2026-10-30'] });
    expect(first?.conceptKey).toBe('target');
    expect(first?.reasoning).toContain(
      `because ${RANK_REASON_PHRASES.need} and ${RANK_REASON_PHRASES.proximity}.`,
    );
    expect(named(first?.reasoning ?? '')).toEqual(['need', 'proximity']);
  });

  it('a factor weighing against it is not named: need favours it, relevance does not, need alone decided', () => {
    // target: lower relevance (yield rank 2) but much less recalled.
    const [first] = twoConcepts({ recall: [0.05, 0.95], yieldRank: [2, 1] });
    expect(first?.conceptKey).toBe('target');
    const ref = first?.factors;
    expect(ref !== undefined && ref.preMasteryScore < 1).toBe(true);
    expect(named(first?.reasoning ?? '')).toEqual(['need']);
  });

  it('an exact tie names no factor: the tie-break is said to have ordered them', () => {
    const [first] = twoConcepts({ recall: [0.5, 0.5] });
    expect(first?.reasoning).toBe(
      `reference (COURSEA) ${RANK_REASON_PHRASES.tie}. It appears in past papers.`,
    );
    expect(named(first?.reasoning ?? '')).toEqual([]);
  });

  it('decidingFactors reads the weighted terms: a factor favours only when its weighted term is higher', () => {
    const [first, second] = twoConcepts({ recall: [0.3, 0.9] });
    if (first === undefined || second === undefined) throw new Error('expected two');
    const withProximity = (f: typeof first.factors) =>
      f as typeof f & {
        proximityScore: number;
        blendWeights: { relevance: number; need: number; proximity: number };
      };
    expect(decidingFactors(withProximity(first.factors), withProximity(second.factors))).toEqual([
      'need',
    ]);
    expect(decidingFactors(withProximity(first.factors), withProximity(first.factors))).toBe('tie');
  });

  it('no reason carries a decimal, a percentage, a ratio, a weight or a count of unmet material', () => {
    const fixtures = [
      twoConcepts({ recall: [0.3, 0.9] }),
      twoConcepts({ recall: [0.5, 0.5], due: ['2026-08-20', '2026-10-30'] }),
      twoConcepts({}),
      twoConcepts({ recall: [0.3, 0.9], yieldRank: [3, 1], due: ['2026-08-18', '2026-09-30'] }),
    ];
    for (const ranking of fixtures) {
      for (const entry of ranking) {
        expect(entry.reasoning).not.toMatch(/\d+\.\d+|%|\bpercent|\bratio\b|\bweight\b|\bscore\b/i);
        expect(entry.reasoning).not.toMatch(COUNT_OF_UNMET);
        expect(entry.reasoning).not.toMatch(/\bweak|struggling|behind\b/i);
      }
    }
  });
});
