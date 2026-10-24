/**
 * `@auto-web` — F5.1's "Explain it back" surface (`olea-service/features/
 * F5-explain-it-back.md`, `ol-z6x2` [WB-2] F5 tranche, `[D-163]`), driven in
 * a real browser against the REAL `ExplainBackModal` from `packages/plugin`.
 *
 * **In v0.9 the view is ungraded practice** (`[D-603]`, words `[D-611]`;
 * `ol-egov.141.89.6.129`): after an answer it shows her explanation, the
 * passages the prompt carries under "From your notes", the reflection prompts
 * and "Done" / "Try again", and nothing that grades. The fixture states
 * (`explain-back-scenarios.ts`, outside this bead's files) still carry canned
 * `grade`/`acceptWithObservation` results under their graded-era names; the
 * practice view never calls them, which is part of what these tests prove.
 *
 * `ExplainBackModal` is a `Modal`, not an `ItemView` — it renders as an
 * app-wide overlay into `[data-wb-modal-host]`, a sibling of the host
 * iframe, never inside it (`obsidian-shim`'s own `Modal` doc). So every
 * locator below queries the TOP document directly, never `frame(page)`.
 *
 * Reachability: proves the SCREEN and its phase transitions against the real
 * class, not `packages/plugin/src/main.ts`'s own production wiring — same
 * posture `registry.spec.ts`'s own doc states for its surface.
 *
 * Scenarios asserted (F5.1, F5.2, F5.3, F5.4, `[D-603]`, `[D-611]`):
 *   - a fresh, free-form prompt moves from the topic phase to the answering phase
 *   - an answer shows the passages and the reflection prompts, and no findings
 *   - the `[D-171]` "See in registry" affordance is not on the practice view (no cited findings)
 *   - "Try again" returns to answering with her typed answer intact
 *   - "Done" says nothing about how she did
 *   - submitting shows the passages at once, with no check to wait on or fail
 */
import { expect, type Page, test } from '@playwright/test';

/** Vocabulary registry §39's words, restated as literals per this suite's convention. */
const SUBMIT = 'Show the passages';
const NOTICE = 'This is practice: nothing here is graded.';
const HEADING = 'From your notes';
const READ_ALONGSIDE = 'Read these alongside what you wrote.';
const ADD_OR_REPHRASE = 'Is there anything here you would add, or put differently?';
const DONE = 'Done';
const TRY_AGAIN = 'Try again';

/** `explain-back-scenarios.ts`'s two fixture passages (coined vocabulary). */
const PASSAGES = [
  'The alpha mechanism regulates the synthetic rate constant.',
  'A higher synthetic rate constant shortens the reaction half-life.',
];

async function gotoExplainBack(page: Page, stateId: string): Promise<void> {
  await page.goto(`/#/explain-back/${stateId}?set=obsidian-dark&persona=none`);
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', { timeout: 10_000 });
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

function panel(page: Page) {
  return page.locator('.olea-explain-back');
}

async function answerAndShowPassages(page: Page, answer: string): Promise<void> {
  await panel(page).locator('.olea-explain-back-answer').fill(answer);
  await panel(page).getByRole('button', { name: SUBMIT }).click();
  await expect(
    panel(page).locator('.olea-explain-back-heading', { hasText: HEADING }),
  ).toBeVisible();
}

/** Everything that graded, in any form the graded view ever drew it. */
async function expectNothingThatGrades(page: Page): Promise<void> {
  await expect(panel(page).locator('.olea-explain-back-outcome')).toHaveCount(0);
  await expect(panel(page).locator('.olea-explain-back-encouragement')).toHaveCount(0);
  await expect(panel(page).locator('.olea-explain-back-feedback')).toHaveCount(0);
  await expect(panel(page).locator('.olea-explain-back-region')).toHaveCount(0);
  await expect(panel(page)).not.toContainText("What your notes cover that this didn't");
  await expect(panel(page)).not.toContainText('Worth a closer look');
  await expect(panel(page)).not.toContainText('You explained this');
  await expect(panel(page)).not.toContainText('explained at full depth');
  await expect(panel(page).getByRole('button', { name: 'Keep this' })).toHaveCount(0);
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
  await expect(panel(page).getByText(NOTICE, { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: SUBMIT })).toBeVisible();
});

