/**
 * The simulator's fixed `Math.random` streams (`src/deterministic-random.ts`,
 * `ol-egov.141.89.45`, `ol-egov.141.89.51`), proven where they matter: the
 * REAL plugin `ReviewView`'s multiple-choice presentation (`olea-core`'s
 * `presentMcq`, which draws from bare `Math.random` in production and takes
 * no seam from the workbench), opened through the ribbon exactly as the tour
 * opens it.
 *
 * Three claims, one test each:
 * 1. Every realm is covered — this page's, where the plugin's code runs, and
 *    the host iframe's, where its views render — and both are restored the
 *    moment the simulator route is left.
 * 2. The option order is the same on two independent loads (two browser
 *    contexts: separate storage, separate pages, same build).
 * 3. The option order does not move when unrelated code draws from
 *    `Math.random` first. With the earlier single shared sequence it did: one
 *    extra draw anywhere (the plugin's device-id generator, the ingestion
 *    engine's retry jitter — both timing-dependent) shifted every shuffle
 *    after it, which is how an MCQ golden could change because of a change
 *    nowhere near the MCQ.
 *
 * The option TEXT is read in on-screen order and compared; nothing here
 * depends on which order is chosen, only that it is always the same one.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import { frame, gotoSimulator, resetSimulator } from './helpers.js';
import { openViewSurface } from './tour-helpers.js';

const WORLD = process.env.WB_SIM_WORLD ?? 'fixture';
const PERSONA = 'none';
const REVIEW_VIEW_TYPE = 'olea-review';

/** Opens the real review view from a freshly reset world and returns the first MCQ's option texts, in on-screen order. */
async function firstMcqOptionOrder(page: Page, drawFirst = 0): Promise<string[]> {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  if (drawFirst > 0) {
    // Draws from a call site that is not the plugin's — the stand-in for any
    // unrelated, timing-dependent draw that happens before the review opens.
    await page.evaluate((count) => {
      for (let i = 0; i < count; i += 1) Math.random();
    }, drawFirst);
  }
  await resetSimulator(page);
  await openViewSurface(page, REVIEW_VIEW_TYPE);
  const options = frame(page).locator('.olea-review-mcq-option');
  await expect(options.first()).toBeVisible();
  const texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
  expect(texts.length).toBeGreaterThan(1);
  return texts;
}

async function inFreshContext<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  // `browser.newContext()` does not inherit the project's `use` — pass the
  // same base URL and viewport the `page` fixture gets.
  const { baseURL, viewport } = test.info().project.use;
  const context = await browser.newContext({
    ...(baseURL !== undefined ? { baseURL } : {}),
    viewport: viewport ?? { width: 1280, height: 900 },
  });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

test(`@auto-web:simulator/mcq-determinism ${WORLD}/${PERSONA} — the override reaches the host frame's realm too, and is removed on leaving the route`, async ({
  page,
}) => {
  const isNative = async (): Promise<{ top: boolean; frame: boolean; shared: boolean }> =>
    page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-wb-surface]');
      const frameWindow = iframe?.contentWindow as (Window & typeof globalThis) | null;
      if (frameWindow === null || frameWindow === undefined) {
        throw new Error('no host frame window');
      }
      const native = (fn: () => number) =>
        /\[native code\]/.test(Function.prototype.toString.call(fn));
      return {
        top: native(Math.random),
        frame: native(frameWindow.Math.random),
        shared: frameWindow.Math.random === Math.random,
      };
    });

  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  expect(await isNative()).toEqual({ top: false, frame: false, shared: true });

  await page.evaluate(() => {
    location.hash = '#/review/mcq-open?set=obsidian-dark&persona=none';
  });
  await expect(page.locator('html')).toHaveAttribute('data-wb-state', 'mcq-open');
  const after = await isNative();
  expect({ top: after.top, frame: after.frame }).toEqual({ top: true, frame: true });
});

test(`@auto-web:simulator/mcq-determinism ${WORLD}/${PERSONA} — the real review's MCQ option order is identical on two independent loads`, async ({
  browser,
}) => {
  const first = await inFreshContext(browser, (page) => firstMcqOptionOrder(page));
  const second = await inFreshContext(browser, (page) => firstMcqOptionOrder(page));
  expect(second).toEqual(first);
});

test(`@auto-web:simulator/mcq-determinism ${WORLD}/${PERSONA} — unrelated Math.random draws before the review opens do not move the option order`, async ({
  browser,
}) => {
  const baseline = await inFreshContext(browser, (page) => firstMcqOptionOrder(page));
  for (const extraDraws of [1, 7]) {
    const perturbed = await inFreshContext(browser, (page) =>
      firstMcqOptionOrder(page, extraDraws),
    );
    expect(perturbed, `after ${String(extraDraws)} unrelated draw(s)`).toEqual(baseline);
  }
});
