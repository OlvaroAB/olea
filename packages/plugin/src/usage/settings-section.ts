/**
 * `renderUsageSection` — the F7.3 usage view, rendered into the settings
 * pane (`ol-p3t09`, extended `ol-p6t06`).
 *
 * **Wired into production.** `settings/settings-tab.ts`'s `display()` calls
 * this (see that file's F7.3 comment) and `main.ts`'s `onload()` wires the
 * recording side (`usageLogStore.record`, via `WorkerHttpTransport`'s
 * `onCallRecorded`) — both landed in the same commit that introduced this
 * file (`ol-p3t09`), even though this file's own module doc previously said
 * otherwise; that was stale and is corrected here rather than left to
 * mislead the next reader (Class A doc correction, `ol-p6t06`).
 *
 * **Cannot be unit-tested without a real Obsidian host**, same reasoning as
 * `settings/settings-tab.ts`'s module doc: `Setting`/`createEl` need a live
 * DOM Obsidian provides. Kept thin on purpose — every piece of logic that
 * could be wrong (aggregation, wording) lives in `aggregate.ts`/`copy.ts`,
 * each with its own DOM-free test file. This file is only the wiring
 * between those and Obsidian's `Setting` API, and the `@manual` scenarios
 * in `features/F7-plugin-surface.md` are how the rendered section is
 * actually checked.
 */

import type { App } from 'obsidian';
import { Setting } from 'obsidian';
import { aggregateUsageByFeature } from './aggregate.js';
import {
  describeCostAvailabilityNote,
  describeFeatureUsage,
  USAGE_CACHED_INPUT_NOTE,
  USAGE_SECTION_EMPTY_STATE,
  USAGE_SECTION_HEADING,
  USAGE_SECTION_INTRO,
  usesCachedInputPricing,
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
  containerEl.createEl('p', {
    text: describeCostAvailabilityNote(summaries),
    cls: 'olea-usage-cost-note',
  });

  // D-005's named nuance: only shown once the oracle ranking feature has
  // actually been called — see copy.ts's `USAGE_CACHED_INPUT_NOTE` doc.
  if (usesCachedInputPricing(summaries)) {
    containerEl.createEl('p', {
      text: USAGE_CACHED_INPUT_NOTE,
      cls: 'olea-usage-cached-input-note',
    });
  }
}
