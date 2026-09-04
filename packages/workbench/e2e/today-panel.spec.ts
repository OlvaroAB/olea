/**
 * `@auto-web` — the Today panel's five states (F6.1, `[P2-T09]`), driven in a
 * real browser against the real `TodayView` and `loadTodayPanel`/
 * `buildTodayPanel`.
 *
 * **The due count is no longer a headline element (`[D-223]`, `ol-l5og.22`
 * [HOME-3]).** `.olea-today-count`/`.olea-today-count-label` — the 34px
 * numeral plus its label — are gone; all three due states (cannot count,
 * nothing due, N due today) now render as one `.olea-today-note` sentence
 * under a `.olea-today-due-label` "Due" eyebrow, at the same visual weight.
 * `dueNoteCount` below extracts the leading number from that sentence
 * (`copy.ts`'s `dueTodaySentence`: `"${total} due today"`) where a test still
 * needs the number itself.
 *
 * The last two tests are the important ones: `today-stale` and
 * `today-after-writing` **reproduce** `ol-h3wy` rather than describe it (see
 * the package README). Both write an identical review-log record to the
 * vault after the pane has opened; only `today-after-writing` then calls
 * `view.refresh()`. The inspector's "vault, recomputed now" row re-reads the
 * vault fresh at render time regardless of which branch ran, so for
 * `today-stale` the on-screen count and that fresh read are SUPPOSED to
 * disagree — that disagreement is the bug, not an illustration of it, and
 * this file asserts the disagreement is present exactly where it should be
 * and absent everywhere else.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** The workbench's own fresh-vault-read row, from the top-document inspector. */
async function recomputedRowText(page: Page): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: 'vault, recomputed now' }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

/**
 * The leading number out of `.olea-today-note`'s "N due today" sentence —
 * the only place a positive due count still appears now that there is no
 * separate `.olea-today-count` element to read it from directly.
 */
async function dueNoteCount(page: Page): Promise<string> {
  const noteText = (await frame(page).locator('.olea-today-note').textContent())?.trim() ?? '';
  const match = noteText.match(/^(\d+) due today$/);
  return match?.[1] ?? '';
}

test('today-nothing-due: a real computed zero states itself as a note, not a headline — and the front door stays open (ol-h3wy, [D-223])', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-nothing-due', 'obsidian-dark');
  // Zero due renders `.olea-today-note` at the same weight as the other two
  // due states — no `.olea-today-count` headline exists anymore.
  await expect(frame(page).locator('.olea-today-note')).toHaveText('Nothing due today.');
  // `showsStartReviewAction`: the front door does not disappear just because
  // nothing is waiting behind it (this state's own note in today-scenarios.ts).
  await expect(frame(page).locator('.olea-today-primary-action')).toBeVisible();
});

test('today-unavailable: an unenumerable vault says it cannot count, never a silent zero — and offers no session to start', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-unavailable', 'obsidian-dark');
  await expect(frame(page).locator('.olea-today-note')).toHaveText(
    "Olea can't count what's due — it couldn't read your vault just now.",
  );
  // Unlike nothing-due, `showsStartReviewAction` does NOT extend to `due ===
  // null` — there is nothing composed to start a session from.
  await expect(frame(page).locator('.olea-today-primary-action')).toHaveCount(0);
});

test('today-due: the panel counts a real composed session, not a stand-in', async ({ page }) => {
  await gotoState(page, 'today', 'today-due', 'obsidian-dark');
  const countText = await dueNoteCount(page);
  expect(Number(countText)).toBeGreaterThan(0);
});

test('today-after-writing: view.refresh() was called, so the screen agrees with a fresh vault read (ol-h3wy, fixed path)', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-after-writing', 'obsidian-dark');
  const onScreen = await dueNoteCount(page);
  const recomputed = await recomputedRowText(page);
  expect(
    recomputed.startsWith(`${onScreen} due`),
    `expected agreement — on-screen "${onScreen}", inspector recomputed "${recomputed}"`,
  ).toBe(true);
});

test('today-stale: view.refresh() was NOT called, so the screen visibly disagrees with a fresh vault read — this is ol-h3wy reproduced, not described', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-stale', 'obsidian-dark');
  const onScreen = await dueNoteCount(page);
  const recomputed = await recomputedRowText(page);
  expect(
    recomputed.startsWith(`${onScreen} due`),
    `expected a disagreement (that is the point of this state) — on-screen "${onScreen}", ` +
      `inspector recomputed "${recomputed}"`,
  ).toBe(false);
});
