/**
 * The host pane must be tall enough to hold the product state it is showing.
 *
 * WHY THIS EXISTS (`ol-wzar`). The screenshot suite next door targets the host
 * iframe element, and an element screenshot is happy to capture a SCROLLED
 * view: if the product's document is taller than the pane, the baseline still
 * gets written, still compares clean on every later run, and quietly stops
 * containing the bottom of the card. Nothing in that suite can notice —
 * a golden that captures half a screen is a perfectly stable golden.
 *
 * That is not hypothetical. It is what was happening: the config declared an
 * 832px viewport, `devices['Desktop Chrome']` silently overrode it to 720
 * because a later spread wins, and the resulting 432px pane was 110px short of
 * the tallest review state. The screenshots were reviewed and approved in that
 * condition.
 *
 * So this file asserts the property the screenshots cannot: for every state the
 * golden suite captures, the product's own scrollHeight fits inside the pane.
 * It fails when a card grows, when the workbench chrome takes more room, or
 * when someone changes the viewport without re-checking either.
 */
import { expect, test } from '@playwright/test';
import {
  EXPLAIN_STATES,
  frame,
  GENERATE_STATES,
  gotoState,
  gotoWalkStep,
  hostFrameElement,
  ORACLE_STATES,
  RETRIEVE_STATES,
  REVIEW_STATES,
  RHYTHM_STATES,
  SESSION_STATES,
  type Surface,
  TALL_STATE_VIEWPORTS,
  TIMELINE_STATES,
  TODAY_STATES,
  TRENDS_STATES,
  WALK_STEP_VIEWPORTS,
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

/**
 * One variable set is enough. The pane's height is a property of the workbench
 * chrome and the viewport, and the product's content height barely moves
 * between themes — running all six would multiply the cost by six to re-measure
 * the same number. `obsidian-dark` is the default set.
 */
const SET = 'obsidian-dark';

/** The pane, and what the product's own document wants, in CSS pixels. */
async function measure(page: import('@playwright/test').Page) {
  const pane = await hostFrameElement(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().height),
  );
  // Measured inside the iframe's own document — `frame()` reaches across the
  // boundary that `ol-mioe` deliberately put there.
  const needed = await frame(page)
    .locator('body')
    .evaluate((body) =>
      Math.max(body.scrollHeight, body.ownerDocument.documentElement.scrollHeight),
    );
  return { pane, needed };
}

// WBF-4 (`ol-opjq`) widened this from review/today to every flat surface the
// golden suite now screenshots (`visual-regression.spec.ts`) — the same
// silent-scroll failure mode applies to any of them, not just the original
// two.
const SURFACE_STATES: ReadonlyArray<readonly [Surface, readonly string[]]> = [
  ['review', REVIEW_STATES],
  ['today', TODAY_STATES],
  ['oracle', ORACLE_STATES],
  ['retrieve', RETRIEVE_STATES],
  ['generate', GENERATE_STATES],
  ['timeline', TIMELINE_STATES],
  ['explain', EXPLAIN_STATES],
  ['session', SESSION_STATES],
  ['trends', TRENDS_STATES],
  ['rhythm', RHYTHM_STATES],
];

for (const [surface, stateIds] of SURFACE_STATES) {
  for (const stateId of stateIds) {
    test(`${surface}/${stateId} fits its pane without scrolling`, async ({ page }) => {
      // WBF-4: some oracle/timeline/trends/session states need more pane
      // than the shared 1280x900 default offers (`TALL_STATE_VIEWPORTS`'s
      // own header has the measured numbers, and why this is keyed per
      // STATE rather than per surface) — set it here, per-test, rather than
      // raising `playwright.config.ts`'s default, which would also reflow
      // every review/today baseline this bead does not touch.
      const override = TALL_STATE_VIEWPORTS[stateId];
      if (override !== undefined) {
        await page.setViewportSize(override);
      }
      await gotoState(page, surface, stateId, SET);
      const { pane, needed } = await measure(page);

      // 1px of slack for sub-pixel rounding on the pane's border, and no more:
      // the point of the check is that the margin is known, not that it is
      // comfortable.
      expect(
        needed,
        `${surface}/${stateId}: the product needs ${String(needed)}px and the pane offers ` +
          `${String(pane)}px. Either the state grew or the pane shrank — see ol-wzar. ` +
          `Raise the viewport in playwright.config.ts (pane = viewport - inspector - padding) ` +
          `rather than accepting a screenshot of a scrolled card.`,
      ).toBeLessThanOrEqual(pane + 1);
    });
  }
}

// WBF-4 (`ol-opjq`) — the same check, for the twelve walkthrough steps
// `walkthrough-visual.spec.ts` screenshots. Walk mode's own chrome (title,
// copy, counter, step list) shrinks the pane further than any flat surface's
// sidebar+inspector do, so this uses its own per-step overrides
// (`WALK_STEP_VIEWPORTS`) rather than reusing `TALL_SURFACE_VIEWPORTS`.
for (let n = 1; n <= 12; n++) {
  test(`walk/${String(n)} fits its pane without scrolling`, async ({ page }) => {
    const override = WALK_STEP_VIEWPORTS[n];
    if (override !== undefined) {
      await page.setViewportSize(override);
    }
    await gotoWalkStep(page, n);
    const { pane, needed } = await measure(page);

    expect(
      needed,
      `walk/${String(n)}: the product needs ${String(needed)}px and the pane offers ` +
        `${String(pane)}px. Either the step's content grew or its viewport override ` +
        `(WALK_STEP_VIEWPORTS in helpers.ts) needs raising — see ol-wzar.`,
    ).toBeLessThanOrEqual(pane + 1);
  });
}
