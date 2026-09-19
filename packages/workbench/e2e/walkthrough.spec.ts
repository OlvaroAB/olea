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
 *
 * **Rewritten for `[D-224]`/GAP-1 (`ol-h9fs`).** This test used to pin the
 * first gap row (GEOL204, "Imbrication") as `seed` and assert its sprig drew
 * exactly one `<ellipse>`. `[D-224]` replaced the sidebar list with full-tab
 * per-concept pages where a *material-gap* row (no notes at all for the
 * concept) draws the dotted-and-hatched "no stage" mark and no sprig element
 * at all (`gap/view.ts`'s `renderMasteryMark`) — and, independently, the
 * fixture's only seed-stage concept (Hummocky stratification, 0 events) is
 * exactly that material-gap row (`fixture-oracle-vault.ts` picked it for
 * material-gap deliberately, because removing it from `materialPresence`
 * "orphans no review history"). So no row in the current fixture is both
 * seed-stage and sprig-bearing, by construction, independent of whether the
 * mastery fold or the D-224 render is correct.
 *
 * Rather than re-pin a specific row (which breaks again the next time the
 * fixture or the ranking order changes — this is the second time), this
 * checks every sprig-bearing row's geometry against its own displayed stage
 * word, so it stays valid regardless of which concept the oracle ranks
 * first. Seed-specific geometry (no stem, no leaves — the case no row here
 * can currently exercise) is already pinned independently of any fixture, in
 * `packages/plugin/test/sprig/render-sprig.spec.ts`'s "seed draws no stem and
 * no leaves".
 */
test('SPRIG-1: the sprig actually reaches the screen on the gap view (step 8)', async ({
  page,
}) => {
  await gotoWalkStep(page, 8);

  // Reachability — the one claim this test exists for (see module doc above).
  const sprigs = frame(page).locator('.olea-sprig');
  await expect(sprigs.first()).toBeVisible();

  // Geometry — each sprig-bearing mark carries its own stage word right next
  // to the mark (`renderMasteryMark`'s `masteryEl.createSpan({ text:
  // row.masteryState })`), so this reads the row's OWN claimed stage rather
  // than assuming which stage any particular row is. `seed`/`sprout` draw one
  // ellipse (the seed shape, or the sole leaf); `sapling`/`tree` draw three
  // leaves — never a fourth, never an empty outline (D-048/D-049, `ol-8bf9`).
  const ellipsesForStage: Record<string, number> = {
    seed: 1,
    sprout: 1,
    sapling: 3,
    tree: 3,
  };
  const marks = frame(page)
    .locator('.olea-gap-mastery')
    .filter({ has: frame(page).locator('.olea-sprig') });
  const markCount = await marks.count();
  expect(markCount).toBeGreaterThan(0);
  for (let i = 0; i < markCount; i++) {
    const mark = marks.nth(i);
    const stage = (await mark.textContent())?.trim() ?? '';
    const expectedEllipses = ellipsesForStage[stage];
    if (expectedEllipses === undefined) {
      throw new Error(`unrecognised mastery stage word: ${stage}`);
    }
    await expect(mark.locator('ellipse')).toHaveCount(expectedEllipses);
  }
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
