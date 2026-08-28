/**
 * `buildObservationEventWithEmbedding` — ties this directory's previously
 * disconnected pieces together now that `MisconceptionEmbedder` has a
 * production implementation (`./embedder.ts`, `ol-nagi`): a
 * `MisconceptionEmbeddingCacheEngine` resolves embeddings for the CANDIDATE
 * records passed in, a fresh call to the embedder resolves the NEW
 * statement's embedding, and both feed `./matcher.ts`/`./events.ts` exactly
 * as `events.ts`'s own module doc already describes the split.
 *
 * ===========================================================================
 * REACHABILITY — READ BEFORE ASSUMING THIS HAS A CALLER
 * ===========================================================================
 * **No production caller exists for this function, and that is not an
 * oversight of this bead's scope.** `ol-nagi`'s own filed text already
 * distinguishes this port's situation from the other wiring-register
 * findings: it "never had an implementation to leave unwired... a declared
 * seam awaiting its phase." The thing that would call this function —
 * turning an accepted explain-back grading's `misconceptionCandidates`
 * (`../grading/gradingPipeline.ts`) into an appended
 * `MisconceptionObservedEvent` — is explicitly out of scope of every task
 * that has touched this seam so far:
 *
 * - `gradingPipeline.ts`'s own module doc calls the field-for-field mapping
 *   into `ObservationInput` "not built by this lane" and names the two
 *   things a caller must still resolve (a citation, and this file's
 *   `statementEmbedding`).
 * - `packages/plugin/src/grading/wiring.ts` documents, deliberately, that
 *   `gradeExplainBackAttempt` itself has **no caller anywhere in the
 *   plugin**: there is no explain-back destination in the review UI, and
 *   building one now would be a Class C surface change with no citing
 *   clause (two open questions block it — where a grading verdict lives,
 *   `ol-tka5`; what the accept step records, `ol-548w`).
 *
 * So this function is exactly the "declared seam awaiting its phase" shape
 * `ol-nagi`'s own filed text named for the port it wraps, one level up:
 * implemented and tested, deliberately not reachable, because the thing
 * that would call it does not exist yet and building that caller is not
 * this bead's file ownership or its call to make. See this bead's report
 * for the full argument and the follow-up this leaves.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT CHANGE
 * ===========================================================================
 * `buildObservationEvent` (`./events.ts`) is untouched in its own contract:
 * this function is a convenience over it, not a replacement, and a caller
 * that already has both embeddings in hand (e.g. a test) can still call
 * `buildObservationEvent` directly.
 */

import type { MisconceptionEmbeddingCacheEngine } from './embedding-cache.js';
import {
  type BuildObservationEventResult,
  buildObservationEvent,
  type ObservationInput,
} from './events.js';
import type { MisconceptionMatchCandidate } from './matcher.js';
import type { EmbeddingVector, MisconceptionEmbedder, MisconceptionRecord } from './types.js';

export interface BuildObservationEventWithEmbeddingDeps {
  /**
   * `null` when no `MisconceptionEmbedder` is available (F7.8: AI features
   * grey out rather than half-work — the port's only production
   * implementation needs a configured Worker). Falls back to
   * `buildObservationEvent`'s own no-embedder path (always mints fresh)
   * rather than failing.
   */
  readonly embedder: MisconceptionEmbedder | null;
  /**
   * Resolves cached embeddings for `candidateRecords` cheaply across
   * repeated calls. Optional even when `embedder` is present: a caller
   * without a wired cache still gets correct (just uncached) matching —
   * every candidate is embedded fresh alongside the new statement in one
   * batched call.
   */
  readonly cache?: MisconceptionEmbeddingCacheEngine;
  /**
   * Existing misconceptions eligible to reabsorb this occurrence, already
   * filtered to the input's `conceptId` (and typically to `active`/`fading`
   * status) by the caller — see `events.ts`'s own doc for why that
   * filtering is the caller's job.
   */
  readonly candidateRecords: readonly MisconceptionRecord[];
  readonly threshold?: number;
  readonly generateEventId?: () => string;
  readonly generateMisconceptionId?: () => string;
}

/**
 * `buildObservationEvent`, with the two embeddings it needs resolved for the
 * caller: the new statement's (always fresh) and each candidate record's
 * (cached, when a cache is supplied). See the module doc's "REACHABILITY"
 * section for why nothing in production calls this yet.
 */
export async function buildObservationEventWithEmbedding(
  input: ObservationInput,
  deps: BuildObservationEventWithEmbeddingDeps,
): Promise<BuildObservationEventResult> {
  const overrides = {
    ...(deps.threshold !== undefined ? { threshold: deps.threshold } : {}),
    ...(deps.generateEventId ? { generateEventId: deps.generateEventId } : {}),
    ...(deps.generateMisconceptionId
      ? { generateMisconceptionId: deps.generateMisconceptionId }
      : {}),
  };

  if (deps.embedder === null) {
    // No-embedder fallback (`events.ts`'s `BuildObservationEventOptions`):
    // M1 never runs, so this always mints a fresh id.
    return buildObservationEvent(input, { candidates: [], ...overrides });
  }

  let statementEmbedding: EmbeddingVector;
  let candidates: readonly MisconceptionMatchCandidate[];

  if (deps.cache) {
    const [candidateList, freshVectors] = await Promise.all([
      deps.cache.candidatesFor(deps.candidateRecords),
      deps.embedder.embed([input.statement]),
    ]);
    candidates = candidateList;
    statementEmbedding = freshVectors[0] ?? [];
  } else {
    const texts = [input.statement, ...deps.candidateRecords.map((record) => record.statement)];
    const vectors = await deps.embedder.embed(texts);
    statementEmbedding = vectors[0] ?? [];
    candidates = deps.candidateRecords.map((record, index) => ({
      id: record.id,
      embedding: vectors[index + 1] ?? [],
    }));
  }

  return buildObservationEvent(input, { statementEmbedding, candidates, ...overrides });
}
