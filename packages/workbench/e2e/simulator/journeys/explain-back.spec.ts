/**
 * F9.S5 — journey "explain-back": explain a concept back and receive the verdict (F5.1's
 * on-demand explain-back door). `ol-3ux7.64.18` [WBX-16].
 *
 * Driven by the REAL modal gestures, one Playwright action per thing she would do: the palette
 * command (`OLEA_COMMAND_EXPLAIN_BACK`, through the driver's generic `runCommand` — the same
 * `Plugin.invokeCommand` a palette pick takes), the topic typed into `.olea-explain-back-topic`
 * and "Continue" clicked, the answer typed into `.olea-explain-back-answer` and "Check this"
 * clicked, then "Keep this" and "Done". It deliberately does NOT use `driver.explain(text)`
 * (WBX-16c) for the whole round trip: that entry clicks Accept and Done itself before it returns,
 * so a journey built on it can only ever photograph the closed modal — the first cut of this file
 * did exactly that, and its "outcome" golden showed Home with nothing on it. The verdict IS the
 * step this journey exists to capture.
 *
 * The topic is the vault's first file's basename — `driverExplain`'s own `defaultExplainTopic`
 * rule, restated here so the modal round trip issues the identical Worker payload the cassette
 * fill recorded (the fill is this same journey run with `WB_SIM_TRANSPORT=record`). The invented
 * answer text is generic and never copied from any real note (CLAUDE.md's "never quote").
 *
 * Steps captured: topic, answering, verdict, accepted. A cassette miss — guaranteed on the
 * fixture world, which bundles no judge entry for this payload — renders
 * `EXPLAIN_BACK_CHECK_FAILED_TEXT` at the verdict step, and this journey asserts that text is on
 * screen rather than skipping the step, per F9.S5; on a refusal the "accepted" step is the
 * refusal still on screen (there is nothing to accept), never a skipped capture.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { captureJourneyStep, EXPLAIN_BACK_CHECK_FAILED_TEXT, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'explain-back';
const WEEK = 0;

/** `OLEA_COMMAND_EXPLAIN_BACK` (`packages/plugin/src/commands/ids.ts`) — restated as a literal per this suite's convention (`helpers.ts`'s header note). */
const EXPLAIN_BACK_COMMAND_ID = 'olea-explain-back';
/** `packages/plugin/src/explain-back/copy.ts`'s button labels, same convention. */
const CONTINUE_LABEL = 'Continue';
const SUBMIT_LABEL = 'Check this';
const ACCEPT_LABEL = 'Keep this';
/** `renderAcceptedPhase`'s own inline literal (`explain-back/modal.ts`). */
const DONE_LABEL = 'Done';

// Invented, never copied from any real note — see this file's own module doc.
const INVENTED_ANSWER =
  'This works because each step causes the next one directly: the trigger sets the process ' +
  'off, and the outcome follows from evidence the material actually shows, not just something ' +
  'that seems to fit.';

test(`@auto-web:simulator/journeys/explain-back ${WORLD}/${PERSONA} — explain a concept back and receive the verdict`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // The same fallback `driverExplain` uses when no concept is named: the first vault file's
  // basename. Read in the page and typed straight back into the modal — never logged.
  const topic = await page.evaluate(() => {
    const driver = window.__oleaSimulatorDriver;
    if (driver === undefined) throw new Error('explain-back journey: no simulator driver.');
    const [first] = driver.listFilePaths();
    if (first === undefined) throw new Error('explain-back journey: the vault has no files.');
    const base = first.split('/').pop() ?? first;
    return base.replace(/\.[^./]+$/, '');
  });

  const invoked = await page.evaluate(
    (id) => window.__oleaSimulatorDriver?.runCommand(id) ?? false,
    EXPLAIN_BACK_COMMAND_ID,
  );
  expect(invoked, `${EXPLAIN_BACK_COMMAND_ID} is not registered right now`).toBe(true);

  const modal = page.locator('.olea-explain-back');
  await expect(modal).toBeVisible();
  const topicInput = modal.locator('.olea-explain-back-topic');
  await topicInput.fill(topic);
  await captureJourneyStep(page, JOURNEY, WEEK, 'topic');
  await modal.getByRole('button', { name: CONTINUE_LABEL, exact: true }).click();

  // Either the answer box (the topic resolved against her notes) or a refusal (nothing to grade
  // against) — both are real modal states; a refusal short-circuits to the same step names.
  const answerBox = modal.locator('.olea-explain-back-answer');
  const refusal = modal.locator('.olea-explain-back-refusal');
  await expect(answerBox.or(refusal).first()).toBeVisible({ timeout: 30_000 });
  if ((await refusal.count()) > 0) {
    await captureJourneyStep(page, JOURNEY, WEEK, 'answering');
    await captureJourneyStep(page, JOURNEY, WEEK, 'verdict');
    await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
    return;
  }

  await answerBox.fill(INVENTED_ANSWER);
  await captureJourneyStep(page, JOURNEY, WEEK, 'answering');
  await modal.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

  // The verdict (graded phase: `.olea-explain-back-actions`) or the check-failed refusal. On a
  // transport miss the refusal text is asserted, never skipped (F9.S5).
  const graded = modal.locator('.olea-explain-back-actions');
  await expect(graded.or(refusal).first()).toBeVisible({ timeout: 60_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'verdict');
  if ((await refusal.count()) > 0) {
    await expect(refusal).toHaveText(EXPLAIN_BACK_CHECK_FAILED_TEXT);
    await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
    return;
  }

  await modal.getByRole('button', { name: ACCEPT_LABEL, exact: true }).click();
  const done = modal.getByRole('button', { name: DONE_LABEL, exact: true });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
  await done.click();
  await expect(modal).toHaveCount(0);
});
