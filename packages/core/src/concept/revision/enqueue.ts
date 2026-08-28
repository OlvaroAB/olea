/**
 * Bridges a `'revised'` outcome (`material-change.ts`) to the EXISTING
 * ingestion queue (`../../ingestion/`) — row 1.4's `Out`: "read by the
 * on-device work queue (3.10), which schedules regeneration."
 *
 * **No new job kind, no queue schema change.** `EnqueueInput` (`ingestion/
 * types.ts`) already carries an opaque `payload` the engine never inspects
 * — `IngestionQueueEngine` was built precisely so a new kind of work is a
 * new payload shape, never a new queue mechanism. This function is that
 * payload shape's one definition, kept beside the outcome that produces it
 * so the two cannot drift apart silently.
 *
 * `contentHash` is set to the NEW passage's hash, not a fresh random value:
 * the queue's own idempotency (D-002) then does its ordinary job — a second
 * device observing the same edit and reaching the same verdict enqueues the
 * identical `contentHash` and is recognised as a duplicate rather than
 * double-drafting the successor.
 */

import type { EnqueueInput } from '../../ingestion/types.js';
import type { RevisionEvent } from './types.js';

/** The one payload shape a `JobRunner` must recognise for a successor-instrument draft triggered by `[D-093]`. */
export interface InstrumentRevisionJobPayload {
  readonly kind: 'instrument-revision';
  readonly predecessorInstrumentId: string;
  /** The new passage text the successor is drafted from. Real content, forwarded verbatim to the runner exactly as every other generation payload in this queue already is — never a log field (D-005 governs logging, not queue payloads; see `ingestion/types.ts`'s own `JobRunnerView`, which already carries opaque `payload`). */
  readonly newPassageText: string;
}

/** Builds the `EnqueueInput` for the successor instrument a changed-claim revision calls for. */
export function buildSuccessorRevisionEnqueueInput(
  event: RevisionEvent,
  newPassageText: string,
): EnqueueInput {
  const payload: InstrumentRevisionJobPayload = {
    kind: 'instrument-revision',
    predecessorInstrumentId: event.instrumentId,
    newPassageText,
  };
  return {
    contentHash: event.newContentHash,
    label: `instrument-revision:${event.instrumentId}`,
    payload,
  };
}
