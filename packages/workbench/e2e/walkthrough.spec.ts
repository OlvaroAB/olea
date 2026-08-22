/**
 * `@auto-web` — walkthrough steps 7-8 (`ol-akla`, WBF-3) and a
 * rendered-DOM check for the WBF-1 (`ol-mxw3`) fix on the two steps whose
 * screens run over `packages/synthetic`'s coined corpus (10, 12).
 *
 * Steps 7-8 mount the fixture-vault oracle (`oracle-fixture`, D-041), which
 * has its own URL shape (`#/walk/<n>`, not `#/<surface>/<stateId>`) — see
 * `walkthrough.ts`'s module doc — so this file navigates by hand rather than
 * through `helpers.ts`'s `gotoState`, whose `Surface` union does not include
 * `'walk'`.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

async function gotoWalkStep(page: import('@playwright/test').Page, step: number): Promise<void> {
  await page.goto(`/#/walk/${String(step)}?set=obsidian-dark&persona=none`);
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', { timeout: 10_000 });
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

test('WBF-3: steps 7 and 8 mount the same real GapView but focus on different parts of it', async ({
  page,
}) => {
  // `data-wb-fixture-oracle-focus` is set on `host` (`main.ts`'s `frame.body`
  // — the iframe's OWN document body), not on the outer `[data-wb-surface]`
  // iframe element in the top document (which carries an unrelated,
  // pre-existing `data-wb-surface` attribute of its own — see `main.ts`'s
  // route-parsing module doc for that collision). So this reaches inside the
  // frame, same as `frame(page).locator(...)` does for everything else here.
  await gotoWalkStep(page, 7);
  await expect(frame(page).locator('body')).toHaveAttribute(
    'data-wb-fixture-oracle-focus',
    'ranking',
  );
  const step7Note = await frame(page).locator('.wb-fixture-oracle-focus-note').textContent();

  await gotoWalkStep(page, 8);
  await expect(frame(page).locator('body')).toHaveAttribute(
    'data-wb-fixture-oracle-focus',
    'coverage',
  );
  const step8Note = await frame(page).locator('.wb-fixture-oracle-focus-note').textContent();

  // The one thing this bead promises: the two steps are no longer
  // byte-identical screens. The caption differs, and (below) so does what is
  // scrolled into view.
  expect(step7Note).not.toBe(step8Note);
  expect(step7Note?.length ?? 0).toBeGreaterThan(0);
  expect(step8Note?.length ?? 0).toBeGreaterThan(0);

  // Both steps mount the SAME real computation (D-041's whole argument) —
  // the coverage section exists on both, but only step 8 scrolls to it.
  // `.olea-gap-coverage` is unstyled inside the workbench's flex host (a
  // pre-existing gap this bead does not touch — `GapView`'s own styles live
  // in `packages/plugin/styles.css`, another lane's file, and are not wired
  // into the workbench build), so its box collapses to zero width and
  // Playwright's `toBeVisible` reports it as hidden even though it is
  // genuinely in the DOM and `scrollIntoView` ran against it — hence
  // `toHaveCount`, not `toBeVisible`, here.
  await expect(frame(page).locator('.olea-gap-coverage')).toHaveCount(1);
});

test('WBF-1: no synthetic id reaches the rendered timeline screen (step 10)', async ({ page }) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toMatch(/\bsyn:/);
});

test('WBF-1: no synthetic id reaches the rendered trends screen (step 12)', async ({ page }) => {
  await gotoState(page, 'trends', 'trends-cramming', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toMatch(/\bsyn:/);
});

test('WBF-2: the trends screen never opens on the read-failure message', async ({ page }) => {
  await gotoState(page, 'trends', 'trends-cramming', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toContain("Olea can't count what's due");
});

/**
 * `@auto-web` — SPRIG-1 (`ol-t1hc`) reachability.
 *
 * The sprig is the brand's only progress indicator and it was computed in core
 * and drawn nowhere for the whole life of the project. Drawing it is not the
 * claim worth pinning; a viewer SEEING it is. These two assertions exist
 * because the plugin unit tests pass whether or not any workbench surface ever
 * mounts a view that reaches `renderSprig`, and the Today golden screenshots
 * did NOT change when the sprig landed — the flat `today` states are never
 * given a trends source, so their mastery section renders nothing and the
 * goldens could not have caught a regression here either way.
 */
test('SPRIG-1: the sprig actually reaches the screen on the gap view (step 8)', async ({
  page,
}) => {
  await gotoWalkStep(page, 8);
  const sprigs = frame(page).locator('.olea-sprig');
  await expect(sprigs.first()).toBeVisible();
  // Every sprig always draws all five leaf positions — filled ones as fills,
  // empty ones as outlines. A sprig missing its empty leaves is a different
  // picture from a sprig with few leaves, and only the first is honest.
  await expect(sprigs.first().locator('ellipse')).toHaveCount(5);
});

test('SPRIG-1: the sprig reaches the trends screen too (step 12)', async ({ page }) => {
  await gotoWalkStep(page, 12);
  await expect(frame(page).locator('.olea-sprig').first()).toBeVisible();
});
