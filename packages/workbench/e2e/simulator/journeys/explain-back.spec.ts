/**
 * F9.S5 — journey "explain-back": explain a concept back and read the passages (F5.1's on-demand
 * explain-back door). `ol-3ux7.64.18` [WBX-16]; rewritten for v0.9's ungraded practice view
 * (`[D-603]`, words `[D-611]`; `ol-egov.141.89.6.129`).
 *
 * Driven by the REAL modal gestures, one Playwright action per thing she would do: the palette
 * command (`OLEA_COMMAND_EXPLAIN_BACK`, through the driver's generic `runCommand` — the same
 * `Plugin.invokeCommand` a palette pick takes), the topic typed into `.olea-explain-back-topic`
 * and "Continue" clicked, the answer typed into `.olea-explain-back-answer` and "Show the
 * passages" clicked, then "Done". It deliberately does NOT use `driver.explain(text)` (WBX-16c):
 * that entry drives the graded exchange this view no longer has.
 *
 * The topic is the vault's first file's basename — `driverExplain`'s own `defaultExplainTopic`
 * rule, restated here. The invented answer text is generic and never copied from any real note
 * (CLAUDE.md's "never quote").
 *
 * **No Worker call follows an answer** (F5.2 as amended): the passages are the ones the prompt's
 * lookup found when the topic resolved, so the step after "Show the passages" needs no cassette
 * entry of any kind, and no judge recording exists or is needed. The topic step's own retrieval is
 * unchanged.
 *
 * Steps captured: topic, answering, passages. "Done" then closes the view, which is asserted
 * rather than photographed (nothing of the view remains to capture).
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { captureJourneyStep, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'explain-back';
const WEEK = 0;

/** `OLEA_COMMAND_EXPLAIN_BACK` (`packages/plugin/src/commands/ids.ts`) — restated as a literal per this suite's convention (`helpers.ts`'s header note). */
const EXPLAIN_BACK_COMMAND_ID = 'olea-explain-back';
/** `packages/plugin/src/explain-back/copy.ts`'s labels (vocabulary registry §39), same convention. */
const CONTINUE_LABEL = 'Continue';
const SUBMIT_LABEL = 'Show the passages';
const PASSAGES_HEADING = 'From your notes';
const NOTICE = 'This is practice: nothing here is graded.';
const DONE_LABEL = 'Done';

// Invented, never copied from any real note — see this file's own module doc.
const INVENTED_ANSWER =
  'On this day there is one lecture in the morning, a seminar around midday, and a self-directed ' +
  'lab-prep block in the afternoon. Before the lab I still need to pick up new course material, ' +
  'and in the evening there is a short written response due for something studied recently. ' +
  'Afterward the two things left to review are one set of practice cards and a set of ' +
  'close-analysis questions.';

test(`@auto-web:simulator/journeys/explain-back ${WORLD}/${PERSONA} — explain a concept back and read the passages`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // The same fallback `driverExplain`'s `defaultExplainTopic` uses when no concept is named: the
  // first vault file's basename, extension stripped (at least one character before the final dot,
  // so a hidden file's name never collapses to `''`). Read in the page and typed straight back
  // into the modal — never logged.
  const topic = await page.evaluate(() => {
    const driver = window.__oleaSimulatorDriver;
    if (driver === undefined) throw new Error('explain-back journey: no simulator driver.');
    const [first] = driver.listFilePaths();
    if (first === undefined) throw new Error('explain-back journey: the vault has no files.');
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
  await captureJourneyStep(page, JOURNEY, WEEK, 'topic');
  await modal.getByRole('button', { name: CONTINUE_LABEL, exact: true }).click();

  // The answer box, whatever the lookup found: a topic with nothing found is no longer refused
  // ([D-629]); the view says so after her answer.
  const answerBox = modal.locator('.olea-explain-back-answer');
  await expect(answerBox).toBeVisible({ timeout: 30_000 });

  await expect(modal.getByText(NOTICE, { exact: true })).toBeVisible();
  await answerBox.fill(INVENTED_ANSWER);
  await captureJourneyStep(page, JOURNEY, WEEK, 'answering');
  await modal.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

  // The passages, at once: no wait line, no verdict, no check that could fail.
  await expect(
    modal.locator('.olea-explain-back-heading', { hasText: PASSAGES_HEADING }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(modal.locator('.olea-explain-back-refusal')).toHaveCount(0);
  await expect(modal.locator('.olea-explain-back-outcome')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Keep this', exact: true })).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, WEEK, 'passages');

  await modal.getByRole('button', { name: DONE_LABEL, exact: true }).click();
  await expect(modal).toHaveCount(0);
});
