/**
 * F9.S5 — "The view tour" (`features/F9-simulator.md`,
 * `@auto-web:simulator/tour`, `docs/dev/simulator-design.md` §6,
 * `ol-3ux7.64.17` [WBX-15]).
 *
 * Supersedes `goldens.spec.ts`'s hand-listed two-surface walk with a
 * runtime-enumerated one: for each declared week (`TOUR_WEEKS`,
 * `tour-helpers.ts`), this suite opens EVERY view the plugin currently
 * registers (read off the ribbon, never a hand list — see that file's own
 * doc), plus the settings route and the command palette, screenshots each,
 * and runs a cheap structural pass beside every capture.
 * `goldens.spec.ts` itself is left in place, untouched — its 8 existing
 * goldens keep their names and keep being asserted; this file only adds
 * coverage, it does not replace that one.
 *
 * WORLD/PERSONA/GOLDENS: same `WB_SIM_WORLD` / `WB_SIM_GOLDENS` env-var
 * seam `goldens.spec.ts` already uses (default `'fixture'` /
 * `./e2e/simulator/__screenshots__`, resolved by `playwright.config.ts`'s
 * `snapshotPathTemplate`), plus two more this file needs:
 *   - `WB_SIM_PERSONA` (default `'none'`) — the persona-path segment. The
 *     fixture world has none; a persona world's own name goes here
 *     (`scripts/simulator-tour.mjs` sets it from that world's descriptor).
 *   - `WB_SIM_FINDINGS_OUT` (default `./e2e/simulator/structural-findings.json`,
 *     i.e. NOT under `__screenshots__/` — that directory is fixture-golden
 *     PNGs only) — where the structural pass's findings land. Left
 *     untracked/uncommitted by convention (see this file's own bead: real
 *     runs regenerate it, and it is not stable across days by construction
 *     — the real-date-leak guard depends on which day the suite ran).
 *
 * SERIAL EXECUTION, LONG TIMEOUT — `tour-helpers.ts`'s own module doc gives
 * the full argument (avoids a cross-worker race on the findings array, at
 * the cost of wall time, not correctness). Week 8 alone drives 56 sequential
 * day-advances before this test even opens its first surface, so each test
 * gets ten minutes, not the project's default 90s (`SIMULATOR_TIMEOUT_MS`,
 * sized for `goldens.spec.ts`'s much shorter walks).
 */
import { expect, type Page, test } from '@playwright/test';
import { dismissCourseSetupModals, gotoSimulator, resetSimulator } from './helpers.js';
import {
  activeViewText,
  advanceWeeksViaDriver,
  ConsoleWatcher,
  closePaletteSurface,
  closeSettingsSurface,
  expectedSimulatedDateISO,
  fetchWorldDescriptor,
  frame,
  hostFrameElement,
  mergeAndWriteFindings,
  NON_VIEW_SURFACES,
  openPaletteSurface,
  openSettingsSurface,
  openViewSurface,
  paletteText,
  realWallClockDateISO,
  ribbonViewTypes,
  settingsText,
  structuralPass,
  TOUR_WEEKS,
  type TourFinding,
} from './tour-helpers.js';

test.describe.configure({ mode: 'serial' });

const WORLD = process.env.WB_SIM_WORLD ?? 'fixture';
const PERSONA = process.env.WB_SIM_PERSONA ?? 'none';
const FINDINGS_OUT = process.env.WB_SIM_FINDINGS_OUT ?? './e2e/simulator/structural-findings.json';

/** Accumulated across every test in this file — flushed once, in `test.afterAll` (see this file's own module doc). */
const allFindings: TourFinding[] = [];

test.afterAll(() => {
  mergeAndWriteFindings(FINDINGS_OUT, WORLD, allFindings);
});

async function captureAndCheck(
  page: Page,
  watcher: ConsoleWatcher,
  args: {
    week: number;
    surface: string;
    surfaceText: string;
    expectedSimulatedDate: string;
    mark: number;
  },
): Promise<void> {
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  await expect(hostFrameElement(page)).toHaveScreenshot([
    WORLD,
    PERSONA,
    `${String(args.week)}--${args.surface}.png`,
  ]);
  const frameText = (await frame(page).locator('[data-wb-plugin-root]').innerText()).trim();
  allFindings.push(
    ...structuralPass({
      world: WORLD,
      persona: PERSONA,
      week: args.week,
      surface: args.surface,
      surfaceText: args.surfaceText,
      frameText,
      consoleSince: watcher.since(args.mark),
      expectedSimulatedDate: args.expectedSimulatedDate,
      realWallClockDate: realWallClockDateISO(),
    }),
  );
}

for (const week of TOUR_WEEKS) {
  test(`@auto-web:simulator/tour ${WORLD}/${PERSONA} week ${String(week)} — every view + settings + palette`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const watcher = new ConsoleWatcher(page);

    await gotoSimulator(page, { world: WORLD, persona: PERSONA });
    const descriptor = await fetchWorldDescriptor(page);
    const expectedSimulatedDate = expectedSimulatedDateISO(descriptor.asOf, week);

    await resetSimulator(page);
    if (week > 0) {
      await advanceWeeksViaDriver(page, week);
      // ol-yng7: WBX-18 (`ol-qm6u`) found repeated `advanceOneDay()` remounts re-surfacing
      // already-confirmed `CourseSetupModal` proposals against a real-shaped vault, and this call
      // used to scale its round bound with `week` as a stand-in fix. `course-setup-bridge.ts`'s
      // watcher now tracks modal instances by node identity rather than by the string a query
      // happens to return (`helpers.ts`'s own doc), so a cross-mount repeat is dismissed the
      // instant it opens — no click-through budget proportional to the day-advance count is
      // needed any more. The plain default is kept only as the same small safety margin
      // `gotoSimulator`'s own cold-start call already relies on.
      await dismissCourseSetupModals(page);
    }

    const viewTypes = await ribbonViewTypes(page);
    expect(viewTypes.length).toBeGreaterThan(0);

    for (const viewType of viewTypes) {
      const mark = watcher.mark();
      await openViewSurface(page, viewType);
      const surfaceText = await activeViewText(page, viewType);
      await captureAndCheck(page, watcher, {
        week,
        surface: viewType,
        surfaceText,
        expectedSimulatedDate,
        mark,
      });
    }

    for (const surface of NON_VIEW_SURFACES) {
      const mark = watcher.mark();
      if (surface === 'settings') {
        await openSettingsSurface(page);
        const surfaceText = await settingsText(page);
        await captureAndCheck(page, watcher, {
          week,
          surface,
          surfaceText,
          expectedSimulatedDate,
          mark,
        });
        await closeSettingsSurface(page);
      } else {
        await openPaletteSurface(page);
        const surfaceText = await paletteText(page);
        await captureAndCheck(page, watcher, {
          week,
          surface,
          surfaceText,
          expectedSimulatedDate,
          mark,
        });
        await closePaletteSurface(page);
      }
    }
  });
}
