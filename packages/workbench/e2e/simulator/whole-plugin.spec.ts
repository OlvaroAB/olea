/**
 * F9.S3 — "The plugin mounts whole" (`features/F9-simulator.md`,
 * `@auto-web:simulator/whole-plugin`), the two scenarios reachable from
 * outside the plugin through the palette alone.
 *
 * Both commands exercised here are UNCONDITIONALLY registered
 * (`register-commands.ts`'s `buildOleaCommands` — no `if (handlers.x)`
 * guard), chosen deliberately over `olea-registry-open`/`olea-home-open`/
 * etc., which `main.ts` only registers when `handlers.openRegistry` etc. is
 * supplied — a detail this suite should not have to track to stay green.
 * Both are also purely local (Today's due composition and the session
 * builder's ranking both run over `olea-core` and the vault, no
 * `requestUrl`), which matters because live mode (WBX-4, F9.S4) has not
 * landed: this suite's `transport` option defaults to `'replay'` with no
 * cassette, so a command that DID call the network would degrade to the F7
 * unreachable state rather than error — fine in principle, but not something
 * this bead's goldens should depend on by accident.
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
  COMMAND_SESSION_BUILD,
  COMMAND_TODAY_OPEN,
  gotoSimulator,
  openCommandViaPalette,
  resetSimulator,
  VIEW_TYPE_SESSION_BUILDER,
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

  await openCommandViaPalette(page, COMMAND_SESSION_BUILD, VIEW_TYPE_SESSION_BUILDER);
  // Scoped to the right sidebar's own tab strip (`ol-3ux7.64.14` [WBX-12]):
  // Home is active in the MAIN pane's tab strip from the moment of mount
  // (`controller.ts`'s `remountPane`), so an unscoped `[data-wb-tab-active]`
  // would now match two elements — one per pool.
  await expect(
    frame(page).locator('[data-wb-right-tab-strip] [data-wb-tab-active][data-wb-view-type]'),
  ).toHaveAttribute('data-wb-view-type', VIEW_TYPE_SESSION_BUILDER);
});
