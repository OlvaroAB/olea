// test/fixture-oracle-history.spec.ts — `ol-0v9n`: the fixture-vault oracle's
// mastery must come from the fixture vault's OWN review history, keyed to its
// real concept ids, not from a borrowed synthetic-persona stream landing on
// whichever instrument a positional ring-join happened to reach. Before this
// bead, every ranked row read `seed` ("new") regardless of what
// `FIXTURE_ORACLE_HISTORY` said, because the borrowed stream's `conceptIds`
// never matched a ranked concept's real key. This file is the regression: it
// asserts the mastery spread `fixture-oracle-history.ts`'s own module doc
// claims is the spread the product actually renders.

import { fileURLToPath } from 'node:url';
import type { MasteryState } from 'olea-contracts';
import { FolderSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildFixtureOracle } from '../src/oracle/fixture-oracle.js';

const vault = new FolderSource(
  fileURLToPath(new URL('../../core/fixtures/vault', import.meta.url)),
);

describe('buildFixtureOracle — real mastery over the fixture vault’s own history (ol-0v9n)', () => {
  it('renders a varied mastery spread, not a uniform "seed"', async () => {
    const result = await buildFixtureOracle(vault);
    const rows = result.gap.courses.flatMap((c) => (c.status === 'ranked' ? c.rows : []));
    const byName = new Map(rows.map((r) => [r.conceptName, r.masteryState]));

    const expected: Record<string, MasteryState> = {
      // Highest raw yield (`factors.preMasteryScore`), and solid — the "not
      // uniformly bad news" half of ol-0v9n's spread. See
      // `oracle/fixture-oracle-history.ts`'s module doc for why this
      // legitimately does NOT mean this concept displays at rank 1: mastery
      // correctly discounts a concept she already knows.
      Imbrication: 'tree',
      // Genuinely untouched — a real "new", not a fabricated one.
      'Hummocky stratification': 'seed',
      // Recognition-only (MCQ) practice, capped below `tree` by C5.4's own rule.
      Bioturbation: 'sapling',
      // Lowest raw yield, ten attempts, still weak on the recent window — the
      // effort-imbalance half of ol-0v9n's spread.
      Paraconformity: 'sprout',
    };

    for (const [conceptName, masteryState] of Object.entries(expected)) {
      expect(byName.get(conceptName), `mastery for ${conceptName}`).toBe(masteryState);
    }

    // The measurement ol-0v9n's fix is FOR: not every row collapses to one
    // state, which is what the borrowed-stream bug produced.
    expect(new Set(rows.map((r) => r.masteryState)).size).toBeGreaterThan(1);
  });
});
