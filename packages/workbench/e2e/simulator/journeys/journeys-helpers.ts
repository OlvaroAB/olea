/**
 * Helpers for the WBX-16 journeys (`ol-3ux7.64.18`, `docs/dev/simulator-design.md` §7,
 * `features/F9-simulator.md` F9.S5's journey scenarios) — scripted flows through the plugin's
 * OWN registered commands, views and rendered gestures, one golden per step, never a simulator
 * shortcut standing in for a student action.
 *
 * READ-ONLY IMPORTS ONLY. This file only ever reads `../helpers.js` (this suite's existing
 * navigation/control rig — `gotoSimulator`, `resetSimulator`, `frame`, `hostFrameElement`) and
 * `../tour-helpers.js` (`advanceWeeksViaDriver`, `fetchWorldDescriptor`) — nothing here edits
 * either file, matching this lane's brief.
 *
 * GOLDEN NAMING (F9.S5): `simulator/<world>/<persona>/<week>--journey-<name>--<step>.png`,
 * resolved through the SAME `snapshotPathTemplate` seam the tour uses
 * (`playwright.config.ts`'s `simulator` project, `WB_SIM_WORLD`/`WB_SIM_GOLDENS`/`WB_SIM_PERSONA`
 * env — see `tour.spec.ts`'s own module doc for the full seam).
 *
 * REAL GESTURES, NEVER A SIMULATOR SHORTCUT. `window.__oleaSimulatorDriver.rateNextDue()` is a
 * one-click write shortcut (`controller.ts`'s own doc: "a one-click shortcut for exercising write
 * scenarios without running a full review session") — never used by a journey spec. Rating a
 * review item here means the real reveal-then-rate gesture (`review/keymap.ts`: Space to reveal,
 * a click on `.olea-review-rating-btn--good` to rate; an MCQ clicks
 * `.olea-review-mcq-option` then `.olea-review-mcq-footer`'s primary action) — the identical DOM
 * a real click/keypress drives, per F2.2. The driver's `explain`/`contest`/`openRegistry` methods
 * (WBX-16c) ARE real-gesture drivers themselves (they click the same rendered buttons a tap
 * would) and are used directly for those three journeys.
 */
import { expect, type Page } from '@playwright/test';
import { frame, hostFrameElement } from '../helpers.js';

export { frame, hostFrameElement };

/** `EXPLAIN_BACK_CHECK_FAILED_REFUSAL` (`packages/plugin/src/review/copy.ts`) — the transient,
 * transport-miss-shaped explain-back refusal (C4.7/`[D-089]`'s "the check itself failed", never
 * a claim about her notes). Restated here as a literal, matching this suite's existing convention
 * of addressing product copy by its own text rather than importing plugin source into a
 * Playwright spec (`helpers.ts`'s own header note on the same convention for command ids). */
export const EXPLAIN_BACK_CHECK_FAILED_TEXT =
  "Olea couldn't check this explanation against your notes just now, so nothing was graded. Try again in a moment.";

/** F7.8's own degradation phrasing (`packages/plugin/src/settings/degradation-statement.ts`) — restated as a pattern, same convention `tour-helpers.ts`'s `DEGRADATION_PATTERN` already uses. */
export const DEGRADATION_PATTERN =
  /could not reach the worker|olea works without ai|could not reach on this pass|olea: could not/i;

export const WORLD = process.env.WB_SIM_WORLD ?? 'fixture';
export const PERSONA = process.env.WB_SIM_PERSONA ?? 'none';

/** One golden per journey step, named exactly per F9.S5: `<week>--journey-<name>--<step>.png`. */
export async function captureJourneyStep(
  page: Page,
  journey: string,
  week: number,
  step: string,
): Promise<void> {
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  await expect(hostFrameElement(page)).toHaveScreenshot([
    WORLD,
    PERSONA,
    `${String(week)}--journey-${journey}--${step}.png`,
  ]);
}

type DriverWindow = {
  __oleaSimulatorDriver?: {
    explain(text: string, conceptRef?: string): Promise<{ outcome: string; reason?: string }>;
    contest(target: 'review' | 'today'): Promise<{ outcome: string; reason?: string }>;
    openRegistry(): Promise<void>;
  };
};

