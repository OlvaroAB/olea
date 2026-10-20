/**
 * `[D-438]` / `[D-437]` (design: `olea-service/docs/dev/intelligence-build/demand-carriage.md`
 * section 5.2; bead `ol-egov.141.89.2.23`): the per-slot SUPPORT CHECK. Before any generator call,
 * a slot's preselected evidence package is judged for the slot's intended demand, and the slot
 * lands in exactly one of five outcomes, kept apart:
 *
 * | judgment                                         | outcome here                                       |
 * | ------------------------------------------------ | -------------------------------------------------- |
 * | `sufficient`                                     | `supported` (proceeds to generation)               |
 * | `partial` / `insufficient`                       | refused, `not-enough-in-notes`                     |
 * | `conflicting`                                    | refused, `notes-disagree`                          |
 * | empty package (decided by code, NO port call)    | refused, `nothing-retrieved`                       |
 * | the judge ran and abstained (`could-not-decide`) | refused, `could-not-decide` (not an established gap) |
 * | the service failed (`unavailable`, or a throw)   | `owed` after ONE retry; never an empty-slot reason |
 *
 * **The mapping is `draftingEligibility`'s, reused**, so the paper and drafting say the same thing
 * the same way. Pure logic with an INJECTED port: this module imports no transport, wires no judge
 * and has no caller. `[D-470]` bars the paper composer from calling it until a judge is accepted
 * (`ol-egov.141.89.1.5`).
 *
 * **An unmet slot keeps its original demand** (condition 3): the empty slot built here carries
 * `intendedDemand` exactly as the slot had it, and nothing re-routes a refused slot to another
 * demand or refills it with another concept.
 *
 * **An outage is never a source gap.** `owed` has no `PaperEmptySlot`: the caller records the
 * slot as work owed on the `[D-430]` journal (`./paper-journal.ts`) and resumes the paper. Writes
 * nothing, logs nothing, and carries no content (`D-005`): the port gets the chunks the slot
 * already holds, and the result carries codes only.
 */

import { draftingEligibility } from '../retrieval/draftingEligibility.js';
import type { AssessSupportOutcome } from '../retrieval/groundedContext.js';
import type {
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperDemand,
  PaperEmptySlot,
  PaperSupportRefusal,
} from './paper-types.js';

/** What the injected judge is asked: one slot's package, for the slot's demand. */
export interface PaperSupportCheckRequest {
  readonly slotId: string;
  readonly conceptName: string;
  readonly intendedDemand: PaperDemand;
  readonly sourceChunks: readonly string[];
}

/** The injected judge. May throw; a throw is read as `unavailable`. Never wired here. */
export type PaperSlotSupportPort = (
  request: PaperSupportCheckRequest,
) => Promise<AssessSupportOutcome>;

/** One retry of a service failure, then the `[D-430]` resumption path (`demand-carriage.md` 5.2). */
export const PAPER_SUPPORT_SERVICE_RETRIES = 1;

export type PaperSlotSupportOutcome =
  | { readonly kind: 'supported' }
  | {
      readonly kind: 'refused';
      readonly supportRefusal: PaperSupportRefusal;
      /** `false` exactly for the empty package, decided by code. */
      readonly judged: boolean;
    }
  /** The service could not answer after the retry. Work owed, never an empty-slot reason. */
  | { readonly kind: 'owed'; readonly attempts: number };

function isEmptyPackage(chunks: readonly string[]): boolean {
  return chunks.every((chunk) => chunk.trim().length === 0);
}

async function askOnce(
  port: PaperSlotSupportPort,
  request: PaperSupportCheckRequest,
): Promise<AssessSupportOutcome> {
  try {
    return await port(request);
  } catch {
    return { status: 'unavailable' };
  }
}

/** Judges one slot's package for its demand. Pure apart from the injected port. */
export async function checkPaperSlotSupport(
  slot: Pick<PaperBlueprintSlot, 'slotId' | 'conceptName' | 'intendedDemand' | 'sourceChunks'>,
  port: PaperSlotSupportPort,
): Promise<PaperSlotSupportOutcome> {
  if (isEmptyPackage(slot.sourceChunks)) {
    return { kind: 'refused', supportRefusal: 'nothing-retrieved', judged: false };
  }
  const request: PaperSupportCheckRequest = {
    slotId: slot.slotId,
    conceptName: slot.conceptName,
    intendedDemand: slot.intendedDemand,
    sourceChunks: slot.sourceChunks,
  };
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const outcome = await askOnce(port, request);
    if (outcome.status !== 'unavailable') {
      const eligibility = draftingEligibility(outcome);
      if (eligibility.author) return { kind: 'supported' };
      // `could-not-check` is the service-failure arm, handled above; the rest are the four refusals.
      if (eligibility.refusal === 'could-not-check') return { kind: 'owed', attempts };
      return {
        kind: 'refused',
        supportRefusal: eligibility.refusal,
        // A port that itself reports an empty package (`insufficient-evidence`) made no verdict.
        judged: outcome.status !== 'insufficient-evidence',
      };
    }
    if (attempts > PAPER_SUPPORT_SERVICE_RETRIES) return { kind: 'owed', attempts };
  }
}

/**
 * The named empty slot for a refusal. `reason` is descriptive text for an audit (D-005: codes, no
 * content); no wording she reads is produced here.
 */
export function supportRefusedEmptySlot(
  slot: Pick<PaperBlueprintSlot, 'slotId' | 'conceptKey' | 'conceptName' | 'intendedDemand'>,
  supportRefusal: PaperSupportRefusal,
): PaperEmptySlot {
  return {
    slotId: slot.slotId,
    conceptKey: slot.conceptKey,
    conceptName: slot.conceptName,
    reasonCode: 'source-support-refused',
    reason: `source support refused before generation: ${supportRefusal}`,
    intendedDemand: slot.intendedDemand,
    supportRefusal,
  };
}

export interface PaperBlueprintSupportResult {
  /** Slots that may proceed to generation, in blueprint order. */
  readonly supported: readonly PaperBlueprintSlot[];
  /** Slots refused, as empty slots that keep their original demand. */
  readonly refused: readonly PaperEmptySlot[];
  /** Slots whose check could not be completed: work owed on the `[D-430]` journal. */
  readonly owed: readonly { readonly slotId: string; readonly attempts: number }[];
}

/** Checks every slot of a blueprint, in order and one at a time (the port is a rate-limited transport). */
export async function checkPaperBlueprintSupport(
  blueprint: Pick<PaperBlueprint, 'slots'>,
  port: PaperSlotSupportPort,
): Promise<PaperBlueprintSupportResult> {
  const supported: PaperBlueprintSlot[] = [];
  const refused: PaperEmptySlot[] = [];
  const owed: { slotId: string; attempts: number }[] = [];
  for (const slot of blueprint.slots) {
    const outcome = await checkPaperSlotSupport(slot, port);
    if (outcome.kind === 'supported') supported.push(slot);
    else if (outcome.kind === 'refused') {
      refused.push(supportRefusedEmptySlot(slot, outcome.supportRefusal));
    } else owed.push({ slotId: slot.slotId, attempts: outcome.attempts });
  }
  return { supported, refused, owed };
}
