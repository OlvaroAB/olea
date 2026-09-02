import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import { provisionalConceptKey } from '../concept/concept-key.js';
import type { ConceptSize } from '../concept/size.js';
import type { ConceptRecord } from '../concept/types.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  affordancesFor,
  allGapRows,
  buildGapView,
  buildMaterialPresence,
  type ConceptMaterialPresence,
  classifyGap,
  type GapAffordance,
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
    // `ol-63e1`: this suite is about gap classification, not the name/key
    // distinction, so `conceptKey` deliberately mirrors `conceptName` here —
    // it matches the literal string keys the `materialPresence` maps below
    // use ('Alpha', 'Beta', ...). `buildMaterialPresence`'s own describe
    // block (below) is what tests the real opaque-key derivation.
    conceptKey: conceptName,
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
      masteryState: 'sprout',
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

describe("affordancesFor — F4.5 and F4.10's rules, enforced by construction", () => {
  it('offers open-concept and build-session on a coverage gap, and no commissioning affordance (F4.5, amended [D-063])', () => {
    // The draft verb is withdrawn: Olea is already drafting under [D-063]'s
    // unbounded automatic generation, so the row offers a progress reading
    // (open, or reorder her own queue) and nothing that asks her to
    // commission work that is already commissioned.
    expect(affordancesFor('coverage-gap')).toEqual(['open-concept', 'build-session']);
  });

  it('offers locate-or-open on a material gap, and nothing else (F4.10)', () => {
    expect(affordancesFor('material-gap')).toEqual(['find-source']);
  });

  it('leaves no commissioning affordance reachable from any gap class', () => {
    // Neither F4.5's withdrawn draft verb nor F4.10's rule ("not relabelled,
    // not disabled, not conditional") leaves a generate-from-nothing button
    // reachable anywhere — the GapAffordance union itself carries no such
    // member any more. Asserted across every class so a fourth class added
    // without deciding its affordances is a compile error, not a silent
    // default.
    const classes: readonly GapClass[] = ['mastery-gap', 'coverage-gap', 'material-gap'];
    const allowed: ReadonlySet<GapAffordance> = new Set<GapAffordance>([
      'open-concept',
      'build-session',
      'find-source',
    ]);
    for (const gapClass of classes) {
      for (const affordance of affordancesFor(gapClass)) {
        expect(allowed.has(affordance)).toBe(true);
      }
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
    // with nothing to generate from, and locate-or-open only (F4.10).
    expect(rows[2]?.affordances).toEqual(['find-source']);
    // Beta has notes but no cards yet — a progress reading, not a call to
    // action: open and build, never a draft verb (F4.5, amended [D-063]).
    expect(rows[1]?.affordances).toEqual(['open-concept', 'build-session']);
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
  // `ol-63e1`: keyed by `concept.key` now, not `concept.name` — every lookup
  // below goes through the same key the record itself carries, rather than
  // the display string, so this suite proves the actual (opaque) join key
  // rather than one that happens to read the same as the name.
  const ALPHA_KEY = provisionalConceptKey({ name: 'Alpha', boundNotePath: null });

  function concept(
    name: string,
    sourcePaths: readonly string[],
    size?: ConceptSize,
  ): ConceptRecord {
    return {
      key: provisionalConceptKey({ name, boundNotePath: null }),
      name,
      tier: 2,
      courses: ['CRS101'],
      sourcePaths: sourcePaths as VaultPath[],
      ...(size !== undefined ? { size } : {}),
    };
  }

  it("sums instruments across every note that names the concept (ol-t3sd's many-to-many)", () => {
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md', '01 Courses/CRS101/w2.md'])],
      new Map([
        ['01 Courses/CRS101/w1.md' as VaultPath, 3],
        ['01 Courses/CRS101/w2.md' as VaultPath, 2],
      ]),
    );
    expect(presence.get(ALPHA_KEY)?.instrumentCount).toBe(5);
  });

  it('counts a note the caller found no instruments in as zero, not as absent', () => {
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md'])],
      new Map(),
    );
    // Notes exist, cards do not — F4.5, and specifically NOT F4.10.
    expect(presence.get(ALPHA_KEY)).toEqual({
      notePaths: ['01 Courses/CRS101/w1.md'],
      instrumentCount: 0,
    });
    expect(classifyGap(presence.get(ALPHA_KEY))).toBe('coverage-gap');
  });

  it('carries ConceptRecord.size through verbatim (`[D-066]`, `ol-urvq` [SIZE-2])', () => {
    const coarse: ConceptSize = {
      band: 'coarse',
      extent: { noteCount: 3, structureCorroborated: false },
    };
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md'], coarse)],
      new Map(),
    );
    expect(presence.get(ALPHA_KEY)?.size).toEqual(coarse);
  });

  it('a concept with no size reading at all carries no size field, never an invented one', () => {
    const presence = buildMaterialPresence(
      [concept('Alpha', ['01 Courses/CRS101/w1.md'])],
      new Map(),
    );
    expect(presence.get(ALPHA_KEY)?.size).toBeUndefined();
    expect('size' in (presence.get(ALPHA_KEY) ?? {})).toBe(false);
  });
});

describe("GapRow.conceptSize — study-session's coarse/fine slot pricing seam (`ol-urvq` [SIZE-2])", () => {
  it('a ranked row carries the material presence size verbatim', () => {
    const coarse: ConceptSize = {
      band: 'coarse',
      extent: { noteCount: 4, structureCorroborated: false },
    };
    const presence = new Map<string, ConceptMaterialPresence>([
      ['Alpha', { notePaths: ['n.md' as VaultPath], instrumentCount: 1, size: coarse }],
    ]);
    const view = build(presence, [entry('Alpha', 1, 5)]);
    const [row] = allGapRows(view);
    expect(row?.conceptSize).toEqual(coarse);
  });

  it('a ranked row whose presence carries no size reading has no conceptSize field', () => {
    const presence = new Map<string, ConceptMaterialPresence>([
      ['Alpha', { notePaths: ['n.md' as VaultPath], instrumentCount: 1 }],
    ]);
    const view = build(presence, [entry('Alpha', 1, 5)]);
    const [row] = allGapRows(view);
    expect(row?.conceptSize).toBeUndefined();
  });
});
