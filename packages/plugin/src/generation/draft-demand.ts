/**
 * Reading the demand a drafting call carried and returned, and shaping it into what a cached draft
 * carries (`[D-437]`, `ol-egov.141.89.2.26`, demand-carriage design sections 4.3 and 4.4).
 *
 * The drafting result (`draftQuizCardsForConcept`'s `'drafted'` branch) holds two things this file
 * reads and nothing else: the request payload it sent (`intendedDemand`, `requestedAsk`, both set
 * only for a served ask) and the raw response envelope. The response is read through the PUBLIC
 * envelope shape only (`ok`, `result`), the discipline `response.ts` states for the same reason:
 * this package has no dependency on the private service's schema source. From `result` it takes
 * exactly two things, and only when they are one of `[D-262]`'s five words:
 *  - `demandAcknowledgement.intendedDemand`, the server's acknowledgement (present exactly when the
 *    Worker read the demand and applied it, absent from an older Worker), and
 *  - each question's own `declaredDemand`, by position, aligned with `extractDraftedQuestions`
 *    (`response.ts`), which walks the same `result.questions` in the same order.
 *
 * **A word outside the five is read as absent, never coerced.** An out-of-vocabulary declaration
 * therefore cannot agree with a demand that was asked (the check then refuses it), and an
 * out-of-vocabulary acknowledgement is no acknowledgement (the item is then unspecified).
 *
 * **What this file decides nothing about.** Whether a draft is valid, and whether a demand may be
 * recorded, is `olea-core`'s `judgeDraftedDemand`, run at materialisation over the facts this file
 * carries. This module only moves facts from a response onto a record.
 */

import { type DraftedDemandFacts, PAPER_DEMANDS, type PaperDemand } from 'olea-core';
import type { DraftDemandCarriage, DraftDemandOrigin } from './types.js';

/** The two request members this file reads: the drafting request's payload carries both, and only for a served ask. */
export interface DraftedDemandRequest {
  readonly intendedDemand?: PaperDemand;
  readonly requestedAsk?: { readonly heading: string; readonly questionWord?: string };
}

/** What one drafting call carried and returned, before it is split per question. */
export interface DraftedDemandCarry {
  readonly intendedDemand?: PaperDemand;
  readonly requestedAsk?: { readonly heading: string; readonly questionWord?: string };
  readonly acknowledgedDemand?: PaperDemand;
  /** By position in `result.questions`; `undefined` where a question returned no readable word. */
  readonly declaredDemands: readonly (PaperDemand | undefined)[];
}

function demandWord(value: unknown): PaperDemand | undefined {
  return typeof value === 'string' && (PAPER_DEMANDS as readonly string[]).includes(value)
    ? (value as PaperDemand)
    : undefined;
}

/**
 * Reads the facts off one drafting call. Total: a response that is not an ok envelope, or whose
 * `result` has no readable members, gives a carry with an intended demand (if the request had one)
 * and nothing returned, which reads as a skew at materialisation, never as a defect.
 */
export function extractDraftedDemand(
  request: DraftedDemandRequest,
  response: unknown,
): DraftedDemandCarry {
  const base = {
    ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
    ...(request.requestedAsk === undefined ? {} : { requestedAsk: request.requestedAsk }),
  };
  if (typeof response !== 'object' || response === null) return { ...base, declaredDemands: [] };
  const envelope = response as Record<string, unknown>;
  if (envelope.ok !== true) return { ...base, declaredDemands: [] };
  const result = envelope.result;
  if (typeof result !== 'object' || result === null) return { ...base, declaredDemands: [] };
  const fields = result as Record<string, unknown>;

  const acknowledgement = fields.demandAcknowledgement;
  const acknowledgedDemand =
    typeof acknowledgement === 'object' && acknowledgement !== null
      ? demandWord((acknowledgement as Record<string, unknown>).intendedDemand)
      : undefined;

  const questions = Array.isArray(fields.questions) ? fields.questions : [];
  const declaredDemands = questions.map((question) =>
    typeof question === 'object' && question !== null
      ? demandWord((question as Record<string, unknown>).declaredDemand)
      : undefined,
  );

  return {
    ...base,
    ...(acknowledgedDemand === undefined ? {} : { acknowledgedDemand }),
    declaredDemands,
  };
}

/**
 * The carriage for the question at `questionIndex`, or `undefined` when the request carried no
 * demand (an unspecified need, or an ask no generator serves). The result is what `DraftRecord.demand` holds: absent for an unspecified draft, never an empty object.
 */
export function draftDemandCarriage(
  carry: DraftedDemandCarry,
  questionIndex: number,
  origin: DraftDemandOrigin,
): DraftDemandCarriage | undefined {
  if (carry.intendedDemand === undefined) return undefined;
  // A position with no readable declaration (the response had fewer entries, or the word was not
  // one of the five) carries none, which the check reads as no agreement, never as agreement.
  const declaredDemand = carry.declaredDemands[questionIndex];
  return {
    origin,
    intendedDemand: carry.intendedDemand,
    ...(carry.requestedAsk === undefined ? {} : { requestedAsk: carry.requestedAsk }),
    ...(carry.acknowledgedDemand === undefined
      ? {}
      : { acknowledgedDemand: carry.acknowledgedDemand }),
    ...(declaredDemand === undefined ? {} : { declaredDemand }),
  };
}

/** The carriage as the facts `judgeDraftedDemand` reads. The heading and origin are not part of the judgement. */
export function draftedDemandFactsOf(carriage: DraftDemandCarriage): DraftedDemandFacts {
  return {
    intendedDemand: carriage.intendedDemand,
    ...(carriage.acknowledgedDemand === undefined
      ? {}
      : { acknowledgedDemand: carriage.acknowledgedDemand }),
    ...(carriage.declaredDemand === undefined ? {} : { declaredDemand: carriage.declaredDemand }),
  };
}
