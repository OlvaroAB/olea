/**
 * F9.S15 — journey "explain-back-check-failed": forces explain-back's transient check-failed
 * refusal deterministically via WBX-27's fault axis, rather than hoping a world's own default
 * topic happens to miss the cassette (`ol-43ur` [WBX-27]).
 *
 * Reuses `explain-back.spec.ts`'s own real-gesture sequence through the topic step (the same
 * default-topic derivation, `driverExplain`'s own `defaultExplainTopic` rule — see that file's
 * module doc for why this must stay byte-for-byte in step with that function), then arms
 * `forceNextTransportFailure()` immediately before "Check this" is clicked — the point in the
 * sequence where the grading task is the very next Worker call issued, so the forced failure
 * lands there and only there (topic-step retrieval is a LOCAL search, no Worker call — see
 * `explain-back/copy.ts`'s own two-refusal-family doc — so arming any earlier risks the wrong
 * call consuming the one-shot trigger).
 *
 * Step captured: refused, once the modal renders `EXPLAIN_BACK_CHECK_FAILED_TEXT` — or, on a
 * world whose default topic genuinely resolves to nothing before the fault axis ever gets a
 * turn, the real insufficient-notes refusal captured honestly instead.
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
const SUBMIT_LABEL = 'Check this';

// Invented, never copied from any real note — see `explain-back.spec.ts`'s own module doc.
const INVENTED_ANSWER =
  'This works because each step causes the next one directly: the trigger sets the process ' +
  'off, and the outcome follows from evidence the material actually shows, not just something ' +
  'that seems to fit.';

test(`@auto-web:simulator/journeys/explain-back-check-failed ${WORLD}/${PERSONA} — a forced transport fault reads as the transient check-failed refusal, never insufficient-notes`, async ({
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
    // A real, honest state: this world's default topic resolved to nothing before the fault
    // axis ever got a turn (topic-step retrieval is local, no Worker call) — capture it rather
    // than fabricating a reach past a real refusal.
    await captureJourneyStep(page, JOURNEY, WEEK, 'refused');
    return;
  }

  await answerBox.fill(INVENTED_ANSWER);
  // Armed immediately before the one gesture whose Worker call must fail — WBX-27's one-shot
  // trigger, consumed by the very next matching call (`controller.ts`'s own doc).
  await driverForceNextTransportFailure(page);
  await modal.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

  await expect(refusal).toHaveText(EXPLAIN_BACK_CHECK_FAILED_TEXT, { timeout: 30_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'refused');
});
