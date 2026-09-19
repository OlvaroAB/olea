/**
 * `primaryKindFor` — D-238/F3.3's "one generation call of the primary kind"
 * decision, pure.
 *
 * Order: F4.8's format match wins when known; absent a known format, F2.14's
 * fallback is her *recorded* preference (an observed order, read off D7.1's
 * instrument-type log elsewhere — this function never computes it, only
 * consumes it, the same separation `packages/plugin/src/generation
 * /pipeline.ts`'s `deps.formatMatch` already draws between "decide" and
 * "consult"). Never returns nothing: D-238 narrows `[D-063]`'s unbounded rule
 * to the first call, not away from it — "no concept with material is
 * skipped" — so a concept with neither a known format nor any recorded
 * preference still gets `DEFAULT_PRIMARY_KIND_FLOOR`.
 *
 * **Why the floor is `'mcq'`, not `'qa'` (F2.14 lists Q&A first).**
 * `packages/plugin/src/commands/create-card.ts`'s own module doc states the
 * gap plainly: "no generation task produces Q&A/cloze drafts client-side at
 * all (every generative task the plugin calls today is `quiz.generate.v1`,
 * MCQ-shaped)." `cards.generate.v1` exists as a Worker task id and has
 * private-repo prompt work against it (GEN-3.2/GEN-3.3), but no client
 * caller — component register row 2.1's "cards have no accept path at all"
 * is the same still-open gap. A floor this function could not actually
 * service would be worse than an honest one: `'mcq'` is declared here
 * (plain English, not fitted) as the only kind with an execution path today,
 * and is expected to change the moment that gap closes.
 */

import type { SchedulableInstrumentType } from './types.js';

export const DEFAULT_PRIMARY_KIND_FLOOR: SchedulableInstrumentType = 'mcq';

export interface PrimaryKindInput {
  /** F4.8: the kind matched to the concept's nearest assessment's format, or `null` if no format is known for its course. */
  readonly formatMatch: SchedulableInstrumentType | null;
  /**
   * F2.14's fallback, most-preferred first — an already-computed observed
   * order (D7.1), never derived here. An empty array means nothing has been
   * observed yet, which is the honest default before any engagement data
   * exists.
   */
  readonly recordedPreference: readonly SchedulableInstrumentType[];
}

export function primaryKindFor(input: PrimaryKindInput): SchedulableInstrumentType {
  if (input.formatMatch !== null) return input.formatMatch;
  return input.recordedPreference[0] ?? DEFAULT_PRIMARY_KIND_FLOOR;
}
