// `ol-egov.141.89.7.81` (`[D-538]`, F4.2): each gap row carries the evidence its ranking rests on
// besides its past papers, read from the SURVIVING evidence only, so the copy layer can name each
// basis for what it is: the course objectives (an explicit name match, or a link Olea's reading
// inferred, `[D-432]`) and the assessments whose own notes declare a scope naming the concept.
// Scenarios: olea-service `features/F4-oracle.md`, tagged
// `@auto:core/src/gap/build.basis.ol-egov.141.89.7.81.spec`.
//
// INV-3: every course code, concept name and path below is invented.
import { describe, expect, it } from 'vitest';
import type { AssessmentReadReport, AssessmentRecord } from '../assessment/types.js';
import type {
  ConceptAssessmentEdge,
  EvidenceBriefCitation,
  EvidenceObjectivesCitation,
  EvidenceQuestionCitation,
} from '../evidence-edge/types.js';
import { rankOracle } from '../oracle/rank.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { allGapRows, buildGapView, type GapRow } from './build.js';

const COURSE = 'CRS101';
const PAPER = 'Past Papers/2025.md' as VaultPath;
const OBJECTIVES = '03 Research/objectives.md' as VaultPath;
const ASSIGNMENT = 'Assessments/Assignment 2.md' as VaultPath;
const TEST = 'Assessments/Test 1.md' as VaultPath;
const PASSED = 'Assessments/Passed.md' as VaultPath;

function paperCitation(): EvidenceQuestionCitation {
  return {
    sourcePath: PAPER,
    questionLabel: 'Q1',
    questionText: 'An invented question.',
    provenance: { sourcePath: PAPER, location: { page: 1, charRange: { start: 0, end: 4 } } },
  };
}

function objectivesCitation(alignment?: 'name' | 'semantic'): EvidenceObjectivesCitation {
  // The alignment marker is not on the type yet: `oracle/rank.ts`'s `objectivesAlignmentOf`
  // reads it the same way, and the semantic alignment lane sets it ([D-432]).
  return {
    sourcePath: OBJECTIVES,
    provenance: { sourcePath: OBJECTIVES, location: { page: 1 } },
    ...(alignment !== undefined ? { alignment } : {}),
  } as EvidenceObjectivesCitation;
}

function briefCitation(path: VaultPath): EvidenceBriefCitation {
  return { sourcePath: path, provenance: { sourcePath: path, location: { page: 1 } } };
}

/** A ranked entry carrying exactly the factors under test. */
function entry(
  conceptKey: string,
  factors: Partial<ConceptPriority['factors']> = {},
): ConceptPriority {
  const citations = factors.citations ?? [];
  return {
    conceptName: conceptKey,
    conceptKey,
    course: COURSE,
    rank: 1,
    priorityScore: 1,
    factors: {
      citations,
      distinctSourceCount: new Set(citations.map((c) => c.sourcePath)).size,
      contributions: [
        {
          assessmentPath: ASSIGNMENT,
          yieldRank: 1,
          yieldScore: 1,
          confidence: 1,
          assessmentWeightKnown: true,
          assessmentWeightScore: 1,
          daysUntilDue: 10,
          examProximityScore: 1,
          evidenceStrength: 1,
          contribution: 1,
        },
      ],
      preMasteryScore: 1,
      masteryState: 'sprout',
      masteryNeedWeight: 1,
      priorityScore: 1,
      ...factors,
    },
    citations,
    reasoning: 'Invented.',
  };
}

