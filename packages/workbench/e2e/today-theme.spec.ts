/**
 * `@auto-web` — F6.1's "it wears her theme" (`features/F6-today.md`,
 * previously `@manual` only). Unlike the review view, `.olea-today-root`
 * paints no background of its own — `styles.css`'s own header on that
 * selector says why: a sidebar pane has no elevation surface of its own, so
 * it reads directly against whatever sits behind it, the same way it would
 * inside Obsidian's real sidebar chrome. That means the thing to check for
 * "reads as part of her sidebar" is the frame's own host document `body`
 * (`host-frame.ts`: `background: var(--background-primary, ...)`), which is
 * this harness's stand-in for that chrome — verified once, directly, rather
 * than assumed from the module doc's prose.
 *
 * This is the mirror of `theme-baseline.spec.ts`'s "F2.4 dark-by-default
 * holds under every variable set" check, which asserts the OPPOSITE for the
 * review root on purpose: the review view forces a dark floor regardless of
 * host branch, and the Today pane deliberately does not — F2.4 is the
 * review view's own rule and does not apply here (F6-today.md's own
 * scenario text). A host in its light branch should genuinely show a light
 * ground through the pane, and a host in its dark branch a dark one.
 *
 * Legibility is checked the same way `theme-baseline.spec.ts` already
 * checks darkness — real computed style in a real Chromium cascade, not a
 * reimplementation of CSS resolution in Node — via perceptual luminance
 * (ITU-R BT.601), requiring each label to sit far enough from the ground it
 * is actually read against to stand out.
 *
 * **Scoped to the four sets that model a real, complete theme install**
 * (`obsidian-dark`, `obsidian-light`, `things-dark`, `things-light`) — the
 * two `*-no-baseline` sets strip Obsidian's own `app.css` baseline
 * entirely (`ol-itiu`'s edge case), which leaves `--background-primary`
 * undefined regardless of the theme's declared branch, and this
 * harness's host-document fallback (`host-frame.ts`) is a single constant
 * dark colour, not a per-branch one. Measured: both no-baseline sets read
 * dark behind the pane, in the light branch as much as the dark one — a
 * real finding about that deliberately-incomplete condition, but not a
 * defect in Today's own theme-following (`.olea-today-root` still forces
 * nothing), and not what F6.1's scenario is stated against ("a community
 * theme installed" — a stripped-baseline harness state models an already-
 * broken install, not an ordinary one). The `*-no-baseline` pair is
 * `theme-baseline.spec.ts`'s own case to cover, for the review root's dark-
 * floor-leak family of checks; it stays out of this file's scope.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** The four sets that model a complete, real theme install — see module doc. */
const REAL_THEME_SETS = ['obsidian-dark', 'obsidian-light', 'things-dark', 'things-light'] as const;
const LIGHT_SETS = new Set(['obsidian-light', 'things-light']);

function luminance(rgb: string): number {
  const channels = rgb.match(/[\d.]+/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0] = channels;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** `true` for `rgba(0, 0, 0, 0)`/`transparent` — an element with no ground of its own. */
function isTransparent(rgb: string): boolean {
  const alpha = rgb.match(/[\d.]+/g)?.map(Number)[3];
  return alpha === 0;
}

for (const setId of REAL_THEME_SETS) {
  const expectLight = LIGHT_SETS.has(setId);

  test(`${setId}: the ground the Today pane reads against follows this host branch, never a forced floor (F6.1, unlike F2.4's review floor)`, async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-due', setId);
    // `.olea-today-root` itself paints nothing (see module doc) — the frame's
    // host-document body is what a real Obsidian sidebar's own chrome would
    // supply, and it is what the pane is actually seen against.
    const hostBody = frame(page).locator('body');
    const bg = await hostBody.evaluate((el) => getComputedStyle(el).backgroundColor);
    const bgLuminance = luminance(bg);

    if (expectLight) {
      expect(
        bgLuminance,
        `${setId}: the ground behind the Today pane (${bg}) reads as dark, not light`,
      ).toBeGreaterThan(0.6);
    } else {
      expect(
        bgLuminance,
        `${setId}: the ground behind the Today pane (${bg}) reads as light, not dark`,
      ).toBeLessThan(0.4);
    }
  });

  test(`${setId}: every label stays legible against the ground it is actually read on`, async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-due', setId);
    const hostBodyBg = await frame(page)
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const groundLuminance = luminance(hostBodyBg);

    // The header label and the due-count label paint no ground of their
    // own, nor does `.olea-today-root`/`-header`/`-body` above them — they
    // read against the host body's ground computed above.
    const groundless = [
      frame(page).locator('.olea-today-header-label'),
      frame(page).locator('.olea-today-count-label'),
    ];
    for (const label of groundless) {
      const color = await label.evaluate((el) => getComputedStyle(el).color);
      const gap = Math.abs(luminance(color) - groundLuminance);
      expect(
        gap,
        `${setId}: a Today pane label (color ${color} on ground luminance ${groundLuminance.toFixed(2)}) does not stand out enough to read`,
      ).toBeGreaterThan(0.35);
    }

    // `.olea-today-primary-action` is different on purpose (`styles.css`:
    // "TWO OWNED COLOURS" — honey attention, constant in every host theme),
    // so it is checked against its OWN painted background rather than the
    // host ground; comparing its fixed dark-brown text to the ground behind
    // it would pass or fail on the wrong pairing entirely.
    const action = frame(page).locator('.olea-today-primary-action');
    const actionColor = await action.evaluate((el) => getComputedStyle(el).color);
    const actionBg = await action.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(
      isTransparent(actionBg),
      `${setId}: primary action unexpectedly has no ground of its own`,
    ).toBe(false);
    expect(
      Math.abs(luminance(actionColor) - luminance(actionBg)),
      `${setId}: the primary action's own text (${actionColor} on ${actionBg}) does not stand out enough to read`,
    ).toBeGreaterThan(0.35);
  });
}
