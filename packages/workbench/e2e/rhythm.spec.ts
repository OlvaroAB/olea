/**
 * `@auto-web` — RHY-3's multicourse rhythm composition (`ol-i0zw`), driven in
 * a real browser against the real chain: `discoverScheduleEvents` ->
 * `associateScheduleEvents` -> `computeScheduleFreshness` ->
 * `composeRhythmPanel`, over the fixture vault plus one synthetic calendar
 * note (`rhythm-scenarios.ts`'s module doc). There is no product view for
 * this composition yet — the panel is workbench-owned DOM, drawn straight
 * into the host pane the same way `mountGenerate`'s pre-accept controls are
 * (see `main.ts`'s `renderRhythmPanel`) — so, like `retrieve.spec.ts` and
 * `explain.spec.ts`, this does not discharge `[D-072]`'s reachability clause
 * for a production caller; it is real evidence about the composition rule
 * itself (RHY-3-multicourse-composition.md §4), which has never had browser
 * coverage before this file.
 *
 * WB-2 (`ol-z6x2`), first-tranche coverage: `visual-regression.spec.ts`
 * already screenshots both states; this adds the structural assertions a
 * screenshot diff cannot make (row count, which course collapsed vs. which
 * didn't) and a real click-through of the row actions, which are honestly
 * inert Notices here (no product renderer to wire them to) rather than
 * buttons that quietly do nothing without saying so.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

function rhythmPanel(page: Page) {
  return frame(page).locator('.wb-rhythm-panel');
}

function rhythmRows(page: Page) {
  return frame(page).locator('.wb-rhythm-row');
}

test('rhythm-two-flagged: two courses collapse into one composed panel (§4.3)', async ({
  page,
}) => {
  await gotoState(page, 'rhythm', 'rhythm-two-flagged', 'obsidian-dark');
  await expect(rhythmPanel(page)).toHaveAttribute('data-wb-rhythm-panel-kind', 'composed');
  await expect(rhythmRows(page)).toHaveCount(2);
  // §4.4's alphabetical fallback ordering (this vault's real assessment
  // dates are both already behind the fixed clock — see the module doc).
  await expect(rhythmRows(page).nth(0).locator('.wb-rhythm-row-course')).toHaveText('GEOL204');
  await expect(rhythmRows(page).nth(1).locator('.wb-rhythm-row-course')).toHaveText('MUSTH104');
  // §4.3's fact/consequence/mitigation frame only exists at 2+ flagged.
  await expect(frame(page).locator('.wb-rhythm-fact')).toContainText('GEOL204');
  await expect(frame(page).locator('.wb-rhythm-fact')).toContainText('MUSTH104');
  await expect(frame(page).locator('.wb-rhythm-consequence')).toBeVisible();
  await expect(frame(page).locator('.wb-rhythm-mitigation')).toBeVisible();
  await expect(frame(page).locator('.wb-rhythm-footer')).toBeVisible();
});

test('rhythm-one-flagged: one course arrives and drops out, the other renders alone with nothing collapsed (§4.2)', async ({
  page,
}) => {
  await gotoState(page, 'rhythm', 'rhythm-one-flagged', 'obsidian-dark');
  await expect(rhythmPanel(page)).toHaveAttribute('data-wb-rhythm-panel-kind', 'single');
  await expect(rhythmRows(page)).toHaveCount(1);
  await expect(rhythmRows(page).first().locator('.wb-rhythm-row-course')).toHaveText('GEOL204');
  // §4.2: the composition question only exists at two or more, so the
  // consequence/mitigation frame is absent at exactly one flagged course.
  await expect(frame(page).locator('.wb-rhythm-consequence')).toHaveCount(0);
  await expect(frame(page).locator('.wb-rhythm-mitigation')).toHaveCount(0);
  // The footer line is reused verbatim regardless of how many rows compose.
  await expect(frame(page).locator('.wb-rhythm-footer')).toBeVisible();
});

test('FLOW: a row\'s "Open folder" action is real and honestly inert — clicking it surfaces a Notice naming the course, not a silent no-op', async ({
  page,
}) => {
  await gotoState(page, 'rhythm', 'rhythm-one-flagged', 'obsidian-dark');
  const openButton = rhythmRows(page)
    .first()
    .getByRole('button', { name: /Open GEOL204 folder/ });
  await openButton.click();
  const notice = page.locator('[data-wb-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('GEOL204');
});

test("FLOW: a row's contest gesture is real and honestly inert — clicking it says so rather than opening a dispute sheet nothing backs", async ({
  page,
}) => {
  await gotoState(page, 'rhythm', 'rhythm-one-flagged', 'obsidian-dark');
  const contestButton = rhythmRows(page).first().locator('.wb-rhythm-row-actions button').nth(1);
  await contestButton.click();
  const notice = page.locator('[data-wb-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('no real dispute sheet is');
});
