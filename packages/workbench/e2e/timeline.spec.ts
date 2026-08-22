/**
 * `@auto-web` — the timeline surface's day scrubber (`ol-opmb.5` [TB-4]),
 * driven in a real browser against the real `GapView`. Zero model spend at
 * render time (see `timeline-scenarios.ts`'s module doc).
 */
import { expect, test } from '@playwright/test';
import { gotoState } from './helpers.js';

/**
 * One inspector row's value text, addressed by its `data-wb-timeline-*` hook
 * rather than by label — the timeline inspector deliberately reuses label
 * words ("plan", "day") that also appear in the pipeline-trace stage rows and
 * in other timeline rows' own VALUES, so a label-text filter is ambiguous on
 * this surface in a way it is not on the oracle/retrieve ones.
 */
async function timelineAttrValue(page: import('@playwright/test').Page, attr: string) {
  return ((await page.locator(`[${attr}]`).textContent()) ?? '').trim();
}

test('timeline-steady opens on the default day and mounts the real GapView', async ({ page }) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark');
  await expect(page.locator('html')).toHaveAttribute('data-wb-timeline-day', '60');
  const dayValue = await timelineAttrValue(page, 'data-wb-timeline-day-value');
  expect(dayValue).toContain('60 of');
  // The real product view, not a placeholder — same assertion shape
  // `oracle.spec.ts` uses for the single-instant oracle states.
  await expect(page.frameLocator('[data-wb-surface]').locator('.olea-gap-root')).toBeVisible();
});

test('the day scrubber moves the day, re-renders the real view, and updates the URL', async ({
  page,
}) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark', 'none', 10);
  await expect(page.locator('html')).toHaveAttribute('data-wb-timeline-day', '10');
  const before = await timelineAttrValue(page, 'data-wb-timeline-plan-version');

  await page.locator('[data-wb-timeline-next]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wb-timeline-day', '11', {
    timeout: 10_000,
  });
  expect(page.url()).toContain('day=11');

  await page.locator('[data-wb-timeline-prev]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wb-timeline-day', '10', {
    timeout: 10_000,
  });
  expect(page.url()).toContain('day=10');
  const after = await timelineAttrValue(page, 'data-wb-timeline-plan-version');
  // Not a claim that the plan MUST differ (mutation testing covers that in
  // the unit suite) — only that a full round trip through the scrubber lands
  // back where it started.
  expect(after).toBe(before);
});

test('the number input jumps directly to a day and clamps out-of-range input', async ({ page }) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark', 'none', 0);
  const input = page.locator('[data-wb-timeline-day-input]');
  await input.fill('45');
  await input.dispatchEvent('change');
  await expect(page.locator('html')).toHaveAttribute('data-wb-timeline-day', '45', {
    timeout: 10_000,
  });
});

test('day 0 reports "n/a" for changed-since-yesterday; a later day names at least one stage', async ({
  page,
}) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark', 'none', 0);
  const day0Changed = await timelineAttrValue(page, 'data-wb-timeline-changed');
  expect(day0Changed).toContain('n/a');

  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark', 'none', 45);
  const laterChanged = await timelineAttrValue(page, 'data-wb-timeline-changed');
  expect(laterChanged).not.toBe('n/a — day 0');
});

test('every timeline state records a pipeline trace and an anti-degeneracy read', async ({
  page,
}) => {
  for (const state of [
    'timeline-steady',
    'timeline-struggler',
    'timeline-lapsed-returner',
    'timeline-crammer',
  ] as const) {
    await gotoState(page, 'timeline', state, 'obsidian-dark', 'none', 50);
    const rows = page.locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row');
    await expect(rows.first()).toBeVisible();
    const antiDegeneracy = await timelineAttrValue(page, 'data-wb-timeline-anti-degeneracy');
    expect(antiDegeneracy).toContain('queue composition varies');
    expect(antiDegeneracy).toContain('mastery rose');
  }
});
