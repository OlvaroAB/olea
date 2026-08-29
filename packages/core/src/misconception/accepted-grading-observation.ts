/**
 * `buildObservationEventsFromAcceptedGrading` — closes the mapping
 * `../grading/gradingPipeline.ts`'s own module doc names as still open (`ol-4053`):
 * "`AcceptedExplainBackGrading.misconceptionCandidates` is shaped as §4.1's
 * record minus the fields only the store can know... modulo two things a
 * caller resolves at the integration point... (a) `ObservationInput.citation`
 * is a single `SourceCitation`... a caller takes the first (or the one it has
 * most confidence in) and resolves it back to a `SourceCitation` via whatever
 * `blockId -> {path, blockIndex}` mapping it used to build the `sourceBlocks`
 * sent on the request in the first place; (b) `statementEmbedding` (M1's
 * match input) is computed by the caller, not by this pipeline."
 *
 * This file is that caller's shared, tested implementation of both — the
 * "declared seam awaiting its phase" `./observe.ts`'s own module doc names
 * one level up: an accepted grading's `misconceptionCandidates`, turned into
 * `ObservationInput`s and run through `buildObservationEventWithEmbedding`.
 *
 * ===========================================================================
 * A FRESH LOCAL MIRROR, NOT AN IMPORT OF THE GRADING SHAPE
 * ===========================================================================
 * `AcceptedGradingMisconceptionCandidate` below is declared locally rather
 * than importing `../grading/gradingPipeline.js`'s `MisconceptionCandidate`
 * — the same reasoning `./types.ts`'s module doc already gives for
 * `MisconceptionEmbedder` versus retrieval's `EmbeddingProvider`: this
 * directory needs the *shape*, not a live coupling to a concurrently-live
 * lane's module (`packages/core/src/grading/` is not this bead's `owns`).
 * Any real `MisconceptionCandidate` already satisfies this type with zero
 * adapter code — `acceptExplainBackGrading`'s own output can be passed
 * straight through.
 *
 * ===========================================================================
 * NEVER INVENT A CITATION OR A CONCEPT BINDING
 * ===========================================================================
 * A candidate whose `correctionSourceBlockIds` don't resolve to a real
 * `SourceCitation`, or whose `concept`/`confusedWith` label doesn't resolve
 * to a known concept id, is SKIPPED rather than recorded with an invented
 * value — the same structural discipline `groundCitations`
 * (`../grading/gradingPipeline.js`) already applies one layer upstream, and
 * `buildObservationEvent`'s own no-embedder fallback applies to the matching
 * decision: the honest response to "no signal to resolve this" is "don't
 * record it," never "guess." A caller can inspect and count how often a
 * candidate was skipped, and why (`'uncitable'` / `'unresolved-concept'`) —
 * never the candidate's own text (D-005).
 *
 * ===========================================================================
 * FAILURE ISOLATION IS THE CALLER'S JOB, NOT THIS FILE'S
 * ===========================================================================
 * This function does not swallow an embedder failure — `buildObservationEventWithEmbedding`
 * already degrades honestly on a missing/failing embedder (see its own doc
 * and `MisconceptionEmbeddingCacheEngine.ensureEmbeddings`'s "partial
 * progress is the honest failure mode"). A caller wiring this into a real
 * accept action (`packages/plugin/src/grading/wiring.ts`'s
 * `acceptExplainBackGradingWithObservation`, `ol-4053`) wraps THIS
 * function's call in a best-effort boundary the same shape
 * `packages/plugin/src/ingestion/wiring.ts`'s `withUnitsLandedHook` already
 * establishes: an observation failure must never fail the grade acceptance
 * it rode on. That boundary belongs at the plugin's composition root, not
 * here, because this module has no notion of "the caller's grade
 * acceptance" to protect.
 */

import type { MisconceptionEmbeddingCacheEngine } from './embedding-cache.js';
import type { BuildObservationEventResult, ObservationInput } from './events.js';
import { buildObservationEventWithEmbedding } from './observe.js';
import type { MisconceptionEmbedder, MisconceptionRecord, SourceCitation } from './types.js';

/**
 * Mirrors `../grading/gradingPipeline.js`'s `MisconceptionCandidate` — see
 * the module doc for why this is a fresh local shape rather than an import.
 */
export interface AcceptedGradingMisconceptionCandidate {
  readonly concept: string;
  readonly confusedWith?: string;
  readonly statement: string;
  readonly correction: string;
  readonly correctionSourceBlockIds: readonly string[];
}

