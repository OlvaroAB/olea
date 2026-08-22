/**
 * `@auto-web` — the generation surface's three states (C4.7, INV-5, INV-6;
 * `ol-opmb.3` [TB-3]), driven in a real browser replaying real, once-
 * recorded cassettes. Zero model spend at render time. The accept gate is
 * asserted as a REAL clickable control, not merely rendered text — this is
 * the file that proves INV-6 is a gate a user passes through.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

async function inspectorRowValue(page: import('@playwright/test').Page, label: string) {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

/** The accept gate lives in the HOST PANE (`main.ts`'s `renderAcceptGate` appends to `host`), which is the `[data-wb-surface]` iframe's own document — never the top page. */
function acceptGate(page: import('@playwright/test').Page) {
  return frame(page).locator('[data-wb-accept-state]');
}
function acceptButton(page: import('@playwright/test').Page) {
  return frame(page).locator('[data-wb-accept-button]');
}

test('generation-refused-upstream: an inherited retrieval refusal produces zero candidates and nothing to accept', async ({
  page,
}) => {
  await gotoState(page, 'generate', 'generation-refused-upstream', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'generation result');
  expect(result).toContain('0 candidate(s)');
  await expect(acceptGate(page)).toHaveAttribute('data-wb-accept-state', 'nothing-to-accept');
  await expect(acceptButton(page)).toHaveCount(0);
});

test('generation-pending-accept: real candidates exist, but the gate is PENDING — no McqFields yet', async ({
  page,
}) => {
  await gotoState(page, 'generate', 'generation-pending-accept', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'generation result');
  expect(result).not.toContain('0 candidate(s)');
  const acceptRow = await inspectorRowValue(page, 'accept gate');
  expect(acceptRow).toBe('not passed through yet');
  await expect(acceptGate(page)).toHaveAttribute('data-wb-accept-state', 'pending');
  await expect(acceptButton(page)).toBeVisible();
});

test('generation-pending-accept: CLICKING the real Accept button passes the gate — inspector and gate both flip', async ({
  page,
}) => {
  await gotoState(page, 'generate', 'generation-pending-accept', 'obsidian-dark');
  await expect(acceptGate(page)).toHaveAttribute('data-wb-accept-state', 'pending');

  await acceptButton(page).click();

  await expect(acceptGate(page)).toHaveAttribute('data-wb-accept-state', 'accepted');
  const count = await acceptGate(page).getAttribute('data-wb-accept-count');
  expect(Number(count)).toBeGreaterThan(0);
  const acceptRow = await inspectorRowValue(page, 'accept gate');
  expect(acceptRow).toContain('accepted');
  expect(acceptRow).not.toBe('not passed through yet');
  // The button is gone once the gate has been passed — nothing to click twice.
  await expect(acceptButton(page)).toHaveCount(0);
});

test('generation-accepted: opens ALREADY past the gate, via the same acceptCandidates() the click uses', async ({
  page,
}) => {
  await gotoState(page, 'generate', 'generation-accepted', 'obsidian-dark');
  await expect(acceptGate(page)).toHaveAttribute('data-wb-accept-state', 'accepted');
  const count = await acceptGate(page).getAttribute('data-wb-accept-count');
  expect(Number(count)).toBeGreaterThan(0);
  const acceptRow = await inspectorRowValue(page, 'accept gate');
  expect(acceptRow).toContain('accepted');
});

test('every generate state records a "generate" pipeline-trace stage after "retrieve"', async ({
  page,
}) => {
  for (const state of [
    'generation-refused-upstream',
    'generation-pending-accept',
    'generation-accepted',
  ] as const) {
    await gotoState(page, 'generate', state, 'obsidian-dark');
    const rows = page.locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row');
    const stageNames = await rows.locator('.wb-inspector-label').allTextContents();
    expect(stageNames[0]).toBe('retrieve');
    expect(stageNames[1]).toBe('generate');
    if (state === 'generation-accepted') {
      expect(stageNames[2]).toBe('accept');
    } else {
      expect(stageNames).toHaveLength(2);
    }
  }
});

test('generation-refused-upstream: the generate stage attributes its empty result to retrieve', async ({
  page,
}) => {
  await gotoState(page, 'generate', 'generation-refused-upstream', 'obsidian-dark');
  const rows = page.locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row');
  const generateRow = rows.nth(1);
  await expect(generateRow.locator('.wb-inspector-label')).toHaveText('generate');
  const value = (await generateRow.locator('.wb-inspector-value').textContent()) ?? '';
  expect(value).toContain('couldHaveSucceeded: false');
  expect(value).toContain('attributedTo: retrieve');
});
