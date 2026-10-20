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
 * The floor is the kind every deployment can service. `cards.generate.v1`
 * now has a client drafter (`packages/plugin/src/generation/draft-cards.ts`)
 * and the sweep in `packages/plugin/src/generation/pipeline.ts` routes a
 * course whose primary kind comes out `'qa'` through it (`ol-0r92.132`), but
 * only when the composition supplies `deps.kindInputsFor` and
 * `deps.cardDraftDeps`, and no composition root supplies either today. The
 * queue path (`packages/plugin/src/ingestion/generation-queue.ts`) still
 * executes `'mcq'` only. A floor this function could not actually service
 * everywhere would be worse than an honest one: `'mcq'` is declared here
 * (plain English, not fitted) as the kind with an execution path in every
 * composition, and is expected to change when the Q&A route is wired in by
 * default.
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
