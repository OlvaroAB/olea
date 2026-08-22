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
import { frame, gotoState, hostFrameElement, REVIEW_STATES, TODAY_STATES } from './helpers.js';

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

for (const stateId of [...REVIEW_STATES, ...TODAY_STATES]) {
  const surface = REVIEW_STATES.includes(stateId as (typeof REVIEW_STATES)[number])
    ? 'review'
    : 'today';

  test(`${surface}/${stateId} fits its pane without scrolling`, async ({ page }) => {
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
