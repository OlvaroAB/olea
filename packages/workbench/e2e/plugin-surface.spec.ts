/**
 * `@auto-web` — F7's plugin surface (`olea-service/features/F7-plugin-surface.md`),
 * driven in a real browser against the REAL `OleaSettingTab`
 * (`packages/plugin/src/settings/settings-tab.ts`), fed by a fixture
 * `data.json` host and a canned Worker transport
 * (`plugin-surface-scenarios.ts`'s module doc).
 *
 * Reachability: proves the rendered settings pane's conditional sections and
 * the "Test connection" status line against the real component — never
 * `packages/plugin/src/main.ts`'s own production wiring (a real Obsidian
 * `Plugin`/`App`, a real `data.json`, a real `requestUrl`-backed transport),
 * same posture `registry.spec.ts`'s own doc states for its surface.
 *
 * Deliberately NOT covered here (see `features/F7-plugin-surface.md`'s
 * `@manual` set and this surface's own module doc): the command palette, the
 * Hotkeys pane, and the BRAT install path all need a real Obsidian host —
 * the risk there lives IN the Obsidian runtime, which is exactly what this
 * package does not fake.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

function settingsPane(page: Page) {
  return frame(page).locator('.vertical-tab-content');
}

test('plugin-surface-fresh: the explain-back audit-gate section is absent when the gate has never been set', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-fresh', 'obsidian-dark');
  await expect(settingsPane(page)).not.toContainText('Explaining back is paused');
});

test('plugin-surface-gate-set: the audit-gate section renders its exact heading and body once the gate is set', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-gate-set', 'obsidian-dark');
  await expect(settingsPane(page).locator('.olea-explain-back-audit-gate')).toHaveText(
    "Olea grades explain-back answers, then checks that grading against a second opinion — and that check hasn't been agreeing enough lately to trust the result. Explaining back is paused until it does; cards, review, scheduling and the Today panel keep working exactly as before.",
  );
  const headings = settingsPane(page).locator('.setting-item-heading .setting-item-name');
  await expect(headings.filter({ hasText: 'Explaining back is paused' })).toHaveCount(1);
});

test('plugin-surface-fresh: the AI usage section shows the real empty-state sentence, not a blank list', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-fresh', 'obsidian-dark');
  await expect(settingsPane(page).locator('.olea-usage-empty')).toHaveText(
    'No AI calls have been recorded yet in this build. This section fills in as Olea makes calls on your behalf.',
  );
  await expect(settingsPane(page).locator('.olea-usage-list li')).toHaveCount(0);
});

test('plugin-surface-usage-recorded: per-feature call counts list for real, and the cached-input note names the oracle-ranking nuance', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-usage-recorded', 'obsidian-dark');
  const rows = settingsPane(page).locator('.olea-usage-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'oracle.rank.v1' })).toHaveText(/3 calls/);
  await expect(rows.filter({ hasText: 'quiz.generate.v1' })).toHaveText(/1 call\b/);
  await expect(settingsPane(page).locator('.olea-usage-cached-input-note')).toContainText(
    "Oracle exam-practice calls briefly place recently-sent material in the AI provider's own prompt cache",
  );
});

test('plugin-surface-offline: pressing Test connection against an unreachable Worker shows the real unreachable message and re-enables the button', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-offline', 'obsidian-dark');
  const button = settingsPane(page).getByRole('button', { name: 'Test connection' });
  const status = settingsPane(page).locator('.olea-worker-test-status');

  await button.click();
  await expect(status).toHaveText('Testing…');
  await expect(button).toBeDisabled();

  await expect(status).toHaveText(
    'Could not reach the Worker. Check the base URL and your connection.',
    { timeout: 5_000 },
  );
  await expect(button).toBeEnabled();
});

test('plugin-surface-connected: pressing Test connection against a reachable, correctly-tokened Worker shows the real connected message', async ({
  page,
}) => {
  await gotoState(page, 'plugin-surface', 'plugin-surface-connected', 'obsidian-dark');
  const button = settingsPane(page).getByRole('button', { name: 'Test connection' });
  const status = settingsPane(page).locator('.olea-worker-test-status');

  await button.click();
  await expect(status).toHaveText('Connected. The Worker is reachable and the token is valid.', {
    timeout: 5_000,
  });
  await expect(button).toBeEnabled();
});
