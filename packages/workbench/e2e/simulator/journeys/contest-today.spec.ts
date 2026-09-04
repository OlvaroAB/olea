/**
 * F9.S5 — journey "contest-today": contest the Today panel's reading (D-046's four-part test —
 * a contested READING moves nothing and is discounted by nothing; it stands wearing her dissent).
 * `ol-3ux7.64.18` [WBX-16].
 *
 * Driven through `window.__oleaSimulatorDriver.contest('today')` (WBX-16c) — the same
 * `.olea-today-contest-gesture` click and `.olea-today-contest-record` sheet-button click a real
 * tap takes (`controller.ts`'s `driverContest`).
 *
 * Steps captured: before, after. The outcome (`'recorded'` or `'unavailable'` — no gesture
 * rendered right now, a real walkable state) is asserted rather than assumed.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { captureJourneyStep, driverContest, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'contest-today';
const WEEK = 0;

test(`@auto-web:simulator/journeys/contest-today ${WORLD}/${PERSONA} — contest the Today panel's reading`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  await captureJourneyStep(page, JOURNEY, WEEK, 'before');

  // `driverContest('today')` polls for the dispute sheet to close after recording
  // (`controller.ts`'s own `DRIVER_POLL_TIMEOUT_MS`) and THROWS if that poll times out. A throw
  // here is a real defect, never a settle-timing question: the sheet closes only when
  // `recordDispute` (`today/view.ts`) completes, and the one way it does not is
  // `contestClaim` throwing inside it — `ol-3ux7.64.20` (a gesture rendered for a claim with
  // no concepts). So the golden is still captured (the open sheet IS the evidence), and then
  // the journey fails with the driver's own message rather than logging it away.
  let outcome: { outcome: string; reason?: string } | null = null;
  let driverError: string | null = null;
  try {
    outcome = await driverContest(page, 'today');
  } catch (error) {
    driverError = error instanceof Error ? error.message : String(error);
  }
  await captureJourneyStep(page, JOURNEY, WEEK, 'after');
  expect(driverError, 'driverContest threw — see ol-3ux7.64.20').toBeNull();
  expect(['recorded', 'unavailable']).toContain(outcome?.outcome);
});
