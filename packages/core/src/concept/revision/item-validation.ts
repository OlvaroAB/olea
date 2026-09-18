/**
 * F2.23 (`[D-265]`, ruling 3) — item validation: "a mismatch between a
 * harder and an easier same-claim instrument on one concept MAY trigger this
 * validation... it never decides it. The model checks and proposes the
 * suspicion; she confirms... Until a defect is established this way, the
 * item's weight does not move."
 *
 * Two functions, mirroring `material-change.ts`'s own shape:
 *
 * - `evaluateItemValidationTrigger` — the pure precondition check. An
 *   ordinary lapse (no mismatch, or a mismatch that fails `sameDay` /
 *   `sameClaim`) is `'no-trigger'`: "forgetting happens and is not itself
 *   evidence of a problem" is the clause's own first sentence, and this
 *   function is where that sentence is enforced. Only a same-day,
 *   same-claim mismatch where the harder instrument stayed strong and the
 *   easier one failed warrants asking the model anything.
 * - `checkItemValidation` — orchestrates trigger, then judge, then proposal,
 *   exactly as `evaluateCitedPassageRevision` orchestrates hash-then-judge.
 *   It **never** decides an item defective on its own: a `'proposed'`
 *   outcome is a candidate for her to confirm, and nothing in this module
 *   (or reachable from it) writes eligibility, weight or a growth-stage
 *   change. Those three all sit outside `core`'s revision directory —
 *   `[D-093]`'s changed-evidence event, `[D-095]`'s contest mechanism, and
 *   her own confirmation are the only routes that may move them, per this
 *   clause and the component register's own prohibitions
 *   (`docs/Olea_architecture_boundary.md` §4a: "intervention writes no
 *   retrievability, no mastery and no eligibility").
 *
 * **What this module does NOT do, named so a caller does not assume it:**
 * it never reads the vault, never decides `sameDay` or `sameClaim` itself
 * (supplied by the caller, same discipline as `relocate.ts`'s candidate
 * texts), never writes a proposal to any confirmation queue or the review
 * log, and never touches weight, eligibility or growth stage. Those are,
 * respectively: a vault-reading caller (unbuilt); the review pipeline that
 * already knows same-day/same-claim comparability; the confirmation-queue
 * admission a different lane's files cover; and the scoring/mastery model
 * this directory has no access to and no standing to change.
 */

import type { Clock } from '../../ingestion/types.js';
import type {
  ItemValidationJudgeInput,
  ItemValidationJudgePort,
  ItemValidationOutcome,
  ItemValidationProposal,
  ItemValidationTriggerOutcome,
  SameClaimMismatchInput,
} from './types.js';

/**
 * The precondition, and only the precondition: same claim, same day, harder
 * instrument strong, easier instrument failed. Any other combination —
 * including a failed easier instrument with no harder-instrument evidence at
 * all, or a mismatch on different claims — is an ordinary lapse and gets
 * `'no-trigger'`, per the clause's own worked scenario.
 */
export function evaluateItemValidationTrigger(
  input: SameClaimMismatchInput,
): ItemValidationTriggerOutcome {
  if (!input.sameClaim || !input.sameDay) {
    return { kind: 'no-trigger' };
  }
  if (input.harderOutcome === 'strong' && input.easierOutcome === 'failed') {
    return { kind: 'check-warranted', suspectInstrumentId: input.easierInstrumentId };
  }
  return { kind: 'no-trigger' };
}

/**
 * Runs the trigger, and only if it warrants a check, calls the judge and
 * shapes its verdict into a proposal. `judgeInput` is supplied separately
 * from `mismatch` (rather than derived from it) because this module holds
 * no instrument or source text of its own — the caller already has both in
 * hand to describe the mismatch, and passes the suspected instrument's text
 * and cited source alongside it.
 */
export async function checkItemValidation(
  mismatch: SameClaimMismatchInput,
  judgeInput: ItemValidationJudgeInput,
  judge: ItemValidationJudgePort | null,
  clock: Clock,
): Promise<ItemValidationOutcome> {
  const trigger = evaluateItemValidationTrigger(mismatch);
  if (trigger.kind === 'no-trigger') {
    return { kind: 'no-trigger' };
  }

  if (judge === null) {
    return { kind: 'judge-unavailable' };
  }

  const verdict = await judge.judge(judgeInput);
  if (!verdict.suspected || verdict.kind === undefined) {
    return { kind: 'not-suspected' };
  }

  const proposal: ItemValidationProposal = {
    instrumentId: trigger.suspectInstrumentId,
    kind: verdict.kind,
    at: clock.now(),
    reason: verdict.reason,
  };
  return { kind: 'proposed', proposal };
}
