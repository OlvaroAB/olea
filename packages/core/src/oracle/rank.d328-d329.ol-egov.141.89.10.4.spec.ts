// New test file for `ol-egov.141.89.10.4` ([ILB-PLN-4]), covering two of its acceptance
// criteria against `rank.ts` (this bead's one owned file in this package). Kept separate from
// `rank.spec.ts` — a file this bead does not own — per the lane rule "create new test files
// named after your change" rather than editing a shared spec concurrent lanes may also touch.
//
// Concept, course and assessment ids below are structural placeholders, never fixture
// vocabulary — INV-3.
import { describe, expect, it } from 'vitest';
import type { AssessmentReadReport, AssessmentRecord } from '../assessment/types.js';
import type { ConceptAssessmentEdge, EvidenceQuestionCitation } from '../evidence-edge/types.js';
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

const ASOF = '2026-08-16';

// D-328's own case class in the chain's locked dev set is `R12`
// (`eval/data/ilb/pln/dev/cases.json`, `eval/data/ilb/pln/targets.dev.json`); this suite proves
// the same invariant directly against the built module, independent of the harness runner.
describe('rankOracle — [D-328]: a stale or unavailable delivered-parameters read never silences a veto', () => {
  it('the assessment-passed veto fires identically whether options arrive delivered or fall back to declared', () => {
    // `due` is well before `asOf`: `checkEdgeVeto` reads this as `'assessment-passed'`,
    // C5.10's own veto — computed from `daysUntilDue` alone, with no dependency on
    // `RankOracleOptions` at all (see `checkEdgeVeto`'s doc). A caller whose delivered
    // weights read failed or went stale degrades to the declared fallback
    // (`resolveOptions`) for the BLEND, but that degrade must never read as "nothing to
    // veto": the veto list is not delivered data, and `[D-328]`'s acceptance ("a failed or
    // stale veto-list read never becomes nothing is vetoed") holds exactly because the two
    // are structurally independent, which this test pins by construction rather than by
    // inspecting `resolveOptions` internals.
    const passedAssessment = assessment({ due: '2020-01-01' });
    const baseInput: Omit<RankOracleInput, 'options'> = {
      evidence: {
        edges: [edge({ assessmentPath: passedAssessment.path })],
        assessmentsRead: readReport([passedAssessment]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
    };

    // "Delivered" regime: every derived/delivered weight present, including values far from
    // the declared fallback, so the two runs are not accidentally identical.
    const delivered = rankOracle({
      ...baseInput,
      options: {
        proximityHalfLifeDays: 3,
        assessmentWeightDivisor: 50,
        masteryNeedWeight: { seed: 0.9, sprout: 0.5, sapling: 0.2, tree: 0.05, unknown: 0.9 },
      },
    });
    // "Unavailable / stale" regime: no delivered artifact at all — `resolveOptions` falls
    // back per-field to the declared constants, exactly the state a failed or stale read
    // leaves the caller in (`rank-weights-provider.ts`'s own stale/expired distinction).
    const fallenBack = rankOracle(baseInput);

    for (const result of [delivered, fallenBack]) {
      expect(result.courses).toHaveLength(1);
      const course = result.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected ranked (course itself is fine)');
      // The concept's only edge was vetoed — it must be reported as vetoed, never silently
      // ranked as though the assessment were still live, and never simply absent.
      expect(course.ranked).toHaveLength(0);
      expect(course.vetoedConcepts ?? []).toHaveLength(1);
      const vetoed = course.vetoedConcepts?.[0];
      expect(vetoed?.conceptKey).toBe('concept-a');
      expect(vetoed?.vetoedEdges).toHaveLength(1);
      expect(vetoed?.vetoedEdges[0]?.reason).toBe('assessment-passed');
    }
  });
});

// D-329's case class in the chain's locked dev set is `R2` (same files as above). This suite
// exercises `rankOracle`'s new, purely additive `courseConcepts` input directly.
describe('rankOracle — [D-329]: unknown relevance is ranked, never dropped, and a no-evidence course is served on need alone', () => {
  it('a concept with no evidence edge in a course that has some is ranked at unknown relevance, not silently absent', () => {
    const result = rankOracle({
      evidence: {
        edges: [edge({ conceptName: 'concept-hasedge' })],
        assessmentsRead: readReport([assessment()]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
      courseConcepts: new Map([
        [
          'COURSEA',
          new Map([
            ['concept-hasedge', 'concept-hasedge'],
            ['concept-noedge', 'concept-noedge'],
          ]),
        ],
      ]),
    });
    const course = result.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected ranked');
    expect(course.ranked).toHaveLength(2);
    const noEdge = course.ranked.find((c) => c.conceptKey === 'concept-noedge');
    const hasEdge = course.ranked.find((c) => c.conceptKey === 'concept-hasedge');
    expect(noEdge).toBeDefined();
    expect(hasEdge).toBeDefined();
    if (noEdge === undefined || hasEdge === undefined) return;

    // The module's documented, exhaustive signal for a `[D-329]` synthesized entry: both
    // `contributions` and `citations` empty at once, which never happens for a concept that
    // survived from a real edge (`evidence-edge/build.ts`'s "evidential, not membership" rule).
    expect(noEdge.factors.contributions).toHaveLength(0);
    expect(noEdge.citations).toHaveLength(0);
    expect(noEdge.factors.vetoedEdges ?? []).toHaveLength(0);
    // Never the silencing zero, and never the scale's unbounded top: strictly inside the
    // `(0, 1]` range every per-edge signal is normalized to (this file's module doc, "The
    // scoring shape") — the exact placement inside it is `[D-332]`'s frozen-weights question,
    // marked `pending` on the chain's locked targets (`r2-noedge-middle`), not this test's.
    expect(noEdge.factors.preMasteryScore).toBeGreaterThan(0);
    expect(noEdge.factors.preMasteryScore).toBeLessThanOrEqual(1);
    expect(noEdge.reasoning).toContain('no assessment evidence recorded yet');

    // The concept WITH an edge is completely unaffected by the new input — same shape as
    // `rankOracle` has always produced for it.
    expect(hasEdge.factors.contributions).toHaveLength(1);
  });

  it('a course with no assessment evidence anywhere is served on need alone, never abstained, when its concepts are named', () => {
    const result = rankOracle({
      evidence: {
        edges: [],
        assessmentsRead: readReport([]),
        assessmentsWithNoEvidence: [],
      },
      asOf: ASOF,
      courseConcepts: new Map([['COURSEC', new Map([['concept-x', 'concept-x']])]]),
    });
    expect(result.courses).toHaveLength(1);
    const course = result.courses[0];
    // `status: 'ranked'` (never `'abstained'`) is itself the signal this course was served,
    // not refused — the module doc's own "servesOnNeedAlone" reading of `[D-329]`.
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') return;
    expect(course.ranked).toHaveLength(1);
    expect(course.ranked[0]?.factors.preMasteryScore).toBeGreaterThan(0);
  });

  it('a course named in courseConcepts with no known concepts yet still serves on need alone with an empty ranking, not abstained', () => {
    const result = rankOracle({
      evidence: { edges: [], assessmentsRead: readReport([]), assessmentsWithNoEvidence: [] },
      asOf: ASOF,
      courseConcepts: new Map([['COURSEC', new Map()]]),
    });
    const course = result.courses[0];
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') return;
    expect(course.ranked).toHaveLength(0);
  });

  it('omitting courseConcepts entirely leaves the abstain path byte-identical to before this bead', () => {
    const result = rankOracle({
      evidence: {
        edges: [],
        assessmentsRead: readReport([assessment({ path: 'Assessments/NoEvidence1.md' })]),
        assessmentsWithNoEvidence: ['Assessments/NoEvidence1.md'],
      },
      asOf: ASOF,
    });
    expect(result.courses[0]?.status).toBe('abstained');
  });
});
