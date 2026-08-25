/**
 * The settings pane's "AI usage" section copy (F7.3, `ol-p3t09`). Kept as
 * plain strings/functions, not JSX/markup, same reasoning as
 * `settings/degradation-statement.ts`: `settings-tab.ts` (or whichever
 * settings surface renders this) uses Obsidian's own `Setting`/`createEl`
 * calls, and every piece of wording worth testing lives here where it can
 * be asserted without a DOM.
 */

import type { FeatureUsageSummary } from './types.js';

export const USAGE_SECTION_HEADING = 'AI usage';

export const USAGE_SECTION_EMPTY_STATE =
  'No AI calls have been recorded yet in this build. This section fills in as Olea makes calls on your behalf.';

/** F7.3: "informational in v0.9, the future quota surface." Named explicitly rather than left implicit, same discipline as the F7.8 degradation statement. */
export const USAGE_SECTION_INTRO =
  'AI usage to date, per feature — informational only for now; there is no quota to manage yet.';

/**
 * Why cost never appears as a number. `costUsd` is always `null` on every
 * `FeatureUsageSummary` in this build (see `types.ts`) because the client
 * has no data source for it: the server-side telemetry that computes cost
 * (C4.4) travels to Analytics Engine and never reaches the client
 * (D-005/D-014), and the response stamp the client does receive (D7.3)
 * carries only prompt version and model id. Stating this plainly, rather
 * than rendering a "$0.00" or omitting the row, is the D-005 anti-
 * fabrication discipline applied to this view: an absent figure must read
 * as absent, never as zero.
 */
export const USAGE_COST_UNAVAILABLE_NOTE =
  "Cost isn't shown yet — that figure is recorded server-side only and doesn't reach the plugin in this build.";

/** One line per feature, e.g. "quiz.generate.v1 — 12 calls (gpt-4o-mini, prompt v1.2.0)". */
export function describeFeatureUsage(summary: FeatureUsageSummary): string {
  const models = summary.modelIds.join(', ');
  const prompts = summary.promptVersions.join(', ');
  const callWord = summary.callCount === 1 ? 'call' : 'calls';
  return `${summary.taskId} — ${summary.callCount} ${callWord} (${models}, prompt ${prompts})`;
}
