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
 * **Not wired into `settings-tab.ts` by this bead** — that file is outside
 * `ol-p6t01`'s owned paths (`privacy/`, `privacy/test`, this feature file,
 * and `olea-service`'s `src/`/`test/` only). See this bead's report for the
 * exact call to add to `OleaSettingTab.display()`, following the same
 * pattern `renderUsageSection`'s own module doc already documents for
 * itself.
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
  DELETE_DONE_MESSAGE,
  type DeleteConfirmState,
  deleteButtonLabel,
  EXPORT_BUTTON_LABEL,
  EXPORT_DESCRIPTION,
  EXPORT_DONE_MESSAGE,
  PRIVACY_SECTION_HEADING,
  PRIVACY_SECTION_INTRO,
} from './copy.js';
import { buildPrivacyExportBundle } from './export-bundle.js';
import { runFullDelete } from './full-delete.js';
import { createObsidianVaultDeletePort, obsidianDeleteHttpRequest } from './obsidian-adapters.js';
import type { ObsidianDataHost } from './types.js';

export const PRIVACY_EXPORT_FOLDER = 'Olea exports';

export interface RenderPrivacySectionDeps {
  readonly app: App;
  readonly vault: VaultSource;
  readonly dataHost: ObsidianDataHost;
  readonly deviceId: string;
}

function exportFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${PRIVACY_EXPORT_FOLDER}/olea-export-${stamp}.json`;
}

export function renderPrivacySection(
  containerEl: HTMLElement,
  deps: RenderPrivacySectionDeps,
): void {
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
            const now = new Date();
            const bundle = await buildPrivacyExportBundle({
              vault: deps.vault,
              deviceId: deps.deviceId,
              today: calendarDayFromLocalDate(now),
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
            await runFullDelete({
              dataHost: deps.dataHost,
              vault: deps.vault,
              vaultDelete: createObsidianVaultDeletePort(deps.app),
              deviceId: deps.deviceId,
              today: calendarDayFromLocalDate(new Date()),
              workerConfig,
              httpRequest: obsidianDeleteHttpRequest,
            });
            new Notice(DELETE_DONE_MESSAGE);
          } finally {
            confirmState = 'idle';
            button.setButtonText(deleteButtonLabel(confirmState));
            button.setDisabled(false);
          }
        })();
      });
    });
}