/** `window.__oleaSimulatorDriver.explain(text)` — top-level window, never frame-scoped (see `tour-helpers.ts`'s own doc on why). */
export async function driverExplain(
  page: Page,
  text: string,
): Promise<{ outcome: string; reason?: string }> {
  return page.evaluate(async (t) => {
    const driver = (window as unknown as DriverWindow).__oleaSimulatorDriver;
    if (driver === undefined)
      throw new Error('driverExplain: window.__oleaSimulatorDriver is not installed.');
    return driver.explain(t);
  }, text);
}

export async function driverContest(
  page: Page,
  target: 'review' | 'today',
): Promise<{ outcome: string; reason?: string }> {
  return page.evaluate(async (t) => {
    const driver = (window as unknown as DriverWindow).__oleaSimulatorDriver;
    if (driver === undefined)
      throw new Error('driverContest: window.__oleaSimulatorDriver is not installed.');
    return driver.contest(t);
  }, target);
}

export async function driverOpenRegistry(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const driver = (window as unknown as DriverWindow).__oleaSimulatorDriver;
    if (driver === undefined)
      throw new Error('driverOpenRegistry: window.__oleaSimulatorDriver is not installed.');
    await driver.openRegistry();
  });
}

/**
 * One item of the review queue, rated by the REAL rendered gesture (F2.2): an MCQ front clicks an
 * option then the footer's primary action; a Q&A/cloze front is revealed by focusing the root and
 * pressing Space (the ONLY way to reveal — there is no clickable reveal control, see
 * `review/view.ts`: reveal is keyboard-only), then a rating button is clicked directly. Returns
 * the screen kind reached BEFORE acting on it, or `'empty'`/`'complete'` if the queue has nothing
 * left — never fabricated, read off the real DOM each time.
 */
export async function reviewScreenKind(
  page: Page,
): Promise<'empty' | 'complete' | 'mcq' | 'note-missing' | 'card'> {
  // `.olea-review-body` is the wrapper EVERY screen kind renders (front, reveal, mcq-open,
  // mcq-answered, empty, complete, note-missing — `review/view.ts`'s own render* methods) —
  // waiting for it to actually be attached before branching avoids reading a transient,
  // still-rendering DOM state between one item's transition and the next (observed failure mode:
  // a bare read landing in the brief gap right after a re-render started).
  await frame(page)
    .locator('.olea-review-body')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
  if ((await frame(page).locator('.olea-review-empty').count()) > 0) return 'empty';
  if ((await frame(page).locator('.olea-review-complete').count()) > 0) return 'complete';
  if ((await frame(page).locator('.olea-review-note-missing').count()) > 0) return 'note-missing';
  if ((await frame(page).locator('.olea-review-mcq-option').count()) > 0) return 'mcq';
  return 'card';
}

/** `.olea-review-note-missing`'s real "Skip for now" click gesture — its source note was deleted from the vault since the item was scheduled (`review/view.ts`'s `renderNoteMissing`), a real state the review loop must move past rather than fail on. */
/**
 * Clicks `selector` and then waits for the CURRENT `.olea-review-body` to be replaced — every
 * review gesture that advances the queue re-renders the whole body (`review/view.ts`'s
 * `render*` methods empty and rebuild it), so "the old body is detached" is the honest signal
 * that the next screen is the one being read. Without it, `reviewScreenKind` read the previous
 * card's body in the gap after the click (`ol-3ux7.64.18`'s fixture run: the last rating's
 * stale body read as a card, Space on the not-yet-rendered complete screen did nothing).
 */
async function clickAndWaitForNextScreen(page: Page, selector: string): Promise<void> {
  const current = frame(page).locator('.olea-review-body').first();
  const handle = await current.elementHandle({ timeout: 10_000 });
  await frame(page).locator(selector).click();
  if (handle !== null) {
    await handle.waitForElementState('hidden', { timeout: 10_000 }).catch(() => undefined);
    await handle.dispose();
  }
}

export async function skipNoteMissing(page: Page): Promise<void> {
  await clickAndWaitForNextScreen(page, '.olea-review-note-missing .olea-review-primary-action');
}