test('explain-back-graded-feedback: an answer shows the passages and the reflection prompts, and no findings', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  await answerAndShowPassages(page, 'The alpha mechanism does something.');

  await expect(panel(page)).toContainText('The alpha mechanism does something.');
  for (const passage of PASSAGES) {
    await expect(
      panel(page).locator('.olea-explain-back-item .olea-explain-back-item-text', {
        hasText: passage,
      }),
    ).toBeVisible();
  }
  await expect(panel(page).getByText(READ_ALONGSIDE, { exact: true })).toBeVisible();
  await expect(panel(page).getByText(ADD_OR_REPHRASE, { exact: true })).toBeVisible();
  await expect(panel(page).getByText(NOTICE, { exact: true })).toBeVisible();
  // No answer field for any reflection prompt.
  await expect(panel(page).locator('textarea, input')).toHaveCount(0);
  await expect(panel(page).getByRole('button')).toHaveText([DONE, TRY_AGAIN]);
  await expectNothingThatGrades(page);
  // The canned grader's own text never appears: nothing was asked of it.
  await expect(panel(page)).not.toContainText('effect on half-life is missing');
});

// `[D-171]`'s affordance rendered only after cited findings. In v0.9 there are none, so it does not
// render on the practice view; where F8.4b's affordance sits on that view is an open question.
test('explain-back-graded-feedback: the D-171 "See in registry" affordance is not on the practice view', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  await answerAndShowPassages(page, 'The alpha mechanism does something.');

  await expect(panel(page).getByRole('button', { name: 'See in registry' })).toHaveCount(0);
  await expect(page.locator('[data-wb-inspector]')).not.toContainText('Registry hand-off recorded');
});

test('explain-back-graded-feedback: "Try again" returns to answering with her typed answer intact', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-graded-feedback');

  const typedAnswer = 'The alpha mechanism does something specific.';
  await answerAndShowPassages(page, typedAnswer);

  await panel(page).getByRole('button', { name: TRY_AGAIN }).click();

  const answerBox = panel(page).locator('.olea-explain-back-answer');
  await expect(answerBox).toBeVisible();
  await expect(answerBox).toHaveValue(typedAnswer);
  await expect(panel(page).locator('.olea-explain-back-heading', { hasText: HEADING })).toHaveCount(
    0,
  );
  await expect(panel(page).getByText(READ_ALONGSIDE, { exact: true })).toHaveCount(0);
});

test('explain-back-graded-clean: "Done" says nothing about how she did', async ({ page }) => {
  await gotoExplainBack(page, 'explain-back-graded-clean');

  await answerAndShowPassages(page, 'A complete, correct explanation.');
  await expectNothingThatGrades(page);

  await panel(page).getByRole('button', { name: DONE }).click();

  // "Done" closes the view: no depth heading, no milestone line and no other line about how she
  // did ever appeared, and there was no "Keep this" to choose.
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('explained at full depth');
  await expect(page.locator('body')).not.toContainText('You explained this');
});

test('explain-back-refused-check-failed: submitting shows the passages at once, with no check to wait on or fail', async ({
  page,
}) => {
  await gotoExplainBack(page, 'explain-back-refused-check-failed');

  await panel(page)
    .locator('.olea-explain-back-answer')
    .fill('An answer to read against the notes.');
  await panel(page).getByRole('button', { name: SUBMIT }).click();

  // The fixture's grader would fail; it is never asked, so the passages simply appear.
  await expect(
    panel(page).locator('.olea-explain-back-heading', { hasText: HEADING }),
  ).toBeVisible();
  await expect(panel(page).locator('.olea-explain-back-loading')).toHaveCount(0);
  await expect(panel(page)).not.toContainText('Checking against your notes');
  await expect(panel(page).locator('.olea-explain-back-refusal')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Check this' })).toHaveCount(0);
});
