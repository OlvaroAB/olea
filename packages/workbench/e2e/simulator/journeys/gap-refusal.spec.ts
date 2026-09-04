/**
 * F9.S15 — journey "gap-refusal": forces gap's own on-device `'unavailable'` refusal via
 * WBX-27's vault-read fault-axis trigger — the lever for a surface with no Worker call at all
 * (`gap/provider.ts`'s `createLocalGapProvider`, entirely on-device by its own module doc;
 * `ol-43ur` [WBX-27]).
 *
 * The trigger is STICKY, not one-shot: `gap/view.ts`'s open path runs TWO real `load()` calls
 * per open (`main.ts`'s `revealGapView` always calls `refreshGapViews()` right after the
 * freshly-opened leaf's own `onOpen()`-triggered load), each reading multiple files
 * CONCURRENTLY, so a fixed-count trigger measured unsound in practice (`controller.ts`'s
 * `SimulatorFaultAxis` doc has the full argument and what was measured) — one call to
 * `forceNextVaultReadFailure()` here fails every vault read for the rest of this test.
 *
 * Step captured: refused, once `GapView`'s own `renderUnavailable` (STY-0h, `[D-089]`'s two-cue
 * solid-edge/returning-arrow family — never the dashed "absence" edge a genuine empty result
 * uses elsewhere on this same pane) is on screen.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  driverForceNextVaultReadFailure,
  driverRunCommand,
  frame,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'gap-refusal';
const WEEK = 0;

/** `OLEA_COMMAND_GAP_OPEN` (`packages/plugin/src/commands/ids.ts`), restated as a literal per this suite's convention. */
const GAP_COMMAND_ID = 'olea-gap-open';

test(`@auto-web:simulator/journeys/gap-refusal ${WORLD}/${PERSONA} — a forced vault-read fault reads as gap's own could-not-check refusal`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // Armed immediately before the one gesture whose vault reads must fail — sticky from here on,
  // so both of gap's own load() calls (onOpen and the follow-up refresh) fail, and the FINAL
  // render stays 'unavailable' rather than the second call silently succeeding. Never touches
  // the transport, so this can never be confused with the `unavailable` no-Worker-configured
  // branch `[D-089]` keeps distinct.
  await driverForceNextVaultReadFailure(page);
  const invoked = await driverRunCommand(page, GAP_COMMAND_ID);
  expect(invoked, `${GAP_COMMAND_ID} is not registered right now`).toBe(true);

  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  const refusal = frame(page).locator('.olea-gap-unavailable');
  await expect(refusal).toBeVisible({ timeout: 30_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'refused');
});