/**
 * Everything the caller already holds about the surrounding attempt and the
 * source material it graded against — the two things `gradingPipeline.ts`'s
 * own doc names as the integration point's job, plus the per-concept
 * candidate lookup `./events.ts`'s `ObservationInput`/`candidates` doc
 * already requires. `resolveCitation`/`resolveConceptId` return `null` for
 * "cannot resolve," never a guess — see the module doc's "NEVER INVENT"
 * section.
 */
export interface AcceptedGradingObservationContext {
  readonly originInstrumentId: string;
  readonly originReviewEventId: string | null;
  readonly timestamp: string;
  /**
   * A graded `correctionSourceBlockIds` entry (this function always tries
   * the first) -> the `{path, blockIndex}` the caller used to build the
   * `sourceBlocks` it sent on the grading request in the first place.
   */
  readonly resolveCitation: (blockId: string) => SourceCitation | null;
  /** A `concept`/`confusedWith` label -> the opaque concept id `MisconceptionRecord.conceptId` expects. */
  readonly resolveConceptId: (concept: string) => string | null;
  /** Existing misconceptions eligible to reabsorb this occurrence, for one already-resolved concept id — see `./events.ts`'s doc for why this filtering is the caller's job. */
  readonly candidateRecordsForConcept: (conceptId: string) => readonly MisconceptionRecord[];
}

export interface AcceptedGradingObservationDeps {
  /** `null` when no `MisconceptionEmbedder` is available (F7.8) — passed straight through to `buildObservationEventWithEmbedding`. */
  readonly embedder: MisconceptionEmbedder | null;
  readonly cache?: MisconceptionEmbeddingCacheEngine;
  readonly threshold?: number;
  readonly generateEventId?: () => string;
  readonly generateMisconceptionId?: () => string;
}

/** Why a candidate produced no observation event — never the candidate's own text (D-005). */
export type SkippedAcceptedGradingCandidateReason = 'uncitable' | 'unresolved-concept';

export type AcceptedGradingObservationOutcome =
  | {
      readonly candidate: AcceptedGradingMisconceptionCandidate;
      readonly skipped: false;
      readonly result: BuildObservationEventResult;
    }
  | {
      readonly candidate: AcceptedGradingMisconceptionCandidate;
      readonly skipped: true;
      readonly reason: SkippedAcceptedGradingCandidateReason;
    };

/**
 * Maps every `candidates` entry to an `ObservationInput` and runs it through
 * `buildObservationEventWithEmbedding`, in order, awaiting each before the
 * next (candidate count per accepted grading is small — see `./matcher.ts`'s
 * doc on why distinct misconceptions stay few — so sequential is honest
 * rather than a real cost). See the module doc for why a candidate that
 * cannot be honestly grounded to a citation or a concept id is skipped,
 * never recorded with an invented one.
 */
export async function buildObservationEventsFromAcceptedGrading(
  candidates: readonly AcceptedGradingMisconceptionCandidate[],
  context: AcceptedGradingObservationContext,
  deps: AcceptedGradingObservationDeps,
): Promise<readonly AcceptedGradingObservationOutcome[]> {
  const outcomes: AcceptedGradingObservationOutcome[] = [];

  for (const candidate of candidates) {
    const conceptId = context.resolveConceptId(candidate.concept);
    if (conceptId === null) {
      outcomes.push({ candidate, skipped: true, reason: 'unresolved-concept' });
      continue;
    }

    const blockId = candidate.correctionSourceBlockIds[0];
    const citation = blockId !== undefined ? context.resolveCitation(blockId) : null;
    if (citation === null) {
      outcomes.push({ candidate, skipped: true, reason: 'uncitable' });
      continue;
    }

    const confusedWithConceptId = candidate.confusedWith
      ? context.resolveConceptId(candidate.confusedWith)
      : null;

    const input: ObservationInput = {
      conceptId,
      confusedWithConceptId,
      statement: candidate.statement,
      correction: candidate.correction,
      citation,
      originInstrumentId: context.originInstrumentId,
      originReviewEventId: context.originReviewEventId,
      timestamp: context.timestamp,
    };

    const result = await buildObservationEventWithEmbedding(input, {
      embedder: deps.embedder,
      ...(deps.cache ? { cache: deps.cache } : {}),
      candidateRecords: context.candidateRecordsForConcept(conceptId),
      ...(deps.threshold !== undefined ? { threshold: deps.threshold } : {}),
      ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
      ...(deps.generateMisconceptionId
        ? { generateMisconceptionId: deps.generateMisconceptionId }
        : {}),
    });

    outcomes.push({ candidate, skipped: false, result });
  }

  return outcomes;
}
