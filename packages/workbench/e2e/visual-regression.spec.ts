/**
 * Screenshot goldens per state × variable set — WB-2's (`ol-z6x2`) stated
 * purpose, and P6-T03/Q6.1's evidence generator: Q6.1 (the accessibility and
 * quality floor) previously had the obligation to produce evidence and no
 * mechanism that produced any.
 *
 * SCOPE: all 12 review states and all 5 Today states, each across all 6
 * variable sets — 102 screenshots. Persona is deliberately held at `none`
 * (the default): the bead's acceptance criterion is "per state × variable
 * set", persona is a third, independent axis (8 personas) that would make
 * this 8x larger for a question ("does a persona's history render
 * correctly") that belongs to WB-1's own persona-history tests, not a
 * screenshot diff.
 *
 * TARGET: `[data-wb-surface]`, the host iframe element — the product's own
 * pixels and nothing else's, per the package README's "host pane is its own
 * document" section (`ol-mioe`). Screenshotting the iframe element captures
 * exactly what a reader sees rendered on the page, without the workbench's
 * own chrome (sidebar, inspector) ever entering the comparison.
 *
 * DETERMINISM: `mcq-open` / `mcq-answered-*` depend on `queue/derive.ts`
 * threading a fixed-seed `RandomSource` through `adaptReviewQueue` — see
 * `../src/deterministic-random.ts`. Without that fix (found while wiring
 * this file — see its header for how) these four states render different
 * MCQ option text on every load, which would make roughly a third of this
 * matrix flaky by construction.
 *
 * PROVENANCE, READ BEFORE TRUSTING A DIFF: the baseline PNGs this suite
 * currently ships were generated on linux/**arm64**, Chromium via
 * `@playwright/test`. GitHub Actions' `ubuntu-latest` runners are linux/x64.
 * Font hinting and sub-pixel rendering are not guaranteed identical across
 * that architecture boundary even with the same Chromium build, so a first
 * CI run may show diffs that are rendering-environment noise rather than a
 * real regression. `playwright.config.ts` sets a small `maxDiffPixelRatio`
 * tolerance for exactly this, but the honest status is: these goldens are
 * PROVISIONAL until a run on the actual CI architecture confirms or
 * regenerates them (see the regeneration command below, reviewed and
 * committed by a human). See the run report for what was and was not
 * verified.
 *
 * REGENERATING: `pnpm exec playwright test --update-snapshots=all`. NOT
 * `pnpm run e2e -- --update-snapshots`, which this docblock used to recommend
 * — the flag does not reach playwright through that script, the run reports
 * failures, and nothing is rewritten. Measured, `ol-wzar`.
 *
 * WHAT THIS SUITE CANNOT SEE: an element screenshot of a pane whose content
 * overflows it captures a scrolled view and compares clean forever after. That
 * property is checked by `pane-fit.spec.ts`, which exists because this suite
 * spent months capturing a 3304px-tall pane in an 832px window.
 */
import { expect, test } from '@playwright/test';
import {
  gotoState,
  hostFrameElement,
  REVIEW_STATES,
  TODAY_STATES,
  VARIABLE_SETS,
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

for (const stateId of REVIEW_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`review/${stateId} @ ${setId}`, async ({ page }) => {
      await gotoState(page, 'review', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`review-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of TODAY_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`today/${stateId} @ ${setId}`, async ({ page }) => {
      await gotoState(page, 'today', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`today-${stateId}--${setId}.png`);
    });
  }
}
