/**
 * `renderUsageSection` — the F7.3 usage view stub, rendered into the
 * settings pane (`ol-p3t09`).
 *
 * **Cannot be unit-tested without a real Obsidian host**, same reasoning as
 * `settings/settings-tab.ts`'s module doc: `Setting`/`createEl` need a live
 * DOM Obsidian provides. Kept thin on purpose — every piece of logic that
 * could be wrong (aggregation, wording) lives in `aggregate.ts`/`copy.ts`,
 * each with its own DOM-free test file. This file is only the wiring
 * between those and Obsidian's `Setting` API, and the `@manual` scenarios
 * in `features/F7-plugin-surface.md` are how the rendered section is
 * actually checked.
 *
 * Not wired into `settings-tab.ts` by this bead: that file is outside
 * `ol-p3t09`'s owned paths. See the bead's report for the exact call to
 * add to `OleaSettingTab.display()`.
 */

import type { App } from 'obsidian';
import { Setting } from 'obsidian';
import { aggregateUsageByFeature } from './aggregate.js';
import {
  describeFeatureUsage,
  USAGE_COST_UNAVAILABLE_NOTE,
  USAGE_SECTION_EMPTY_STATE,
  USAGE_SECTION_HEADING,
  USAGE_SECTION_INTRO,
} from './copy.js';
import type { ObsidianDataHost } from './log-store.js';
import { ObsidianUsageLogStore } from './log-store.js';

/** `app` is accepted for parity with the other `render*Fields` methods in `settings-tab.ts` even though this section needs no App API directly — keeps the call site uniform if that changes later. */
export async function renderUsageSection(
  containerEl: HTMLElement,
  dataHost: ObsidianDataHost,
  _app?: App,
): Promise<void> {
  const store = new ObsidianUsageLogStore(dataHost);
  const entries = await store.load();
  const summaries = aggregateUsageByFeature(entries);

  new Setting(containerEl).setName(USAGE_SECTION_HEADING).setHeading();
  containerEl.createEl('p', { text: USAGE_SECTION_INTRO, cls: 'olea-usage-intro' });

  if (summaries.length === 0) {
    containerEl.createEl('p', { text: USAGE_SECTION_EMPTY_STATE, cls: 'olea-usage-empty' });
    return;
  }

  const list = containerEl.createEl('ul', { cls: 'olea-usage-list' });
  for (const summary of summaries) {
    list.createEl('li', { text: describeFeatureUsage(summary) });
  }
  containerEl.createEl('p', { text: USAGE_COST_UNAVAILABLE_NOTE, cls: 'olea-usage-cost-note' });
}
