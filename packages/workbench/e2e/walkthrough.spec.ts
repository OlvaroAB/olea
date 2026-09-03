/**
 * `@auto-web` — walkthrough steps 7-8 (`ol-akla`, WBF-3) and a
 * rendered-DOM check for the WBF-1 (`ol-mxw3`) fix on the two steps whose
 * screens run over `packages/synthetic`'s coined corpus (10, 12).
 *
 * Steps 7-8 mount the fixture-vault oracle (`oracle-fixture`, D-041), which
 * has its own URL shape (`#/walk/<n>`, not `#/<surface>/<stateId>`) — see
 * `walkthrough.ts`'s module doc — so this file navigates via `helpers.ts`'s
 * `gotoWalkStep` rather than `gotoState`, whose `Surface` union does not
 * include `'walk'`. `gotoWalkStep` used to be a private copy in this file;
 * WBF-4 (`ol-opjq`) promoted it to `helpers.ts` so `pane-fit.spec.ts` and
 * `walkthrough-visual.spec.ts` share the one definition.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState, gotoWalkStep } from './helpers.js';

test('WBF-3: steps 7 and 8 mount the same real GapView but focus on different parts of it', async ({
  page,
}) => {
  // `data-wb-fixture-oracle-focus` is set on `host` (`main.ts`'s `frame.body`
  // — the iframe's OWN document body), not on the outer `[data-wb-surface]`
  // iframe element in the top document (which carries an unrelated,
  // pre-existing `data-wb-surface` attribute of its own — see `main.ts`'s
  // route-parsing module doc for that collision). So this reaches inside the
  // frame, same as `frame(page).locator(...)` does for everything else here.
  await gotoWalkStep(page, 7);
  await expect(frame(page).locator('body')).toHaveAttribute(
    'data-wb-fixture-oracle-focus',
    'ranking',
  );
  const step7Note = await frame(page).locator('.wb-fixture-oracle-focus-note').textContent();

  await gotoWalkStep(page, 8);
  await expect(frame(page).locator('body')).toHaveAttribute(
    'data-wb-fixture-oracle-focus',
    'coverage',
  );
  const step8Note = await frame(page).locator('.wb-fixture-oracle-focus-note').textContent();

  // The one thing this bead promises: the two steps are no longer
  // byte-identical screens. The caption differs, and (below) so does what is
  // scrolled into view.
  expect(step7Note).not.toBe(step8Note);
  expect(step7Note?.length ?? 0).toBeGreaterThan(0);
  expect(step8Note?.length ?? 0).toBeGreaterThan(0);

  // Both steps mount the SAME real computation (D-041's whole argument) —
  // the coverage section exists on both, but only step 8 scrolls to it.
  // `.olea-gap-coverage` is unstyled inside the workbench's flex host (a
  // pre-existing gap this bead does not touch — `GapView`'s own styles live
  // in `packages/plugin/styles.css`, another lane's file, and are not wired
  // into the workbench build), so its box collapses to zero width and
  // Playwright's `toBeVisible` reports it as hidden even though it is
  // genuinely in the DOM and `scrollIntoView` ran against it — hence
  // `toHaveCount`, not `toBeVisible`, here.
  await expect(frame(page).locator('.olea-gap-coverage')).toHaveCount(1);
});

test('WBF-1: no synthetic id reaches the rendered timeline screen (step 10)', async ({ page }) => {
  await gotoState(page, 'timeline', 'timeline-steady', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toMatch(/\bsyn:/);
});

test('WBF-1: no synthetic id reaches the rendered trends screen (step 12)', async ({ page }) => {
  await gotoState(page, 'trends', 'trends-cramming', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toMatch(/\bsyn:/);
});

test('WBF-2: the trends screen never opens on the read-failure message', async ({ page }) => {
  await gotoState(page, 'trends', 'trends-cramming', 'obsidian-dark');
  const text = await frame(page).locator('body').innerText();
  expect(text).not.toContain("Olea can't count what's due");
});

/**
 * `@auto-web` — SPRIG-1 (`ol-t1hc`) reachability.
 *
 * The sprig is the brand's only progress indicator and it was computed in core
 * and drawn nowhere for the whole life of the project. Drawing it is not the
 * claim worth pinning; a viewer SEEING it is. These two assertions exist
 * because the plugin unit tests pass whether or not any workbench surface ever
 * mounts a view that reaches `renderSprig`, and the Today golden screenshots
 * did NOT change when the sprig landed — at the time this doc was written,
 * every flat `today` state built `TodayPanelInput` with no `concepts` at all,
 * so their mastery section rendered nothing and the goldens could not have
 * caught a regression here either way. WB-8 (`ol-ppxj.31`) has since given
 * ONE flat `today` state, `today-scope-not-declared`, a real (concepts +
 * vitality) mastery reading — see `today-scenarios.ts`'s module doc — so
 * that one state's golden now does carry ladder/sprig content and was
 * re-baselined for it; every other flat `today` state is unchanged and this
 * paragraph's claim still holds for them.
 */
test('SPRIG-1: the sprig actually reaches the screen on the gap view (step 8)', async ({
  page,
}) => {
  await gotoWalkStep(page, 8);
  const sprigs = frame(page).locator('.olea-sprig');
  await expect(sprigs.first()).toBeVisible();
  // D-048/D-049 retired the "five fixed leaf positions, filled vs. empty
  // outline" reading this assertion used to pin (`ol-8bf9`) — geometry is
  // parameterised per stage instead (`render-sprig.ts`'s `SPRIG_GEOMETRY`):
  // `seed` draws one ellipse and no stem or leaves, `sprout` a stem plus one
  // leaf ellipse, `sapling`/`tree` a stem plus three — never a fourth leaf,
  // and never an empty outline. The first gap row in this fixture (GEOL204,
  // "Imbrication") is `seed`, which is exactly one `<ellipse>` (the seed
  // shape itself; `SPRIG_GEOMETRY.seed.leaves` is empty).
  await expect(sprigs.first().locator('ellipse')).toHaveCount(1);
});

// WB-7 (`ol-ppxj.30`) found this red; VIT-3 (`ol-l5og.17`) then built the
// ladder's real `renderSprig()` call (`packages/plugin/src/today/view.ts`'s
// `renderLadderRow`, matching the field form's geometry per the vocabulary
// registry's "Invariant across both forms" and F2.11/`[D-049]`/`[D-116]`) but
// left this assertion red for a different, upstream reason: step 12's
// `trends-cramming` state (`walkthrough.ts`) built `buildTodayPanel` with no
// `vitality` input, so `MasteryOverviewInput.vitality` was `undefined` and
// `TodayView.renderMastery`'s D-115/D-116 all-null bail-out
// (`courses.every((course) => course.vitality === null)`) suppressed the
// whole mastery section before `renderLadderRow`, and therefore
// `renderSprig()`, ever ran — the sprig geometry was built and simply never
// reachable from any workbench fixture. WB-8 (`ol-ppxj.31`) closed that gap in
// `trends-scenarios.ts` (`buildTrendsViewModel` now supplies a real
// `vitality` input, folded from the state's own review-log entries, for
// every state except `trends-cramming-neutralised` — see that file's module
// doc), and `trends-cramming` is one of the states that now carries one.
test('SPRIG-1: the sprig reaches the trends screen too (step 12)', async ({ page }) => {
  await gotoWalkStep(page, 12);
  await expect(frame(page).locator('.olea-sprig').first()).toBeVisible();
});
