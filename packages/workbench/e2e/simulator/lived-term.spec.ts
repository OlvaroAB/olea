/**
 * F9.S2 — "The lived term: what she does today changes tomorrow"
 * (`features/F9-simulator.md`, `@auto-web:simulator/lived-term`).
 *
 * Drives `#/simulator` over the public fixture world through
 * `SimulatorController`'s real controls (`[data-sim-rate]`,
 * `[data-sim-advance]`, `[data-sim-reset]`) — never a URL parameter, since
 * this route has exactly one addressable state (`main.ts`'s
 * `DEFAULT_SIMULATOR_STATE`) and the whole point is that what changes lives
 * in the persisted vault and clock, not in the route.
 *
 * WHAT THIS DOES NOT COVER: the scenario "the clock override moves every
 * wall-time read the plugin makes" (scope source, misconception store,
 * materiality clock) would need hooks into those modules' own inspector
 * output that do not exist yet from outside the plugin; only the Today
 * panel's due count and the badge's own date span are asserted here as the
 * two externally-observable wall-time reads. Left for a follow-up rather
 * than asserted on faith.
 */
import { expect, test } from '@playwright/test';
import { waitForSettled } from '../helpers.js';
import {
  advanceDays,
  badgeDate,
  gotoSimulator,
  overlayEntryCount,
  overlayTotalBytes,
  rateNextDue,
  readDueCount,
  resetSimulator,
  sessionNotComposedNote,
  SIMULATOR_STATE_ID,
  scrubberDateLocator,
  scrubberLocator,
  scrubTo,
} from './helpers.js';

/**
 * `ol-egov.141.89.10.38` (root cause B of `ol-egov.141.89.10.34`): the
 * fixture world's clock (`../../src/clock.ts`'s `WORKBENCH_NOW`,
 * 2027-01-15) sits after every assessment the fixture vault originally
 * declared (the last was due 2026-11-27), so the oracle's C5.10
 * `'assessment-passed'` veto removed every concept's evidence and the real
 * composer (`composeStudySessionForRequest`) ranked nothing — Today read a
 * bare zero while she still had scheduled work. **Fixed by adding one new
 * assessment, not by moving the clock**: `packages/core/fixtures/vault/02
 * Assignments/Season Checkpoint - GEOL204.md`, due 2027-01-29 (14 days
 * past `WORKBENCH_NOW`, the same offset `ol-tq8f`'s persona-world fix used
 * for the identical veto). Moving `WORKBENCH_NOW` instead was rejected:
 * that constant is read by thirteen other workbench modules outside this
 * suite's `owns` (`timeline-scenarios.ts`, `trends-scenarios.ts`,
 * `oracle-scenarios.ts`, `main.ts`, and more), so it would have shifted
 * goldens this bead has no mandate to touch. Adding one fixture file keeps
 * every OTHER workbench golden byte-identical and only the 22 simulator
 * goldens named in this bead's acceptance move.
 *
 * Measured against the real production composer (a throwaway Vitest probe,
 * `packages/plugin/src/session-builder/provider.ts`'s
 * `composeStudySessionForRequest`, over `FolderSource` on the real fixture
 * vault, deleted after use — the identical discipline `[SESS-12]` used):
 * at `WORKBENCH_NOW` the composed session now has 3 items, all GEOL204,
 * `composed: true`. Past the new assessment's due date (verified at
 * `WORKBENCH_NOW` + 20 days) every course's evidence has passed again,
 * the composer ranks nothing, and `[D-373]`'s already-landed fallback
 * (`ol-egov.141.89.10.66`) takes over: Today falls back to the KNOWN due
 * count (13, the same legacy whole-vault enumeration `[SESS-12]` measured
 * as "13 due instruments across 2 courses") plus a separate sentence
 * naming why no session was composed — never a bare zero.
 *
 * **`[SESS-12]`'s own finding applies here unchanged**: the composed
 * session is a budget-filled composition rebuilt on remount, not a FIFO
 * drain, so rating an item is never asserted here as "the count minus
 * one" — see the two tests below that changed for this reason.
 */

test.describe.configure({ mode: 'parallel' });

