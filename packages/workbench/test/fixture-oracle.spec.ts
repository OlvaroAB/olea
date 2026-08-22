// test/fixture-oracle.spec.ts — the fixture-vault oracle's own gap classes
// (`ol-akla` [WBF-3]), and a measurement this file exists because nothing
// asserted before: does the real fixture vault actually produce all three
// gap classes step 8's copy ("she's shaky on it / notes but no cards / not
// in her materials at all") claims?
//
// It does not, currently — see the second describe block below. That is a
// measured fact about `packages/core/fixtures/vault/` as it stands today,
// not a defect this bead fixes: `session-scenarios.ts`'s own module doc
// already documents the underlying cause ("no concept the oracle ranks has
// a single card") for the session surface, and this file confirms the same
// finding reaches the fixture-vault ORACLE's ranking too. Recorded here
// rather than silently patched, per the run charter: a corpus change big
// enough to manufacture a material-gap or mastery-gap row is a decision
// about the fixture vault's content, not a bug-fix reachable from this bead
// (`discovered-from` bead filed separately).

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
  it('measured: every ranked row is coverage-gap; mastery-gap and material-gap are not reachable on this vault', async () => {
    const result = await buildFixtureOracle(vault);

    const classesSeen = new Set<GapClass>();
    let rankedRowCount = 0;
    for (const course of result.gap.courses) {
      if (course.status !== 'ranked') continue;
      for (const row of course.rows) {
        rankedRowCount += 1;
        classesSeen.add(row.gapClass);
      }
    }

    // A real walk, not a stub — GEOL204 ranks with rows.
    expect(rankedRowCount).toBeGreaterThan(0);

    // The measurement this suite exists for. If this ever goes false, step
    // 8's "three kinds of gap" copy has become true of the fixture vault and
    // this test (and its `discovered-from` bead) should be revisited rather
    // than this line quietly widened.
    expect(classesSeen).toEqual(new Set<GapClass>(['coverage-gap']));

    // Spelled out for whoever reads this test next without following the
    // Set diff by eye.
    expect(classesSeen.has('mastery-gap')).toBe(false);
    expect(classesSeen.has('material-gap')).toBe(false);
  });
});
