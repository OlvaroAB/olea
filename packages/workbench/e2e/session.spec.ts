/**
 * `@auto-web` — the session-builder surface's six states (F4.6, F4.7, F4.8,
 * F4.9; `ol-p5t06b` [P5-T06b] / `ol-opmb.3`), driven in a real browser
 * against the real `SessionBuilderView` and `buildStudySession` over the
 * fixture vault (see `session-scenarios.ts`'s module doc — every number is
 * real computation, no model spend).
 *
 * WB-2 (`ol-z6x2`), first-tranche flow coverage: `visual-regression.spec.ts`
 * already screenshots every one of these states, but a screenshot diff never
 * clicks anything. The budget buttons (`SessionBuilderView.renderBudgetControls`)
 * are the one genuinely interactive control this surface has — `deps.load`
 * rebuilds the session for whatever budget is clicked, against the cached
 * fixture-vault world, so clicking one is a real recompute and not a second
 * pre-baked URL. That is the flow this file exists to drive; the per-state
 * tests below are the same structural-assertion shape `oracle.spec.ts` and
 * `retrieve.spec.ts` already use, filling the surface's remaining gap.
 *
 * Nothing here retags a `features/` scenario — see the run's handback note.
 *
 * **`[D-243]` (`ol-egov.132.7` [SESS-8.7], 2026-09-12) gutted this view's own
 * DOM.** `SessionBuilderView.render()` now calls only `renderSteeringControls`
 * — the three F4.6 steering inputs — and nothing else; the ranked item list,
 * the "could not find X" copy line and the `kind: 'unavailable'` box all
 * moved to `../home/view.ts`'s `HomeView`, which has no flat-surface mount in
 * this workbench (only the simulator mounts a real `HomeView`, via the whole
 * `OleaPlugin`). So `.olea-session-item`/`-line`/`-unavailable*`/`-copy`
 * never render under `mountSession` any more, and this file no longer
 * asserts on them — the still-real, still-computed facts (budget, items
 * count, format preference, duration basis) are read from the workbench's
 * own `renderSessionInspector` panel instead, which calls the identical
 * `buildStudySession` the real view used to render, independent of which
 * component draws it. **Gap this leaves**: nothing in `@auto-web` currently
 * exercises `HomeView`'s own rendering of the composed session or its
 * unavailable state — that needs a new `home-scenarios.ts` +
 * `mountHome` flat-surface builder in a future tranche (filed on `ol-z6x2`).
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** One inspector row's value text, from the top-document inspector (never the iframe). */
async function inspectorRowValue(page: Page, label: string): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

/**
 * The real item count off the inspector's `items` row (`main.ts`'s
 * `renderSessionInspector`, computed from the real `model.items.length` —
 * never `.olea-session-item`, which `[D-243]` retired from this route; see
 * this file's module doc).
 */
async function inspectorItemCount(page: Page): Promise<number> {
  const items = await inspectorRowValue(page, 'items');
  const match = /^(\d+) item\(s\)/.exec(items);
  if (match === null)
    throw new Error(`session.spec.ts: could not parse an item count from "${items}"`);
  return Number(match[1]);
}

/** The real `SessionBuilderView`'s budget button carrying this label ("20 min", "45 min", "90 min"). */
function budgetButton(page: Page, label: string) {
  return frame(page).locator('.olea-session-budget', { hasText: label });
}

test('session-exam-eve-90: F4.8 format preference resolves to MCQ ahead of Q&A/cloze the night before a quiz', async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-exam-eve-90', 'obsidian-dark');
  const budget = await inspectorRowValue(page, 'budget');
  expect(budget).toContain('90 min');
  const items = await inspectorRowValue(page, 'items');
  // `[D-246]`/VOC-7 (`abb6d75`) widened the declared format-class map: the
  // old two-value `'mcq'`/`unknown` code is now `'recall-style'` (quiz, test,
  // exam, midterm, final all resolve here — `format-class.ts`'s word table).
  expect(items).toContain('formatPreference: recall-style');
  expect(await inspectorItemCount(page)).toBeGreaterThan(0);
  // Borrowed instruments — the illustrative label the workbench adds so a
  // reader never mistakes a re-bound fixture card for one that arrived that
  // way in her real vault (session-scenarios.ts's own module doc).
  await expect(frame(page).locator('.wb-illustrative-label')).toBeVisible();
});

