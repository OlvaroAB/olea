/**
 * F9.S5 — journey "explain-back": explain a concept back and receive the verdict (F5.1's
 * on-demand explain-back door). `ol-3ux7.64.18` [WBX-16].
 *
 * Driven entirely through `window.__oleaSimulatorDriver.explain(text)` (WBX-16c) — the same
 * `OLEA_COMMAND_EXPLAIN_BACK` invocation and modal round trip a real typed answer and click take
 * (`controller.ts`'s `driverExplain`). The invented answer text is generic and never copied from
 * any real note (CLAUDE.md's "never quote").
 *
 * Steps captured: topic, answering (or, on a refusal, whatever the modal actually shows next),
 * outcome. A cassette miss — guaranteed on the fixture world, which bundles no
 * `simulator-cassette.json` (`controller.ts`'s `loadReplayCassette` doc) — renders
 * `EXPLAIN_BACK_CHECK_FAILED_TEXT`, and this journey asserts that text is on screen rather than
 * skipping the step, per F9.S5.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  driverExplain,
  EXPLAIN_BACK_CHECK_FAILED_TEXT,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'explain-back';
const WEEK = 0;

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

  // Fire the real explain() gesture and capture whatever intermediate DOM is up as it resolves —
  // the driver runs the whole modal round trip in one call (see `journeys-helpers.ts`'s own
  // doc), so this journey captures a "topic" step right before invoking it (the surface it is
  // about to reach, F5.1) and then the settled outcome once the call returns.
  await captureJourneyStep(page, JOURNEY, WEEK, 'topic');

  const outcome = await driverExplain(page, INVENTED_ANSWER);

  await captureJourneyStep(page, JOURNEY, WEEK, 'answering');

  expect(['graded', 'degraded', 'unavailable']).toContain(outcome.outcome);

  if (outcome.outcome === 'unavailable' && outcome.reason === EXPLAIN_BACK_CHECK_FAILED_TEXT) {
    // A transport miss — assert the plugin's own degradation-shaped refusal is actually on
    // screen at this step, never skipped. The modal renders in the TOP document
    // (`[data-wb-modal-host]`, `Modal.open()`'s own doc), never inside the simulator's iframe.
    await expect(page.locator('.olea-explain-back-refusal')).toHaveText(
      EXPLAIN_BACK_CHECK_FAILED_TEXT,
    );
  }

  await captureJourneyStep(page, JOURNEY, WEEK, 'outcome');
});