test('@auto-web:simulator/lived-term — a review written today is there after a reload', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const before = await readDueCount(page);
  if (before === 'none' || before === 0) {
    throw new Error(
      'fixture world has nothing due at its snapshot instant — this test needs a due item to rate; see today-scenarios.ts / the fixture vault',
    );
  }

  await rateNextDue(page);
  // `ol-egov.141.89.10.38`: NOT asserted as `before - 1`. The due count is a
  // budget-filled composition rebuilt on remount (`[SESS-12]`,
  // `ol-egov.132.13`) — rating one item can leave the total unchanged (the
  // composer refills from the same ranked concept's other instrument),
  // lower it by one, or by more than one, depending on what else the same
  // remount's obligation replay now excludes. What this test needs is
  // persistence across a reload, not the arithmetic — so it reads the REAL
  // post-rate value and checks THAT survives, rather than a value this
  // suite would otherwise have to assume.
  const afterRate = await readDueCount(page);

  // Reload is a full page load — a fresh module evaluation, a fresh
  // SimulatorController.create(), and (per `SimulatorController.create`)
  // a fresh read of the SAME persisted IndexedDB store. If the rating only
  // lived in page memory, this would bounce back to `before`.
  await page.reload();
  await waitForSettled(page, SIMULATOR_STATE_ID);
  const afterReload = await readDueCount(page);
  expect(afterReload).toBe(afterRate);
});

test('@auto-web:simulator/lived-term — reset returns the world to its snapshot in one step', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const originalDate = (await badgeDate(page).textContent()) ?? '';
  const before = await readDueCount(page);
  if (before === 'none' || before === 0) {
    throw new Error('fixture world has nothing due at its snapshot instant — see the sibling test');
  }
  // Every fresh mount's own cold-start ingestion writes a deterministic,
  // stable set of `.olea/concepts/*.json` provenance rows into the overlay —
  // NOT a per-user event, and not zero even on an untouched snapshot (see
  // this file's module doc / the sibling "no fabrication" test, which relies
  // on the same fact). Reset's actual claim is "back to what a fresh mount
  // of the snapshot writes", not "back to nothing" — so the baseline read
  // right after this test's own first reset is what "reset" is compared
  // against below, not a literal 0.
  //
  // Byte total, not row count (`ol-3ux7.64.22` [WBX-19], `helpers.ts`'s
  // `overlayTotalBytes` doc): the fixture world's cold-start mount now
  // renders Home's standing retrospective offers, which writes one
  // `retrospective-offered` line per outstanding assessment into `asOf`'s
  // own review-log file before `rateNextDue` below ever runs — so that file
  // (one overlay ROW) already exists at this baseline, and `rateNextDue`'s
  // write lands as more bytes in the SAME row rather than a new one.
  // `overlayEntryCount` can no longer tell "wrote something, same day as the
  // baseline" apart from "wrote nothing"; the byte total still can.
  const baselineOverlay = await overlayTotalBytes(page);

  await rateNextDue(page);
  await advanceDays(page, 2);
  expect(await overlayTotalBytes(page)).toBeGreaterThan(baselineOverlay);

  await resetSimulator(page);
  expect(await overlayTotalBytes(page)).toBe(baselineOverlay);
  await expect(badgeDate(page)).toHaveText(originalDate);
  expect(await readDueCount(page)).toBe(before);
});

test('@auto-web:simulator/lived-term — a day with no session records no events', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const overlayBefore = await overlayEntryCount(page);
  await advanceDays(page, 7);
  const overlayAfter = await overlayEntryCount(page);

  // The overlay (`simulator/store.ts`) is the only place a vault write can
  // land — advancing the clock never calls `vault.write`/`vault.delete`, so
  // an unchanged row count is direct evidence nothing was fabricated for the
  // seven skipped days, not merely that one particular file stayed empty.
  expect(overlayAfter).toBe(overlayBefore);
});

test('@auto-web:simulator/lived-term — advancing a day re-mounts the plugin and moves the badge date', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const day0 = (await badgeDate(page).textContent()) ?? '';
  await advanceDays(page, 1);
  const day1 = (await badgeDate(page).textContent()) ?? '';
  expect(day1).not.toBe(day0);

  const expectedNext = new Date(`${day0}T00:00:00Z`);
  expectedNext.setUTCDate(expectedNext.getUTCDate() + 1);
  expect(day1).toBe(expectedNext.toISOString().slice(0, 10));
});

