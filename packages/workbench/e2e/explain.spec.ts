/**
 * `@auto-web` — the explain surface's two states (F2.7; `explain-scenarios.ts`),
 * driven in a real browser against real `groundExplanation` and
 * `generateExplainProse` calls over the fixture vault. Zero model spend for
 * `explanation-refused-no-grounding`; `explanation-grounded` replays a
 * pre-recorded `explain-why.generate.v1` cassette. No product view renders a
 * bare grounding-plus-prose result (`explain-scenarios.ts`'s module doc), so
 * — like `retrieve.spec.ts` — these assertions read the inspector, which is
 * the honest target here, not a limitation of the test.
 *
 * WB-2 (`ol-z6x2`), first-tranche coverage: `visual-regression.spec.ts`
 * already screenshots both states; this is the surface's first assertion-
 * level coverage of what the pipeline actually produced. Nothing here
 * retags a `features/` scenario — see the run's handback note.
 */
import { expect, type Page, test } from '@playwright/test';
import { gotoState } from './helpers.js';

/** One inspector row's value text, from the top-document inspector. */
async function inspectorRowValue(page: Page, label: string): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

test('explanation-grounded: real fixture-vault text is cited, and the generated prose cites one of the same chunks', async ({
  page,
}) => {
  await gotoState(page, 'explain', 'explanation-grounded', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('grounded');
  expect(result).toMatch(/cited chunk\(s\)/);
  expect(result).toContain('Imbrication'); // the real fixture-vault note this query echoes

  const explanation = await inspectorRowValue(page, 'explanation');
  expect(explanation).not.toContain('refused');
  expect(explanation).toMatch(/cites source #\d+/);

  // The pipeline trace is real: retrieval runs before generation, and
  // generation only runs at all on the grounded branch (explain-
  // scenarios.ts's own module doc — the refused state never calls the
  // generative task).
  const traceLabels = await page
    .locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row .wb-inspector-label')
    .allTextContents();
  expect(traceLabels.length).toBeGreaterThan(0);
  expect(traceLabels).toContain('generate');
});

test('explanation-refused-no-grounding: nothing to ground on refuses rather than inventing (INV-5)', async ({
  page,
}) => {
  await gotoState(page, 'explain', 'explanation-refused-no-grounding', 'obsidian-dark');
  const result = await inspectorRowValue(page, 'result');
  expect(result).toContain('refused');

  // `prose` is `null` for this state — no "explanation" row is rendered at
  // all, and no generative call was ever made (zero model spend).
  await expect(
    page.locator('[data-wb-inspector] .wb-inspector-row', {
      has: page.locator('.wb-inspector-label', { hasText: 'explanation' }),
    }),
  ).toHaveCount(0);

  const traceLabels = await page
    .locator('[data-wb-inspector] .wb-inspector-log .wb-inspector-row .wb-inspector-label')
    .allTextContents();
  expect(traceLabels).not.toContain('generate');
});
