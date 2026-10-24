/**
 * F9.S15 — journey "explain-back-check-failed" (`ol-43ur` [WBX-27]), rewritten for v0.9's
 * ungraded practice view (`[D-603]`, `ol-egov.141.89.6.129`). It used to force explain-back's
 * transient check-failed refusal through WBX-27's fault axis; in v0.9 no check runs, so there is
 * nothing for a fault to fail. It now proves exactly that, in the real plugin: with the fault
 * armed immediately before "Show the passages", the passages still appear and no check-failed
 * refusal can be drawn, because no Worker call follows an answer (F5.2 as amended).
 *
 * Reuses `explain-back.spec.ts`'s own real-gesture sequence through the topic step (the same
 * default-topic derivation, `driverExplain`'s own `defaultExplainTopic` rule — see that file's
 * module doc).
 *
 * Step captured: passages — or, on a world whose default topic genuinely resolves to nothing, the
 * real insufficient-notes refusal captured honestly instead, under the same step name.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  driverForceNextTransportFailure,
  EXPLAIN_BACK_CHECK_FAILED_TEXT,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'explain-back-check-failed';
const WEEK = 0;

/** `OLEA_COMMAND_EXPLAIN_BACK` (`packages/plugin/src/commands/ids.ts`), restated as a literal per this suite's convention (`explain-back.spec.ts`'s own header note). */
const EXPLAIN_BACK_COMMAND_ID = 'olea-explain-back';
const CONTINUE_LABEL = 'Continue';
/** Vocabulary registry §39's words, same convention. */
const SUBMIT_LABEL = 'Show the passages';
const PASSAGES_HEADING = 'From your notes';

// Invented, never copied from any real note — see `explain-back.spec.ts`'s own module doc.
const INVENTED_ANSWER =
  'This works because each step causes the next one directly: the trigger sets the process ' +
  'off, and the outcome follows from evidence the material actually shows, not just something ' +
  'that seems to fit.';

test(`@auto-web:simulator/journeys/explain-back-check-failed ${WORLD}/${PERSONA} — a forced transport fault cannot reach the practice view: no Worker call follows an answer`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  const topic = await page.evaluate(() => {
    const driver = window.__oleaSimulatorDriver;
    if (driver === undefined) {
      throw new Error('explain-back-check-failed journey: no simulator driver.');
    }
    const [first] = driver.listFilePaths();
    if (first === undefined) {
      throw new Error('explain-back-check-failed journey: the vault has no files.');
    }
    const base = first.split('/').pop() ?? first;
    const withExtensionStripped = /^(.+)\.[^./]+$/.exec(base);
    return withExtensionStripped === null ? base : (withExtensionStripped[1] ?? base);
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
  await modal.getByRole('button', { name: CONTINUE_LABEL, exact: true }).click();

  const answerBox = modal.locator('.olea-explain-back-answer');
  const refusal = modal.locator('.olea-explain-back-refusal');
  await expect(answerBox.or(refusal).first()).toBeVisible({ timeout: 30_000 });
  if ((await refusal.count()) > 0) {
    // A real, honest state: this world's default topic resolved to nothing before an answer box
    // existed — capture it rather than fabricating a reach past a real refusal.
    await captureJourneyStep(page, JOURNEY, WEEK, 'passages');
    return;
  }

  await answerBox.fill(INVENTED_ANSWER);
  // Armed immediately before the one gesture that, in the graded view, made the Worker call this
  // fault would have failed. In v0.9 that gesture makes no call, so the fault has nothing to hit.
  await driverForceNextTransportFailure(page);
  await modal.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

  await expect(
    modal.locator('.olea-explain-back-heading', { hasText: PASSAGES_HEADING }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(modal.getByText(EXPLAIN_BACK_CHECK_FAILED_TEXT, { exact: true })).toHaveCount(0);
  await expect(refusal).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, WEEK, 'passages');
});