test("session-short-20: F4.6's own example budget, no imminent quiz so the format preference is silent", async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-short-20', 'obsidian-dark');
  const budget = await inspectorRowValue(page, 'budget');
  expect(budget).toContain('20 min');
  const items = await inspectorRowValue(page, 'items');
  // `[D-246]`/VOC-7 (`abb6d75`): `formatPreference` now resolves to `unknown`
  // ONLY when there is no next assessment at all; an assessment whose type
  // the declared-class word table does not recognise falls to `'written'`
  // rather than `unknown` (`format-class.ts`'s own default) — this state has
  // an assessment, just not an imminent quiz, so the preference is a real
  // declared class now, not silence.
  expect(items).toContain('formatPreference: written');
  expect(await inspectorItemCount(page)).toBeGreaterThan(0);
  // The default 20-minute button IS one of the three clickable options here
  // (unlike session-tight-5's 5-minute default), so it should render active.
  await expect(budgetButton(page, '20 min')).toHaveClass(/olea-session-budget-active/);
});

test('session-tight-5: the budget actually bites — items are left out, and 5 minutes matches none of the three buttons', async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-tight-5', 'obsidian-dark');
  const items = await inspectorRowValue(page, 'items');
  // `model.leftOut.length` (grouped by concept/row) stays 0 here — every
  // ranked row still gets a slot — but the parenthetical instrument count is
  // where the 5-minute budget actually shows: fewer instruments per row were
  // included than the same rows get at 20/45/90 minutes (13 items there,
  // fewer here — see the debug run this assertion was verified against).
  const leftOutInstrumentsMatch = /\((\d+) instrument\(s\)\)/.exec(items);
  expect(leftOutInstrumentsMatch).not.toBeNull();
  expect(Number(leftOutInstrumentsMatch?.[1])).toBeGreaterThan(0);
  // The view's three budget buttons are always 20/45/90 (SESSION_BUDGET_OPTIONS)
  // regardless of this state's own 5-minute default, so none of them is the
  // active one on load — a real, slightly surprising consequence of the
  // budget list being a Class B default independent of any one state.
  await expect(frame(page).locator('.olea-session-budget-active')).toHaveCount(0);
});

test('session-measured-45: durationBasis reads measured, not assumed', async ({ page }) => {
  await gotoState(page, 'session', 'session-measured-45', 'obsidian-dark');
  const budget = await inspectorRowValue(page, 'budget');
  expect(budget).toContain('45 min');
  expect(budget).toContain('durationBasis: measured');
  await expect(budgetButton(page, '45 min')).toHaveClass(/olea-session-budget-active/);
});

test('session-exam-eve-90 / session-short-20: every other state reads durationBasis assumed, not measured', async ({
  page,
}) => {
  for (const stateId of ['session-exam-eve-90', 'session-short-20'] as const) {
    await gotoState(page, 'session', stateId, 'obsidian-dark');
    const budget = await inspectorRowValue(page, 'budget');
    expect(budget).not.toContain('durationBasis: measured');
  }
});

test('session-no-cards-yet: ranked concepts exist, but none is practisable — a coverage gap, not a budget gap', async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-no-cards-yet', 'obsidian-dark');
  const items = await inspectorRowValue(page, 'items');
  expect(items).toContain('0 item(s)');
  const consideredMatch = /considered (\d+) row/.exec(items);
  expect(consideredMatch).not.toBeNull();
  // The whole point of this state (session-scenarios.ts's module doc): rows
  // WERE ranked and considered, there is simply nothing practisable among
  // them — `consideredRowCount` is what tells this apart from
  // session-nothing-to-build's zero ranked rows below.
  expect(Number(consideredMatch?.[1])).toBeGreaterThan(0);
  // This state is a real empty MODEL — a session with zero items — never the
  // `kind: 'unavailable'` branch. `session-vault-unreadable` below is what
  // reaches that branch (round 35 tranche, `ol-z6x2`). The inspector's own
  // `0 item(s)` above is the whole proof now; `[D-243]` retired the DOM this
  // test used to also check (see the module doc).
  expect(await inspectorItemCount(page)).toBe(0);
});

