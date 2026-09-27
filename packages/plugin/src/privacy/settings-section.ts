/**
 * `renderPrivacySection` — F7.4's settings-pane surface (`ol-p6t01`): the
 * "Export & delete your data" section named in the bead's acceptance
 * criterion. The bundling, the purge/delete mechanics and the wording live
 * in this folder's other, DOM-free modules with their own test files; this
 * file wires those to Obsidian's `Setting` API. Its button paths are driven
 * under Vitest with a small `obsidian` stand-in
 * (`test/privacy/settings-section.spec.ts`, `ol-egov.141.8.12`); how the
 * rendered section looks stays `@manual` (`features/F7-plugin-surface.md`).
 *
 * **The export carries the settings-stored records** (`ol-egov.141.8.12`):
 * the button passes the plugin's data host to `buildPrivacyExportBundle`, so
 * the bundle's `settings` holds every content-derived key `data-manifest.ts`
 * lists. Before this, the button passed none and every real export carried
 * `settings: null`.
 *
 * **No writer of the old plugin instance outlives the delete**
 * (`ol-egov.141.8.12`, `FullDeleteWriteSeal` below). A store holding an
 * in-memory copy loaded before the delete, a background job still running,
 * and `main.ts`'s unload-time flush of the gate-stage counts would each
 * write their copy back into the settings file after the delete cleared it.
 * Before the delete starts, the section seals the plugin's one settings
 * host: every later write from that instance is dropped, writes issued
 * before the seal land first, and the delete writes through the unsealed
 * queue underneath. After a reload the old instance stays sealed for good;
 * when no reload happened (the delete threw, or the host has no reload
 * API) the seal is lifted and the instance runs on as it did before this
 * bead. What the plugin does after the reload is not decided here
 * (`[D-406]`). Out of reach, and so not claimed: files a still-running job
 * of the old instance writes into the vault after the delete.
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
import type { AtomicDataHost } from '../retrieval/serializing-data-host.js';
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

/** What `FullDeleteWriteSeal.seal` hands the delete: the host it writes through, and the lift. */
export interface SealedFullDeleteHost {
  /** The unsealed queue: ordered after every write issued before the seal. The delete's reads and writes go here. */
  readonly dataHost: AtomicDataHost;
  /** Lifts this seal, unless the plugin instance was unloaded meanwhile — a retired instance stays sealed. */
  release(): void;
}

/** The plugin instance's side of the seal: `main.ts`'s `OleaPlugin` implements it; the pane finds it on its data host. */
export interface FullDeleteWriterSealHost {
  sealForFullDelete(): Promise<SealedFullDeleteHost>;
}

function hasFullDeleteWriterSeal(
  host: ObsidianDataHost,
): host is ObsidianDataHost & FullDeleteWriterSealHost {
  return typeof (host as Partial<FullDeleteWriterSealHost>).sealForFullDelete === 'function';
}

/**
 * The plugin's one settings-file host, with a seal for the full delete (`ol-egov.141.8.12`; see
 * the module doc). Wraps the serializing queue every store of the instance writes through
 * (`../retrieval/serializing-data-host.ts`): reads always pass; a write issued while sealed is
 * dropped before it reaches the queue, so a write issued earlier still lands in order and nothing
 * issued later can overtake the delete. `retire` is `onunload`'s call: it answers whether an
 * unload-time flush may run, and a sealed instance that retires stays sealed.
 */
export class FullDeleteWriteSeal implements AtomicDataHost {
  private sealDepth = 0;
  private retired = false;

  constructor(private readonly queue: AtomicDataHost) {}

  loadData(): Promise<unknown> {
    return this.queue.loadData();
  }

  saveData(data: unknown): Promise<void> {
    return this.sealDepth > 0 ? Promise.resolve() : this.queue.saveData(data);
  }

  readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void> {
    return this.sealDepth > 0 ? Promise.resolve() : this.queue.readModifyWrite(mutate);
  }

  /** Seals, then resolves once every write issued before the seal has landed. */
  async seal(): Promise<SealedFullDeleteHost> {
    this.sealDepth += 1;
    let released = false;
    try {
      await this.queue.loadData();
    } catch (error) {
      // No delete follows a failed seal, so nothing stays sealed.
      this.sealDepth -= 1;
      throw error;
    }
    return {
      dataHost: this.queue,
      release: () => {
        if (released || this.retired) return;
        released = true;
        this.sealDepth -= 1;
      },
    };
  }

  /** `onunload`: marks the instance done. `true` when unsealed, so an unload-time flush may write. */
  retire(): boolean {
    this.retired = true;
    return this.sealDepth === 0;
  }
}

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
              dataHost: deps.dataHost,
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
          // `ol-egov.141.8.12`: seal before anything is read or cleared, so no writer of this
          // plugin instance can put a cleared key back (module doc). `null` on a host without it.
          let seal: SealedFullDeleteHost | null = null;
          try {
            seal = hasFullDeleteWriterSeal(deps.dataHost)
              ? await deps.dataHost.sealForFullDelete()
              : null;
            const deleteHost: ObsidianDataHost = seal?.dataHost ?? deps.dataHost;
            const workerConfigStore = new ObsidianWorkerConfigStore(deleteHost);
            const persisted = await workerConfigStore.load();
            const workerConfig: WorkerConfig = {
              baseUrl: persisted.baseUrl,
              token: persisted.token,
            };
            const result = await runFullDelete({
              dataHost: deleteHost,
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
            // A no-op once the reload unloaded this instance; otherwise the instance runs on.
            seal?.release();
            confirmState = 'idle';
            button.setButtonText(deleteButtonLabel(confirmState));
            button.setDisabled(false);
          }
        })();
      });
    });
}
