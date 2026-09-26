/**
 * `renderPrivacySection` — F7.4's settings-pane surface (`ol-p6t01`): the
 * "Export & delete your data" section named in the bead's acceptance
 * criterion. Same posture as `usage/settings-section.ts`'s module doc:
 * **cannot be unit-tested without a real Obsidian host** (`Setting`/
 * `createEl`/`Notice` all need a live DOM Obsidian provides), so every
 * piece of logic that could be wrong — the bundling, the purge/delete
 * mechanics, the wording — lives in this folder's other, DOM-free modules
 * with their own test files. This file is only the wiring between those
 * and Obsidian's `Setting` API. See `features/F7-plugin-surface.md`'s
 * `@manual` scenarios for how the rendered section is actually checked.
 *
 * Rendered by `OleaSettingTab.display()` (`../settings/settings-tab.ts`).
 *
 * **Export saves into the vault, not through an OS save dialog.** Obsidian
 * gives a plugin no cross-platform "save file" prompt; writing a new file
 * into the vault is the idiomatic equivalent, and it is what she can then
 * move, copy or delete herself. The file lands under `Olea exports/` —
 * deliberately NOT dot-prefixed (unlike `.olea/`'s caches and logs): this
 * file is made *for* her to find, open and move, not an internal artifact
 * she is not meant to see.
 *
 * **Delete requires two clicks**, never one — `copy.ts`'s
 * `DeleteConfirmState` names the contract this file implements: the first
 * click only relabels the button (`deleteButtonLabel('confirming')`); the
 * second, while still in `'confirming'`, actually calls `runFullDelete`.
 * Re-rendering the whole pane (e.g. navigating away and back) resets state
 * to `'idle'`, so a stale confirm can never fire.
 */

import type { App } from 'obsidian';
import { Notice, Setting } from 'obsidian';
import type { VaultSource } from 'olea-core';
import { calendarDayFromLocalDate } from 'olea-core';
import { ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import {
  DELETE_DESCRIPTION,
  type DeleteConfirmState,
  deleteButtonLabel,
  deleteCompletionMessage,
  EXPORT_BUTTON_LABEL,
  EXPORT_DESCRIPTION,
  EXPORT_DONE_MESSAGE,
  PRIVACY_SECTION_HEADING,
  PRIVACY_SECTION_INTRO,
} from './copy.js';
import { buildPrivacyExportBundle } from './export-bundle.js';
import { runFullDelete } from './full-delete.js';
import { obsidianDeleteHttpRequest } from './obsidian-adapters.js';
import { reloadPluginAfterFullDelete } from './reload-plugin.js';
import type { ObsidianDataHost } from './types.js';

export const PRIVACY_EXPORT_FOLDER = 'Olea exports';

export interface RenderPrivacySectionDeps {
  readonly app: App;
  readonly vault: VaultSource;
  readonly dataHost: ObsidianDataHost;
  readonly deviceId: string;
  /**
   * `ol-3ux7.64.9` [WBX-8]: the plugin's one clock seam (`main.ts`'s
   * `this.now`), threaded through `settings-tab.ts`. Omitted defaults to
   * the real wall clock — unchanged from before this bead.
   */
  readonly now?: () => Date;
}

function exportFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${PRIVACY_EXPORT_FOLDER}/olea-export-${stamp}.json`;
}

export function renderPrivacySection(
  containerEl: HTMLElement,
  deps: RenderPrivacySectionDeps,
): void {
  const readNow = deps.now ?? (() => new Date());
  new Setting(containerEl).setName(PRIVACY_SECTION_HEADING).setHeading();
  containerEl.createEl('p', { text: PRIVACY_SECTION_INTRO, cls: 'olea-privacy-intro' });

  new Setting(containerEl)
    .setName(EXPORT_BUTTON_LABEL)
    .setDesc(EXPORT_DESCRIPTION)
    .addButton((button) => {
      button.setButtonText(EXPORT_BUTTON_LABEL).onClick(() => {
        void (async () => {
          button.setDisabled(true);
          try {
            const now = readNow();
            const bundle = await buildPrivacyExportBundle({
              vault: deps.vault,
              deviceId: deps.deviceId,
              today: calendarDayFromLocalDate(now),
              now: () => now.toISOString(),
            });
            const path = exportFileName(now);
            await deps.vault.write(path, `${JSON.stringify(bundle, null, 2)}\n`);
            new Notice(`${EXPORT_DONE_MESSAGE} Saved to "${path}".`);
          } finally {
            button.setDisabled(false);
          }
        })();
      });
    });

  let confirmState: DeleteConfirmState = 'idle';

  new Setting(containerEl)
    .setName('Delete everything')
    .setDesc(DELETE_DESCRIPTION)
    .addButton((button) => {
      button.setButtonText(deleteButtonLabel(confirmState)).onClick(() => {
        if (confirmState === 'idle') {
          confirmState = 'confirming';
          button.setButtonText(deleteButtonLabel(confirmState));
          return;
        }

        void (async () => {
          button.setDisabled(true);
          try {
            const workerConfigStore = new ObsidianWorkerConfigStore(deps.dataHost);
            const persisted = await workerConfigStore.load();
            const workerConfig: WorkerConfig = {
              baseUrl: persisted.baseUrl,
              token: persisted.token,
            };
            const result = await runFullDelete({
              dataHost: deps.dataHost,
              vault: deps.vault,
              deviceId: deps.deviceId,
              today: calendarDayFromLocalDate(readNow()),
              workerConfig,
              httpRequest: obsidianDeleteHttpRequest,
            });
            // `ol-egov.141.8.7`: `result.remainingOleaPaths` is the widened full
            // delete's own honest discovery pass — never assume it emptied just
            // because every step ran; a discovery-limited host can still leave
            // something under `.olea/` (see `full-delete.ts`'s module doc).
            new Notice(deleteCompletionMessage(result.remainingOleaPaths.length));
            // `ol-ppxj.26`: `runFullDelete` just minted a fresh device id, but
            // every port built once at `onload` (`main.ts`) already captured
            // the OLD one by closure. Reloading the plugin here — rather than
            // leaving that for her next Obsidian restart — is what makes the
            // reset actually take effect for the rest of this session; see
            // `reload-plugin.ts`'s module doc for why this is the smaller,
            // more honest fix than re-threading `deviceId` everywhere.
            await reloadPluginAfterFullDelete(deps.app);
          } finally {
            confirmState = 'idle';
            button.setButtonText(deleteButtonLabel(confirmState));
            button.setDisabled(false);
          }
        })();
      });
    });
}