test('session-nothing-to-build: no past paper registered, rankOracle abstains — zero ranked rows, the OTHER emptiness', async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-nothing-to-build', 'obsidian-dark');
  const items = await inspectorRowValue(page, 'items');
  expect(items).toContain('0 item(s)');
  const consideredMatch = /considered (\d+) row/.exec(items);
  expect(consideredMatch).not.toBeNull();
  expect(Number(consideredMatch?.[1])).toBe(0);
  expect(await inspectorItemCount(page)).toBe(0);
});

test("session-vault-unreadable: SessionBuilderView's kind: 'unavailable' branch, reached through a real vault-list failure (round 35, ol-z6x2)", async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-vault-unreadable', 'obsidian-dark');
  // The steering controls still render (`SessionBuilderView.render` draws
  // them unconditionally — `[D-243]` moved everything conditional on
  // `state.kind`, including the unavailable box this test used to also
  // assert in this view's own DOM, to `HomeView`, which has no flat-surface
  // mount here; see the module doc). Real, still-testable proof of reaching
  // the `kind: 'unavailable'` branch is the inspector's own line below,
  // which reads `SessionScenario.model` directly rather than through a
  // renderer.
  await expect(frame(page).locator('.olea-session-budget')).not.toHaveCount(0);
  // The inspector's own honest counterpart: no world was composed, so it has
  // nothing independent to read — never a silent zero standing in for a
  // model (session-scenarios.ts's own doc on `SessionScenario.model`).
  const sessionRow = await inspectorRowValue(page, 'session');
  expect(sessionRow).toContain('unavailable');
  expect(sessionRow).toContain('no world composed');
  // No illustrative label either — this state's instruments/history are both
  // the 'real'/'none' defaults, not borrowed.
  await expect(frame(page).locator('.wb-illustrative-label')).toHaveCount(0);
});

test('FLOW: clicking a budget button re-runs buildStudySession for real, over the cached fixture-vault world', async ({
  page,
}) => {
  await gotoState(page, 'session', 'session-tight-5', 'obsidian-dark');
  const itemsBefore = await inspectorItemCount(page);

  await budgetButton(page, '20 min').click();
  await expect(budgetButton(page, '20 min')).toHaveClass(/olea-session-budget-active/);

  // The 5-minute default matched none of the three buttons (previous test),
  // so clicking any one of them is a real state change, not a no-op replay
  // of the URL's own pre-baked scenario — this is Playwright driving the
  // component, exactly as `keyboard-flows.spec.ts` and `generate.spec.ts`'s
  // accept-button test do for their own surfaces. Read from the inspector,
  // not `.olea-session-item` — `[D-243]` retired that DOM (module doc), and
  // `main.ts`'s `mountSession` now re-renders the inspector from every
  // `deps.load` a click makes, so this is still a live read of the click's
  // real effect, not a stale one-shot snapshot.
  const itemsAfter20 = await inspectorItemCount(page);
  expect(itemsAfter20).toBeGreaterThanOrEqual(itemsBefore);

  // Clicking a strictly larger budget can only ever add items or hold
  // steady — never remove one the smaller budget already fit.
  await budgetButton(page, '90 min').click();
  await expect(budgetButton(page, '90 min')).toHaveClass(/olea-session-budget-active/);
  await expect(budgetButton(page, '20 min')).not.toHaveClass(/olea-session-budget-active/);
  const itemsAfter90 = await inspectorItemCount(page);
  expect(itemsAfter90).toBeGreaterThanOrEqual(itemsAfter20);
});
