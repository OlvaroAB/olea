/**
 * `createRevisionAwareJobRunner` — the `JobRunner` consumer for the
 * `'instrument-revision'` job kind (`olea-core`'s `InstrumentRevisionJobPayload`,
 * `concept/revision/enqueue.ts`), closing the reachability gap
 * `materialize-mcq.ts`'s own module doc and `ol-2zfj.37`'s close notes name:
 * "no `JobRunner` in this repo recognises that `kind` yet" (`[D-133]`,
 * `ol-2zfj.39`).
 *
 * ## What was missing, precisely
 *
 * `enqueue.ts` already builds a `PersistedJob.payload` naming a predecessor
 * instrument and the new passage text a `'revised'` outcome was detected
 * against (`concept/revision/material-change.ts`). `IngestionQueueEngine`
 * drains it against whatever single `JobRunner` it was constructed with —
 * today, in production, that is `createExtractionJobRunner` (`olea-core`),
 * which only recognises `'source'`/`'note'`/`'vision-page'` and reports
 * anything else `ok: false, retryable: false` (an unrecognised payload,
 * `extraction-runner.ts`'s own doc). This module is the missing recognition:
 * dispatch to it for `'instrument-revision'`, fall through to whatever other
 * runner a host already has for everything else.
 *
 * ## Why a vault walk, not a widened job payload
 *
 * Drafting a successor needs `courseCode` + `conceptName`
 * (`draftQuizCardsForConcept`'s own `DraftQuizCardsRequest`) — neither of
 * which `InstrumentRevisionJobPayload` carries, because `RevisionEvent`
 * (`concept/revision/types.ts`, outside this bead's `owns`) does not carry
 * them either: it is built from an instrument id and two content hashes
 * alone, and the caller that would resolve a concept/course binding before
 * enqueuing does not exist yet (`material-change.ts`'s own doc: "a
 * vault-reading caller, plugin-side, unbuilt"). Rather than widen a payload
 * shape whose only real producer is still unbuilt, this runner resolves the
 * predecessor's concept/course binding itself, the same way every other
 * reader of instrument-to-concept binding in this package does:
 * `enumerateVaultInstruments` (`olea-core`), one vault walk, matched by
 * `instrumentId` (`routing.ts`'s `buildConceptInstrumentInventory` is the
 * precedent for building a fresh reader on that same walk rather than a
 * second one).
 *
 * `payload.newPassageText` is read only to prove it survived the trip; it is
 * NOT threaded into the drafting call. `draftQuizCardsForConcept` re-retrieves
 * grounded chunks for `conceptName` via `retrieve()` — it has no "draft from
 * this exact text" mode — so the new passage reaches the successor only
 * insofar as it is already indexed and the retrieval band grounds on it. A
 * later bead that wants a "draft strictly from this passage" mode can use
 * the field this runner leaves untouched; documented here so its apparent
 * disuse reads as a decision, not an oversight.
 *
 * ## Why this bypasses `runGenerationSweep`'s cache dedupe
 *
 * `runGenerationSweep` skips a (courseCode, conceptName) pair the cache
 * already has ANY record for (`pipeline.ts`'s `skippedDuplicate`) — correct
 * for its own "don't draft the same concept twice in a sweep" purpose, and
 * wrong here: a revision's whole premise is that this concept already has a
 * materialized instrument (the predecessor), so an existing cache/vault
 * record for that concept is the expected case, not a duplicate to skip.
 * This runner drafts unconditionally when the engine drains it — the
 * ingestion queue's own content-hash idempotency (`enqueue.ts`'s doc: keyed
 * on the NEW passage's hash) is what stops two devices observing the same
 * edit from drafting the successor twice, not a cache lookup in here.
 *
 * ## Composition (`packages/plugin/src/ingestion/wiring.ts`, outside this
 * bead's `owns` — named rather than silently left undone)
 *
 * `buildIngestionRunner` is the one place a real `JobRunner` is handed to
 * `IngestionQueueEngine.create` in production
 * (`packages/plugin/src/ingestion/wiring.ts:102-107`). Wiring this consumer
 * in needs exactly:
 *
 * ```ts
 * const revisionAware = createRevisionAwareJobRunner({
 *   vault: deps.vault,
 *   cache: generationCache,       // GenerationWiring.cache, ol-p3t07a
 *   deviceId,
 *   draftDeps: () => currentDraftDeps,  // read fresh, same posture wiring.ts's
 *                                       // own module doc uses for `this.knowledgeKind?.classifier`
 *   fallback: runner,             // the existing createExtractionJobRunner(...) call
 * });
 * const engine = await IngestionQueueEngine.create({ ...,  runner: revisionAware });
 * ```
 *
 * That two-line substitution is outside this bead's `owns`
 * (`packages/plugin/src/ingestion/`) and is left as this exact diff for the
 * orchestrator/next lane, per `[D-072]`'s escape hatch — everything up to
 * and including this consumer, the draft cache record it writes, and
 * `accept.ts`'s forwarding into `materializeAcceptedDraft` is built and
 * tested; only this last composition line remains.
 */

