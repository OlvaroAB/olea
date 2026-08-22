import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { SourceCoverage } from '../concept/evidence.js';
import type { ConceptRecord } from '../concept/types.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  affordancesFor,
  allGapRows,
  buildGapView,
  buildMaterialPresence,
  type ConceptMaterialPresence,
  classifyGap,
  type GapClass,
} from './build.js';

const ASSESSMENT_PATH = '02 Assessments/final.md' as VaultPath;

function entry(conceptName: string, rank: number, priorityScore: number): ConceptPriority {
  const citation = {
    sourcePath: '03 Research/paper-2024.pdf' as VaultPath,
    questionLabel: `Q${rank}`,
    questionText: 'A question.',
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 10 } },
    } as ConceptPriority['citations'][number]['provenance'],
  };
  return {
    conceptName,
    course: 'CRS101',
    rank,
    priorityScore,
    factors: {
      citations: [citation],
      distinctSourceCount: rank,
      contributions: [
        {
          assessmentPath: ASSESSMENT_PATH,
          yieldRank: 1,
          yieldScore: 1,
          confidence: 1,
          assessmentWeightKnown: true,
          assessmentWeightScore: 1,
          daysUntilDue: 10,
          examProximityScore: 1,
          evidenceStrength: 1,
          contribution: priorityScore,
        },
      ],
      preMasteryScore: priorityScore,
      masteryState: 'shaky',
      masteryNeedWeight: 1,
      priorityScore,
    },
    citations: [citation],
    reasoning: `Cited in ${rank} place(s).`,
  };
}

