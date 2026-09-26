/**
 * F3.7/D-238's deck-served-out-or-lapsed trigger signal — GEN-3.5
 * (`ol-2zfj.136`).
 *
 * `generation/triggers.ts`'s `deckServedOutOrLapsedTrigger` takes two
 * opaque booleans, `deckServedOut` and `lapsed`; this module computes both
 * from real per-instrument scheduler state (`SchedulerState`, this
 * directory's own port) — never from a constant stand-in.
 *
 * **`deckServedOut`**: every built instrument for the concept has been
 * served (reviewed) at least once — `state !== null` for the whole deck.
 * An empty deck reads `false`: there is nothing to be "served out" of.
 *
 * **`lapsed` reuses F2.12's own already-ratified threshold, imported rather
 * than restated.** `DeckServedOutOrLapsedTriggerInput`'s own doc: "the
 * concept (or its recall-tier instrument) has lapsed per F2.12's evidence."
 * F2.12 is confusion routing (`misconception/confusion-routing.ts`), whose
 * `CONFUSION_ROUTING_LAPSE_THRESHOLD` (declared, ~4, already ratified and
 * shipping in that feature) is the one number this reading is permitted to
 * use — D-269 (`ol-2zfj.138`) only parks `repeatedRejectionTrigger`'s OWN,
 * separate, not-yet-ratified threshold. Reusing an ALREADY-closed threshold
 * for the SAME evidence F2.12 already reads is not a fresh Class C pick;
 * only recall-tier instruments count (`mastery/vitality.ts#isRecallTier`,
 * R3's filter — the same restriction F2.12's own module doc states:
 * `CONFUSION_ROUTING_LAPSE_THRESHOLD` fires "after `rating === 'again'`",
 * which only a recall-tier (FSRS-scheduled) instrument can ever produce).
 */

import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { isRecallTier } from '../mastery/vitality.js';
import { CONFUSION_ROUTING_LAPSE_THRESHOLD } from '../misconception/confusion-routing.js';
import type { SchedulerState } from './types.js';

export interface DeckServingSignalInput {
  /** Every built instrument's kind and current scheduler state (`null` = never reviewed) for this concept's deck. */
  readonly deck: readonly {
    readonly instrumentType: SchedulableInstrumentType;
    readonly state: SchedulerState | null;
  }[];
}

export interface DeckServingSignal {
  readonly deckServedOut: boolean;
  readonly lapsed: boolean;
}

/** See module doc. */
export function deckServingSignal(input: DeckServingSignalInput): DeckServingSignal {
  const deckServedOut = input.deck.length > 0 && input.deck.every((item) => item.state !== null);
  const lapsed = input.deck.some(
    (item) =>
      isRecallTier(item.instrumentType) &&
      item.state !== null &&
      item.state.lapses >= CONFUSION_ROUTING_LAPSE_THRESHOLD,
  );
  return { deckServedOut, lapsed };
}
