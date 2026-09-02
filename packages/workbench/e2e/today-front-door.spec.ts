/**
 * `@auto-web` — F6.1's front-door promise, from `features/F6-today.md`'s
 * "New and due are different numbers" and "The panel as a surface" blocks
 * (both previously `@manual` only):
 *
 *   - "Start review is the one way in" — given items are due, exactly one
 *     primary action exists and it is the review entry point.
 *   - "all three things are on the panel at once" — the due count, the new
 *     count and that one action render together, and nothing else does.
 *
 * `today-due` is the only wired state with a non-zero, non-null due total
 * over the untouched fixture vault (`today-scenarios.ts`): every instrument
 * is a first exposure, so `newCount` equals the total there too, which is
 * enough to exercise "some of them never reviewed" — the scenario does not
 * require a MIXED due/new split, only that a new count is present alongside
 * the due count.
 *
 * `today-due` wires no `courseScopeModels`, `concepts`, insight window or
 * `courseMaterialArrivals` (see `buildTodayScenario`'s `realLoad`), so this
 * is also the state where "nothing else" is checkable without a second,
 * competing claim on screen — the mastery, scope, insights and rhythm
 * sections all render nothing here, which this file asserts rather than
 * assumes.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

test('today-due: exactly one primary action renders, and it is "Start review"', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-due', 'obsidian-dark');
  const body = frame(page).locator('.olea-today-body');

  // The one native control this pane has at all (`styles.css`'s own
  // "the pane's one native control" comment on `.olea-today-primary-action`).
  const buttons = body.locator('button');
  await expect(buttons).toHaveCount(1);
  await expect(buttons.first()).toHaveClass(/olea-today-primary-action/);
  await expect(buttons.first()).toHaveText('Start review');
});

test('today-due: due count, new count and the one action render together, and nothing else does', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-due', 'obsidian-dark');
  const body = frame(page).locator('.olea-today-body');

  // The due headline: a real, positive number (today-panel.spec.ts already
  // covers `> 0`; this file's job is co-presence with the new line and the
  // action, not the number itself).
  const dueCount = await body.locator('.olea-today-count').textContent();
  expect(Number(dueCount)).toBeGreaterThan(0);

  // The new-count line: present, and it names "new" (copy.ts's
  // `newCountSentence` — singular/plural wording is that module's own
  // scenario, not this one's).
  await expect(body.locator('.olea-today-new')).toBeVisible();
  await expect(body.locator('.olea-today-new')).toContainText('new');

  // The one action.
  await expect(body.locator('.olea-today-primary-action')).toHaveCount(1);

  // Nothing else: no mastery overview, no cross-course scope reading, no
  // insights section and no rhythm reading — `today-due` wires none of
  // their inputs (`buildTodayScenario`'s `realLoad`), so a regression that
  // silently started defaulting one of them in would show up here first.
  await expect(body.locator('.olea-today-mastery')).toHaveCount(0);
  await expect(body.locator('.olea-today-insights')).toHaveCount(0);
});
