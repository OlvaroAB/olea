/**
 * `buildSuccessionEvent` — `[D-133]`'s second durable home (`ol-w00s`), the
 * builder for {@link SuccessionEvent}.
 *
 * **Where this sits in the sequence.** `material-change.ts`'s `'revised'`
 * outcome fires the instant a changed claim is detected — it names the
 * predecessor (`event.instrumentId`) and a not-yet-drafted successor
 * (`successorEnqueueInput`), but the successor has no id of its own until
 * something downstream (out of this module's `owns` — the plugin's
 * generation/accept path, e.g. `materialize-mcq.ts`'s `stampMcqId`-shaped
 * write) actually writes it to the vault. `buildSuccessionEvent` is called
 * at THAT later moment, once both ids are in hand, never at detection time.
 *
 * Pure and synchronous, like `buildSuccessorRevisionEnqueueInput` beside it —
 * the caller supplies the `Clock` (never `Date.now()` read directly, same
 * discipline as `material-change.ts`) and both instrument ids; this function
 * only shapes them into the event.
 */

import type { Clock } from '../../ingestion/types.js';
import type { SuccessionEvent } from './types.js';

export function buildSuccessionEvent(
  predecessorInstrumentId: string,
  successorInstrumentId: string,
  clock: Clock,
): SuccessionEvent {
  return {
    predecessorInstrumentId,
    successorInstrumentId,
    at: clock.now(),
  };
}
