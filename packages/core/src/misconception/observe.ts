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
 * REACHABILITY — RETRACTED, `ol-0r92.95` [DOS-C2]
 * ===========================================================================
 * **This doc comment was stale.** It once said no production caller existed
 * for this function; that stopped being true no later than `ol-4053`/
 * `ol-0r92.90`, which wired `packages/plugin/src/grading/wiring.ts`'s
 * `acceptExplainBackGradingWithObservation` →
 * `buildObservationEventsFromAcceptedGrading` (`./accepted-grading-
 * observation.ts`) → this function, with `main.ts`'s
 * `persistMisconceptionObservations` appending the result to the
 * misconception log (`./write.ts`'s `appendMisconceptionEvent`) for real.
 * The gap this section used to describe (no UI destination, two open Class C
 * questions) was closed by `ol-12gs`/`[D-117]` before this doc caught up —
 * see `wiring.ts`'s own module doc for that history. Left in place, a
 * "nothing calls this" comment reads as an invitation to skip exactly the
 * failure-isolation care the caller below already depends on, which is the
 * reason `ol-0r92.95`'s acceptance criteria call retracting it out by name.
 *
 * ===========================================================================
 * `ol-0r92.95` [DOS-C2]: AN EMBEDDER FAILURE DEGRADES, IT NEVER DROPS
 * ===========================================================================
 * Before this bead, an embedder failure (a thrown rejection from
 * `deps.embedder.embed`) propagated straight out of this function. Its
 * caller (`buildObservationEventsFromAcceptedGrading`) had no per-candidate
 * isolation of its own, so the exception reached `wiring.ts`'s outer
 * try/catch around the WHOLE batch — which discarded every candidate's
 * observation for that accept, not just the one the embedder failed on. The
 * grading verdict was kept; the observation that should feed retrieval and
 * mastery was silently lost, with no retry.
 *
 * The fix lives here, not one level up, because this is the one place that
 * already knows the honest no-embedder fallback exists (`buildObservationEvent`'s
 * own `{ candidates: [], ...overrides }` path, used above when
 * `deps.embedder === null`). `embedWithBoundedRetry` below gives a transient
 * embedder failure `MAX_EMBED_ATTEMPTS` (3) tries before treating it the
 * same as "no embedder configured" — matching, never a fresh-and-unmatched
 * misconception id — rather than losing the observation outright. **This
 * function itself now never throws for an embedder failure.** It still
 * throws for a genuine caller bug (e.g. a malformed `input`), matching
 * `buildObservationEvent`'s existing contract — bounded retry is scoped to
 * the specific failure mode (a flaky/unavailable Worker call) this bead's
 * evidence names, not a blanket try/catch around this whole function.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT CHANGE
 * ===========================================================================
 * `buildObservationEvent` (`./events.ts`) is untouched in its own contract:
 * this function is a convenience over it, not a replacement, and a caller
 * that already has both embeddings in hand (e.g. a test) can still call
 * `buildObservationEvent` directly.
 */

import { assertBeliefBearingStatement } from './belief-source.js';
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
  /**
   * `ol-0r92.95`: overrides the embedder-retry sleep between bounded-retry
   * attempts — a real delay would make this function's spec slow and flaky
   * for no reason. Defaults to a real (tiny) delay; tests inject a no-op.
   */
  readonly delayBetweenEmbedAttempts?: (attempt: number) => Promise<void>;
}

/** `ol-0r92.95`: an embedder failure gets this many tries before this function degrades to the no-embedder fallback rather than losing the observation. */
const MAX_EMBED_ATTEMPTS = 3;

function defaultDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 25));
}

/**
 * Runs `embed` with up to `MAX_EMBED_ATTEMPTS` tries, resolving `null` —
 * never rejecting — once every attempt has failed. `null` is this function's
 * own "treat this the same as no embedder configured" signal; a genuine
 * result (including an empty array, which `embed` is entitled to return) is
 * always wrapped so `null` cannot be confused with "the embedder returned
 * nothing."
 */
async function embedWithBoundedRetry(
  embedder: MisconceptionEmbedder,
  texts: readonly string[],
  delay: (attempt: number) => Promise<void>,
): Promise<readonly EmbeddingVector[] | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
    try {
      return await embedder.embed(texts);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_EMBED_ATTEMPTS) await delay(attempt);
    }
  }
  // D-005: a count only, never the statement/candidate text the embedder was
  // asked to embed.
  console.error(
    'Olea: misconception embedder failed after bounded retry — observation degrades to unmatched, never dropped',
    { attempts: MAX_EMBED_ATTEMPTS, textCount: texts.length, error: lastError },
  );
  return null;
}

/**
 * `buildObservationEvent`, with the two embeddings it needs resolved for the
 * caller: the new statement's (always fresh) and each candidate record's
 * (cached, when a cache is supplied). See the module doc's "REACHABILITY"
 * section for this function's real production caller, and the
 * "`ol-0r92.95`" section for why an embedder failure can no longer make this
 * function throw.
 */
export async function buildObservationEventWithEmbedding(
  input: ObservationInput,
  deps: BuildObservationEventWithEmbeddingDeps,
): Promise<BuildObservationEventResult> {
  // `[D-101]`: checked here, before any embedding work runs (never spend an
  // embed call on prose that cannot become a statement) — defense-in-depth,
  // same as `events.ts`'s own guard below it. See `belief-source.ts`'s
  // `assertBeliefBearingStatement` doc for why a real production caller
  // gates earlier still and never reaches this throw.
  assertBeliefBearingStatement(input.statementAuthorship);

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

  const delay = deps.delayBetweenEmbedAttempts ?? defaultDelay;
  const embedder = deps.embedder;

  let statementEmbedding: EmbeddingVector;
  let candidates: readonly MisconceptionMatchCandidate[];

  if (deps.cache) {
    const [candidateList, freshVectors] = await Promise.all([
      deps.cache.candidatesFor(deps.candidateRecords),
      embedWithBoundedRetry(embedder, [input.statement], delay),
    ]);
    if (freshVectors === null) {
      // `ol-0r92.95`: the embedder never recovered within the bounded-retry
      // budget — degrade to the same no-match, fresh-id path `embedder ===
      // null` takes above, rather than losing this candidate's observation.
      return buildObservationEvent(input, { candidates: [], ...overrides });
    }
    candidates = candidateList;
    statementEmbedding = freshVectors[0] ?? [];
  } else {
    const texts = [input.statement, ...deps.candidateRecords.map((record) => record.statement)];
    const vectors = await embedWithBoundedRetry(embedder, texts, delay);
    if (vectors === null) {
      return buildObservationEvent(input, { candidates: [], ...overrides });
    }
    statementEmbedding = vectors[0] ?? [];
    candidates = deps.candidateRecords.map((record, index) => ({
      id: record.id,
      embedding: vectors[index + 1] ?? [],
    }));
  }

  return buildObservationEvent(input, { statementEmbedding, candidates, ...overrides });
}
