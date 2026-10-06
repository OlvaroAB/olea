// `ol-egov.141.89.7.81` (`[D-538]`, F4.2, F4.10, `[D-529]`): each gap row names every basis its
// ranking rests on, and no other, in the signed words: past papers counted ("Appears in" / "Asked
// in"), "its course objectives name it" only for an explicit name match, a link Olea's reading
// inferred worded as Olea's reading, "its assessments point to it" for an assessment note's own
// scope (never "brief"), and "supporting material not found" in place of an absence claim.
// Scenarios: olea-service `features/F4-oracle.md`, tagged
// `@auto:plugin/test/gap/copy.row-basis.ol-egov.141.89.7.81.spec`.
//
// INV-3: every course code, concept name and path below is invented.
import type { GapRow, VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE,
  changedPassageGapLine,
  gapRowBasisKey,
  gapRowLine,
  MATERIAL_GAP_HEADING,
  masteryGapLine,
  masteryGapMeta,
  masteryGapNarrative,
  materialGapHeading,
  materialGapMeta,
  materialGapNarrative,
  rankingAttribution,
  syllabusCounterweightBreakdown,
} from '../../src/gap/copy.js';

type Basis = NonNullable<GapRow['basis']>;

const ASSIGNMENT = '02 Assessments/Assignment 2.md' as VaultPath;
const TEST = '02 Assessments/Test 1.md' as VaultPath;
const PAPER = '03 Research/paper-2024.pdf' as VaultPath;

/** The four bases a row can rest on, as the core build carries them. */
const PAPERS = 3;
const OBJ: Basis = { objectives: 'named', assessmentPaths: [] };
const INFERRED: Basis = { objectives: 'inferred', assessmentPaths: [] };
const ASSESS: Basis = { objectives: null, assessmentPaths: [ASSIGNMENT] };
const OBJ_ASSESS: Basis = { objectives: 'named', assessmentPaths: [ASSIGNMENT, TEST] };
const NO_OTHER: Basis = { objectives: null, assessmentPaths: [] };

