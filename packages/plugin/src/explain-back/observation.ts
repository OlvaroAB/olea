/**
 * Builds the `AcceptExplainBackGradingWithObservationContext`
 * (`../grading/wiring.ts`) the "Explain it back" view needs to call
 * `acceptExplainBackGradingWithObservation` for real — the last piece that
 * module's own doc names as missing: "which `sourceBlocks` id maps to which
 * `{path, blockIndex}`, which label maps to which concept id, and which
 * existing records are eligible to reabsorb a new occurrence."
 *
 * ===========================================================================
 * WHY `resolveConceptId` IS AN EXACT-ID MATCH AGAINST THE PERMITTED LIST (`[D-482]`)
 * ===========================================================================
 * The grading request carries `permittedConceptIds` (the subject, plus the resolved neighbour
 * when one resolved; empty for a free topic) and tells the judge to name only one of them. This
 * resolver matches a candidate's concept label by exact id against that SAME list and refuses
 * anything else, so a first-ever misconception on the known subject binds to the subject id, a
 * free label (a stale Worker that ignored the list) is never accepted as a new concept, and a
 * free topic records nothing. A concept confused with itself is refused downstream
 * (`olea-core`'s `buildObservationEventsFromAcceptedGrading`, reason `self-confusion`).
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
  /**
   * `[D-482]` item 4: the same permitted concept ids the grading request carried. A candidate's
   * concept label resolves only by exact match against this list; anything else is refused, even
   * if a stale Worker ignored the list. Absent reads as the subject alone (or nothing for a free
   * topic).
   */
  readonly permittedConceptIds?: readonly string[];
  readonly originInstrumentId: string;
  /** Always `null` here: writing the graded verdict into a review-log event is `ol-95vv`'s job, not this bead's (disclosed, not hidden — see `ol-12gs`'s close evidence). */
  readonly originReviewEventId: string | null;
  readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  readonly records: readonly MisconceptionRecord[];
  readonly now: () => Date;
  /**
   * `ol-gavc`: the caller's own verdict, already computed (typically via
   * {@link hasExplainBackSourceRevisionChanged} against a fresh retrieval) —
   * this function only threads it through to
   * `AcceptExplainBackGradingWithObservationContext.sourceRevisionStale`,
   * never re-derives it itself, since a fresh retrieval needs a
   * `VaultSource` this pure module has no access to. Omitted or `false`
   * means "no signal to the contrary," matching that field's own doc.
   */
  readonly sourceRevisionStale?: boolean;
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
  const permitted = new Set(
    params.permittedConceptIds ??
      (params.subjectConceptId !== null ? [params.subjectConceptId] : []),
  );

  return {
    originInstrumentId: params.originInstrumentId,
    originReviewEventId: params.originReviewEventId,
    timestamp: params.now().toISOString(),
    resolveCitation: (blockId) => citations.get(blockId) ?? null,
    resolveConceptId: (concept) => (permitted.has(concept) ? concept : null),
    candidateRecordsForConcept: (conceptId) =>
      params.records.filter((record) => record.conceptId === conceptId),
    ...(params.sourceRevisionStale !== undefined
      ? { sourceRevisionStale: params.sourceRevisionStale }
      : {}),
  };
}

export type { AcceptExplainBackGradingWithObservationResult };

/**
 * `ol-0r92.89`: the pure comparison a caller uses to decide
 * `AcceptExplainBackGradingWithObservationContext.sourceRevisionStale` —
 * `../grading/wiring.js`'s accept step rejects outright when this is `true`
 * rather than recording anything against a citation that may no longer say
 * what it said when the grading request went out.
 *
 * Compares by `{path, blockIndex, text}` triples, not by `blockId` alone:
 * `request.ts`'s `retrieveExplainBackSourceBlocks` mints `blockId` from
 * `path#blockIndex#index`, where `index` is this call's position in the
 * retrieved list — a re-embed that returns the same passages in a different
 * order would change every `blockId` without the underlying source having
 * changed at all, and that is not the drift this function exists to catch.
 * Order-independent (`Set`, not array equality) for the same reason.
 *
 * **`ol-gavc` gives this its first production caller**: `main.ts`'s
 * `buildExplainBackObservationContextFor` re-retrieves the source blocks via
 * `composeExplainBackSourceBlocks(params.query)` and calls this with
 * (`params.sourceBlocks`, that fresh retrieval) just before building the
 * accept context, threading the verdict through as `sourceRevisionStale`.
 */
export function hasExplainBackSourceRevisionChanged(
  gradedAgainst: readonly ExplainBackSourceBlock[],
  freshlyRetrieved: readonly ExplainBackSourceBlock[],
): boolean {
  const key = (entry: ExplainBackSourceBlock): string =>
    `${entry.path}#${entry.blockIndex}#${entry.block.text}`;
  const before = new Set(gradedAgainst.map(key));
  const after = new Set(freshlyRetrieved.map(key));
  if (before.size !== after.size) return true;
  for (const entry of before) {
    if (!after.has(entry)) return true;
  }
  return false;
}
