// test/fixture-oracle.spec.ts — the fixture-vault oracle's own gap classes
// (`ol-akla` [WBF-3], `ol-m3ty`), and a measurement this file exists because
// nothing asserted before: does the real fixture vault actually produce all
// three gap classes step 8's copy ("she's shaky on it / notes but no cards /
// not in her materials at all") claims?
//
// It used to not: every ranked row was `coverage-gap`, because no concept
// the oracle ranks had a single card AND every ranked concept's material
// presence resolved cleanly (`ol-akla`'s own measurement, kept in git
// history rather than restated here). `buildFixtureOracle` now reads through
// `withGapClassExtension` (`../src/oracle/fixture-oracle-vault.js`) — see
// that module's doc for exactly what it adds and why it lives in the
// workbench rather than in `packages/core/fixtures/vault/` (core's own
// frozen regression target, outside this bead's `owns`). The classification
// itself is still `packages/core/src/gap/build.ts`'s unmodified
// `classifyGap`, run over genuinely different vault bytes — this test is
// the bug's own measurement, flipped into the regression it should have
// been from the start.

import { fileURLToPath } from 'node:url';
import { FolderSource, type GapClass } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildFixtureOracle } from '../src/oracle/fixture-oracle.js';
import {
  FIXTURE_ORACLE_COVERAGE_NOTE,
  FIXTURE_ORACLE_RANKING_NOTE,
  fixtureOracleFocus,
  fixtureOracleFocusNote,
} from '../src/oracle/fixture-oracle-focus.js';

const vault = new FolderSource(
  fileURLToPath(new URL('../../core/fixtures/vault', import.meta.url)),
);

describe('fixtureOracleFocus (WBF-3)', () => {
  it("maps step 7's stateId to the ranking and step 8's to the coverage section", () => {
    expect(fixtureOracleFocus('oracle-ranked')).toBe('ranking');
    expect(fixtureOracleFocus('gap-coverage')).toBe('coverage');
  });

  it('throws on an unknown state id, same discipline as every other surface', () => {
    expect(() => fixtureOracleFocus('not-a-real-id')).toThrow();
  });

  it('the two foci get two different, non-empty captions', () => {
    const rankingNote = fixtureOracleFocusNote('ranking');
    const coverageNote = fixtureOracleFocusNote('coverage');
    expect(rankingNote).toBe(FIXTURE_ORACLE_RANKING_NOTE);
    expect(coverageNote).toBe(FIXTURE_ORACLE_COVERAGE_NOTE);
    expect(rankingNote).not.toBe(coverageNote);
    expect(rankingNote.length).toBeGreaterThan(0);
    expect(coverageNote.length).toBeGreaterThan(0);
  });
});

describe('buildFixtureOracle over the real fixture vault — which gap classes it actually yields', () => {
  it('ol-m3ty: all three gap classes are reachable, each earned by classifyGap over real material presence', async () => {
    const result = await buildFixtureOracle(vault);

    const rowsByClass = new Map<GapClass, string[]>();
    let rankedRowCount = 0;
    for (const course of result.gap.courses) {
      if (course.status !== 'ranked') continue;
      for (const row of course.rows) {
        rankedRowCount += 1;
        const names = rowsByClass.get(row.gapClass) ?? [];
        names.push(row.conceptName);
        rowsByClass.set(row.gapClass, names);
      }
    }

    // A real walk, not a stub — GEOL204 ranks with rows.
    expect(rankedRowCount).toBeGreaterThan(0);

    // The measurement this suite exists for (`ol-m3ty`). All three classes
    // step 8's copy names must actually be present — not a superset, not a
    // subset. If this ever goes false, either the extension
    // (`fixture-oracle-vault.ts`) or the classifier it runs over has
    // regressed.
    const classesSeen = new Set(rowsByClass.keys());
    expect(classesSeen).toEqual(new Set<GapClass>(['coverage-gap', 'mastery-gap', 'material-gap']));

    // `'mastery-gap'` (F4.3): her material names it, cards exist. The
    // extension gives "Imbrication" a real, topic-bound instrument.
    expect(rowsByClass.get('mastery-gap')).toContain('Imbrication');
    const imbrication = result.gap.courses
      .flatMap((c) => (c.status === 'ranked' ? c.rows : []))
      .find((row) => row.conceptName === 'Imbrication');
    expect(imbrication?.notePaths.length).toBeGreaterThan(0);
    expect(imbrication?.instrumentCount).toBeGreaterThan(0);

    // `'material-gap'` (F4.10): the assessment evidence names it, her
    // material does not — genuinely, via `ol-lzwe`'s ambiguous-title
    // mechanism, not a hardcoded label. `classifyGap` reaches this class
    // exactly when the concept has no entry in `materialPresence` at all.
    expect(rowsByClass.get('material-gap')).toContain('Hummocky stratification');
    const hummocky = result.gap.courses
      .flatMap((c) => (c.status === 'ranked' ? c.rows : []))
      .find((row) => row.conceptName === 'Hummocky stratification');
    expect(hummocky?.notePaths).toEqual([]);
    expect(hummocky?.instrumentCount).toBe(0);
    // The real key never resolved — a real `ConceptRecord.key` always
    // carries the `concept-prov1:` provisional-key prefix
    // (`oracle/compose.ts`'s `resolveCaseInsensitiveConceptKeys` doc).
    expect(hummocky?.conceptKey).toBe('Hummocky stratification');

    // `'coverage-gap'` (F4.5): her material names it, no instrument exists
    // yet. Bioturbation and Paraconformity are untouched by the extension
    // and keep their original classification.
    expect(rowsByClass.get('coverage-gap')).toEqual(
      expect.arrayContaining(['Bioturbation', 'Paraconformity']),
    );

    // F4.10's affordance rule, checked against the real row rather than
    // restated: a material-gap row never carries `draft-cards`.
    expect(hummocky?.affordances).toEqual(['find-source']);
  });
});
