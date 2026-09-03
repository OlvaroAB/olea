/**
 * `@auto-web` — F5.1's "Explain it back" surface (`olea-service/features/
 * F5-explain-it-back.md`, `ol-z6x2` [WB-2] F5 tranche, `[D-163]`), driven in
 * a real browser against the REAL `ExplainBackModal` from `packages/plugin`,
 * fed CANNED `grade`/`acceptWithObservation` results
 * (`explain-back-scenarios.ts`'s module doc explains why: this surface's own
 * risk is the modal's phase-rendering state machine and its copy, never the
 * grading pipeline itself — that is already covered by `packages/core`'s and
 * `olea-service`'s own spec files).
 *
 * `ExplainBackModal` is a `Modal`, not an `ItemView` — it renders as an
 * app-wide overlay into `[data-wb-modal-host]`, a sibling of the host
 * iframe, never inside it (`obsidian-shim`'s own `Modal` doc). So every
 * locator below queries the TOP document directly, never `frame(page)`.
 *
 * Reachability: proves the SCREEN and its phase transitions against the real
 * class, not `packages/plugin/src/main.ts`'s own production
 * `gradeExplainBackAttempt`/`acceptExplainBackGradingWithObservation` wiring
 * — same posture `registry.spec.ts`'s own doc states for its surface.
 *
 * Scenarios asserted (F5.1, `[D-163]`, `[D-171]`, F6.8/V5, C4.7/`[D-089]`):
 *   - a fresh, free-form prompt moves from the topic phase to the answering phase
 *   - a graded answer renders feedback, missed points and cited issues
 *   - the `[D-171]` "See in registry" affordance appears with cited issues and hands off for real
 *   - declining ("Try again") returns to answering with her typed answer intact
 *   - accepting a clean grading shows the one honest F6.8 encouragement line
 *   - a transient check failure shows the error-refusal, never the insufficient-notes wording
 */
import { expect, type Page, test } from '@playwright/test';

async function gotoExplainBack(page: Page, stateId: string): Promise<void> {
  await page.goto(`/#/explain-back/${stateId}?set=obsidian-dark&persona=none`);
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', { timeout: 10_000 });
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

function panel(page: Page) {
  return page.locator('.olea-explain-back');
}

test('explain-back-fresh-prompt: a free-form prompt moves from the topic phase to the answering phase', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-fresh-prompt');

  const topicInput = panel(page).locator('.olea-explain-back-topic');
  await expect(topicInput).toBeVisible();
  await topicInput.fill('the alpha mechanism');
  await panel(page).getByRole('button', { name: 'Continue' }).click();

  await expect(panel(page).locator('.olea-explain-back-answer')).toBeVisible();
  await expect(panel(page).locator('.olea-explain-back-question')).toHaveText(
    'In your own words: explain the alpha mechanism.',
  );
});

test('explain-back-graded-feedback: a graded answer renders feedback, missed points and cited issues', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  await panel(page)
    .locator('.olea-explain-back-answer')
    .fill('The alpha mechanism does something.');
  await panel(page).getByRole('button', { name: 'Check this' }).click();

  // `[D-217]` (`ol-0r92.48`): the graded phase renders no verdict heading at
  // all — the old three-verdict wording this test asserted ("Part of this
  // holds up.") is rejected wording; only the fact-based feedback line and
  // the headings below render here now.
  await expect(panel(page).locator('.olea-explain-back-outcome')).toHaveCount(0);
  await expect(panel(page).locator('.olea-explain-back-feedback')).toContainText(
    'effect on half-life is missing',
  );
  const missedHeading = panel(page).locator('.olea-explain-back-heading', {
    hasText: "What your notes cover that this didn't",
  });
  await expect(missedHeading).toBeVisible();
  const citedHeading = panel(page).locator('.olea-explain-back-heading', {
    hasText: 'From your notes',
  });
  await expect(citedHeading).toBeVisible();
  const misconceptionHeading = panel(page).locator('.olea-explain-back-heading', {
    hasText: 'Worth a closer look',
  });
  await expect(misconceptionHeading).toBeVisible();
});

test('explain-back-graded-feedback: the D-171 "See in registry" affordance hands off through the real function', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  await panel(page)
    .locator('.olea-explain-back-answer')
    .fill('The alpha mechanism does something.');
  await panel(page).getByRole('button', { name: 'Check this' }).click();

  const registryButton = panel(page).getByRole('button', { name: 'See in registry' });
  await expect(registryButton).toBeVisible();
  await registryButton.click();

  await expect(page.locator('[data-wb-inspector]')).toContainText('Registry hand-off recorded');
});

test('explain-back-graded-feedback: declining ("Try again") returns to answering with her typed answer intact', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  const typedAnswer = 'The alpha mechanism does something specific.';
  await panel(page).locator('.olea-explain-back-answer').fill(typedAnswer);
  await panel(page).getByRole('button', { name: 'Check this' }).click();
  // `[D-217]`: the graded phase shows the feedback line, never an outcome
  // heading — see the sibling test above.
  await expect(panel(page).locator('.olea-explain-back-feedback')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Try again' }).click();

  const answerBox = panel(page).locator('.olea-explain-back-answer');
  await expect(answerBox).toBeVisible();
  await expect(answerBox).toHaveValue(typedAnswer);
  await expect(panel(page).locator('.olea-explain-back-outcome')).toHaveCount(0);
});

test('explain-back-graded-clean: accepting a clean grading shows the one honest F6.8 encouragement line', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-clean');

  await panel(page).locator('.olea-explain-back-answer').fill('A complete, correct explanation.');
  await panel(page).getByRole('button', { name: 'Check this' }).click();

  // `[D-217]`: no verdict heading in the graded phase — just the fact-based
  // feedback line `cleanGrading()` sets.
  await expect(panel(page).locator('.olea-explain-back-outcome')).toHaveCount(0);
  await expect(panel(page).locator('.olea-explain-back-feedback')).toHaveText(
    'This names the mechanism and its target correctly.',
  );
  // Clean: none of the three headings, and no D-171 registry action.
  await expect(panel(page).locator('.olea-explain-back-heading')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'See in registry' })).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Keep this' }).click();

  await expect(panel(page).locator('.olea-explain-back-encouragement')).toContainText(
    "That's the first time this concept has been explained at full depth.",
  );
  await expect(panel(page).getByRole('button', { name: 'Done' })).toBeVisible();
  // The workbench fixture's deps never wire `recordSoloGradeAndReview`
  // (`explain-back-scenarios.ts`), so no SOLO depth comes back and the
  // accepted phase renders no outcome heading either — `renderAcceptedPhase`
  // only prints one when a level is actually returned.
  await expect(panel(page).locator('.olea-explain-back-outcome')).toHaveCount(0);
});

test('explain-back-refused-check-failed: a transient check failure shows the error-refusal, never the insufficient-notes wording', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-refused-check-failed');

  await panel(page).locator('.olea-explain-back-answer').fill('An answer to check.');
  await panel(page).getByRole('button', { name: 'Check this' }).click();

  // Exact text match is itself proof this is the transient refusal and not
  // `explainBackInsufficientNotesRefusal`'s "Your notes have…/Add more to
  // your notes" diagnostic (C4.7/`[D-089]`'s two-reason posture).
  const refusal = panel(page).locator('.olea-explain-back-refusal');
  await expect(refusal).toHaveText(
    "Olea couldn't check this explanation against your notes just now, so nothing was graded. Try again in a moment.",
  );
  await expect(panel(page).getByRole('button', { name: 'Check this' })).toBeVisible();
});
