/**
 * `@auto-web` — three Today-panel states added for `ol-z6x2` [WB-2]'s next
 * tranche: `today-after-reentry` (F6.6), `today-encouragement-off` (F6.8)
 * and `today-term-dates-pointer` (F6.9/F7.2, `[D-147]`). See
 * `today-scenarios.ts`'s own module doc for what each state builds and,
 * for the two F6.8/F6.9 states, exactly what surfaces they do and do not
 * reach.
 *
 * All three back an `@manual` scenario in `features/F6-today.md` — a human
 * still has to read the screen for tone and for what a real settings tab
 * would do. What this file adds is the same kind of lexical/structural
 * backstop `today-voice.spec.ts` already describes itself as: real, in a
 * real browser, over the real fixture vault, narrow by design.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** The workbench's own fresh-vault-read row, from the top-document inspector — same helper `today-panel.spec.ts` defines for its own file. */
async function recomputedRowText(page: Page): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: 'vault, recomputed now' }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

/**
 * The leading number out of `.olea-today-note`'s "N due today" sentence —
 * `[D-223]` (`ol-l5og.22` [HOME-3]) folded the old `.olea-today-count`
 * numeral into this one prose sentence; see `today-panel.spec.ts`'s own
 * module doc for the full before/after. Same helper that file defines for
 * itself.
 */
async function dueNoteCount(page: Page): Promise<string> {
  const noteText = (await frame(page).locator('.olea-today-note').textContent())?.trim() ?? '';
  const match = noteText.match(/^(\d+) due today$/);
  return match?.[1] ?? '';
}

/**
 * F6.6's own forbidden list, read directly off the manual scenario's wording
 * ("nothing about the re-entry screen implied it had expired or been
 * discarded"). Narrow on purpose, same discipline `today-voice.spec.ts`'s
 * own `FORBIDDEN_PATTERN` states for itself: a broad net would also catch
 * legitimate copy.
 */
const F6_6_FORBIDDEN_PATTERN = /\b(expired?|discarded|lost|gone|no longer available)\b/i;

/**
 * F6.8's own forbidden list — streak revival under another name, effort/
 * discipline scoring, and invented praise with no cited evidence. Read
 * directly off `docs/Olea_alpha_functional_scope.md`'s F6.8 clause.
 */
const F6_8_FORBIDDEN_PATTERN =
  /\b(on a roll|keep it up|keep going|well done|great job|good job|you'?re doing (great|well|amazing)|proud of you|nice work|way to go)\b/i;

/** F6.9's own forbidden list for the pointer specifically — no streak, no effort score, no "falling behind" framing. */
const F6_9_POINTER_FORBIDDEN_PATTERN = /\b(streak|effort score|falling behind|behind)\b/i;

test.describe('today-after-reentry (F6.6)', () => {
  test('a smaller, re-entry-sized write still leaves an honest, non-zero due count on screen, agreeing with a fresh vault read', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-after-reentry', 'obsidian-dark');
    const countText = await dueNoteCount(page);
    expect(Number(countText)).toBeGreaterThan(0);

    // `refreshedAfterWrite: true` for this state (same family as
    // `today-after-writing`) — the on-screen count should agree with a
    // fresh read, not disagree the way `today-stale` deliberately does.
    const recomputed = await recomputedRowText(page);
    expect(
      recomputed.startsWith(`${countText} due`),
      `expected agreement after refresh — on-screen "${countText}", inspector recomputed "${recomputed}"`,
    ).toBe(true);
  });

  test('no rendered prose implies the remaining backlog expired, was lost, or was discarded', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-after-reentry', 'obsidian-dark');
    const texts = await frame(page).locator('.olea-today-note, .olea-today-new').allTextContents();
    for (const text of texts) {
      expect(text, `"${text}" reads as if the remaining backlog were lost or expired`).not.toMatch(
        F6_6_FORBIDDEN_PATTERN,
      );
    }
  });
});

test.describe('today-encouragement-off (F6.8)', () => {
  test('the real due count and a real rhythm-quiet finding both render, with no term-dates pointer (termDatesAsk absent)', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-encouragement-off', 'obsidian-dark');
    const countText = await dueNoteCount(page);
    expect(Number(countText)).toBeGreaterThan(0);

    // The rhythm-quiet finding — same composition `today-rhythm-quiet` uses.
    await expect(frame(page).locator('.olea-today-insights-label')).toContainText(
      'What has arrived',
    );
    await expect(frame(page).locator('.olea-today-insight-text')).toBeVisible();

    // No `termDatesAsk` was supplied for this state — see
    // `today-term-dates-pointer` for the twin that supplies it.
    await expect(frame(page).locator('.olea-today-term-dates-pointer-text')).toHaveCount(0);
  });

  test('no rendered prose on this pane praises a streak, scores effort, or invents progress (F6.8)', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-encouragement-off', 'obsidian-dark');
    const texts = await frame(page)
      .locator(
        '.olea-today-note, .olea-today-new, .olea-today-insight-text, .olea-today-insight-scope',
      )
      .allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text, `"${text}" reads as F6.8-forbidden encouragement`).not.toMatch(
        F6_8_FORBIDDEN_PATTERN,
      );
    }
  });
});

test.describe('today-term-dates-pointer (F6.9/F7.2, [D-147])', () => {
  test('the quiet pointer draws beside the rhythm-quiet finding when termDatesAsk resolves to "unanswered"', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-term-dates-pointer', 'obsidian-dark');
    await expect(frame(page).locator('.olea-today-insights-label')).toContainText(
      'What has arrived',
    );
    const pointerText = frame(page).locator('.olea-today-term-dates-pointer-text');
    await expect(pointerText).toBeVisible();
    await expect(pointerText).toContainText('When does this term run?');
    const button = frame(page).locator('.olea-today-term-dates-pointer-button');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Add term dates');
  });

  test('the pointer\'s own copy states a fact, never a compliance verdict — no streak, no effort score, no "falling behind" (F6.9)', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-term-dates-pointer', 'obsidian-dark');
    const text = await frame(page).locator('.olea-today-term-dates-pointer-text').textContent();
    const label = await frame(page).locator('.olea-today-term-dates-pointer-button').textContent();
    for (const value of [text, label]) {
      expect(value ?? '', `"${value}" reads as a compliance verdict`).not.toMatch(
        F6_9_POINTER_FORBIDDEN_PATTERN,
      );
    }
  });

  test('pressing the pointer button is a real, honestly inert action — it surfaces a Notice naming the settings tab, not a silent no-op', async ({
    page,
  }) => {
    await gotoState(page, 'today', 'today-term-dates-pointer', 'obsidian-dark');
    await frame(page).locator('.olea-today-term-dates-pointer-button').click();
    const notice = page.locator('[data-wb-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('settings');
  });
});
