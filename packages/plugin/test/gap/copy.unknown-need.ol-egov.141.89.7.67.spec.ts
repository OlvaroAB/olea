// `ol-egov.141.89.7.67` (F4.2, `[D-529]`, sheet v50 "Unknown-need copy"): the two signed
// sentences for a row whose recall reading is unknown. INV-3: all names invented.
import type { GapRow, VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { changedPassageGapLine, masteryGapLine } from '../../src/gap/copy.js';

function row(distinctSourceCount: number, instrumentCount = 3, unknown = true): GapRow {
  return {
    conceptName: 'Invented Concept',
    conceptKey: 'invented-concept',
    course: 'CRS101',
    gapClass: 'mastery-gap',
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
    ...(unknown ? { need: { basis: 'unknown' } } : {}),
  } as unknown as GapRow;
}

describe('unknown-need copy', () => {
  it('never checked, with a past-paper basis', () => {
    expect(masteryGapLine(row(3))).toBe(
      'Asked in 3 past papers; you have 3 instruments built, but Olea has no recall evidence for it yet, so this says nothing about what you know.',
    );
  });
  it('never checked, no past-paper basis (lead pending [D-538])', () => {
    expect(masteryGapLine(row(0))).toBe(
      'You have 3 instruments built, but Olea has no recall evidence for it yet, so this says nothing about what you know.',
    );
  });
  it('passage changed, with and without a past-paper basis', () => {
    expect(changedPassageGapLine(row(3, 3, false))).toBe(
      "Asked in 3 past papers; you have 3 instruments built, but the material behind your earlier answers has changed, so they don't count until it's checked again.",
    );
    expect(changedPassageGapLine(row(0, 1, false))).toBe(
      "You have 1 instrument built, but the material behind your earlier answers has changed, so they don't count until it's checked again.",
    );
  });
  it('the changed-passage line never claims attainment is lost', () => {
    expect(changedPassageGapLine(row(3))).not.toMatch(/lost|reset|forgot|erased/i);
  });
});
