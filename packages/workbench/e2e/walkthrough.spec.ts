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
 * did NOT change when the sprig landed — the flat `today` states are never
 * given a trends source, so their mastery section renders nothing and the
 * goldens could not have caught a regression here either way.
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

// WB-7 (`ol-ppxj.30`) finding, left as a reported red rather than fixed here:
// step 12 mounts `TodayView` (surface `trends`), and `TodayView`'s ladder form
// (`renderLadderRow` in `packages/plugin/src/today/view.ts`) draws each
// concept as a plain `.olea-today-mastery-ladder-dot` div, never a real
// `renderSprig()` — `.olea-sprig` genuinely does not exist on this surface,
// under any selector. That is a real gap against the vocabulary registry's
// own normative invariant ("The two forms" §, "Invariant across both forms":
// "identical sprig geometry, only the pixel size changes" — F2.11, amended by
// `[D-049]`/`[D-116]`), which this assertion is correctly pinning: the ladder
// form should draw sprig geometry per concept and currently draws a plain
// mark instead. VIT-2 (`ol-a3hv`, closed) built the ladder with plain
// tending/early marks rather than sprig geometry, so the gap is pre-existing,
// not a WB-7 regression. Per this bead's own instruction ("if the affordance
// is clause-backed but unbuilt, do NOT build it"), this e2e-only lane does
// not touch `packages/plugin/src/today/view.ts` — the fix belongs to whoever
// owns that file, as a follow-up to VIT-2 under F2.11. Left red on purpose.
test('SPRIG-1: the sprig reaches the trends screen too (step 12)', async ({ page }) => {
  await gotoWalkStep(page, 12);
  await expect(frame(page).locator('.olea-sprig').first()).toBeVisible();
});