function rowsOf(entries: readonly ConceptPriority[]): readonly GapRow[] {
  const ranking: RankOracleResult = {
    courses: [{ course: COURSE, status: 'ranked', ranked: entries }],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
  return allGapRows(
    buildGapView({ ranking, assessments: [], materialPresence: new Map(), sourceCoverage: [] }),
  );
}

function rowFor(rows: readonly GapRow[], conceptKey: string): GapRow {
  const row = rows.find((r) => r.conceptKey === conceptKey);
  if (row === undefined) throw new Error(`expected a row for ${conceptKey}`);
  return row;
}

describe('the row carries the surviving evidence behind it ([D-538])', () => {
  it('names the objectives as an explicit name match and lists every assessment note, sorted', () => {
    const rows = rowsOf([
      entry('all-three', {
        citations: [paperCitation()],
        objectivesCitations: [objectivesCitation()],
        distinctObjectivesSourceCount: 1,
        briefCitations: [briefCitation(TEST), briefCitation(ASSIGNMENT)],
      }),
    ]);
    expect(rowFor(rows, 'all-three').basis).toEqual({
      objectives: 'named',
      assessmentPaths: [ASSIGNMENT, TEST],
    });
  });

  it('a past-paper-only row carries no objectives and no assessment notes', () => {
    const rows = rowsOf([entry('papers', { citations: [paperCitation()] })]);
    expect(rowFor(rows, 'papers').basis).toEqual({ objectives: null, assessmentPaths: [] });
  });

  it('an objectives entry built before the field existed (no objectivesCitations) reads none', () => {
    const rows = rowsOf([entry('legacy', { citations: [paperCitation()] })]);
    expect(rowFor(rows, 'legacy').basis?.objectives).toBeNull();
  });
});

describe('objectives evidence Olea inferred is carried as inferred ([D-432], [D-538])', () => {
  it('every citation a reading-based alignment: inferred', () => {
    const rows = rowsOf([
      entry('inferred', { objectivesCitations: [objectivesCitation('semantic')] }),
    ]);
    expect(rowFor(rows, 'inferred').basis?.objectives).toBe('inferred');
  });

  it('one explicit name match among them: named; a citation with no marker is a name match', () => {
    const rows = rowsOf([
      entry('mixed', {
        objectivesCitations: [
          objectivesCitation('semantic'),
          { ...objectivesCitation('name'), sourcePath: 'Other/objectives.md' as VaultPath },
        ],
      }),
      entry('unmarked', { objectivesCitations: [objectivesCitation()] }),
    ]);
    expect(rowFor(rows, 'mixed').basis?.objectives).toBe('named');
    expect(rowFor(rows, 'unmarked').basis?.objectives).toBe('named');
  });
});

// ---------------------------------------------------------------------------
// Through the real ranking: the veto removes a passed assessment's edge before the row is built.
// ---------------------------------------------------------------------------

function assessment(path: VaultPath, due: string): AssessmentRecord {
  return {
    path,
    course: COURSE,
    type: 'Assignment',
    weight: 20,
    weightRaw: '20',
    due,
    status: 'upcoming',
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

function edge(
  conceptKey: string,
  assessmentPath: VaultPath,
  overrides: Partial<ConceptAssessmentEdge>,
): ConceptAssessmentEdge {
  return {
    conceptName: conceptKey,
    conceptKey,
    assessmentPath,
    course: COURSE,
    yieldRank: 1,
    confidence: 1,
    citations: [],
    ...overrides,
  };
}

function briefEdge(conceptKey: string, assessmentPath: VaultPath): ConceptAssessmentEdge {
  return edge(conceptKey, assessmentPath, {
    basis: 'assessment-brief',
    briefCitations: [briefCitation(assessmentPath)],
  });
}

function rankedRows(edges: readonly ConceptAssessmentEdge[]): readonly GapRow[] {
  const records = [
    assessment(PASSED, '2026-01-01'),
    assessment(ASSIGNMENT, '2026-09-01'),
    assessment(TEST, '2026-09-15'),
  ];
  const ranking = rankOracle({
    evidence: {
      edges,
      assessmentsRead: readReport(records),
      assessmentsWithNoEvidence: [],
    },
    asOf: '2026-08-16',
  });
  return allGapRows(
    buildGapView({
      ranking,
      assessments: records,
      materialPresence: new Map(),
      sourceCoverage: [],
    }),
  );
}

describe('an assessment already sat is never named as a basis ([D-538], C5.10)', () => {
  it('a scope-property edge to a passed assessment is vetoed, and only the upcoming one is listed', () => {
    const rows = rankedRows([briefEdge('two-briefs', PASSED), briefEdge('two-briefs', ASSIGNMENT)]);
    expect(rowFor(rows, 'two-briefs').basis?.assessmentPaths).toEqual([ASSIGNMENT]);
  });

  it('a concept whose only scope-property edge is to the passed assessment, beside a past paper, lists none', () => {
    const rows = rankedRows([
      briefEdge('paper-and-passed', PASSED),
      edge('paper-and-passed', ASSIGNMENT, { citations: [paperCitation()] }),
    ]);
    const row = rowFor(rows, 'paper-and-passed');
    expect(row.distinctSourceCount).toBe(1);
    expect(row.basis?.assessmentPaths).toEqual([]);
  });

  it('the row and the ranking read an inferred link the same way', () => {
    const rows = rankedRows([
      edge('inferred', ASSIGNMENT, {
        basis: 'objectives',
        objectivesCitations: [objectivesCitation('semantic')],
      }),
    ]);
    const row = rowFor(rows, 'inferred');
    expect(row.basis?.objectives).toBe('inferred');
    // The ranking's own reason for the same entry (registry §29, row 33): never "name it".
    expect(row.reasoning).toContain('It is covered by the course objectives.');
  });
});
