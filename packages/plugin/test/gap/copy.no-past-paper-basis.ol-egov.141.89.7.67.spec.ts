// `ol-egov.141.89.7.67` fix A (F4.2, `[D-529]`): a row with no past-paper basis
// (distinctSourceCount 0: ranked only on an objectives document or a brief)
// never states a past-paper count; the rest of today's sentence is kept.
//
// INV-3: every name and path below is invented.
import type { GapRow, VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  gapRowLine,
  masteryGapLine,
  masteryGapMeta,
  masteryGapNarrative,
  materialGapMeta,
  materialGapNarrative,
} from '../../src/gap/copy.js';

function row(
  gapClass: GapRow['gapClass'],
  distinctSourceCount: number,
  instrumentCount = 3,
): GapRow {
  return {
    conceptName: 'Invented Concept',
    conceptKey: 'invented-concept',
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
    targetAssessmentPath: '02 Assessments/assignment-1.md' as VaultPath,
    assessmentFormat: 'unknown',
    citations: [],
    distinctSourceCount,
    reasoning: 'Invented.',
    notePaths: [],
    instrumentCount,
    affordances: ['open-concept'],
  } as GapRow;
}

const NONE = 0;
const noCount = (s: string) => {
  expect(s).not.toMatch(/past paper/i);
  expect(s).not.toMatch(/Asked in|Appears in|asked in/);
};

describe('a row with no past-paper basis states no past-paper count (`ol-egov.141.89.7.67`)', () => {
  it('material-gap', () => {
    expect(gapRowLine(row('material-gap', NONE))).toBe("It isn't in your materials.");
    expect(materialGapMeta(row('material-gap', NONE))).toBe('Not in your materials');
    for (const s of materialGapNarrative(row('material-gap', NONE))) noCount(s);
  });

  it('coverage-gap', () => {
    expect(gapRowLine(row('coverage-gap', NONE))).toBe('You have notes on it but no cards yet.');
  });

  it('mastery-gap, estimated and unknown need', () => {
    const r = row('mastery-gap', NONE);
    expect(gapRowLine(r)).toBe("You have 3 instruments built but recall here hasn't caught up.");
    expect(masteryGapLine({ ...r, need: { basis: 'unknown' } } as GapRow)).toBe(
      'You have 3 instruments built, but Olea has no recall evidence for it yet, so this says nothing about what you know.',
    );
    expect(masteryGapMeta(r)).toBe('3 instruments');
    expect(masteryGapNarrative(r)).toEqual([
      'Your notes cover this, and 3 instruments are built from them — the material and the practice both exist.',
      "It's ranked here because recall on it is worth another pass.",
    ]);
  });

  it('a one-instrument row keeps its singular', () => {
    expect(gapRowLine(row('mastery-gap', NONE, 1))).toBe(
      "You have 1 instrument built but recall here hasn't caught up.",
    );
  });

  it('a mixed row (past paper plus objectives) keeps the past-paper count', () => {
    // distinctSourceCount counts past papers only, so the objectives add nothing to it.
    expect(gapRowLine(row('material-gap', 2))).toBe(
      "Appears in 2 past papers; it isn't in your materials.",
    );
    expect(gapRowLine(row('mastery-gap', 1))).toBe(
      "Asked in 1 past paper; you have 3 instruments built but recall here hasn't caught up.",
    );
  });

  it('a past-paper-only row is unchanged', () => {
    expect(gapRowLine(row('coverage-gap', 1))).toBe(
      'Appears in 1 past paper; you have notes on it but no cards yet.',
    );
    expect(materialGapMeta(row('material-gap', 2))).toBe(
      'Asked in 2 past papers · not in your materials',
    );
    expect(masteryGapMeta(row('mastery-gap', 2))).toBe('3 instruments · asked in 2 past papers');
  });
});
