/**
 * `ol-egov.141.89.9.70` item 1 ([D-414], `ol-egov.141.89.48`), the plugin half: the gap view's
 * wording and the vocabulary registry's section 25.
 *
 * **There is no approved wording for the demand-grain row yet.** Registry section 25 ratifies the
 * sentence's shape and leaves its copy to a design pass, so every state of the reading is data-only
 * on the gap view today: a material gap at each verdict, each of the two unresolved causes, and a
 * re-check that could not run for each of its five reasons. This file pins three things:
 *
 *  1. every string the gap copy produces for a row is byte-identical whether or not the row carries
 *     any of those readings (a state with no approved wording shows nothing);
 *  2. no gap-view or grove source file reads the reading, and no wording for it exists in either
 *     copy module;
 *  3. the moment wording for it does appear in a copy module, the exports test below goes red, and
 *     its message says what to do: get the wording approved, then add a test that runs every
 *     string it can return through the registry's section 25 check (`olea-core`'s
 *     `gap/demand-gap-sentence-check.ts`, `demandGapSentenceViolations`), so unapproved wording
 *     cannot land quietly.
 *
 * Every string here is invented (INV-3).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GapRow, VaultPath } from 'olea-core';
import { type DemandGapReading, RECHECK_NOT_RUN_REASONS } from 'olea-core/src/gap/demand-gap.js';
import { describe, expect, it } from 'vitest';
import * as gapCopy from '../../src/gap/copy.js';
import * as groveCopy from '../../src/grove/copy.js';

function row(overrides: Partial<GapRow> = {}): GapRow {
  const citation = {
    sourcePath: '03 Research/paper-2024.pdf' as VaultPath,
    questionLabel: 'Q1',
    questionText: 'A question.',
    provenance: { location: { page: 1, charRange: { start: 0, end: 4 } } },
  } as GapRow['citations'][number];
  return {
    conceptName: 'Alpha',
    conceptKey: 'Alpha',
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
    targetAssessmentPath: '02 Assessments/final.md' as VaultPath,
    assessmentFormat: 'unknown',
    citations: [citation],
    distinctSourceCount: 2,
    reasoning: 'Cited in two past papers.',
    notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath],
    instrumentCount: 2,
    affordances: ['open-concept', 'build-session'],
    ...overrides,
  };
}

/** Every state the reading can be in: each verdict with and without a re-check that could not run, and each unresolved cause. */
function everyReading(): readonly DemandGapReading[] {
  const readings: DemandGapReading[] = [];
  for (const verdict of ['partial', 'insufficient', 'conflicting'] as const) {
    readings.push({
      kind: 'material-gap',
      demand: 'calculate',
      verdict,
      evidenceFingerprint: 'fp-1',
    });
    for (const reason of RECHECK_NOT_RUN_REASONS) {
      readings.push({
        kind: 'material-gap',
        demand: 'apply-to-unfamiliar-case',
        verdict,
        evidenceFingerprint: 'fp-1',
        recheck: { reason },
      });
    }
  }
  readings.push({ kind: 'unresolved', cause: 'assessment-scope-unknown' });
  readings.push({ kind: 'unresolved', cause: 'operation-unsupported' });
  return readings;
}

const CLASSES = [
  {},
  { gapClass: 'coverage-gap', instrumentCount: 0 },
  { gapClass: 'material-gap', notePaths: [], instrumentCount: 0, affordances: ['find-source'] },
] as const satisfies readonly Partial<GapRow>[];

/** Everything the row-level copy functions write for `target`, in one comparable value. */
function wordingFor(target: GapRow): string {
  return JSON.stringify([
    gapCopy.gapRowLine(target),
    gapCopy.masteryGapLine(target),
    gapCopy.masteryGapMeta(target),
    gapCopy.materialGapMeta(target),
    gapCopy.masteryGapNarrative(target),
    gapCopy.materialGapNarrative(target),
    gapCopy.readinessNote(target),
    gapCopy.pastPaperChips(target),
    gapCopy.rankingAttribution([target]),
    gapCopy.syllabusCounterweightSentence('Course', [target]),
    gapCopy.syllabusCounterweightBreakdown([target]),
    gapCopy.affordanceLabel(target.affordances[0] ?? 'open-concept'),
  ]);
}

describe('a state with no approved wording shows nothing: the gap view copy ignores every reading', () => {
  it('covers every reading (a single-state test would pass while another state leaked)', () => {
    const readings = everyReading();
    // 3 verdicts x (1 without + 5 reasons) + 2 unresolved causes.
    expect(readings).toHaveLength(3 * (1 + RECHECK_NOT_RUN_REASONS.length) + 2);
    expect(new Set(readings.map((reading) => JSON.stringify(reading))).size).toBe(readings.length);
  });

  it.each(CLASSES)(
    'every string written for a %o row is identical with and without any reading',
    (overrides) => {
      const plain = wordingFor(row({ ...overrides }));
      for (const reading of everyReading()) {
        expect(wordingFor(row({ ...overrides, demandGap: reading })), JSON.stringify(reading)).toBe(
          plain,
        );
      }
    },
  );

  it('no reading, verdict or reason name ever appears in the words written for a row that carries it', () => {
    for (const reading of everyReading()) {
      const written = wordingFor(row({ demandGap: reading }));
      for (const internal of [
        'material-gap',
        'unresolved',
        'threshold-blocked',
        'retrieval-failed',
        'demand-not-askable',
        'assessment-scope-unknown',
        'operation-unsupported',
      ]) {
        expect(written, internal).not.toContain(internal);
      }
    }
  });
});

describe('nothing on the gap view or the grove reads the reading, and no wording for it exists', () => {
  const codeOf = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each([
    '../../src/gap/copy.ts',
    '../../src/gap/view.ts',
    '../../src/gap/provider.ts',
    '../../src/grove/copy.ts',
    '../../src/grove/view.ts',
  ])('%s never names the reading, its map or its type', (path) => {
    expect(codeOf(path)).not.toMatch(
      /demandGaps?\b|DemandGapReading|readDemandGap|SufficiencyRecord/,
    );
  });

  it('neither copy module exports a name that is wording for the demand-grain row', () => {
    const wordingNames = [...Object.keys(gapCopy), ...Object.keys(groveCopy)].filter((name) =>
      /demand.?gap|sufficien|material.?demand|unmet.?demand|asked.?demand/i.test(name),
    );
    // If this fails, wording for the row now exists. Get it approved first (registry section 25),
    // then add a test that runs every string it can return through `demandGapSentenceViolations`
    // on its surface ('gap-view' or 'grove') and expects no violation, and update this list.
    expect(wordingNames).toEqual([]);
  });
});
