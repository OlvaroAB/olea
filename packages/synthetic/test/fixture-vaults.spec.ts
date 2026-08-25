/**
 * The extraction eval — `olea-service`'s `[FND-U3] / ol-ej59.8`.
 *
 * Every existing extraction test (`packages/core/src/concept/extract.spec.ts`)
 * runs against one shape: the fixture vault that replicates her structures.
 * That is a test the extractor passes by fitting one convention, not proof it
 * reads *any* convention. F1.3 already contracts "tolerating inconsistent
 * structures" and "do not assume one shape" — this suite is the oracle for
 * that clause: four differently-shaped vaults (`../src/fixture-vaults.ts`),
 * each read by `extractConcepts(vault)` with **no shape-telling option**,
 * scored against ground truth planted alongside each vault.
 *
 * A shape whose ground truth says `'gap'` is not a failing test — it is the
 * oracle doing its job, giving a future extraction-fix bead something
 * concrete to turn green. `packages/synthetic/README.md`'s N-015 section
 * applies here exactly as it does to a review-log stream: nothing here may
 * ever be used to tune a threshold, only to check extraction correctness
 * against a planted, known-shape truth.
 */

import { extractConcepts } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildFixtureVault,
  FIXTURE_VAULT_SHAPES,
  fixtureVaultGroundTruth,
} from '../src/fixture-vaults.js';

describe('extraction eval — differently-shaped fixture vaults', () => {
  it('covers all four shapes the acceptance criteria names', () => {
    expect([...FIXTURE_VAULT_SHAPES].sort()).toEqual(
      ['no-frontmatter', 'no-zettelkasten', 'renamed-properties', 'week-organised'].sort(),
    );
  });

  for (const shape of FIXTURE_VAULT_SHAPES) {
    describe(shape, () => {
      it('matches its planted ground truth from an unconfigured call', async () => {
        const vault = buildFixtureVault(shape);
        const truth = fixtureVaultGroundTruth(shape);

        // The load-bearing constraint: no options object at all. A caller who
        // has never seen this vault's shape calls it exactly this way.
        const concepts = await extractConcepts(vault);

        // `key` is intentionally not part of `FixtureConceptGroundTruth`
        // (`../src/fixture-vaults.ts`'s own doc: no compile-time coupling to
        // `extract.ts`'s exact shape beyond what this eval checks). It is a
        // provisional, content-derived stand-in (`ol-il6m`,
        // `olea-core`'s `concept-key.js`) with nothing for this shape-oracle
        // to assert about it yet, so it is stripped before comparison rather
        // than widening the ground truth to a value this suite does not
        // exist to check.
        //
        // `size` (`[D-066]`, `olea-core`'s `concept/size.ts`) is stripped for
        // the identical reason: this is a shape-reading oracle, not a
        // size-derivation one — `concept/size.spec.ts` in `olea-core` is
        // where the derivation itself is tested and mutation-checked.
        const withoutKey = concepts.map(({ key: _key, size: _size, ...rest }) => rest);
        expect(withoutKey).toEqual(truth.expectedConcepts);
      });

      it('never throws on a second, tier-3-enabled pass either', async () => {
        const vault = buildFixtureVault(shape);
        await expect(extractConcepts(vault, { includeTier3: true })).resolves.toBeDefined();
      });
    });
  }

  it('every shape carries an explicit verdict — nothing here is silently assumed to pass', () => {
    for (const shape of FIXTURE_VAULT_SHAPES) {
      const truth = fixtureVaultGroundTruth(shape);
      expect(['convention-independent', 'gap']).toContain(truth.verdict);
      expect(truth.explanation.length).toBeGreaterThan(0);
    }
  });

  it("the two 'gap' shapes are the two the acceptance criteria's own gap analysis predicted", () => {
    const gaps = FIXTURE_VAULT_SHAPES.filter(
      (shape) => fixtureVaultGroundTruth(shape).verdict === 'gap',
    ).sort();
    expect(gaps).toEqual(['no-frontmatter', 'renamed-properties']);
  });
});
