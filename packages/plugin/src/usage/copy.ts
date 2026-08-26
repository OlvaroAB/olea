/**
 * The settings pane's "AI usage" section copy (F7.3, `ol-p3t09`, extended
 * `ol-p6t06`). Kept as plain strings/functions, not JSX/markup, same
 * reasoning as `settings/degradation-statement.ts`: `settings-tab.ts` (or
 * whichever settings surface renders this) uses Obsidian's own
 * `Setting`/`createEl` calls, and every piece of wording worth testing
 * lives here where it can be asserted without a DOM.
 */

import { TASK_IDS } from 'olea-contracts';
import type { FeatureUsageSummary } from './types.js';

export const USAGE_SECTION_HEADING = 'AI usage';

export const USAGE_SECTION_EMPTY_STATE =
  'No AI calls have been recorded yet in this build. This section fills in as Olea makes calls on your behalf.';

/** F7.3: "informational in v0.9, the future quota surface." Named explicitly rather than left implicit, same discipline as the F7.8 degradation statement. */
export const USAGE_SECTION_INTRO =
  'AI usage to date, per feature — informational only for now; there is no quota to manage yet.';

/**
 * Why cost never appears as a number **for a feature with no priced calls**.
 * `costUsd` is `null` on a `FeatureUsageSummary` whenever none of that
 * feature's recorded entries carry a real figure (see `types.ts`) — true of
 * every summary in this build today, because the recording call site
 * (`worker/transport.ts`/`main.ts`, outside this module) does not yet pass
 * `[D-123]`'s usage figures through. Stating this plainly, rather than
 * rendering a "$0.00" or omitting the row, is the D-005 anti-fabrication
 * discipline applied to this view: an absent figure must read as absent,
 * never as zero.
 */
export const USAGE_COST_UNAVAILABLE_NOTE =
  "Cost isn't shown yet — that figure is recorded server-side only and doesn't reach the plugin in this build.";

/** Shown instead of the note above once every recorded feature has at least one priced call. */
export const USAGE_COST_AVAILABLE_NOTE =
  "Cost totals above are the AI provider's own reported figures for calls this build has recorded — never an estimate.";

/** Shown when some but not all recorded calls carry a cost figure — a mixed log, e.g. spanning the point the recording wiring above was extended. */
export const USAGE_COST_PARTIAL_NOTE =
  'Cost totals above cover only the calls this build recorded a figure for — some earlier calls aren\'t included, and totals marked "at least" are undercounts, never full totals.';

/**
 * D-005's named nuance: "Slot O's cached-input pricing means her past
 * papers sit briefly in a provider-side prompt cache — transient,
 * TTL-bounded, but real; it gets named in the usage view (F7.3) rather than
 * hidden." `oracle.rank.v1` is the only task id routed to Slot O
 * (`docs/Olea_ai_workload_and_cost_model.md` §2, service repo), so its
 * presence in the log is what triggers this note — a structural fact about
 * which feature uses that pricing path, not a per-call measurement (no
 * slot's cost model measures actual cache hits yet).
 */
export const USAGE_CACHED_INPUT_NOTE =
  "Oracle exam-practice calls briefly place recently-sent material in the AI provider's own prompt cache to keep repeat calls cheaper — transient and time-limited, never stored beyond that window.";

/** One line per feature, e.g. "quiz.generate.v1 — 12 calls (gpt-4o-mini, prompt v1.2.0)", with a cost clause appended only when this feature has at least one priced call. */
export function describeFeatureUsage(summary: FeatureUsageSummary): string {
  const models = summary.modelIds.join(', ');
  const prompts = summary.promptVersions.join(', ');
  const callWord = summary.callCount === 1 ? 'call' : 'calls';
  const base = `${summary.taskId} — ${summary.callCount} ${callWord} (${models}, prompt ${prompts})`;
  if (summary.costUsd === null) {
    return base;
  }
  const amount = summary.costUsd.toFixed(4);
  return summary.pricedCallCount === summary.callCount
    ? `${base} — $${amount}`
    : `${base} — at least $${amount} (${summary.pricedCallCount} of ${summary.callCount} calls priced)`;
}

/** Picks the right cost-availability note for the whole section, given every feature summary currently shown. */
export function describeCostAvailabilityNote(summaries: readonly FeatureUsageSummary[]): string {
  const priced = summaries.filter((s) => s.costUsd !== null).length;
  if (priced === 0) return USAGE_COST_UNAVAILABLE_NOTE;
  if (priced === summaries.length) return USAGE_COST_AVAILABLE_NOTE;
  return USAGE_COST_PARTIAL_NOTE;
}

/** True when the oracle ranking feature (Slot O, `oracle.rank.v1`) has been recorded at least once — the trigger for naming D-005's cached-input pricing nuance. */
export function usesCachedInputPricing(summaries: readonly FeatureUsageSummary[]): boolean {
  return summaries.some((s) => s.taskId === TASK_IDS.ORACLE_RANK);
}