test('@auto-web:simulator/lived-term — a second day-advance shows no course-setup modal', async ({
  page,
}) => {
  // `ol-3ux7.64.11` [WBX-9]: every `remountPane()` used to construct a
  // BRAND NEW `OleaPlugin` whose in-memory `courseSetupSeenCodes` started
  // empty, so `CourseSetupModal` reopened for every course-shaped fixture
  // folder after every single control click — `[data-sim-advance]` included.
  // `resetSimulator` legitimately reopens the proposals once (it clears the
  // SAME shared plugin-data blob the seen-set now lives in — the one
  // legitimate reopen this bead's brief names) and its own guarded dismiss
  // resolves them; the assertion below is on the mount AFTER that, and the
  // one after THAT, so neither can be passing only because the reset's own
  // dismiss loop happened to still be draining.
  await gotoSimulator(page);
  await resetSimulator(page);

  await advanceDays(page, 1);
  await advanceDays(page, 1);

  // `[data-wb-modal-open]` is set on `[data-wb-modal-host]` in the TOP
  // document, never inside `[data-wb-surface]` (`obsidian-shim`'s
  // `Modal.open()` doc) — matching `dismissCourseSetupModals`' own query.
  await expect(page.locator('[data-wb-modal-open]')).toHaveCount(0);
});

// `ol-3ux7.64.16` [WBX-13] — the term scrubber. `docs/dev/simulator-design.md`
// §4b: bounded forward from asOf, forward is Advance made continuous,
// backward hides (never deletes) a later day's review-log record and forward
// restores it exactly.

test('@auto-web:simulator/lived-term — the term scrubber bounds forward from asOf and scrubbing forward is Advance made continuous', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);
  const asOf = (await badgeDate(page).textContent()) ?? '';

  const DAYS = 3;

  // Reference: three sequential day-advances from a fresh reset.
  await advanceDays(page, DAYS);
  const badgeViaAdvance = (await badgeDate(page).textContent()) ?? '';
  const dueViaAdvance = await readDueCount(page);
  expect(badgeViaAdvance).not.toBe(asOf);

  // The same three days, reached in one committed scrub from a fresh reset.
  await resetSimulator(page);
  await scrubTo(page, DAYS);

  expect(await scrubberLocator(page).inputValue()).toBe(String(DAYS));
  await expect(scrubberDateLocator(page)).toHaveText(badgeViaAdvance);
  await expect(badgeDate(page)).toHaveText(badgeViaAdvance);
  expect(await readDueCount(page)).toBe(dueViaAdvance);
});

test("@auto-web:simulator/lived-term — scrubbing backward hides a later day's review record, and scrubbing forward restores it exactly", async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  // Visit the EARLY day first, before anything anywhere has been rated, so
  // this reading is an honest baseline — not something computed after the
  // fact from a day that might itself have drifted.
  const EARLY_DAY = 1;
  await scrubTo(page, EARLY_DAY);
  const dueAtEarlyDayBeforeAnyRating = await readDueCount(page);
  const overlayBeforeAnyRating = await overlayEntryCount(page);

  // Move to a LATER day and rate — this writes a review-log record dated on
  // the later day only.
  const LATER_DAY = 3;
  await scrubTo(page, LATER_DAY);
  const dueAtLaterDayBeforeRating = await readDueCount(page);
  if (dueAtLaterDayBeforeRating === 'none' || dueAtLaterDayBeforeRating === 0) {
    throw new Error(
      'fixture world has nothing due at this scrubbed day — this test needs a due item to rate',
    );
  }
  await rateNextDue(page);
  // `ol-egov.141.89.10.38`: not asserted as `dueAtLaterDayBeforeRating - 1` —
  // see this file's module doc and the sibling reload test's own comment.
  // This test's actual claim is the hide/restore round trip below, which
  // reads whatever the REAL post-rate value is and checks it survives a
  // scrub away and back, never the decrement arithmetic itself.
  const dueAtLaterDayAfterRating = await readDueCount(page);
  const overlayAfterRating = await overlayEntryCount(page);
  expect(overlayAfterRating).toBeGreaterThan(overlayBeforeAnyRating);

  // Scrub BACK to the early day — the later day's record is dated after it,
  // so it is hidden: the early day's own due count is EXACTLY what it was
  // before the later rating ever happened, as if the future had not
  // occurred yet.
  await scrubTo(page, EARLY_DAY);
  expect(await readDueCount(page)).toBe(dueAtEarlyDayBeforeAnyRating);
  // Never deleted: the overlay still holds the hidden record while it is
  // hidden — only the READ side filtered it out.
  expect(await overlayEntryCount(page)).toBe(overlayAfterRating);

  // Scrub FORWARD again, past the later day — the record reappears exactly,
  // proving the hide-then-show round trip lost and fabricated nothing.
  await scrubTo(page, LATER_DAY);
  expect(await readDueCount(page)).toBe(dueAtLaterDayAfterRating);
  expect(await overlayEntryCount(page)).toBe(overlayAfterRating);
});

