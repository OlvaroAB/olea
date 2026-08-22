/**
 * `@auto-web` — the retrieval surface's four states (C4.7, INV-5;
 * `ol-opmb.2` [TB-2]), driven in a real browser replaying a real,
 * once-embedded cassette. Zero model spend at render time (see
 * `retrieve-scenarios.ts`'s module doc). No product view exists for raw
 * retrieval results — the assertions read the inspector, which is honest
 * (main.ts's own module doc explains why), not a limitation of the test.
 */
import { expect, test } from '@playwright/test';
import { gotoState } from './helpers.js';

/** One inspector row's value text, from the top-document inspector. */
async function inspectorRowValue(page: import('@playwright/test').Page, label: string) {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

test('grounding-refused-no-hits: an empty index refuses with reason no-hits', async ({ page }) => {
  await gotoState(page, 'retrieve', 'grounding-refused-no-hits', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('refused');
  expect(result).toContain('no-hits');
});

test('grounding-refused-below-threshold: pure gibberish refuses with reason below-relevance-threshold', async ({
  page,
}) => {
  await gotoState(page, 'retrieve', 'grounding-refused-below-threshold', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('refused');
  expect(result).toContain('below-relevance-threshold');
  const query = await inspectorRowValue(page, 'query');
  expect(query).toContain('unans-gib-01');
});

test('grounding-refused-composite: the ratified operating point refuses with reason below-composite-threshold', async ({
  page,
}) => {
  await gotoState(page, 'retrieve', 'grounding-refused-composite', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('refused');
  expect(result).toContain('below-composite-threshold');
  const query = await inspectorRowValue(page, 'query');
  expect(query).toContain('requireComposite: true');
});

test('grounded-with-citations: the ratified operating point grounds with a real citation', async ({
  page,
}) => {
  await gotoState(page, 'retrieve', 'grounded-with-citations', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('grounded');
  expect(result).toContain('cited chunk');
  expect(result).toContain('syn:retrieval-note:'); // a real corpus path, not an invented one
});

test('every retrieve state records exactly one "retrieve" pipeline-trace stage', async ({
  page,
}) => {
  for (const state of [
    'grounding-refused-no-hits',
    'grounding-refused-below-threshold',
    'grounding-refused-composite',
    'grounded-with-citations',
  ] as const) {
    await gotoState(page, 'retrieve', state, 'obsidian-dark');
    const rows = page.locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.wb-inspector-label')).toHaveText('retrieve');
  }
});
