// `ol-egov.141.89.5.26` ([D-414]): the demand-grain reading on the gap view's row, as data.
// Every string is invented (INV-3).
//
// What is pinned: absent is not empty (a concept with no reading has no field); the reading is a
// pass-through that never moves a score, a rank, a readiness, a need, the practice-evidence
// `unmetDemands` or the affordances (G4, and B5's signal is a different signal); and no affordance
// on a row carrying it can be a draft (F4.10).

import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import { readNeed } from '../mastery/attainment.js';
import type { PaperDemand } from '../oracle/paper-types.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { allGapRows, buildGapView, type ConceptMaterialPresence } from './build.js';
import type { DemandGapReading } from './demand-gap.js';

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

const PRESENCE: ReadonlyMap<string, ConceptMaterialPresence> = new Map([
  ['Alpha', { notePaths: ['a.md' as VaultPath], instrumentCount: 3 }],
  ['Beta', { notePaths: ['b.md' as VaultPath], instrumentCount: 0 }],
  // Gamma has no note at all: a material gap in F4.10's original grain.
]);

const RANKING: RankOracleResult = {
  courses: [
    {
      course: 'CRS101',
      status: 'ranked',
      ranked: [entry('Alpha', 1, 0.9), entry('Beta', 2, 0.6), entry('Gamma', 3, 0.3)],
    },
  ],
  unattributableAssessments: [],
  asOf: '2026-08-16',
};

function rows(
  extra: {
    readonly demandGaps?: ReadonlyMap<string, DemandGapReading>;
    readonly unmetDemands?: ReadonlyMap<string, readonly PaperDemand[]>;
  } = {},
) {
  return allGapRows(
    buildGapView({
      ranking: RANKING,
      assessments: ASSESSMENTS,
      materialPresence: PRESENCE,
      sourceCoverage: COVERAGE,
      need: new Map([
        [
          'Alpha',
          readNeed({ weakest: { instrumentId: 'i1', recallProbability: 0.4 }, instrumentsRead: 1 }),
        ],
      ]),
      ...extra,
    }),
  );
}

const GAP: DemandGapReading = {
  kind: 'material-gap',
  demand: 'calculate',
  verdict: 'insufficient',
  evidenceFingerprint: 'fp-1',
};

function byName(list: ReturnType<typeof rows>, name: string) {
  const found = list.find((row) => row.conceptName === name);
  if (found === undefined) throw new Error(`no row for ${name}`);
  return found;
}

describe('GapRow.demandGap: a data-only pass-through, absent is not empty', () => {
  it('a row carries the reading its concept has in the supplied map, verbatim', () => {
    const list = rows({ demandGaps: new Map([['Alpha', GAP]]) });
    expect(byName(list, 'Alpha').demandGap).toEqual(GAP);
  });

  it('a concept missing from a supplied map has no demandGap field at all, never an empty value', () => {
    const list = rows({ demandGaps: new Map([['Alpha', GAP]]) });
    expect(byName(list, 'Beta')).not.toHaveProperty('demandGap');
    expect(byName(list, 'Gamma')).not.toHaveProperty('demandGap');
  });

  it('with no map at all no row has the field (today, in production)', () => {
    for (const row of rows()) expect(row).not.toHaveProperty('demandGap');
  });

  it('an unresolved reading passes through as its own kind, beside no verdict', () => {
    const unresolved: DemandGapReading = { kind: 'unresolved', cause: 'assessment-scope-unknown' };
    const list = rows({ demandGaps: new Map([['Beta', unresolved]]) });
    expect(byName(list, 'Beta').demandGap).toEqual(unresolved);
  });
});

describe('the reading moves nothing else on the row (G4)', () => {
  const baseline = rows();
  const withReadings = rows({
    demandGaps: new Map<string, DemandGapReading>([
      ['Alpha', GAP],
      ['Beta', { kind: 'unresolved', cause: 'operation-unsupported' }],
      ['Gamma', { ...GAP, verdict: 'partial', recheck: { reason: 'threshold-blocked' } }],
    ]),
  });

  it('every other field of every row is identical with and without the reading', () => {
    expect(withReadings).toHaveLength(baseline.length);
    for (const row of withReadings) {
      const { demandGap: _ignored, ...rest } = row;
      const before = byName(baseline, row.conceptName);
      expect(rest).toEqual(before);
    }
  });

  it('gapScore, rank, readiness and need are exactly as they were', () => {
    for (const row of withReadings) {
      const before = byName(baseline, row.conceptName);
      expect(row.gapScore).toBe(before.gapScore);
      expect(row.rank).toBe(before.rank);
      expect(row.readiness).toEqual(before.readiness);
      expect(row.need).toEqual(before.need);
      expect(row.masteryState).toBe(before.masteryState);
    }
  });

  it('the practice-evidence unmetDemands is a different signal: neither derives from the other', () => {
    // Unmet practice demands with no cached verdict give no demandGap...
    const unmetOnly = rows({ unmetDemands: new Map([['Alpha', ['calculate'] as const]]) });
    expect(byName(unmetOnly, 'Alpha').unmetDemands).toEqual(['calculate']);
    expect(byName(unmetOnly, 'Alpha')).not.toHaveProperty('demandGap');
    // ...and a demandGap with no read demands gives no unmetDemands.
    const gapOnly = rows({ demandGaps: new Map([['Alpha', GAP]]) });
    expect(byName(gapOnly, 'Alpha').demandGap).toEqual(GAP);
    expect(byName(gapOnly, 'Alpha')).not.toHaveProperty('unmetDemands');
    // Both together, each kept its own.
    const both = rows({
      demandGaps: new Map([['Alpha', GAP]]),
      unmetDemands: new Map([['Alpha', ['calculate'] as const]]),
    });
    expect(byName(both, 'Alpha').demandGap).toEqual(GAP);
    expect(byName(both, 'Alpha').unmetDemands).toEqual(['calculate']);
  });

  it('unmetDemands still withholds the recognition credit exactly as before, whether or not a reading is present', () => {
    const unmet = new Map([['Alpha', ['calculate'] as const]]);
    const without = byName(rows({ unmetDemands: unmet }), 'Alpha');
    const withGap = byName(
      rows({ unmetDemands: unmet, demandGaps: new Map([['Alpha', GAP]]) }),
      'Alpha',
    );
    expect(withGap.readiness).toEqual(without.readiness);
    expect(withGap.gapScore).toBe(without.gapScore);
  });

  it('the affordances are the class own affordances: a row carrying the reading gains none, and never a draft', () => {
    for (const row of withReadings) {
      const before = byName(baseline, row.conceptName);
      expect(row.affordances).toEqual(before.affordances);
      expect(row.affordances.some((affordance) => /draft/i.test(affordance))).toBe(false);
    }
  });
});