import {
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../retrieval/draft-quiz-cards.js';
import { draftQuizCardsForConcept } from '../retrieval/draft-quiz-cards.js';
import type { DraftCacheStore } from './cache-store.js';
import { extractDraftedProvenance, extractDraftedQuestions } from './response.js';
import type { DraftRecord } from './types.js';

/** Narrows `PersistedJob.payload` (`unknown` by contract) to the one shape this runner understands. Mirrors `createExtractionJobRunner`'s own `isExtractionJobPayload` guard, one payload family over. */
export function isInstrumentRevisionJobPayload(
  value: unknown,
): value is InstrumentRevisionJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'instrument-revision' &&
    typeof v.predecessorInstrumentId === 'string' &&
    v.predecessorInstrumentId.length > 0 &&
    typeof v.newPassageText === 'string'
  );
}

function defaultGenerateDraftId(): string {
  return globalThis.crypto.randomUUID();
}

export interface RevisionJobRunnerDeps {
  readonly vault: VaultSource;
  readonly cache: DraftCacheStore;
  /**
   * Read fresh on every drained job, not captured at construction — the same
   * "read whatever is current" posture `ingestion/wiring.ts`'s own module
   * doc states for `this.knowledgeKind?.classifier`. `null` means the Worker
   * isn't configured (F7.8); the job is then deferred (`retryable: true`)
   * rather than failed outright, since this is a transient configuration
   * state, not a fact about the job.
   */
  readonly draftDeps: () => DraftQuizCardsDeps | null;
  /** Injected so tests can fake grounded/refused outcomes without a real Worker — same seam `pipeline.ts`'s `deps.draftForConcept` uses. Defaults to the real `draftQuizCardsForConcept`. */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
  readonly generateDraftId?: () => string;
  readonly now?: () => Date;
}

interface RevisionTarget {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly conceptKey: string;
  readonly sourcePath: VaultPath;
}

/**
 * Resolves the predecessor instrument's concept/course binding by walking
 * the vault once (`enumerateVaultInstruments`) — see the module doc's "why a
 * vault walk" section. `null` when the predecessor cannot be found or, per
 * `enumerateVaultInstruments`'s own invariant, resolves with no concept/
 * course binding at all (an instrument enumerated with zero concepts is
 * pushed to `unbound` instead of `records`, so this is a defensive guard
 * against a corpus state this function does not expect, never a case it
 * silently invents a value for).
 */
async function resolveRevisionTarget(
  vault: VaultSource,
  predecessorInstrumentId: string,
): Promise<RevisionTarget | null> {
  const { records, concepts } = await enumerateVaultInstruments(vault);
  const record = records.find((r) => r.instrumentId === predecessorInstrumentId);
  if (record === undefined) return null;

  const conceptKey = record.conceptIds[0];
  const courseCode = record.courses[0];
  if (conceptKey === undefined || courseCode === undefined) return null;

  const concept = concepts.find((c) => c.key === conceptKey);
  if (concept === undefined) return null;

  return { courseCode, conceptName: concept.name, conceptKey, sourcePath: record.notePath };
}

