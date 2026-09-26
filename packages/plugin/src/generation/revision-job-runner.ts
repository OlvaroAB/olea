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
 * bead's `owns`) — LANDED
 *
 * `buildIngestionRunner` composes this consumer in production:
 * `deps.revision ? createRevisionAwareJobRunner({ vault: deps.vault, cache:
 * deps.revision.cache, draftDeps: deps.revision.draftDeps, fallback: runner
 * }) : runner` (`packages/plugin/src/ingestion/wiring.ts:493-499`), the
 * `composedRunner` handed to `IngestionQueueEngine.create`. `main.ts:2486`
 * confirms it is already composed and names the confirmation-queue
 * admission this runner's draft record still needs (see that comment for
 * what remains, distinct from this composition step). Corrected 2026-09-25,
 * `ol-egov.141.89.15` — this paragraph previously described the
 * substitution above as left for a later lane; it had already landed.
 *
 * ## `[D-366]` — SAME-KIND SUCCESSOR, NOT ALWAYS MCQ (`ol-v7r5.68`)
 *
 * Before this bead, `resolveRevisionTarget` resolved the predecessor's
 * concept/course binding but never its `instrumentType`, so every drafted
 * successor went through `draftForConcept`
 * (`draftQuizCardsForConcept`/`quiz.generate.v1`) regardless of what kind of
 * instrument the predecessor actually was —
 * `citation-revision-wiring.ts`'s own module doc named this gap explicitly
 * ("`revision-job-runner.ts` drafts every successor through
 * `draftQuizCardsForConcept` regardless of the predecessor's original
 * `instrumentType`"), the moment `[D-366]` widened suspension tracking to
 * Q&A and cloze.
 *
 * `resolveRevisionTarget` now also returns `record.instrumentType`, and
 * `runInstrumentRevisionJob` drafts a SAME-KIND successor:
 *
 *   - `'mcq'` predecessor → `draftForConcept` (`quiz.generate.v1`), unchanged
 *     from before this bead — every question comes back as an `'mcq'`-kind
 *     `DraftRecord` (`question`, no `instrumentType` — matching every prior
 *     caller's "undefined means mcq" convention, `types.ts`'s own doc).
 *   - `'qa'` predecessor → `draftCardForConcept` (`./draft-cards.js`'s
 *     `draftCardsForConcept`, `cards.generate.v1`) instead — every card comes
 *     back as a `'qa'`-kind `DraftRecord` (`card`, `instrumentType: 'qa'`),
 *     the same shape `accept.ts`'s `materializeQaCardDraft` already
 *     dispatches on. Structurally the identical grounding-gate/refusal/
 *     transport-failure control flow as the `'mcq'` branch — see
 *     `draft-cards.ts`'s own doc for why it mirrors `draft-quiz-cards.ts`
 *     line for line.
 *   - `'cloze'` predecessor → **no draft is produced.** There is no
 *     `cloze.generate.v1` task, no `DraftClozeContent` shape on `DraftRecord`
 *     (`types.ts`'s own doc: "no `'cloze'`… counterpart exists yet; nothing
 *     in this pipeline drafts either shape"), and no cloze materializer
 *     registered in `accept.ts`'s `DRAFT_MATERIALIZERS`. Fabricating a draft
 *     with no real generative task behind it would be exactly the guess this
 *     codebase's "never guess, omit rather than fabricate" convention
 *     forbids, so this job succeeds with nothing cached — the same "not
 *     content-bearing, not an error" posture the unparseable/empty branch
 *     below already uses. A `'revised'` outcome for a self-contained cloze
 *     predecessor still suspends it (`citation-revision-wiring.ts`'s
 *     `actions.suspend`, unaffected by this file); it simply gets no
 *     successor until a real `cloze.generate.v1` task exists (a follow-up
 *     this bead reports rather than builds — a new generative task touches
 *     `prompts/`, `packages/contracts` and `olea-service`, all outside this
 *     bead's `owns`).
 *
 * Every branch still forwards `predecessorInstrumentId: payload.
 * predecessorInstrumentId` onto the cached `DraftRecord` exactly as before —
 * that field is instrument-type-agnostic (`types.ts`'s own doc) and is what
 * `accept.ts` forwards on to whichever materializer resolves the kind.
 * **The successor LINK is therefore real for `'qa'` today at the cache/
 * review-log layer** (`materialize-card.ts`'s own module doc: the succession
 * event, `DraftRecord.predecessorInstrumentId`) even though a card has no
 * in-block `predecessor:` field the way an MCQ does — see that file's module
 * doc for exactly why, and for the Class C gap that remains.
 */

import {
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  type VaultInstrumentRecord,
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
import type { DraftCardsDeps, DraftCardsRequest, DraftCardsResult } from './draft-cards.js';
import { draftCardsForConcept } from './draft-cards.js';
import {
  extractDraftedCards,
  extractDraftedCardsProvenance,
  extractDraftedProvenance,
  extractDraftedQuestions,
} from './response.js';
import type { DraftCardContent, DraftProvenance, DraftQuestion, DraftRecord } from './types.js';

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
  /** Injected so tests can fake grounded/refused outcomes without a real Worker — same seam `pipeline.ts`'s `deps.draftForConcept` uses. Defaults to the real `draftQuizCardsForConcept`. Used only for an `'mcq'` predecessor — see the module doc's `[D-366]` section. */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
  /**
   * `[D-366]`: the same seam as `draftForConcept` above, for a `'qa'`
   * predecessor — see the module doc's section. Defaults to the real
   * `draftCardsForConcept`. `DraftQuizCardsDeps` (what `draftDeps()` above
   * returns) already satisfies `DraftCardsDeps` structurally — both mirror
   * `retrieve`/`transport`/`classifyPassage`/`onStage`/`onJudgeRequest`
   * field-for-field (`draft-cards.ts`'s own doc) — so this runner passes the
   * SAME resolved `draftDeps` value to whichever drafting function the
   * predecessor's kind selects, never a second deps shape to assemble.
   */
  readonly draftCardForConcept?: (
    deps: DraftCardsDeps,
    request: DraftCardsRequest,
  ) => Promise<DraftCardsResult>;
  readonly generateDraftId?: () => string;
  readonly now?: () => Date;
}

interface RevisionTarget {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly conceptKey: string;
  readonly sourcePath: VaultPath;
  /** `[D-366]`: which kind of successor to draft — see the module doc's section. */
  readonly instrumentType: VaultInstrumentRecord['instrumentType'];
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
  // `[D-357]`: the permanent concept key, so the revision drafts under the key her review log and
  // every other reader carry.
  const { records, concepts } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const record = records.find((r) => r.instrumentId === predecessorInstrumentId);
  if (record === undefined) return null;

  const conceptKey = record.conceptIds[0];
  const courseCode = record.courses[0];
  if (conceptKey === undefined || courseCode === undefined) return null;

  const concept = concepts.find((c) => c.key === conceptKey);
  if (concept === undefined) return null;

  return {
    courseCode,
    conceptName: concept.name,
    conceptKey,
    sourcePath: record.notePath,
    instrumentType: record.instrumentType,
  };
}

/** One "nothing to cache" reason, shared by both drafting branches below — see their own doc. */
type SuccessorDraftOutcome<TContent> =
  | { readonly kind: 'thrown' }
  | { readonly kind: 'nothing-to-cache' }
  | {
      readonly kind: 'drafted';
      readonly contents: readonly TContent[];
      readonly provenance: DraftProvenance;
    };

/**
 * Drafts an `'mcq'`-kind successor via `quiz.generate.v1` — the pre-`[D-366]`
 * behaviour, unchanged, factored out so `runInstrumentRevisionJob` can pick
 * between this and {@link draftQaSuccessor} by the predecessor's own kind.
 */
async function draftMcqSuccessor(
  draftDeps: DraftQuizCardsDeps,
  draftForConcept: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>,
  target: RevisionTarget,
): Promise<SuccessorDraftOutcome<DraftQuestion>> {
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
    return { kind: 'thrown' };
  }

  if (result.status === 'refused') {
    // A grounded refusal is not an error (F4.5's grounded-by-construction
    // argument, `pipeline.ts`'s own doc) — nothing to cache, and the job
    // succeeded at doing exactly what it was asked: check whether a
    // successor could be grounded right now. `[D-093]`'s revision-detection
    // caller (unbuilt — see the module doc) owns deciding whether a refused
    // successor needs a different signal back to her; this runner only owns
    // not pretending a refusal is a transport failure.
    return { kind: 'nothing-to-cache' };
  }

  const questions = extractDraftedQuestions(result.response);
  const provenance = extractDraftedProvenance(result.response);
  if (questions === null || provenance === null || questions.length === 0) {
    // Unparseable or empty — nothing content-bearing to cache. Not an error:
    // the ingestion queue marks this job `done`, and a future edit to the
    // same instrument would enqueue its own fresh `instrument-revision` job
    // (a new content hash) rather than this one being retried.
    return { kind: 'nothing-to-cache' };
  }

  return { kind: 'drafted', contents: questions, provenance };
}

/**
 * `[D-366]`: the same shape as {@link draftMcqSuccessor}, drafting a
 * `'qa'`-kind successor via `cards.generate.v1` instead — see the module
 * doc's section for why this exists and why cloze has no equivalent.
 */
async function draftQaSuccessor(
  draftDeps: DraftCardsDeps,
  draftCardForConcept: (
    deps: DraftCardsDeps,
    request: DraftCardsRequest,
  ) => Promise<DraftCardsResult>,
  target: RevisionTarget,
): Promise<SuccessorDraftOutcome<DraftCardContent>> {
  let result: DraftCardsResult;
  try {
    result = await draftCardForConcept(draftDeps, {
      courseCode: target.courseCode,
      conceptName: target.conceptName,
    });
  } catch {
    return { kind: 'thrown' };
  }

  if (result.status === 'refused') {
    return { kind: 'nothing-to-cache' };
  }

  const cards = extractDraftedCards(result.response);
  const provenance = extractDraftedCardsProvenance(result.response);
  if (cards === null || provenance === null || cards.length === 0) {
    return { kind: 'nothing-to-cache' };
  }

  return { kind: 'drafted', contents: cards, provenance };
}

/**
 * Drafts a successor for one drained `'instrument-revision'` job and caches
 * it as a `DraftRecord` carrying `predecessorInstrumentId` — the piece
 * `accept.ts` forwards to `materializeAcceptedDraft`/
 * `materializeAcceptedCardDraft` once she resolves it. Exported directly
 * (not only through `createRevisionAwareJobRunner`) so a test can exercise
 * the drafting logic without going through `JobRunnerView` plumbing.
 *
 * `[D-366]`: dispatches to {@link draftMcqSuccessor} or {@link
 * draftQaSuccessor} by `target.instrumentType` — see the module doc's
 * section. A `'cloze'` predecessor (or any kind neither function handles)
 * produces no draft at all, for the same "never guess" reason named there.
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

  const generateDraftId = deps.generateDraftId ?? defaultGenerateDraftId;
  const now = deps.now ?? (() => new Date());

  if (target.instrumentType === 'qa') {
    // Held behind the spend decision (`[D-261]`): a Q&A successor is drafted
    // only when a caller supplies `draftCardForConcept` explicitly. No
    // production composition does, so a suspended Q&A card enqueues its
    // revision job but makes no `cards.generate.v1` call until spend is
    // authorised and the composition root opts in (`draftCardsForConcept` is
    // the intended supplier then).
    const draftCardForConcept = deps.draftCardForConcept;
    if (draftCardForConcept === undefined) return { ok: true };
    const drafted = await draftQaSuccessor(draftDeps, draftCardForConcept, target);
    if (drafted.kind === 'thrown') return { ok: false, retryable: true };
    if (drafted.kind === 'nothing-to-cache') return { ok: true };

    const createdAt = now().toISOString();
    for (const card of drafted.contents) {
      const record: DraftRecord = {
        draftId: generateDraftId(),
        status: 'pending',
        courseCode: target.courseCode,
        conceptName: target.conceptName,
        conceptIds: [target.conceptKey],
        sourcePath: target.sourcePath,
        createdAt,
        card,
        provenance: drafted.provenance,
        firstServedAt: null,
        predecessorInstrumentId: payload.predecessorInstrumentId,
        // `[D-366]`: written explicitly, never left to the `undefined` ⇒
        // `'mcq'` default (`types.ts`'s own doc) — this call site now
        // legitimately produces either kind, so leaving it implicit would
        // be a guess about which default applies, not a fact already known.
        instrumentType: 'qa',
      };
      await deps.cache.put(record);
    }
    return { ok: true };
  }

  if (target.instrumentType === 'mcq') {
    const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
    const drafted = await draftMcqSuccessor(draftDeps, draftForConcept, target);
    if (drafted.kind === 'thrown') return { ok: false, retryable: true };
    if (drafted.kind === 'nothing-to-cache') return { ok: true };

    const createdAt = now().toISOString();
    for (const question of drafted.contents) {
      const record: DraftRecord = {
        draftId: generateDraftId(),
        status: 'pending',
        courseCode: target.courseCode,
        conceptName: target.conceptName,
        conceptIds: [target.conceptKey],
        sourcePath: target.sourcePath,
        createdAt,
        question,
        provenance: drafted.provenance,
        firstServedAt: null,
        predecessorInstrumentId: payload.predecessorInstrumentId,
      };
      await deps.cache.put(record);
    }
    return { ok: true };
  }

  // `[D-366]`: `'cloze'` — no generative task, no `DraftRecord` content
  // shape, no registered materializer (see the module doc's section).
  // Succeeds with nothing cached rather than fabricate a draft; the
  // predecessor's own suspension (handled entirely by
  // `citation-revision-wiring.ts`, outside this file) is unaffected.
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
