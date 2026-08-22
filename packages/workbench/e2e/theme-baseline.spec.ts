/**
 * `@auto-web` — real-browser regression guards for two WB-1 findings that
 * were originally verified by hand (README: "Findings the workbench
 * produced by running"). Turning a documented one-time measurement into a
 * permanent check is the whole value WB-2 adds over the finding itself.
 *
 * `ol-itiu` — the `data-wb-baseline` attribute must say which load model
 * (Obsidian's always-present `app.css` stand-in, or the theme alone)
 * produced a screenshot, because the two answer different questions and
 * only one models a real install.
 *
 * `ol-ro57` — a host theme that declares a variable in only one branch
 * (Things 2.2.4's `--background-modifier-hover`, light branch only) must
 * not leak the wrong half into the review view's forced-dark root. Verified
 * here by ACTUAL COMPUTED STYLE in a real Chromium cascade, not a
 * reimplementation of CSS resolution in Node — that distinction is the
 * point of running this in a browser at all.
 */
import { expect, test } from '@playwright/test';
import { baselineOf, frame, gotoState, hostFrameElement, VARIABLE_SETS } from './helpers.js';

function expectedBaseline(setId: string): 'present' | 'stripped' {
  return setId.includes('no-baseline') ? 'stripped' : 'present';
}

for (const setId of VARIABLE_SETS) {
  test(`${setId}: data-wb-baseline says which load model produced it (ol-itiu)`, async ({
    page,
  }) => {
    await gotoState(page, 'review', 'qa-reveal', setId);
    const expected = expectedBaseline(setId);

    expect(await baselineOf(page)).toBe(expected);
    await expect(frame(page).locator('body')).toHaveAttribute('data-wb-baseline', expected);
    await expect(hostFrameElement(page)).toHaveAttribute('data-wb-variable-set', setId);
  });
}

test.describe('F2.4 dark-by-default holds under every variable set (ol-ro57 regression guard)', () => {
  for (const setId of VARIABLE_SETS) {
    test(`${setId}: the review root renders dark regardless of the host theme`, async ({
      page,
    }) => {
      await gotoState(page, 'review', 'qa-reveal', setId);
      const root = frame(page).locator('.olea-review-root');
      const bg = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
      const channels = bg.match(/[\d.]+/g)?.map(Number) ?? [];
      const [r = 0, g = 0, b = 0] = channels;
      // Perceptual luminance (ITU-R BT.601). A dark surface stays well under
      // the midpoint regardless of which branch the host theme declared.
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      expect(
        luminance,
        `${setId}: .olea-review-root background ${bg} reads as light, not dark`,
      ).toBeLessThan(0.4);
    });
  }

  test('things-light and things-light-no-baseline: the keycap chip stays a translucent overlay, never the opaque light block ol-ro57 found', async ({
    page,
  }) => {
    for (const setId of ['things-light', 'things-light-no-baseline'] as const) {
      await gotoState(page, 'review', 'qa-reveal', setId);
      const keycap = frame(page).locator('.olea-review-keycap').first();
      const bg = await keycap.evaluate((el) => getComputedStyle(el).backgroundColor);
      const channels = bg.match(/[\d.]+/g)?.map(Number) ?? [];
      const alpha = channels[3] ?? 1;
      expect(
        alpha,
        `${setId}: .olea-review-keycap background ${bg} is not a translucent overlay ` +
          '— this is the exact shape ol-ro57 found (an opaque light chip reading unreadable ' +
          'on a light-grey background)',
      ).toBeLessThan(0.3);
    }
  });
});