/**
 * Drafts a successor for one drained `'instrument-revision'` job and caches
 * it as a `DraftRecord` carrying `predecessorInstrumentId` — the piece
 * `accept.ts` forwards to `materializeAcceptedDraft` once she resolves it.
 * Exported directly (not only through `createRevisionAwareJobRunner`) so a
 * test can exercise the drafting logic without going through `JobRunnerView`
 * plumbing.
 */
export async function runInstrumentRevisionJob(
  deps: RevisionJobRunnerDeps,
  payload: InstrumentRevisionJobPayload,
): Promise<JobRunOutcome> {
  const draftDeps = deps.draftDeps();
  if (draftDeps === null) {
    // F7.8's "grey out, don't crash" posture: the Worker isn't configured
    // right now, which is a transient fact about this session, not a
    // permanent property of the job — resumed the next time the engine
    // retries it, same as a `transient-error` outcome.
    return { ok: false, retryable: true };
  }

  const target = await resolveRevisionTarget(deps.vault, payload.predecessorInstrumentId);
  if (target === null) {
    return {
      ok: false,
      retryable: false,
      reason: `instrument-revision job: predecessor instrument ${payload.predecessorInstrumentId} was not found in the vault, or resolved with no concept/course binding`,
    };
  }

  const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
  const generateDraftId = deps.generateDraftId ?? defaultGenerateDraftId;
  const now = deps.now ?? (() => new Date());

  let result: DraftQuizCardsResult;
  try {
    result = await draftForConcept(draftDeps, {
      courseCode: target.courseCode,
      conceptName: target.conceptName,
    });
  } catch {
    // A generative call failing outright (network, malformed transport
    // response) — retryable, same posture `pipeline.ts`'s per-concept catch
    // uses and `createExtractionJobRunner`'s own catch-all.
    return { ok: false, retryable: true };
  }

  if (result.status === 'refused') {
    // A grounded refusal is not an error (F4.5's grounded-by-construction
    // argument, `pipeline.ts`'s own doc) — nothing to cache, and the job
    // succeeded at doing exactly what it was asked: check whether a
    // successor could be grounded right now. `[D-093]`'s revision-detection
    // caller (unbuilt — see the module doc) owns deciding whether a refused
    // successor needs a different signal back to her; this runner only owns
    // not pretending a refusal is a transport failure.
    return { ok: true };
  }

  const questions = extractDraftedQuestions(result.response);
  const provenance = extractDraftedProvenance(result.response);
  if (questions === null || provenance === null || questions.length === 0) {
    // Unparseable or empty — nothing content-bearing to cache. Not an error:
    // the ingestion queue marks this job `done`, and a future edit to the
    // same instrument would enqueue its own fresh `instrument-revision` job
    // (a new content hash) rather than this one being retried.
    return { ok: true };
  }

  const createdAt = now().toISOString();
  for (const question of questions) {
    const record: DraftRecord = {
      draftId: generateDraftId(),
      status: 'pending',
      courseCode: target.courseCode,
      conceptName: target.conceptName,
      conceptIds: [target.conceptKey],
      sourcePath: target.sourcePath,
      createdAt,
      question,
      provenance,
      firstServedAt: null,
      predecessorInstrumentId: payload.predecessorInstrumentId,
    };
    await deps.cache.put(record);
  }

  return { ok: true };
}

/**
 * Builds the composed `JobRunner` a host actually drains against: recognises
 * `'instrument-revision'` itself, defers to `deps.fallback` for everything
 * else (in production, `createExtractionJobRunner`'s result — see the module
 * doc's composition note for exactly where this plugs in).
 */
export function createRevisionAwareJobRunner(
  deps: RevisionJobRunnerDeps & { readonly fallback: JobRunner },
): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    if (!isInstrumentRevisionJobPayload(job.payload)) {
      return deps.fallback(job);
    }
    return runInstrumentRevisionJob(deps, job.payload);
  };
}
