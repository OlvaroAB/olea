/**
 * Forces a reload of this plugin instance immediately after a full delete
 * (`ol-ppxj.26`, discovered from `ol-1ttf`).
 *
 * `runFullDelete` mints and persists a fresh device id (`resetDeviceId`),
 * but `main.ts`'s `onload` reads the id exactly once (`ensureDeviceId`) and
 * threads that single value by closure into everything built there —
 * `this.review.ports` (`reviewLog`, `suspendPort`, `gradeContestPort`),
 * `generationWiring`, the study-plan refresh, and more. None of that
 * refreshes mid-session: absent this fix, every one of those ports keeps
 * stamping events with the OLD device id until she next restarts Obsidian
 * or explicitly reloads the plugin, so a "full delete" that mints a fresh
 * identity silently does not take effect where it matters until later.
 *
 * The honest fix that stays inside this feature's own boundary is to make
 * the reset take effect immediately: disable-then-enable this plugin runs
 * `onunload` then a fresh `onload`, which rebuilds every one of those
 * closures against whatever is now persisted — the freshly-minted id,
 * since `ensureDeviceId` reads it back unchanged (it only mints when
 * nothing valid is stored).
 *
 * The alternative — re-threading `deviceId` through every consumer as a
 * live getter instead of a captured value — would touch the entire
 * `onload` wiring graph (review ports, generation wiring, the misconception
 * store, the study-plan refresh, ...), almost none of which lives in this
 * plugin's `privacy/` or `device/` modules. A forced reload is the smaller,
 * more honest fix: one call, at the one place a full delete already
 * finishes, entirely inside the module that owns the delete flow.
 *
 * **`app.plugins` has no public type.** `obsidian.d.ts` declares no
 * `plugins` member on `App` at all — the same undocumented territory
 * `main.ts`'s `openSettingsTab` already reaches into for `app.setting`,
 * reached the same defensive way here: cast, guard every method with
 * optional chaining, and never throw out of a delete that has already
 * succeeded (degrade-never-block, F6.9). A host that removes or renames
 * this API leaves her with the pre-existing behaviour — "delete ran,
 * reload the plugin yourself to finish" — never a thrown error surfacing
 * on top of a delete Notice that already told her it worked.
 */

import type { App } from 'obsidian';

interface PluginManagerLike {
  disablePlugin?: (id: string) => Promise<void>;
  enablePlugin?: (id: string) => Promise<void>;
}

/** Must match `manifest.json`'s `id` field — stable for the life of the plugin; see `reload-plugin.spec.ts`'s cross-check against the real file. */
export const PLUGIN_ID = 'olea';

/**
 * Best-effort: resolves whether or not the reload actually happened. Never
 * rejects — see this module's doc for why a failure here must not surface
 * as an error on top of a delete that already completed.
 */
export async function reloadPluginAfterFullDelete(
  app: App,
  pluginId: string = PLUGIN_ID,
): Promise<void> {
  try {
    const plugins = (app as unknown as { plugins?: PluginManagerLike }).plugins;
    if (plugins?.disablePlugin === undefined || plugins.enablePlugin === undefined) return;
    await plugins.disablePlugin(pluginId);
    await plugins.enablePlugin(pluginId);
  } catch {
    // Best effort — see this module's doc.
  }
}
