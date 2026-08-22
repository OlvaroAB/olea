/**
 * `@auto-web` — genuine, in-browser keyboard-driven flows through the real
 * `ReviewView`, resolved by the real `keymap.ts` (Q6.5).
 *
 * These differ from every other spec in this suite in one deliberate way:
 * elsewhere, the workbench itself drives a state to its target by dispatching
 * `scenario.keys` before the page is considered "ready" (see `scenarios.ts`),
 * and Playwright only loads the resulting URL. Here, Playwright sends the
 * keystrokes — `page.keyboard.press`, routed through actual browser input —
 * starting from a state one step *before* the behaviour under test, so the
 * assertion is about the real keymap responding to a real `KeyboardEvent`,
 * not about a URL resolving to a pre-baked DOM.
 *
 * See `features/F2-review.md` (F2.2, "reveal unlocks all four ratings" /
 * "nothing is ratable before reveal") and `features/F6-today.md` for the
 * `@manual` scenarios these give browser-level evidence alongside — added,
 * never substituted. The `@manual` set is unchanged; see the run report.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

for (const [surface, stateId] of [
  ['qa', 'qa-front'],
  ['cloze', 'cloze-front'],
] as const) {
  test(`${surface}: nothing is ratable before reveal, and Space reveals all four ratings`, async ({
    page,
  }) => {
    await gotoState(page, 'review', stateId, 'obsidian-dark');
    const root = frame(page).locator('.olea-review-root');

    await expect(frame(page).locator('.olea-review-ratings')).toHaveCount(0);

    await root.focus();
    await page.keyboard.press('Space');

    await expect(frame(page).locator('.olea-review-rating-btn')).toHaveCount(4);
    // Every rating carries its own FSRS interval preview — real scheduler
    // output, not placeholder text (see the package README's persona table).
    for (const text of await frame(page)
      .locator('.olea-review-rating-interval')
      .allTextContents()) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
}

test('MCQ: a real keystroke answers, and marks exactly one option correct', async ({ page }) => {
  await gotoState(page, 'review', 'mcq-open', 'obsidian-dark');
  const root = frame(page).locator('.olea-review-root');
  const optionCountBefore = await frame(page).locator('.olea-review-mcq-option').count();
  expect(optionCountBefore).toBe(4);
  await expect(frame(page).locator('.olea-review-mcq-feedback')).toHaveCount(0);

  await root.focus();
  await page.keyboard.press('a'); // first option, whichever it is

  const correct = frame(page).locator('.olea-review-mcq-option--correct');
  await expect(correct).toHaveCount(1);
  await expect(correct.locator('.olea-review-mcq-option-tag')).toHaveText('Correct answer');

  const wrong = frame(page).locator('.olea-review-mcq-option--wrong');
  const wrongCount = await wrong.count();
  expect(wrongCount).toBeLessThanOrEqual(1);
  if (wrongCount === 1) {
    await expect(wrong.locator('.olea-review-mcq-option-tag')).toHaveText('You chose');
  }

  await expect(frame(page).locator('.olea-review-mcq-feedback')).toBeVisible();
});

test('MCQ: the "guessed" toggle flips live on the "g" key, both ways', async ({ page }) => {
  await gotoState(page, 'review', 'mcq-answered-correct', 'obsidian-dark');
  const root = frame(page).locator('.olea-review-root');
  // `.olea-review-ghost-action` is shared with the header's Edit/Suspend
  // buttons (`actionButton`), so it has to be scoped to the MCQ footer to
  // reach the guess toggle specifically, not merely the first match.
  const toggle = frame(page).locator('.olea-review-mcq-footer .olea-review-ghost-action');

  // mcq-answered-correct is reached without the guess tap (buildScenario's
  // keys for it are just the correct letter), so it starts un-toggled.
  await expect(toggle).not.toHaveClass(/olea-review-ghost-action--active/);

  await root.focus();
  await page.keyboard.press('g');
  await expect(toggle).toHaveClass(/olea-review-ghost-action--active/);

  await page.keyboard.press('g');
  await expect(toggle).not.toHaveClass(/olea-review-ghost-action--active/);
});