function ranking(entries: readonly ConceptPriority[]): RankOracleResult {
  return {
    courses: [{ course: 'CRS101', status: 'ranked', ranked: entries }],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
}

const ASSESSMENTS: readonly AssessmentRecord[] = [
  {
    path: ASSESSMENT_PATH,
    course: 'CRS101',
    type: 'Test',
    weight: 40,
    weightRaw: '40',
    due: '2026-09-01',
    status: 'todo',
  },
];

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

function build(presence: ReadonlyMap<string, ConceptMaterialPresence>, entries: ConceptPriority[]) {
  return buildGapView({
    ranking: ranking(entries),
    assessments: ASSESSMENTS,
    materialPresence: presence,
    sourceCoverage: COVERAGE,
  });
}

describe('classifyGap — the three classes the contract refuses to merge', () => {
  it('classifies notes + cards as a mastery gap (F4.3: "you know this badly")', () => {
    expect(classifyGap({ notePaths: ['n.md' as VaultPath], instrumentCount: 4 })).toBe(
      'mastery-gap',
    );
  });

  it('classifies notes + no cards as a coverage gap (F4.5: "you haven\'t started")', () => {
    expect(classifyGap({ notePaths: ['n.md' as VaultPath], instrumentCount: 0 })).toBe(
      'coverage-gap',
    );
  });

  it('classifies no notes as a material gap (F4.10: "we don\'t have it")', () => {
    expect(classifyGap({ notePaths: [], instrumentCount: 0 })).toBe('material-gap');
    expect(classifyGap(undefined)).toBe('material-gap');
  });
});

describe("affordancesFor — F4.10's rule, enforced by construction", () => {
  it('offers the draft affordance on a coverage gap, where the grounding exists', () => {
    expect(affordancesFor('coverage-gap')).toContain('draft-cards');
  });

  it('offers locate-or-open on a material gap, and nothing else', () => {
    expect(affordancesFor('material-gap')).toEqual(['find-source']);
  });

  it('never offers a draft affordance on a material gap, for any class value', () => {
    // F4.10: not relabelled, not disabled, not conditional. Asserted across
    // every class so adding a fourth without deciding its affordances is a
    // compile error, and mislabelling this one is a red test.
    const classes: readonly GapClass[] = ['mastery-gap', 'coverage-gap', 'material-gap'];
    for (const gapClass of classes) {
      const offered = affordancesFor(gapClass).includes('draft-cards');
      expect(offered).toBe(gapClass === 'coverage-gap');
    }
  });
});

describe('buildGapView', () => {
  it('classifies each row from what her material actually holds, and carries the affordances with it', () => {
    const model = build(
      new Map([
        ['Alpha', { notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath], instrumentCount: 2 }],
        ['Beta', { notePaths: ['05 Zettelkasten/Beta.md' as VaultPath], instrumentCount: 0 }],
      ]),
      [entry('Alpha', 1, 3), entry('Beta', 2, 2), entry('Gamma', 3, 1)],
    );
    const rows = allGapRows(model);
    expect(rows.map((r) => [r.conceptName, r.gapClass])).toEqual([
      ['Alpha', 'mastery-gap'],
      ['Beta', 'coverage-gap'],
      ['Gamma', 'material-gap'],
    ]);
    // Gamma is cited by a past paper and named by no note of hers — the row
    // with nothing to generate from, and the row with no draft button.
    expect(rows[2]?.affordances).not.toContain('draft-cards');
    expect(rows[1]?.affordances).toContain('draft-cards');
  });

  it('carries the oracle reasoning and citations through verbatim, never re-narrating them', () => {
    const model = build(new Map(), [entry('Alpha', 1, 3)]);
    const row = allGapRows(model)[0];
    expect(row?.reasoning).toBe('Cited in 1 place(s).');
    expect(row?.citations).toHaveLength(1);
    expect(row?.distinctSourceCount).toBe(1);
  });

  it('keeps an abstained course abstained rather than rendering an empty ranking', () => {
    const model = buildGapView({
      ranking: {
        courses: [
          {
            course: 'CRS202',
            status: 'abstained',
            reason: 'no-evidence',
            detail: 'No evidence for 2 assessments.',
            assessmentPaths: [
              '02 Assessments/a.md' as VaultPath,
              '02 Assessments/b.md' as VaultPath,
            ],
          },
        ],
        unattributableAssessments: [],
        asOf: '2026-08-16',
      },
      assessments: ASSESSMENTS,
      materialPresence: new Map(),
      sourceCoverage: COVERAGE,
    });
    const course = model.courses[0];
    expect(course?.status).toBe('abstained');
    // The distinction P5-T04 refused to collapse, and this view does not undo.
    expect(allGapRows(model)).toEqual([]);
  });

  it('carries the coverage scope on the model itself, so rows cannot be rendered without it', () => {
    const model = build(new Map(), [entry('Alpha', 1, 3)]);
    expect(model.scope.sources).toHaveLength(1);
    expect(model.scope.canStateExhaustiveness).toBe(true);
    expect(model.asOf).toBe('2026-08-16');
  });

  it('is a pure projection — the same inputs give the same model', () => {
    const presence = new Map([
      ['Alpha', { notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath], instrumentCount: 2 }],
    ]);
    const entries = [entry('Alpha', 1, 3), entry('Beta', 2, 2)];
    expect(build(presence, entries)).toEqual(build(presence, entries));
  });
});

describe('buildMaterialPresence', () => {
  function concept(name: string, sourcePaths: readonly string[]): ConceptRecord {
    return { name, tier: 2, courses: ['CRS101'], sourcePaths: sourcePaths as VaultPath[] };
  }

  it("sums instruments across every note that names the concept (ol-t3sd's many-to-many)", () => {
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md', '01 Courses/CRS101/w2.md'])],
      new Map([
        ['01 Courses/CRS101/w1.md' as VaultPath, 3],
        ['01 Courses/CRS101/w2.md' as VaultPath, 2],
      ]),
    );
    expect(presence.get('Alpha')?.instrumentCount).toBe(5);
  });

  it('counts a note the caller found no instruments in as zero, not as absent', () => {
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md'])],
      new Map(),
    );
    // Notes exist, cards do not — F4.5, and specifically NOT F4.10.
    expect(presence.get('Alpha')).toEqual({
      notePaths: ['01 Courses/CRS101/w1.md'],
      instrumentCount: 0,
    });
    expect(classifyGap(presence.get('Alpha'))).toBe('coverage-gap');
  });
});
