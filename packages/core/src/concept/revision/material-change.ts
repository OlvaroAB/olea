/**
 * `evaluateCitedPassageRevision` — `[CORP-3]`'s (`ol-2zfj.2`) instrument-side
 * half of component register row 1.4, implementing `[D-093]` / C5.3 exactly
 * as ordered: relocate before stranding, hash before judge, same claim
 * before changed claim.
 *
 * **No floor, no debounce, unlike row 1.4's file-level trigger.** The file
 * trigger (`packages/plugin/src/ingestion/materiality/trigger.ts`) applies a
 * minimum-edit-size floor before calling the judge — deliberately, because
 * `[D-093]`'s own text forbids exactly that at THIS grain: "every changed
 * cited passage gets the model read at the next batch pass... no distance
 * gate, similarity score or edit-size heuristic excuses any of them from
 * that read." Any hash difference at the citation anchor reaches the judge,
 * once relocation has been ruled out.
 *
 * **What this function does NOT do, named so a caller does not assume it:**
 * it never reads the vault, never writes a suspend event, never writes the
 * successor to a confirmation queue, and never persists a
 * {@link RevisionEvent}. Those are, respectively: a vault-reading caller
 * (plugin-side, unbuilt — see this bead's close notes for the exact hook);
 * `review-log/write.ts`'s existing generic `suspend` (needs no new field —
 * suspension carries no reason today by design, `suspendLogRecordV2`'s own
 * comment, and "the passage under it changed" is not a capability the
 * contract names for a suspend record to carry); the confirmation-queue
 * admission (`features/F3-learn-from-anything.md`'s `core/accept/*` scenario
 * cluster, a different lane's files); and a persisted revision event, which
 * has no ratified schema home yet (Class C — see this bead's close notes for
 * the exact schema gap and the clause that would need to authorise it).
 *
 * **`[D-351]` (ruled 2026-09-25): the pending-revalidation recording half.**
 * The instant a real difference is confirmed (the hash check above), and
 * before checking whether a judge is configured, this function calls the
 * optional {@link PendingRevalidationRecorder} so the caller can persist
 * `[D-343]`'s pending-revalidation fact durably — still never writing
 * anything itself (no vault access here either; see the paragraph above).
 */

import { hashText } from '../../ingestion/hash.js';
import type { Clock } from '../../ingestion/types.js';
import { buildSuccessorRevisionEnqueueInput } from './enqueue.js';
import { classifyRelocation } from './relocate.js';
import type {
  CitedPassageInput,
  CitedPassageRevisionOutcome,
  PendingRevalidationRecorder,
  RevisionEvent,
  RevisionJudgePort,
} from './types.js';

/** A judge-supplied reason is content-free per D-005; this literal is used only when the judge omits one, so `RevisionEvent.change` is never empty. */
const NO_REASON_GIVEN = 'no reason supplied';

export async function evaluateCitedPassageRevision(
  input: CitedPassageInput,
  judge: RevisionJudgePort | null,
  clock: Clock,
  pendingRecorder?: PendingRevalidationRecorder,
): Promise<CitedPassageRevisionOutcome> {
  if (input.current.kind === 'not-found') {
    const match = classifyRelocation(input.previousText, input.current.relocationCandidates);
    if (match.kind === 'exact') return { kind: 'relocated', candidate: match.candidate };
    if (match.kind === 'near') return { kind: 'relocation-proposed', candidate: match.candidate };
    return { kind: 'stranded' };
  }

  const currentText = input.current.text;
  const newContentHash = await hashText(currentText);
  if (newContentHash === input.previousContentHash) {
    return { kind: 'unchanged' };
  }

  // `[D-343]`/`[D-351]`: a real difference is now known. Record it as
  // pending revalidation BEFORE checking whether a judge is even configured
  // and before any judge call — recording is unconditional, judging is not
  // (see `PendingRevalidationRecorder`'s own doc). A failure here propagates
  // rather than being swallowed, so this function never proceeds past an
  // unrecorded pending state.
  await pendingRecorder?.recordPending({
    instrumentId: input.instrumentId,
    sourceContentHash: newContentHash,
  });

  if (judge === null) {
    return { kind: 'judge-unavailable', sourceContentHash: newContentHash };
  }

  const verdict = await judge.judge({
    previousText: input.previousText,
    currentText,
  });

  const event: RevisionEvent = {
    instrumentId: input.instrumentId,
    at: clock.now(),
    oldContentHash: input.previousContentHash,
    newContentHash,
    change: verdict.reason ?? NO_REASON_GIVEN,
  };

  if (!verdict.material) {
    return { kind: 'refreshed', event };
  }

  return {
    kind: 'revised',
    event,
    predecessorInstrumentId: input.instrumentId,
    successorEnqueueInput: buildSuccessorRevisionEnqueueInput(event, currentText),
  };
}