function row(
  gapClass: GapRow['gapClass'],
  distinctSourceCount: number,
  basis: Basis | undefined,
  extra: Partial<GapRow> = {},
): GapRow {
  return {
    conceptName: 'Invented Concept',
    conceptKey: `invented-${gapClass}-${distinctSourceCount}-${JSON.stringify(basis)}`,
    course: 'CRS101',
    gapClass,
    rank: 1,
    oracleRank: 1,
    priorityScore: 1,
    gapScore: 1,
    readiness: {
      assessmentFormat: 'unknown',
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'sprout',
    targetAssessmentPath: ASSIGNMENT,
    assessmentFormat: 'unknown',
    citations:
      distinctSourceCount === 0
        ? []
        : [
            {
              sourcePath: PAPER,
              questionLabel: 'Q1',
              questionText: 'An invented question.',
              provenance: { location: { page: 1, charRange: { start: 0, end: 4 } } },
            } as GapRow['citations'][number],
          ],
    distinctSourceCount,
    reasoning: 'Invented.',
    notePaths: gapClass === 'material-gap' ? [] : ['05 Zettelkasten/Invented.md' as VaultPath],
    instrumentCount: gapClass === 'mastery-gap' ? 4 : 0,
    affordances: ['open-concept'],
    ...(basis !== undefined ? { basis } : {}),
    ...extra,
  } as GapRow;
}

const unknownNeed = { need: { basis: 'unknown' } } as unknown as Partial<GapRow>;

/** Every sentence a row of this basis puts in front of her, across the three classes. */
function everyLine(papers: number, basis: Basis): string[] {
  const material = row('material-gap', papers, basis);
  const coverage = row('coverage-gap', papers, basis);
  const mastery = row('mastery-gap', papers, basis);
  const unknown = row('mastery-gap', papers, basis, unknownNeed);
  return [
    gapRowLine(material),
    gapRowLine(coverage),
    gapRowLine(mastery),
    masteryGapLine(unknown),
    changedPassageGapLine(mastery),
    materialGapMeta(material),
    masteryGapMeta(mastery),
    ...materialGapNarrative(material),
    ...masteryGapNarrative(mastery),
    ...masteryGapNarrative(unknown),
    materialGapHeading([material]),
  ];
}

describe('the material-gap row line names each basis, and what Olea did not find', () => {
  it('past papers only: the count, then the not-found clause', () => {
    expect(gapRowLine(row('material-gap', PAPERS, NO_OTHER))).toBe(
      "Appears in 3 past papers; Olea hasn't found supporting material for it.",
    );
  });
  it('objectives only', () => {
    expect(gapRowLine(row('material-gap', 0, OBJ))).toBe(
      "Its course objectives name it; Olea hasn't found supporting material for it.",
    );
  });
  it('assessments only', () => {
    expect(gapRowLine(row('material-gap', 0, ASSESS))).toBe(
      "Its assessments point to it; Olea hasn't found supporting material for it.",
    );
  });
  it('objectives and assessments', () => {
    expect(gapRowLine(row('material-gap', 0, OBJ_ASSESS))).toBe(
      "Its course objectives name it, and its assessments point to it; Olea hasn't found supporting material for it.",
    );
  });
  it('past papers and objectives', () => {
    expect(gapRowLine(row('material-gap', PAPERS, OBJ))).toBe(
      "Appears in 3 past papers, and its course objectives name it; Olea hasn't found supporting material for it.",
    );
  });
  it('all three', () => {
    expect(gapRowLine(row('material-gap', PAPERS, OBJ_ASSESS))).toBe(
      "Appears in 3 past papers, its course objectives name it, and its assessments point to it; Olea hasn't found supporting material for it.",
    );
  });
  it('a row with no basis carried and no past paper keeps only the not-found sentence', () => {
    expect(gapRowLine(row('material-gap', 0, undefined))).toBe(
      "Olea hasn't found supporting material for it.",
    );
  });
});

describe('the coverage-gap row line names each basis', () => {
  it('objectives only', () => {
    expect(gapRowLine(row('coverage-gap', 0, OBJ))).toBe(
      'Its course objectives name it; you have notes on it but no cards yet.',
    );
  });
  it('past papers and assessments', () => {
    expect(gapRowLine(row('coverage-gap', PAPERS, ASSESS))).toBe(
      'Appears in 3 past papers, and its assessments point to it; you have notes on it but no cards yet.',
    );
  });
  it('past papers only is unchanged', () => {
    expect(gapRowLine(row('coverage-gap', 1, NO_OTHER))).toBe(
      'Appears in 1 past paper; you have notes on it but no cards yet.',
    );
  });
});

describe('the mastery-gap row line names each basis; the unknown-need sentences keep their tails', () => {
  it('past papers and objectives', () => {
    expect(gapRowLine(row('mastery-gap', PAPERS, OBJ))).toBe(
      "Asked in 3 past papers, and its course objectives name it; you have 4 instruments built but recall here hasn't caught up.",
    );
  });
  it('assessments only', () => {
    expect(gapRowLine(row('mastery-gap', 0, ASSESS))).toBe(
      "Its assessments point to it; you have 4 instruments built but recall here hasn't caught up.",
    );
  });
  it('unknown need, objectives only: the lead takes the basis, the signed tail is unchanged', () => {
    expect(masteryGapLine(row('mastery-gap', 0, OBJ, unknownNeed))).toBe(
      'Its course objectives name it; you have 4 instruments built, but Olea has no recall evidence for it yet, so this says nothing about what you know.',
    );
  });
  it('the changed-passage sentence takes the same lead', () => {
    expect(changedPassageGapLine(row('mastery-gap', PAPERS, ASSESS))).toBe(
      "Asked in 3 past papers, and its assessments point to it; you have 4 instruments built, but the material behind your earlier answers has changed, so they don't count until it's checked again.",
    );
  });
});

describe('a link Olea inferred never reads as the objectives naming it ([D-432])', () => {
  it('row lines and header lines word it as Olea’s reading', () => {
    expect(gapRowLine(row('material-gap', 0, INFERRED))).toBe(
      "Olea's reading places it under its course objectives; Olea hasn't found supporting material for it.",
    );
    expect(gapRowLine(row('coverage-gap', PAPERS, INFERRED))).toBe(
      "Appears in 3 past papers, and Olea's reading places it under its course objectives; you have notes on it but no cards yet.",
    );
    expect(materialGapMeta(row('material-gap', 0, INFERRED))).toBe(
      "Placed under your course objectives by Olea's reading · supporting material not found",
    );
    expect(masteryGapMeta(row('mastery-gap', 0, INFERRED))).toBe(
      "4 instruments · placed under your course objectives by Olea's reading",
    );
  });
  it('nothing it produces says the objectives name it, or "covered"', () => {
    for (const line of everyLine(PAPERS, INFERRED)) {
      expect(line).not.toMatch(/objectives name it|named by your course objectives|cover(ed)? by/i);
    }
  });
});

describe("the detail page's header lines name each basis", () => {
  it('material gap: objectives only, all three, past papers only, nothing carried', () => {
    expect(materialGapMeta(row('material-gap', 0, OBJ))).toBe(
      'Named by your course objectives · supporting material not found',
    );
    expect(materialGapMeta(row('material-gap', PAPERS, OBJ_ASSESS))).toBe(
      'Asked in 3 past papers · named by your course objectives · pointed to by your assessments · supporting material not found',
    );
    expect(materialGapMeta(row('material-gap', 2, NO_OTHER))).toBe(
      'Asked in 2 past papers · supporting material not found',
    );
    expect(materialGapMeta(row('material-gap', 0, undefined))).toBe(
      'Supporting material not found',
    );
  });
  it('mastery gap: instruments first, then each basis', () => {
    expect(masteryGapMeta(row('mastery-gap', PAPERS, ASSESS))).toBe(
      '4 instruments · asked in 3 past papers · pointed to by your assessments',
    );
    expect(masteryGapMeta(row('mastery-gap', 0, OBJ))).toBe(
      '4 instruments · named by your course objectives',
    );
    expect(masteryGapMeta(row('mastery-gap', PAPERS, NO_OTHER))).toBe(
      '4 instruments · asked in 3 past papers',
    );
  });
});

describe('the mastery narrative names the bases; an unknown need says recall is not known yet', () => {
  it('estimated need: the bases, then recall', () => {
    expect(masteryGapNarrative(row('mastery-gap', 0, OBJ))[1]).toBe(
      "It's ranked here because its course objectives name it, and recall on it is worth another pass.",
    );
    expect(masteryGapNarrative(row('mastery-gap', PAPERS, OBJ_ASSESS))[1]).toBe(
      "It's ranked here because it's been asked in 3 past papers, its course objectives name it, its assessments point to it, and recall on it is worth another pass.",
    );
  });
  it('unknown need: the bases, then the registry’s ruled sentence, never "worth another pass"', () => {
    const lines = masteryGapNarrative(row('mastery-gap', 0, OBJ, unknownNeed));
    expect(lines.slice(1)).toEqual([
      "It's ranked here because its course objectives name it.",
      'How well you recall it is not known yet.',
    ]);
    expect(lines.join(' ')).not.toContain('worth another pass');
  });
  it('unknown need with no basis carried: the ruled sentence alone', () => {
    const lines = masteryGapNarrative(row('mastery-gap', 0, undefined, unknownNeed));
    expect(lines.slice(1)).toEqual(['How well you recall it is not known yet.']);
  });
});

describe('the material-gap narrative and the counterweight say what was not found', () => {
  it('the narrative opens with the row line, then never claims absence or a gap in what she knows', () => {
    const material = row('material-gap', 0, ASSESS);
    expect(materialGapNarrative(material)).toEqual([
      gapRowLine(material),
      'So Olea has nothing to build practice from yet — this says nothing about what you know.',
    ]);
  });
  it('the breakdown counts material gaps as not found', () => {
    expect(
      syllabusCounterweightBreakdown([
        row('coverage-gap', 1, NO_OTHER),
        row('material-gap', 0, OBJ),
      ]),
    ).toBe('1 with nothing built · 1 with no supporting material found');
  });
});

describe('the material-gap heading names the bases present among the material gaps it heads', () => {
  it('past papers only: the ratified frame, with what was not found', () => {
    expect(materialGapHeading([row('material-gap', PAPERS, NO_OTHER)])).toBe(
      'Named by your past papers, supporting material not found',
    );
    expect(MATERIAL_GAP_HEADING).toBe('Named by your past papers, supporting material not found');
  });
  it('objectives only names the objectives, not past papers', () => {
    expect(materialGapHeading([row('material-gap', 0, OBJ)])).toBe(
      'Named by your course objectives, supporting material not found',
    );
  });
  it('assessments only', () => {
    expect(materialGapHeading([row('material-gap', 0, ASSESS)])).toBe(
      'Pointed to by your assessments, supporting material not found',
    );
  });
  it('across rows: every basis present, once, in order', () => {
    expect(
      materialGapHeading([
        row('material-gap', 0, ASSESS),
        row('material-gap', PAPERS, NO_OTHER),
        row('material-gap', 0, OBJ),
      ]),
    ).toBe(
      'Named by your past papers and your course objectives, pointed to by your assessments, supporting material not found',
    );
  });
  it('an inferred link is named as Olea’s reading', () => {
    expect(materialGapHeading([row('material-gap', 0, INFERRED)])).toBe(
      "Placed under your course objectives by Olea's reading, supporting material not found",
    );
  });
});

describe('the signed rules hold across every row kind and basis', () => {
  const combos: readonly (readonly [number, Basis])[] = [
    [PAPERS, NO_OTHER],
    [0, OBJ],
    [0, INFERRED],
    [0, ASSESS],
    [0, OBJ_ASSESS],
    [PAPERS, OBJ],
    [PAPERS, ASSESS],
    [PAPERS, OBJ_ASSESS],
  ];
  it('never "brief", never an absence claim, and the objectives and assessments never carry a count', () => {
    for (const [papers, basis] of combos) {
      for (const line of everyLine(papers, basis)) {
        expect(line).not.toMatch(/brief/i);
        expect(line).not.toMatch(/isn't in your materials|not in your materials|missing from/i);
        expect(line).not.toMatch(/\d+ (course )?objectives|\d+ assessments/i);
        expect(line).not.toMatch(/(appears|asked) in (its|your) (course objectives|assessments)/i);
      }
    }
  });
  it('a row with no past paper never states a past-paper count', () => {
    for (const [papers, basis] of combos) {
      if (papers !== 0) continue;
      for (const line of everyLine(papers, basis)) expect(line).not.toMatch(/past paper/i);
    }
  });
});

describe('the course framing reads only surviving evidence (a vetoed assessment is never named)', () => {
  it('rows carrying their basis win over an edge map that still names a vetoed scope edge', () => {
    const rows = [row('material-gap', PAPERS, NO_OTHER)];
    const preVeto = new Map([
      [gapRowBasisKey('CRS101', rows[0]?.conceptKey ?? ''), new Set(['assessment-brief' as const])],
    ]);
    expect(rankingAttribution(rows, preVeto)).not.toContain(ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE);
  });
  it('a row carrying assessment evidence still gets the clause', () => {
    expect(rankingAttribution([row('material-gap', PAPERS, ASSESS)])).toContain(
      ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE,
    );
  });
});
