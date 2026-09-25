/**
 * `@auto-web` — F6.10's landing dashboard (`[D-243]`, `ol-egov.132.7`
 * [SESS-8.7]), driven in a real browser against the REAL `HomeView` over
 * `home-scenarios.ts`'s reuse of the REAL fixture-vault session composition
 * — see that file's own module doc for why the composed-session half is
 * real computation and the course strip/avoidance question are hand-built
 * `HomeCourseRow`/`HomeAvoidanceQuestion` fixtures over coined vocabulary,
 * the same discipline `grove-scenarios.ts` already documents for its own
 * pane.
 *
 * `main.ts`'s own `mountHome` (`ol-qq61`, fixed by `ol-ppxj.50`) now passes
 * `reloaded.state.courses` and `reloaded.state.avoidanceQuestion` through
 * unchanged on every refresh instead of rebuilding the dashboard state by
 * hand with `courses: []` and no `avoidanceQuestion` key — so the course
 * strip and avoidance question `home-scenarios.ts` computes for
 * `home-session-unavailable`/`home-empty` do reach this workbench's live
 * DOM, and their goldens below cover it. `home-composed` still shows
 * neither: that is `home-scenarios.ts`'s own fixture choice
 * (`avoidanceQuestion: undefined`, `courses: []`), not a mount gap — see
 * that file's own module doc.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState, hostFrameElement } from './helpers.js';

test('home-composed: the composed session renders inline, with Start and no course strip (home-scenarios.ts fixture choice, see module doc)', async ({
  page,
}) => {
  await gotoState(page, 'home', 'home-composed', 'obsidian-dark');
  await expect(frame(page).locator('.olea-home-offer-title')).toBeVisible();
  await expect(frame(page).getByRole('button', { name: 'Start' })).toBeVisible();
  // Exactly one `.olea-card` (the offer card) — no avoidance card, since
  // `home-composed` is deliberately left with `avoidanceQuestion: undefined`
  // even at the `home-scenarios.ts` layer (that file's own module doc:
  // `test/home-scenarios.spec.ts` pins this state's shape).
  await expect(frame(page).locator('.olea-card')).toHaveCount(1);
  await expect(frame(page).locator('.olea-home-course-row')).toHaveCount(0);
  await expect(hostFrameElement(page)).toHaveScreenshot('home-home-composed--obsidian-dark.png');
});

test('home-empty: the honest empty composition, relocated onto Home by [D-243]', async ({
  page,
}) => {
  await gotoState(page, 'home', 'home-empty', 'obsidian-dark');
  await expect(frame(page).locator('.olea-home-offer-title')).toHaveCount(0);
  await expect(frame(page).locator('.olea-home-offer-reason-line').first()).toContainText(
    'Nothing that Olea has instruments for fits in',
  );
  await expect(hostFrameElement(page)).toHaveScreenshot('home-home-empty--obsidian-dark.png');
});

test("home-session-unavailable: SessionBuilderView's own unavailable box, inside a dashboard state", async ({
  page,
}) => {
  await gotoState(page, 'home', 'home-session-unavailable', 'obsidian-dark');
  await expect(frame(page).locator('.olea-home-offer-title')).toHaveText(
    'Olea could not read your sources just now.',
  );
  await expect(frame(page).getByRole('button', { name: 'Start' })).toHaveCount(0);
  await expect(hostFrameElement(page)).toHaveScreenshot(
    'home-home-session-unavailable--obsidian-dark.png',
  );
});

test("home-unavailable: HomeView's own outer unavailable branch, with no session card at all", async ({
  page,
}) => {
  await gotoState(page, 'home', 'home-unavailable', 'obsidian-dark');
  await expect(frame(page).locator('.olea-home-unavailable')).toHaveText(
    'Olea could not read your vault just now.',
  );
  await expect(frame(page).locator('.olea-card')).toHaveCount(0);
  await expect(hostFrameElement(page)).toHaveScreenshot('home-home-unavailable--obsidian-dark.png');
});
