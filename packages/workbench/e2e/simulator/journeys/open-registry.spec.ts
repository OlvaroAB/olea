/**
 * F9.S5 — journey "open-registry": open the concept and instrument registry (F8.4).
 * `ol-3ux7.64.18` [WBX-16].
 *
 * Driven through `window.__oleaSimulatorDriver.openRegistry()` (WBX-16c) — the same
 * `OLEA_COMMAND_REGISTRY_OPEN` invocation a palette click takes (`controller.ts`'s
 * `driverOpenRegistry`).
 *
 * Step captured: opened, once the registry view leaf actually exists in the workspace.
 */
import { test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { captureJourneyStep, driverOpenRegistry, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'open-registry';
const WEEK = 0;

test(`@auto-web:simulator/journeys/open-registry ${WORLD}/${PERSONA} — open the registry`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  await driverOpenRegistry(page);

  await captureJourneyStep(page, JOURNEY, WEEK, 'opened');
});
