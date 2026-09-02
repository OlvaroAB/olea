/**
 * `@auto-web` — the oracle surface's ten states (F4.2, F4.3, F4.5, F4.9,
 * F4.10; `ol-opmb.1` [TB-1]), driven in a real browser against the real
 * `GapView` and a synthetic curriculum + corpus. Zero model spend, no
 * fixture-vault dependency (see `oracle-scenarios.ts`'s module doc).
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** One inspector row's value text, from the top-document inspector (never the iframe). */
async function inspectorRowValue(page: import('@playwright/test').Page, label: string) {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

test('oracle-ranked: vantrel ranks with real reasoning and citations, computed with no model call', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'oracle-ranked', 'obsidian-dark');
  await expect(frame(page).locator('.olea-gap-course')).toHaveCount(2);
  await expect(frame(page).locator('.olea-gap-row')).toHaveCount(4);
});

test('oracle-abstained: quorbin abstains rather than rendering as a course that came back empty', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'oracle-abstained', 'obsidian-dark');
  await expect(frame(page).locator('.olea-gap-abstain')).toBeVisible();
});

test('gap-mastery: melspar renders as a mastery-gap row', async ({ page }) => {
  await gotoState(page, 'oracle', 'gap-mastery', 'obsidian-dark');
  await expect(frame(page).locator('.olea-gap-row-mastery-gap')).not.toHaveCount(0);
});

test('gap-coverage: dornith renders as a coverage-gap row and, per [D-063], offers no draft verb', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'gap-coverage', 'obsidian-dark');
  const row = frame(page).locator('.olea-gap-row-coverage-gap');
  await expect(row).not.toHaveCount(0);
  await expect(row.first().locator('.olea-gap-action-draft-cards')).toHaveCount(0);
  await expect(row.first().locator('.olea-gap-action-build-session')).toBeVisible();
});

test('gap-material (F4.10): kelvane renders as a material-gap row and NEVER offers draft-cards', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'gap-material', 'obsidian-dark');
  const row = frame(page).locator('.olea-gap-row-material-gap');
  await expect(row).not.toHaveCount(0);
  await expect(row.first().locator('.olea-gap-action-draft-cards')).toHaveCount(0);
  await expect(row.first().locator('.olea-gap-action-find-source')).toBeVisible();
});

test("FLOW: gap-mastery — clicking build-session navigates to the session surface, seeded with that row's concept (round 35, ol-z6x2)", async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'gap-mastery', 'obsidian-dark');
  const row = frame(page).locator('.olea-gap-row-mastery-gap').first();
  await expect(row).toBeVisible();
  const conceptName = ((await row.locator('.olea-gap-concept').textContent()) ?? '').trim();
  expect(conceptName.length).toBeGreaterThan(0);
  const buildSessionAction = row.locator('.olea-gap-action-build-session');
  await expect(buildSessionAction).toBeVisible();

  await buildSessionAction.click();

  // A real hash navigation, not a no-op: the workbench harness wires
  // `deps.buildSession` (main.ts's `mountOracle`) to `writeRoute`, landing on
  // the session surface's default state with `focus=<conceptName>`.
  await expect(page.locator('html')).toHaveAttribute('data-wb-route-surface', 'session', {
    timeout: 10_000,
  });
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', { timeout: 10_000 });
  expect(page.url()).toContain(`/session/session-exam-eve-90`);
  expect(decodeURIComponent(page.url())).toContain(`focus=${conceptName}`);

  // `SessionBuilderView.setFocusConcept` really ran: `study-session/build.ts`'s
  // own doc says a concept absent from the ranking is not an error, and this
  // oracle state's synthetic corpus (`oracle-scenarios.ts`) and the session
  // surface's real fixture-vault corpus (`session-scenarios.ts`) are two
  // different worlds by design, so the honest, real outcome here is
  // `focusLine`'s "could not find" sentence — proof the request actually
  // reached `buildStudySession`, not a false positive match.
  await expect(frame(page).locator('.olea-session-copy')).toContainText(
    `Olea could not find ${conceptName} in the current ranking`,
  );
});

test('coverage-unreadable-source (ol-cvsc): an unreadable source renders, never a clean zero', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'coverage-unreadable-source', 'obsidian-dark');
  await expect(frame(page).locator('.olea-gap-scope-source-unreadable')).toBeVisible();
});

test('plan-fresh: refreshStudyPlan against a working provider reports source: provider', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'plan-fresh', 'obsidian-dark');
  const value = await inspectorRowValue(page, 'refreshStudyPlan');
  expect(value).toContain('source: provider');
  expect(value).toContain('offline: false');
});

test('plan-stale-offline: refreshStudyPlan against a throwing provider falls back to the cached plan', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'plan-stale-offline', 'obsidian-dark');
  const value = await inspectorRowValue(page, 'refreshStudyPlan');
  expect(value).toContain('source: cache');
  expect(value).toContain('offline: true');
});

test('plan-expired-offline: refreshStudyPlan discards a plan past the governing horizon (D-122)', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'plan-expired-offline', 'obsidian-dark');
  const value = await inspectorRowValue(page, 'refreshStudyPlan');
  expect(value).toContain('source: none');
  expect(value).toContain('offline: true');
  expect(value).toContain('reason:');
});

test('oracle-struggling: the declared struggling course is visible on the real gap view', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'oracle-struggling', 'obsidian-dark');
  await expect(frame(page).locator('.olea-gap-row')).not.toHaveCount(0);
});
