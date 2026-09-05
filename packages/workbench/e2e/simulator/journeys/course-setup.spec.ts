/**
 * F9.S16 — journey "course-setup": ol-l5og.19's golden-capturing path for `CourseSetupModal`
 * (piece 2 only; piece 1, a real design kit for this surface, is separate, David-owned work the
 * same bead names — this file does not attempt it).
 *
 * `CourseSetupModal` is an Obsidian `Modal`, never ribbon-registered, so `tour.spec.ts`'s own
 * module doc names the mechanism gap this journey closes: the automated tour "opens EVERY view
 * the plugin currently registers (read off the ribbon...)", which structurally cannot reach a
 * Modal. This journey reaches it instead through the SAME production trigger `main.ts`'s
 * cold-start course-detection scan uses (`checkForCourseSetupProposals` →
 * `openNextCourseSetupProposal`, `main.ts`'s own doc just above that pair) — no plugin edit, no
 * driver hook, no ItemView promotion. On the FIXTURE world specifically, the vault's own two
 * course-shaped folders (`01 Courses/GEOL204`, `01 Courses/MUSTH104` —
 * `packages/core/fixtures/vault`, `detectCourseProposals`'s alphabetical sort) already fire that
 * scan on a fresh mount; `../helpers.ts`'s `gotoSimulator` already dismisses those very modals via
 * `dismissCourseSetupModals` before any other journey ever sees them (that file's own module doc).
 * A persona world's own synthetic vault proposes its OWN course codes — this journey never assumes
 * a literal name, only the DOM shape (see "READS STATE, NEVER ASSUMES A CODE" below), which is
 * what let it run unmodified across fixture/steady/crammer/real (WBX-26's own per-world sweep).
 *
 * `gotoSimulatorKeepingModals` below duplicates `gotoSimulator`'s two navigation lines
 * (`page.goto` + `waitForSettled`) rather than reusing it — the one thing this journey needs done
 * differently is skipping that dismiss call, not worth widening `gotoSimulator`'s shared shape for
 * one caller (this lane owns only this journey file, not `../helpers.ts`).
 *
 * ONE PHASE REACHED, NOT THREE. `confirmation-view.ts`'s own module doc and
 * `openNextCourseSetupProposal`'s own doc both name the same gap: this production call site
 * always passes `recognitionClaims: []` and omits `kinshipCandidateCourse`, so
 * `renderRecognitionClaims`/`renderKinshipControl` paint nothing for a modal opened this way —
 * "recognition" and "kinship" are not states this trigger reaches today, so only "confirmation"
 * (heading, name input, root path, and the first-read readout — `firstRead` is always non-empty
 * here) is captured. Capturing the other two would be a fabricated golden of a state nothing
 * production-shaped produces; the bead's piece 1 (a real design kit) is where they get drawn
 * instead, once commissioned.
 *
 * READS STATE, NEVER ASSUMES A CODE. An earlier version of this file hardcoded `'GEOL204'`/
 * `'MUSTH104'` as the expected name-input values — correct for the fixture world, and WRONG the
 * moment this same spec ran against a persona world (`steady`'s own synthetic vault proposed
 * `'QUORBIN'` first, failing the literal assertion). Fixed to read the input's own value back and
 * compare it against itself across the confirm, never a hardcoded string: the property this
 * journey actually needs to prove is "a genuinely NEW proposal replaced the confirmed one", which
 * holds regardless of what any world's own detection happens to name its courses.
 *
 * ZERO, ONE OR MANY — ALL REAL. A world/vault pairing with no unseen course-shaped folder at all
 * reaches an honest empty-queue state with no modal at all; captured as "nothing to show" (no
 * golden forced), the same "a real, honest state" posture `open-registry-row.spec.ts` takes for
 * its own empty case. A world proposing only one course reaches "closed" instead of "chained"
 * after the first confirm — also honest, also not padded into a fabricated second phase. A world
 * proposing three or more is drained by the same bounded click-if-present loop
 * `dismissCourseSetupModals` (`../helpers.ts`) already uses for this exact cleanup, so nothing is
 * left open for whatever runs next in the same worker.
 *
 * TWO PROPOSALS, ONE AT A TIME (C7.8/`[D-098]`'s own "asked about one at a time rather than
 * stacked"). Confirming the first chains straight into the second via `onConfirm`'s own
 * `void this.openNextCourseSetupProposal(vault)` — captured as its own step ("chained") because
 * it is the one behaviour unique to this modal a single "opened" golden would never show.
 * `Modal.close()` (`obsidian-shim/index.ts`) removes `containerEl` from the DOM outright on
 * confirm, so exactly one `.olea-course-setup-confirmation` is ever present at a time — never two
 * stacked — which is what the count checks below rely on.
 *
 * SCREENSHOT SCOPE: `CourseSetupModal` renders into the TOP document's `[data-wb-modal-host]`, a
 * SIBLING of the simulator's own iframe (`obsidian-shim/index.ts`'s `Modal.open()` doc), never
 * inside it — so every locator below is `page.locator(...)`, never `frame(page)`, matching
 * `dismissCourseSetupModals`'s own scoping. `captureJourneyStep` still works unmodified: the
 * modal host is a fixed, full-viewport overlay (`workbench.css`'s `.wb-modal-host`), so it paints
 * over the same screen region `hostFrameElement(page)` (`[data-wb-surface]`)'s bounding box
 * occupies — the identical pattern `explain-back.spec.ts` already relies on for its own
 * top-document modal goldens.
 */