test('@auto-web:simulator/lived-term — reset returns the scrubber to asOf and unhides everything', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);
  const asOf = (await badgeDate(page).textContent()) ?? '';
  expect(await scrubberLocator(page).inputValue()).toBe('0');
  // Baseline recorded AT asOf, before this test moves anywhere — the only
  // due count a later comparison at asOf may honestly be checked against
  // (a due count recorded on a DIFFERENT day would drift for reasons that
  // have nothing to do with reset, per the sibling scrub test's own doc).
  const dueAtAsOfBaseline = await readDueCount(page);

  await scrubTo(page, 2);
  const before = await readDueCount(page);
  if (before === 'none' || before === 0) {
    throw new Error('fixture world has nothing due at this scrubbed day — this test needs one');
  }
  await rateNextDue(page);
  // Scrub back — hides the record just rated, exercising the exact state
  // reset must be able to clear.
  await scrubTo(page, 1);

  await resetSimulator(page);

  expect(await scrubberLocator(page).inputValue()).toBe('0');
  await expect(scrubberDateLocator(page)).toHaveText(asOf);
  await expect(badgeDate(page)).toHaveText(asOf);
  // "Unhides everything": the overlay reset alongside the clock, so there is
  // nothing left for the cutoff — now back at asOf — to hide at all. Checked
  // against the SAME day's own pre-test baseline, never against a count
  // recorded on a different day.
  expect(await readDueCount(page)).toBe(dueAtAsOfBaseline);
});

// `ol-egov.141.89.10.38`, `[D-373]`: once the term's declared evidence has
// passed (the new fixture assessment `Season Checkpoint - GEOL204.md`, due
// 14 days past `asOf` — see this file's module doc; this test scrubs to 20
// days past `asOf`, past that due date), the real composer
// ranks no concepts again, the SAME veto that made `WORKBENCH_NOW`'s own
// snapshot empty before this bead's fix. `[D-373]`'s already-landed
// fallback (`ol-egov.141.89.10.66`) is what this test actually exercises:
// Today falls back to the known due count from what she has already
// scheduled and states separately why no session was composed — never a
// bare zero. This is the "completed-course maintenance" case `[D-373]`'s
// own text names as distinct from a course that never had an assessment
// declared at all (D-329's need-only path) — the fixture vault's two
// courses both always carry a declared assessment, so the
// no-assessment-declared half of that distinction is not exercised here;
// see this bead's report.
test('@auto-web:simulator/lived-term — once every declared assessment has passed, Today shows the known due count and why no session was composed, never a bare zero', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  // Bounded forward from `asOf` by `SCRUBBER_MAX_DAYS` (112) — 20 days is
  // comfortably past the new fixture assessment's due date (+14 days) and
  // well inside that bound.
  const PAST_EVERY_ASSESSMENT_DAYS = 20;
  await scrubTo(page, PAST_EVERY_ASSESSMENT_DAYS);

  const due = await readDueCount(page);
  // The known-due-count fallback reads a real enumeration, never the
  // composition's own empty list — so this must be a number, not the
  // 'none' `readDueCount` returns for a genuine "nothing due" sentence,
  // and never a bare zero either.
  expect(due).not.toBe('none');
  expect(due).not.toBe(0);
  expect(typeof due).toBe('number');

  // The distinct second fact `[D-373]` requires: why no session was
  // composed, stated separately from the due count above — never folded
  // into one sentence (`today/copy.ts`'s `sessionNotComposedSentence`).
  await expect
    .poll(() => sessionNotComposedNote(page))
    .toBe('No session was composed today: no course currently has an upcoming assessment.');
});
