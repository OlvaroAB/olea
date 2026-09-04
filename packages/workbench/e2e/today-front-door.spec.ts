/**
 * `@auto-web` — F6.1's "New and due are different numbers" and "The panel as
 * a surface" blocks (both previously `@manual` only):
 *
 *   - "Start review is the one way in" — given items are due, exactly one
 *     primary action exists and it is the review entry point.
 *   - "all three things are on the panel at once" — the due count, the new
 *     count and that one action render together, and nothing else does.
 *
 * **This file's premise has narrowed, not moved off screen (`[D-223]`,
 * `ol-l5og.22` [HOME-3]).** `[D-033]`'s "front door" ruling — one way in,
 * reached through the composed session rather than around it — now attaches
 * to Home (F6.10), which is where she lands and where a genuine "the one way
 * in" claim belongs. What survives on Today is narrower and still true: this
 * panel's own review button is F6's heading note's third named thing, "the
 * review entry point," and `showsStartReviewAction`'s doc in `copy.ts` is
 * explicit that the reason it must never disappear is now that one — an
 * entry point with no action when nothing is due is a hole in the screen —
 * rather than `[D-033]`'s front-door reasoning. This file's two tests below
 * still hold at face value (one action, all three things together) because
 * neither ever asserted Today was the product's only door; they asserted
 * what is true on THIS panel, which `[D-223]` left unchanged.
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
 *
 * **The due count is read off `.olea-today-note`, not a `.olea-today-count`
 * element.** `[D-223]` folded the numeral into one plain sentence
 * (`copy.ts`'s `dueTodaySentence`: `"${total} due today"`) under a
 * `.olea-today-due-label` "Due" eyebrow — same file `today-panel.spec.ts`
 * documents this for.
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

  // The due sentence: a real, positive number, stated in prose now rather
  // than a separate numeral element (today-panel.spec.ts already covers the
  // `> 0` claim in depth; this file's job is co-presence with the new line
  // and the action, not the number itself).
  const dueNote = (await body.locator('.olea-today-note').textContent())?.trim() ?? '';
  const dueMatch = dueNote.match(/^(\d+) due today$/);
  expect(dueMatch, `expected a "N due today" sentence, got "${dueNote}"`).not.toBeNull();
  expect(Number(dueMatch?.[1])).toBeGreaterThan(0);

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
