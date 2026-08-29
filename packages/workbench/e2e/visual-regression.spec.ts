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
 * WBF-4 (`ol-opjq`) extended this file's matrix to the seven flat surfaces
 * that had zero visual coverage — oracle (9 states), retrieve (4), generate
 * (3), timeline (4), explain (2), session (6) and trends (6) — each across
 * the same 6 variable sets, 204 more screenshots for the same reason as the
 * two above: a fully green functional suite (`oracle.spec.ts`,
 * `retrieve.spec.ts`, etc.) never once looked at a pixel, and the defects
 * this round found (a raw synthetic id rendered as a concept name, a false
 * error banner) are exactly the class of thing only a rendered diff catches.
 * The twelve walkthrough STEPS themselves — including the two pseudo-surfaces
 * `note` and `oracle-fixture` that never appear in this file's state lists —
 * are covered separately, in `walkthrough-visual.spec.ts`.
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
 *
 * TALL STATES: some oracle, timeline, session and trends states need more
 * pane than the shared 1280x900 default offers — `helpers.ts`'s
 * `TALL_STATE_VIEWPORTS` has the measured numbers, keyed per STATE rather
 * than per surface (its own header has the argument: `.wb-host` stretches to
 * fill whatever viewport it is given, so overriding a whole surface for the
 * sake of its tallest state leaves every shorter state in that surface
 * captured with a wall of blank space below real content). `pane-fit.spec.ts`
 * applies the identical override before measuring, so a pane-fit pass is a
 * real guarantee about what this file is about to capture.
 */
import { expect, test } from '@playwright/test';
import {
  EXPLAIN_STATES,
  GENERATE_STATES,
  gotoState,
  hostFrameElement,
  ORACLE_STATES,
  RETRIEVE_STATES,
  REVIEW_STATES,
  RHYTHM_STATES,
  SESSION_STATES,
  TALL_STATE_VIEWPORTS,
  TIMELINE_STATES,
  TODAY_STATES,
  TRENDS_STATES,
  VARIABLE_SETS,
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

/** Applies `TALL_STATE_VIEWPORTS`'s override for this state, if it has one. */
async function applyTallViewportIfAny(
  page: import('@playwright/test').Page,
  stateId: string,
): Promise<void> {
  const override = TALL_STATE_VIEWPORTS[stateId];
  if (override !== undefined) {
    await page.setViewportSize(override);
  }
}

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

for (const stateId of ORACLE_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`oracle/${stateId} @ ${setId}`, async ({ page }) => {
      await applyTallViewportIfAny(page, stateId);
      await gotoState(page, 'oracle', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`oracle-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of RETRIEVE_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`retrieve/${stateId} @ ${setId}`, async ({ page }) => {
      await gotoState(page, 'retrieve', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`retrieve-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of GENERATE_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`generate/${stateId} @ ${setId}`, async ({ page }) => {
      await gotoState(page, 'generate', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`generate-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of TIMELINE_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`timeline/${stateId} @ ${setId}`, async ({ page }) => {
      await applyTallViewportIfAny(page, stateId);
      await gotoState(page, 'timeline', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`timeline-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of EXPLAIN_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`explain/${stateId} @ ${setId}`, async ({ page }) => {
      await gotoState(page, 'explain', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`explain-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of SESSION_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`session/${stateId} @ ${setId}`, async ({ page }) => {
      await applyTallViewportIfAny(page, stateId);
      await gotoState(page, 'session', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`session-${stateId}--${setId}.png`);
    });
  }
}

for (const stateId of TRENDS_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`trends/${stateId} @ ${setId}`, async ({ page }) => {
      await applyTallViewportIfAny(page, stateId);
      await gotoState(page, 'trends', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`trends-${stateId}--${setId}.png`);
    });
  }
}

// RHY-3's multicourse composition (`ol-i0zw`) — 2 states across the same 6
// variable sets, 12 more screenshots. No product view exists for this
// composition yet (`rhythm-scenarios.ts`'s module doc), so this is the FIRST
// visual coverage of RHY-3-multicourse-composition.md's §4 collapse rule.
for (const stateId of RHYTHM_STATES) {
  for (const setId of VARIABLE_SETS) {
    test(`rhythm/${stateId} @ ${setId}`, async ({ page }) => {
      await applyTallViewportIfAny(page, stateId);
      await gotoState(page, 'rhythm', stateId, setId);
      await expect(hostFrameElement(page)).toHaveScreenshot(`rhythm-${stateId}--${setId}.png`);
    });
  }
}
