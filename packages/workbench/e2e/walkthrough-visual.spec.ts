/**
 * `@auto-web` — WBF-4 (`ol-opjq`)'s stated acceptance bar: "a golden PNG
 * exists for each of the twelve walkthrough steps and the suite fails on a
 * visual change; a check asserts no string beginning syn: reaches rendered
 * text."
 *
 * Before this file, golden screenshots existed for the review and today
 * surfaces only (`visual-regression.spec.ts`) — which happen to back
 * walkthrough steps 3, 4 and 5. The product owner's click-through flagged
 * steps 2, 6, 7, 8, 9, 10, 11 and 12; those are exactly the steps with no
 * visual coverage, and the three he did NOT flag are exactly the three that
 * had it. Every defect found that round (a raw synthetic id rendered as a
 * concept name, a false read-failure banner, two steps rendering
 * byte-identical output) was invisible to a fully green functional suite,
 * because none of it was a behaviour any test asserted — only a rendered
 * diff catches this class of thing.
 *
 * SCOPE: all twelve walkthrough steps, ONE variable set
 * (`obsidian-dark`, walk mode's own default — see `walkthrough.spec.ts`'s
 * `gotoWalkStep`). Unlike `visual-regression.spec.ts`'s per-surface matrix,
 * walk mode does not expose a `set=` picker in its own nav chrome, and the
 * twelve steps are a fixed narrative rather than an independent state axis —
 * theming them six ways each would be testing the six flat variable sets a
 * second time over content those sets already golden separately, not the
 * walkthrough itself.
 *
 * TARGET: `[data-wb-surface]`, same as `visual-regression.spec.ts` — the
 * product's own pixels, not the walkthrough's title/copy/nav chrome around
 * it. The walkthrough copy IS covered, functionally, by `walkthrough.ts`'s
 * own unit tests (title/copy per step come from static data, not render
 * logic); what a rendered diff catches here is the same class of defect the
 * flat-surface goldens catch — geometry, real content, real citations.
 *
 * TALL STEPS: 7, 8, 10, 11 and 12 need more pane than walk mode's default
 * (~448px at the shared 1280x900 viewport) offers — `helpers.ts`'s
 * `WALK_STEP_VIEWPORTS` has the measured numbers and the argument for
 * per-step overrides here rather than a shared config change.
 * `pane-fit.spec.ts`'s walk-step loop applies the identical override before
 * measuring, so its pass is a real guarantee about what this file is about
 * to capture — steps 1-6 and 9 use no override and fit unaided.
 *
 * WHY STEP 1 GETS NO SYNTHETIC-ID CHECK BEYOND THIS FILE'S GENERAL ONE: step
 * 1 ('note') renders her fixture note's own markdown verbatim — there is no
 * synthetic id path to leak one through. Steps 10 and 12 already had a
 * narrower, named regression test for this exact defect in
 * `walkthrough.spec.ts` (WBF-1, `ol-mxw3`); the loop below is the general
 * form the acceptance criterion actually asks for, run across all twelve.
 *
 * REGENERATING: `pnpm exec playwright test --update-snapshots=all`, same as
 * `visual-regression.spec.ts` — NOT `pnpm run e2e -- --update-snapshots`.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoWalkStep, hostFrameElement, WALK_STEP_VIEWPORTS } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

const STEP_COUNT = 12;

for (let n = 1; n <= STEP_COUNT; n++) {
  test(`walk step ${String(n)} golden`, async ({ page }) => {
    const override = WALK_STEP_VIEWPORTS[n];
    if (override !== undefined) {
      await page.setViewportSize(override);
    }
    await gotoWalkStep(page, n);
    await expect(hostFrameElement(page)).toHaveScreenshot(`walk-${String(n).padStart(2, '0')}.png`);
  });
}

test.describe('no synthetic id reaches rendered text, on any walkthrough step', () => {
  for (let n = 1; n <= STEP_COUNT; n++) {
    test(`walk step ${String(n)}: no "syn:" leak`, async ({ page }) => {
      const override = WALK_STEP_VIEWPORTS[n];
      if (override !== undefined) {
        await page.setViewportSize(override);
      }
      await gotoWalkStep(page, n);
      const text = await frame(page).locator('body').innerText();
      expect(text).not.toMatch(/\bsyn:/);
    });
  }
});
