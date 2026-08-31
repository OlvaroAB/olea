/**
 * Builds the `AcceptExplainBackGradingWithObservationContext`
 * (`../grading/wiring.ts`) the "Explain it back" view needs to call
 * `acceptExplainBackGradingWithObservation` for real — the last piece that
 * module's own doc names as missing: "which `sourceBlocks` id maps to which
 * `{path, blockIndex}`, which label maps to which concept id, and which
 * existing records are eligible to reabsorb a new occurrence."
 *
 * ===========================================================================
 * WHY `resolveConceptId` IS AN EXACT-STRING MATCH, NOT A LOOKUP
 * ===========================================================================
 * `explain-back.judge.v1`'s request carries no `conceptId` field anywhere —
 * the model is never told the subject concept's own opaque id. It can only
 * echo one back when a `misconceptionDigest` entry already showed it that
 * exact string (`toWireMisconceptionDigest`'s `concept: entry.conceptId`).
 * So a RECURRING misconception (subject already has a digest entry) resolves
 * correctly here; a brand-new one on a subject with no prior digest entries
 * will typically come back as free text the model invented for lack of
 * anything else to write, which this function correctly refuses to match —
 * `accepted-grading-observation.ts`'s own "never invent a concept binding"
 * rule means that candidate is skipped (`unresolved-concept`), not guessed.
 * This is a real, disclosed limitation of the current wire protocol
 * (`explainBackJudgeRequest` never sends the subject's own id) rather than a
 * shortcut this file takes — fixing it means adding a field to
 * `explain-back.judge.v1`'s request/prompt, a service-side prompt-versioning
 * change out of this bead's `owns`.
 *
 * `confusedWith` is never resolved to anything but `null`: this view only
 * ever grades a single, concept-only subject (see `./request.ts`'s module
 * doc), so there is no second, distinct concept a genuine confusion could
 * name — resolving it to the same subject id would misrecord a concept as
 * confused with itself, which is worse than the honest "cannot resolve".
 */

import type { MisconceptionRecord, MisconceptionSourceCitation } from 'olea-core';
import type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
} from '../grading/wiring.js';
import type { ExplainBackSourceBlock } from './request.js';

export interface BuildExplainBackObservationContextParams {
  /** `null` for the free-form entry point, where no concept binding is known — see the module doc. */
  readonly subjectConceptId: string | null;
  readonly originInstrumentId: string;
  /** Always `null` here: writing the graded verdict into a review-log event is `ol-95vv`'s job, not this bead's (disclosed, not hidden — see `ol-12gs`'s close evidence). */
  readonly originReviewEventId: string | null;
  readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  readonly records: readonly MisconceptionRecord[];
  readonly now: () => Date;
}

export function buildExplainBackObservationContext(
  params: BuildExplainBackObservationContextParams,
): AcceptExplainBackGradingWithObservationContext {
  const citations = new Map<string, MisconceptionSourceCitation>(
    params.sourceBlocks.map((entry) => [
      entry.block.blockId,
      { path: entry.path, blockIndex: entry.blockIndex },
    ]),
  );
  const subjectConceptId = params.subjectConceptId;

  return {
    originInstrumentId: params.originInstrumentId,
    originReviewEventId: params.originReviewEventId,
    timestamp: params.now().toISOString(),
    resolveCitation: (blockId) => citations.get(blockId) ?? null,
    resolveConceptId: (concept) =>
      subjectConceptId !== null && concept === subjectConceptId ? subjectConceptId : null,
    candidateRecordsForConcept: (conceptId) =>
      params.records.filter((record) => record.conceptId === conceptId),
  };
}

export type { AcceptExplainBackGradingWithObservationResult };
