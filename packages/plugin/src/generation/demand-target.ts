/**
 * The shared half of recording a drafted instrument's demand at materialisation (`[D-437]`,
 * `ol-egov.141.89.2.26`, demand-carriage design sections 2, 3.2, 4.4 and 6): judge what the draft
 * carried, and, only for a demand that was asked, acknowledged by the server and agreed by the
 * question's own declaration, assemble the one target record to write.
 *
 * **This file never writes.** It returns a plan; the writer is called from the two materialisers
 * (`materialize-mcq.ts`, `materialize-card.ts`) and paper hand-off alone, which the source scan
 * `packages/core/src/instrument/target-store-callers.spec.ts` (T7) pins. Keeping the call in the
 * materialisers, and out of this shared file, is what keeps a backfill path from appearing.
 *
 * ===========================================================================
 * INTENT IS NOT EVIDENCE OF DELIVERY
 * ===========================================================================
 * The judgement is `olea-core`'s `judgeDraftedDemand`: a code check, no model judge (`[D-310]`),
 * and it only ever REFUSES. An agreeing declaration certifies nothing, so the record stores the
 * demand that was ASKED, under the literal basis `authoring-intent` (the writer stamps it and takes
 * no basis argument). The reading of the produced instrument (`responseForm`) is taken from the
 * block, never stored: an instrument with answer options reads `recognition`, so the sweep's recall
 * intent on a multiple-choice item is recorded as intent and can never read as free recall (row
 * 38, test T20). This function computes that form so the outcome reports it; it does not persist it.
 *
 * **Materialisation never fails because of a demand.** A response with no acknowledgement is skew
 * (an older Worker), and a question declaring a different demand than asked is an invalid draft at
 * DRAFT time; if one is nevertheless accepted, it materialises as an unspecified instrument, with
 * no record and the refusal reported on the outcome, rather than blocking her accept on an
 * annotation. Either way the item is exactly what it would have been with no demand carried, its
 * need stays open, and it can never be read as meeting the demand.
 */

import {
  type DemandMismatchDefect,
  type DraftedDemandDisposition,
  type InstrumentResponseForm,
  type InstrumentTargetOrigin,
  judgeDraftedDemand,
  type NewInstrumentTarget,
  type PaperDemand,
  type QuestionBindingBlock,
  questionBindingOf,
  responseFormOf,
} from 'olea-core';
import { draftedDemandFactsOf } from './draft-demand.js';
import type { DraftDemandCarriage } from './types.js';

/** What a materialiser is handed when its draft carried a demand: the carriage, and the generator stamp (`DraftRecord.provenance`, D7.3) the record keeps. */
export interface MaterializeDemandInput {
  readonly carriage: DraftDemandCarriage;
  readonly generator: { readonly taskId: string; readonly promptVersion: string };
}

/**
 * What became of the demand at materialisation, reported on the materialiser's result (only when
 * the draft carried one; a legacy draft's result has no such member):
 *  - `recorded`: the target record was assembled for writing. `responseForm` is the reading of the
 *    produced block, `recognition` when it offers answer options.
 *  - `unspecified`: nothing recorded. `not-acknowledged` is deployment skew (counted by whatever
 *    reads this; the need stays open).
 *  - `refused`: the question declared a different demand than asked; nothing recorded.
 */
export type MaterializedDemand =
  | {
      readonly kind: 'recorded';
      readonly demand: PaperDemand;
      readonly origin: InstrumentTargetOrigin;
      readonly responseForm: InstrumentResponseForm;
    }
  | {
      readonly kind: 'unspecified';
      readonly reason: Extract<DraftedDemandDisposition, { kind: 'unspecified' }>['reason'];
    }
  | { readonly kind: 'refused'; readonly defect: DemandMismatchDefect };

export interface InstrumentDemandPlan {
  readonly demand: MaterializedDemand;
  /** Present exactly when `demand.kind` is `recorded`: the record the materialiser writes, once. */
  readonly target?: NewInstrumentTarget;
}

export interface PlanInstrumentDemandInput {
  /** The frozen instrument id the record is keyed by. */
  readonly instrumentId: string;
  /** The block as materialised: the question and keyed answer the binding is a digest of. */
  readonly block: QuestionBindingBlock;
  readonly demand: MaterializeDemandInput;
  readonly now: () => Date;
}

/**
 * Judges the draft's demand and, for a recordable one, assembles the record. Pure apart from the
 * binding digest and the clock; touches no vault.
 */
export async function planInstrumentDemand(
  input: PlanInstrumentDemandInput,
): Promise<InstrumentDemandPlan> {
  const { carriage, generator } = input.demand;
  const disposition = judgeDraftedDemand(draftedDemandFactsOf(carriage));
  if (disposition.kind === 'refused') {
    return { demand: { kind: 'refused', defect: disposition.defect } };
  }
  if (disposition.kind === 'unspecified') {
    return { demand: { kind: 'unspecified', reason: disposition.reason } };
  }
  return {
    demand: {
      kind: 'recorded',
      demand: disposition.demand,
      origin: carriage.origin,
      responseForm: responseFormOf(input.block),
    },
    target: {
      instrumentId: input.instrumentId,
      declaredDemand: disposition.demand,
      origin: carriage.origin,
      questionBinding: await questionBindingOf(input.block),
      authoredAt: input.now().toISOString(),
      generator: { taskId: generator.taskId, promptVersion: generator.promptVersion },
    },
  };
}
