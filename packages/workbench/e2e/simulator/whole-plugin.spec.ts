/**
 * F9.S3 — "The plugin mounts whole" (`features/F9-simulator.md`,
 * `@auto-web:simulator/whole-plugin`), the two scenarios reachable from
 * outside the plugin through the palette alone.
 *
 * All three commands exercised here are UNCONDITIONALLY registered
 * (`register-commands.ts`'s `buildOleaCommands` — no `if (handlers.x)`
 * guard), chosen deliberately over `olea-registry-open`/`olea-home-open`/
 * etc., which `main.ts` only registers when `handlers.openRegistry` etc. is
 * supplied — a detail this suite should not have to track to stay green.
 * All three are also purely local (Today's due composition, Home's
 * whole-ranking session composition and the gap view's coverage/mastery
 * read all run over `olea-core` and the vault, no `requestUrl`), which
 * matters because live mode (WBX-4, F9.S4) has not landed: this suite's
 * `transport` option defaults to `'replay'` with no cassette, so a command
 * that DID call the network would degrade to the F7 unreachable state
 * rather than error — fine in principle, but not something this bead's
 * goldens should depend on by accident.
 *
 * **`COMMAND_SESSION_BUILD`'s destination changed under `[D-243]`/`[HOME-4]`
 * (`ol-egov.135`, landed `ol-egov.132.7` [SESS-8.7]): "the session builder is
 * a panel, not a destination."** Its callback (`main.ts`'s `buildSession`)
 * opens `HomeView` in the MAIN pane now, not `SessionBuilderView` in the
 * right sidebar — see `helpers.ts`'s `openCommandViaPalette` doc for the
 * pane-selection consequence. Caught stale here as `ol-f7ao`: this file
 * (and `goldens.spec.ts`) were last touched three days before SESS-8.7
 * landed and were never updated for it; `packages/plugin/test/session-
 * builder/wiring.spec.ts` already source-asserts the current wiring and was
 * green throughout, so the fix here is the test catching up to an already-
 * ratified, already-tested product change, not a plugin regression.
 *
 * NOT covered here (left for a follow-up lane, not asserted on faith):
 * "the settings tab renders through the plugin's own registration" (no
 * palette command opens Settings — Obsidian's own settings modal is outside
 * the shim, `docs/dev/simulator-design.md` §4) and "file events reach the
 * plugin from the persisted vault" (needs a file-list affordance this bead
 * does not own).
 */
import { expect, test } from '@playwright/test';
import { frame } from '../helpers.js';
import {
  COMMAND_GAP_OPEN,
  COMMAND_SESSION_BUILD,
  COMMAND_TODAY_OPEN,
  gotoSimulator,
  openCommandViaPalette,
  resetSimulator,
  VIEW_TYPE_GAP,
  VIEW_TYPE_HOME,
  VIEW_TYPE_TODAY,
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('@auto-web:simulator/whole-plugin — every unconditional command is listed by id and name in the palette', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  await frame(page).locator('[data-wb-palette-toggle]').click();
  await expect(frame(page).locator('[data-wb-palette]')).toBeVisible();

  for (const [id, name] of [
    [COMMAND_TODAY_OPEN, 'Olea: Open Today panel'],
    [COMMAND_SESSION_BUILD, 'Olea: Build a study session'],
    ['olea-review-start', "Olea: Start today's review"],
    ['olea-gap-open', 'Olea: Open worth-studying panel'],
  ] as const) {
    const item = frame(page).locator(`[data-wb-command-id="${id}"]`);
    await expect(item).toHaveCount(1);
    await expect(item).toHaveText(name);
  }
});

test('@auto-web:simulator/whole-plugin — choosing a palette command opens its view in a leaf through the workspace', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  // The plugin opens Today by default right after mount (`controller.ts`'s
  // `remountPane`) — re-opening it via the palette (rather than trusting the
  // default) is the point of this scenario: the command must actually work,
  // not merely have already happened to be true.
  await openCommandViaPalette(page, COMMAND_TODAY_OPEN, VIEW_TYPE_TODAY);

  // Home also lands in the main pane by default at mount (`controller.ts`'s
  // `remountPane`), so proving `COMMAND_SESSION_BUILD` (`buildSession` →
  // `revealHomeView`, `[D-243]`/`[HOME-4]`) actually does something needs
  // the main pane moved AWAY from Home first — otherwise this test would
  // pass even if the command's callback were deleted outright, since Home
  // would already be showing regardless. `COMMAND_GAP_OPEN` is the
  // unconditional command for that: `revealGapView` shares Home's own
  // main-pane pool (`getLeaf('tab')`).
  await openCommandViaPalette(page, COMMAND_GAP_OPEN, VIEW_TYPE_GAP, 'main');
  await expect(
    frame(page).locator('[data-wb-tab-strip] [data-wb-tab-active][data-wb-view-type]'),
  ).toHaveAttribute('data-wb-view-type', VIEW_TYPE_GAP);

  await openCommandViaPalette(page, COMMAND_SESSION_BUILD, VIEW_TYPE_HOME, 'main');
  // Scoped to the main pane's own tab strip (`ol-3ux7.64.14` [WBX-12]):
  // Today is active in the RIGHT pane's tab strip throughout this test
  // (`controller.ts`'s `remountPane`), so an unscoped `[data-wb-tab-active]`
  // would now match two elements — one per pool.
  await expect(
    frame(page).locator('[data-wb-tab-strip] [data-wb-tab-active][data-wb-view-type]'),
  ).toHaveAttribute('data-wb-view-type', VIEW_TYPE_HOME);
});