/** {@link reviewScreenKind}, skipping past any leading `note-missing` items (a real, unremarkable state — see {@link skipNoteMissing}'s own doc) so a journey's own "revealed"/"rated" steps land on an actual ratable item, or on `empty`/`complete` honestly. Bounded (10 skips) for the same reason {@link rateRemainingQueue} bounds its own loop. */
export async function firstRatableScreenKind(
  page: Page,
): Promise<'empty' | 'complete' | 'mcq' | 'card'> {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each skip must settle before the next check.
    const kind = await reviewScreenKind(page);
    if (kind !== 'note-missing') return kind;
    // eslint-disable-next-line no-await-in-loop -- see above.
    await skipNoteMissing(page);
  }
  throw new Error('firstRatableScreenKind: still on note-missing after 10 skips.');
}

/** Reveals the current Q&A/cloze front — Space on the focused root — and waits for the four rating buttons. Never a click: there is no click-based reveal (see this module's own doc). */
export async function revealCard(page: Page): Promise<void> {
  const ratingButtons = frame(page).locator('.olea-review-rating-btn');
  // Retried, not a single shot: right after a transition into a fresh card front, focus can
  // occasionally not yet be settled on `.olea-review-root` when the first Space fires (an
  // observed flake, not a logic error). Checks BEFORE each press, never presses twice in a row
  // blind: `review/keymap.ts`'s 'reveal' state maps a SECOND Space to `flip-back`, so pressing
  // again once already revealed would undo it rather than being a harmless no-op retry.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- each attempt must resolve before the next.
    if ((await ratingButtons.count()) === 4) return;
    // eslint-disable-next-line no-await-in-loop -- see above.
    await frame(page).locator('.olea-review-root').focus();
    // eslint-disable-next-line no-await-in-loop -- see above.
    await page.keyboard.press('Space');
    // Wait for the reveal render itself, not a fixed 200ms: the four buttons attach a beat after
    // the keydown, and a fixed pause shorter than that beat made the NEXT iteration read 0, press
    // Space again, and flip the card back (`ol-3ux7.64.18`'s fixture run — 0 buttons after five
    // presses, every one of them a reveal undone by the next).
    // eslint-disable-next-line no-await-in-loop -- see above.
    await ratingButtons
      .first()
      .waitFor({ state: 'attached', timeout: 2_000 })
      .catch(() => undefined);
  }
  await expect(ratingButtons).toHaveCount(4);
}

/** Clicks the real `.olea-review-rating-btn--good` gesture — the same button a tap on "good" would click. */
export async function clickRatingGood(page: Page): Promise<void> {
  await clickAndWaitForNextScreen(page, '.olea-review-rating-btn--good');
}

/** Answers the current MCQ by clicking its first option (a real click gesture), waits for feedback, then advances via the footer's real "next item" button. */
export async function answerAndAdvanceMcq(page: Page): Promise<void> {
  await frame(page).locator('.olea-review-mcq-option').first().click();
  await expect(frame(page).locator('.olea-review-mcq-feedback')).toBeVisible();
  await frame(page).locator('.olea-review-mcq-footer .olea-review-primary-action').click();
  // Settle before returning control: whatever screen comes next (another unanswered MCQ, a
  // card front, or the empty/complete state), none of them carry a `.olea-review-mcq-feedback`
  // element — waiting for it to be gone is what stops the NEXT loop iteration's locator from
  // racing this transition and resolving a stale, mid-detach element (observed failure mode).
  await expect(frame(page).locator('.olea-review-mcq-feedback')).toHaveCount(0);
}

/**
 * Rates every remaining item in the queue by the real gesture, with NO golden per item (only the
 * caller's own named steps are captured) — a bounded loop (50 items, generous over any fixture
 * world's due count) so a real defect (the queue never emptying) fails loudly rather than hanging
 * the suite.
 */
export async function rateRemainingQueue(page: Page): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each rating must settle before the next.
    const kind = await reviewScreenKind(page);
    if (kind === 'empty' || kind === 'complete') return;
    if (kind === 'mcq') {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await answerAndAdvanceMcq(page);
    } else if (kind === 'note-missing') {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await skipNoteMissing(page);
    } else {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await revealCard(page);
      // eslint-disable-next-line no-await-in-loop -- see above.
      await clickRatingGood(page);
    }
  }
  throw new Error('rateRemainingQueue: queue did not empty within 50 real-gesture ratings.');
}