import { expect, type Page, test } from '@playwright/test';
import { waitForSettled } from '../../helpers.js';
import { SIMULATOR_STATE_ID } from '../helpers.js';
import { captureJourneyStep, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'course-setup';
const WEEK = 0;

/** `confirmation-view.ts`'s own class names, restated as literals per this suite's convention (`journeys-helpers.ts`'s header note). */
const CONFIRMATION_SELECTOR = '.olea-course-setup-confirmation';
const NAME_INPUT_SELECTOR = '.olea-course-setup-name-input';
const CONFIRM_BUTTON_SELECTOR = '.olea-course-setup-confirm';

/** `gotoSimulator`'s own two lines (`../helpers.ts`), minus its `dismissCourseSetupModals()` call — see this file's module doc for why skipping that one line is the whole point of not reusing it. */
async function gotoSimulatorKeepingModals(page: Page): Promise<void> {
  await page.goto(`/#/simulator?world=${WORLD}&persona=${PERSONA}`);
  await waitForSettled(page, SIMULATOR_STATE_ID);
}

test(`@auto-web:simulator/journeys/course-setup ${WORLD}/${PERSONA} — CourseSetupModal's confirmation phase, and the queued second proposal`, async ({
  page,
}) => {
  await gotoSimulatorKeepingModals(page);

  const confirmations = page.locator(CONFIRMATION_SELECTOR);
  const currentNameValue = () => confirmations.first().locator(NAME_INPUT_SELECTOR).inputValue();

  // The cold-start scan is async and fire-and-forget (`checkForCourseSetupProposals`'s own doc)
  // — give it a moment to open its first proposal, or settle on none: a real, honest state this
  // world/vault pairing may reach if `detectCourseProposals` finds no unseen course-shaped folder
  // at all (never fabricated — this journey reports "nothing to show" rather than forcing one).
  await confirmations
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => undefined);
  if ((await confirmations.count()) === 0) {
    await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
    return;
  }

  const firstValue = await currentNameValue();
  await captureJourneyStep(page, JOURNEY, WEEK, 'confirmation');

  await page.locator(CONFIRM_BUTTON_SELECTOR).first().click();

  // `onConfirm` chains straight into the next queued proposal, one at a time, never stacked
  // (C7.8/`[D-098]`) — or resolves to an empty queue on a world with only one unseen course-shaped
  // folder, an honest closing state rather than a fabricated second phase. Polled rather than a
  // fixed wait: `Modal.close()` removes the confirmed instance synchronously, but the next
  // proposal (if any) opens only once `openNextCourseSetupProposal`'s own vault-list/detect round
  // trip resolves.
  await expect
    .poll(
      async () => {
        const count = await confirmations.count();
        if (count === 0) return 'closed';
        if (count !== 1) return 'stacked';
        return (await currentNameValue()) === firstValue ? 'stale' : 'chained';
      },
      {
        timeout: 15_000,
        message:
          'course-setup journey: the modal queue did not resolve to either "closed" or a ' +
          'genuinely new "chained" proposal after confirming the first',
      },
    )
    .toMatch(/^(closed|chained)$/);

  if ((await confirmations.count()) > 0) {
    await captureJourneyStep(page, JOURNEY, WEEK, 'chained');
  }

  // Drain whatever remains (a world may propose more than two courses) so no modal is left open
  // for whatever runs next — the same bounded click-if-present loop `dismissCourseSetupModals`
  // (`../helpers.ts`) already uses for this exact cleanup.
  for (let round = 0; round < 8; round += 1) {
    // eslint-disable-next-line no-await-in-loop -- each round must settle before the next.
    await page.waitForTimeout(150);
    const confirmButton = page.locator(CONFIRM_BUTTON_SELECTOR).first();
    // eslint-disable-next-line no-await-in-loop -- see above.
    if ((await confirmButton.count()) > 0) await confirmButton.click();
  }
  await expect(confirmations).toHaveCount(0);
});
