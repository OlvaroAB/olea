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
 * ## The successor is drafted from the changed passage (`ol-egov.141.89.5.75`, `[D-508]`)
 *
 * Under `[D-508]` every changed cited passage is rewritten from its current text, so
 * `payload.newPassageText` must reach drafting. `draftQuizCardsForConcept` and
 * `draftCardsForConcept` re-retrieve grounded chunks for `conceptName` and have no "draft from this
 * text" input, so a successor reflected the change only if retrieval had already indexed it. This
 * runner supplies the passage through the seam it owns: it hands the drafting function a copy of
 * `draftDeps` whose transport puts the passage FIRST in `sourceChunks` on the generation call
 * (`quiz.generate.v1` / `cards.generate.v1`), keeping `sourceChunkOrigins` aligned (the passage's
 * entry is `null`, a note passage). Other calls (the grounding judge) are untouched, and a passage
 * already in `sourceChunks` is not added twice. Retrieval's own grounding gate still decides whether
 * a draft is made at all; the passage is added to what the model reads, not to what the gate judged.
 *
 * ## An empty or unparseable draft is retried, then fails loudly (`ol-egov.141.89.5.75`)
 *
 * A reply that parses to nothing (no questions or cards, or a body that is not the expected shape)
 * used to end the job `ok` with nothing cached, leaving the predecessor suspended with no successor.
 * It now returns `retryable: true` until `REVISION_EMPTY_DRAFT_MAX_ATTEMPTS` attempts (the queue's
 * own `JobRunnerView.attempts`) have been made; the queue's existing backoff and its own cap
 * (`ingestion/engine.ts`, `MAX_ATTEMPTS`) apply to the retries. At the bound the job returns
 * `retryable: false` with a reason, which the queue records as a `failed` job with that
 * `failedReason`. A grounded refusal is not an empty draft and is unchanged.
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
 *
 * ## A rejected predecessor gets no successor (`ol-egov.141.89.2.14`)
 *
 * C5.3 as amended by `[D-396]`: "A rejection follows the item once it is
 * fixed: no edit or repair silently undoes it, and only her own deliberate
 * restore returns it to circulation." A successor drafted from an edit to
 * the source of an item she rejected would return that item to circulation
 * through a change path, so {@link runInstrumentRevisionJob} reads her
 * review log first and, when the predecessor stands rejected (the same
 * `projectInstrumentValidity` fold every other reader of rejection standing
 * reads, so a restore lifts it here too), ends the job with nothing drafted
 * and no drafting call made. Only a rejection counts here, not a defect
 * suspension: an item found defective is the case a successor exists to
 * repair. A predecessor restored after this job ran gets its successor from
 * the next edit, since this job is done.
 *
 * ## The predecessor's demand is restated on the successor (`[D-437]`, `ol-egov.141.89.2.20`)
 *
 * Design `demand-carriage.md` §4.1's revision row: the predecessor's `declared` demand
 * (`olea-core`'s `readInstrumentDemand`, read against the predecessor's CURRENT block) is restated as
 * the successor's ask, origin `revision`, routed against the generator the successor is drafted
 * through and sent only when it is served. An `unspecified` predecessor (no record: history is never
 * upgraded), a `stale` one (the block was edited after the record was written, so the demand no
 * longer describes the block being replaced: a conservative reading of §3.2's revision row, recorded
 * on the bead) and an `unreadable` one restate NOTHING, so their successor is authored exactly as it
 * was before this section. A declared demand no generator serves is recorded as unmet (counted, not
 * sent), never turned into a different demand. This job writes NO target record: a successor gains
 * one only at accept time, from `materialize-*.ts` (`ol-egov.141.89.2.26`), and the predecessor
 * never gains one. No heading is sent (a revision has none), and no other origin's constant is used.
 * Each ask made is counted per concept and reason (`RevisionJobRunnerDeps.demandCounter`).
 *
 * **The successor's draft carries the demand (`[D-437]`, `ol-egov.141.89.2.30`).** When the ask was
 * sent, each cached successor carries `DraftRecord.demand` (origin `revision`): the intent, the
 * server's acknowledgement and that item's own declaration, read off the request the drafting call
 * sent and the response it returned (`questions[i].declaredDemand` for a quiz, `cards[i].declaredDemand`
 * for a card: the two responses hold the same fact under different keys). `accept.ts` forwards it and
 * the materialiser writes the successor's record when she resolves the draft. A successor whose
 * request carried no demand (an unspecified, stale, unreadable or unserved predecessor) has no
 * `demand` key. An item whose own declaration disagrees with the demand asked is an invalid draft
 * (design section 4.4, Class B): not cached, counted (`draftDemandRefusalCounterFor`), and when that
 * leaves nothing the job ends `ok` with nothing cached, as after a refused or empty draft.
 */

import {
  type AuthoringDemandFields,
  askFromInstrumentReading,
  authoringDemandFields,
  type DemandRoutingCounter,
  enumerateVaultInstruments,
  hashContent,
  type InstrumentCitation,
  type InstrumentRevisionJobPayload,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  PAPER_DEMANDS,
  type PaperDemand,
  projectInstrumentValidity,
  type QuestionBindingBlock,
  readInstrumentCitation,
  readInstrumentDemand,
  readReviewLogHistory,
  routeDemandAsk,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
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
import type { DraftedDemandCarry } from './draft-demand.js';
import { withGroundingPassage } from './grounding-passage.js';
import { hashSourceRevision } from './home-note.js';
import {
  demandRoutingCounterFor,
  draftDemandForQuestion,
  draftDemandRefusalCounterFor,
  draftedDemandCarryOf,
  type SentDemandFields,
} from './pipeline.js';
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

/**
 * How many attempts an empty or unparseable successor draft gets before the job is recorded as
 * failed. A declared constant, not fitted: each attempt is a generation call, so the bound is small;
 * a malformed reply is usually a one-off the next attempt clears. It sits below the queue's own
 * attempt cap, which still governs retries of transport failures.
 */
export const REVISION_EMPTY_DRAFT_MAX_ATTEMPTS = 3;

const GENERATION_TASK_IDS: ReadonlySet<string> = new Set(['quiz.generate.v1', 'cards.generate.v1']);

/**
 * `draftDeps` with its transport wrapped so a generation request carries `passage` first in
 * `sourceChunks` (see the module doc). Everything else passes through unchanged.
 */
function withPassageTransport<T extends { readonly transport: WorkerTaskTransport }>(
  draftDeps: T,
  passage: string,
): T {
  if (passage.trim().length === 0) return draftDeps;
  const inner = draftDeps.transport;
  return {
    ...draftDeps,
    transport: {
      send: (request) => {
        const payload = request.payload;
        // `ol-egov.141.89.5.79`: the grounding gate checks the successor against the passage it
        // was drafted from. The judge's evidence is `context` (a string: the chunk texts joined by
        // a blank line; `WorkerGroundingJudge.judge`, retrieval/workerGroundingJudge.ts:103-115).
        if (
          request.taskId === 'grounding.judge.v1' &&
          typeof payload === 'object' &&
          payload !== null
        ) {
          const judged = payload as { context?: unknown };
          if (typeof judged.context !== 'string' || judged.context.includes(passage)) {
            return inner.send(request);
          }
          return inner.send({
            ...request,
            payload: { ...judged, context: `${passage}\n\n${judged.context}` },
          });
        }
        if (
          !GENERATION_TASK_IDS.has(request.taskId) ||
          typeof payload !== 'object' ||
          payload === null
        ) {
          return inner.send(request);
        }
        const body = payload as { sourceChunks?: unknown; sourceChunkOrigins?: unknown };
        if (!Array.isArray(body.sourceChunks) || body.sourceChunks.includes(passage)) {
          return inner.send(request);
        }
        return inner.send({
          ...request,
          payload: {
            ...body,
            sourceChunks: [passage, ...body.sourceChunks],
            ...(Array.isArray(body.sourceChunkOrigins)
              ? { sourceChunkOrigins: [null, ...body.sourceChunkOrigins] }
              : {}),
          },
        });
      },
    },
  };
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
  /**
   * Where this runner counts each successor ask's routing outcome, per concept and per reason
   * (`[D-437]`). Absent, `demandRoutingCounterFor(deps.cache)`: the session counter the sweep and
   * the heading offer share. An ask that was never made (a rejected predecessor, no Worker, a cloze
   * predecessor) is not counted. Local and in memory (D-005); nothing is persisted or sent.
   */
  readonly demandCounter?: DemandRoutingCounter;
}

interface RevisionTarget {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly conceptKey: string;
  readonly sourcePath: VaultPath;
  /** `[D-366]`: which kind of successor to draft — see the module doc's section. */
  readonly instrumentType: VaultInstrumentRecord['instrumentType'];
  /** `[D-437]`: the predecessor's block as it stands now, against which its demand record is read (a record whose binding no longer matches reads stale). */
  readonly block: QuestionBindingBlock;
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
    block: record.instrumentType === 'mcq' ? record.mcq : record.card,
  };
}

/**
 * The successor's demand fields (`[D-437]`): the predecessor's declared demand restated as the
 * ask, routed against the generator the successor goes through, counted, and reduced to what the
 * request carries. Empty (and the request today's) unless the predecessor declared a demand the
 * generator serves. Reads the predecessor's record and writes nothing.
 */
async function successorDemandFields(
  vault: VaultSource,
  counter: DemandRoutingCounter,
  target: RevisionTarget,
  predecessorInstrumentId: string,
  taskId: 'quiz.generate.v1' | 'cards.generate.v1',
): Promise<AuthoringDemandFields> {
  const reading = await readInstrumentDemand(vault, predecessorInstrumentId, target.block);
  const routing = counter.record(
    target.conceptKey,
    routeDemandAsk(askFromInstrumentReading(reading), taskId),
  );
  return authoringDemandFields(routing);
}

/**
 * Whether `instrumentId` stands rejected in her review log: a `rejected`
 * verdict her deliberate restore has not lifted (`olea-core`'s
 * `projectInstrumentValidity`, reason `'rejected'`). The whole log, read
 * through `readReviewLogHistory`'s folder listing, since a rejection from
 * any earlier day still stands.
 */
async function standsRejected(vault: VaultSource, instrumentId: string): Promise<boolean> {
  const { entries } = await readReviewLogHistory(vault);
  return projectInstrumentValidity(entries).provenInvalid.get(instrumentId)?.reason === 'rejected';
}

/** One "nothing to cache" reason, shared by both drafting branches below — see their own doc. */
type SuccessorDraftOutcome<TContent> =
  | { readonly kind: 'thrown' }
  | { readonly kind: 'nothing-to-cache' }
  /** Unparseable or empty reply: retried under `REVISION_EMPTY_DRAFT_MAX_ATTEMPTS`, then a recorded failure. */
  | { readonly kind: 'empty-draft' }
  | {
      readonly kind: 'drafted';
      readonly contents: readonly TContent[];
      readonly provenance: DraftProvenance;
      /** `[D-437]`: what the request carried and the response returned about demand, split per item by position. */
      readonly demand: DraftedDemandCarry;
    };

/**
 * `draftedDemandCarryOf` for a `cards.generate.v1` response (`[D-437]`, `ol-egov.141.89.2.30`). The
 * request members and the server's acknowledgement are read exactly as for a quiz, by
 * `draftedDemandCarryOf`; only the per-item declarations differ in where they sit: on `result.cards[i]`,
 * where a quiz response has `result.questions[i]`. Positions align with `extractDraftedCards`, which
 * walks the same array and is all-or-nothing. A word outside the five is read as absent, never
 * coerced, as everywhere else the carriage is read.
 */
function extractDraftedCardDemand(
  request: SentDemandFields,
  response: unknown,
): DraftedDemandCarry {
  const carry = draftedDemandCarryOf(request, response);
  const cards =
    typeof response === 'object' && response !== null && (response as { ok?: unknown }).ok === true
      ? ((response as { result?: { cards?: unknown } }).result?.cards ?? null)
      : null;
  if (!Array.isArray(cards)) return { ...carry, declaredDemands: [] };
  return {
    ...carry,
    declaredDemands: cards.map((card): PaperDemand | undefined => {
      const word =
        typeof card === 'object' && card !== null
          ? (card as { declaredDemand?: unknown }).declaredDemand
          : undefined;
      return typeof word === 'string' && (PAPER_DEMANDS as readonly string[]).includes(word)
        ? (word as PaperDemand)
        : undefined;
    }),
  };
}

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
  demandFields: AuthoringDemandFields,
): Promise<SuccessorDraftOutcome<DraftQuestion>> {
  let result: DraftQuizCardsResult;
  try {
    result = await draftForConcept(draftDeps, {
      courseCode: target.courseCode,
      conceptName: target.conceptName,
      // `[D-437]`: the predecessor's declared demand, when it declared one this generator serves.
      ...demandFields,
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
    // Unparseable or empty: see the module doc's retry section.
    return { kind: 'empty-draft' };
  }

  return {
    kind: 'drafted',
    contents: questions,
    provenance,
    demand: draftedDemandCarryOf(result.request, result.response),
  };
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
  demandFields: AuthoringDemandFields,
): Promise<SuccessorDraftOutcome<DraftCardContent>> {
  let result: DraftCardsResult;
  try {
    result = await draftCardForConcept(draftDeps, {
      courseCode: target.courseCode,
      conceptName: target.conceptName,
      // `[D-437]`: see `draftMcqSuccessor`.
      ...demandFields,
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
    return { kind: 'empty-draft' };
  }

  return {
    kind: 'drafted',
    contents: cards,
    provenance,
    demand: extractDraftedCardDemand(result.request, result.response),
  };
}

/**
 * The note's revision hash at draft time, as the sweep records it (`pipeline.ts`, `hashSourceRevision`):
 * `accept.ts` forwards it so accepting refuses a successor drafted against a note that has since
 * changed. Absent when the note is gone.
 */
async function sourceContentHashOf(
  vault: VaultSource,
  notePath: VaultPath,
): Promise<string | undefined> {
  return (await vault.exists(notePath))
    ? await hashSourceRevision(await vault.read(notePath))
    : undefined;
}

/**
 * `ol-egov.141.89.5.79` ([D-508]): the successor's source citation. The sweep builds one from a
 * sweep unit; this job has none, so it is rebuilt from the predecessor's own citation (which note,
 * page and section the question cited) and the current passage text the job carries. The passage
 * digest is minted by `withGroundingPassage` with the passage as the one chunk, the same sealing
 * the sweep applies, so it equals what a new question on this passage would get; it is omitted
 * (whole-note grain) when the passage is not exactly one passage of the cited note.
 *
 * A non-markdown source keeps its path, page and section; its `sourceRevision` is carried only
 * while it is still the file's byte hash now (never a stale one). No citation at all when the
 * predecessor had none or cited its own note (the self-referential fallback): accept then mints
 * its own, as before.
 */
async function successorCitationOf(
  vault: VaultSource,
  predecessorInstrumentId: string,
  ownNotePath: VaultPath,
  passage: string,
): Promise<InstrumentCitation | undefined> {
  try {
    const predecessor = await readInstrumentCitation(vault, predecessorInstrumentId);
    if (predecessor === undefined || predecessor.sourcePath === ownNotePath) return undefined;
    const base: InstrumentCitation = {
      sourcePath: predecessor.sourcePath,
      ...(predecessor.page !== undefined ? { page: predecessor.page } : {}),
      ...(predecessor.section !== undefined ? { section: predecessor.section } : {}),
    };
    if (predecessor.sourcePath.toLowerCase().endsWith('.md')) {
      return passage.trim().length === 0
        ? base
        : await withGroundingPassage(vault, base, ownNotePath, [passage]);
    }
    if (
      predecessor.sourceRevision !== undefined &&
      (await vault.exists(predecessor.sourcePath)) &&
      (await hashContent(await vault.readBinary(predecessor.sourcePath))) ===
        predecessor.sourceRevision
    ) {
      return { ...base, sourceRevision: predecessor.sourceRevision };
    }
    return base;
  } catch {
    return undefined; // never throws: no citation is today's behaviour
  }
}

/** Retry an empty or unparseable draft until the bound, then fail with a reason the queue records. */
function emptyDraftOutcome(payload: InstrumentRevisionJobPayload, attempts: number): JobRunOutcome {
  if (attempts < REVISION_EMPTY_DRAFT_MAX_ATTEMPTS) return { ok: false, retryable: true };
  return {
    ok: false,
    retryable: false,
    reason: `instrument-revision job: no usable successor draft for predecessor ${payload.predecessorInstrumentId} after ${REVISION_EMPTY_DRAFT_MAX_ATTEMPTS} attempts (empty or unparseable reply); the predecessor stays suspended`,
  };
}

/**
 * `ol-egov.141.89.5.79`: a job that ends with no successor cached is recorded, never a silent
 * success (a grounded refusal, or every drafted item refused for its demand). Not retryable: the
 * same retrieval or draft would end the same way until the material or the ask changes.
 */
function noSuccessorOutcome(payload: InstrumentRevisionJobPayload, why: string): JobRunOutcome {
  return {
    ok: false,
    retryable: false,
    reason: `instrument-revision job: no successor cached for predecessor ${payload.predecessorInstrumentId} (${why}); the predecessor stays suspended`,
  };
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
  /** This attempt's number (`JobRunnerView.attempts`); absent reads as the first. */
  attempts = 1,
): Promise<JobRunOutcome> {
  // `ol-egov.141.89.2.14`: see the module doc's section. Read before the
  // Worker check, so a rejected predecessor's job ends rather than waiting
  // for a Worker it will never call.
  if (await standsRejected(deps.vault, payload.predecessorInstrumentId)) {
    return { ok: true };
  }

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
  const demandCounter = deps.demandCounter ?? demandRoutingCounterFor(deps.cache);

  if (target.instrumentType === 'qa') {
    // Held behind the spend decision (`[D-261]`): a Q&A successor is drafted
    // only when a caller supplies `draftCardForConcept` explicitly. No
    // production composition does, so a suspended Q&A card enqueues its
    // revision job but makes no `cards.generate.v1` call until spend is
    // authorised and the composition root opts in (`draftCardsForConcept` is
    // the intended supplier then).
    const draftCardForConcept = deps.draftCardForConcept;
    if (draftCardForConcept === undefined) return { ok: true };
    const demandFields = await successorDemandFields(
      deps.vault,
      demandCounter,
      target,
      payload.predecessorInstrumentId,
      'cards.generate.v1',
    );
    const drafted = await draftQaSuccessor(
      withPassageTransport(draftDeps, payload.newPassageText),
      draftCardForConcept,
      target,
      demandFields,
    );
    if (drafted.kind === 'thrown') return { ok: false, retryable: true };
    if (drafted.kind === 'empty-draft') return emptyDraftOutcome(payload, attempts);
    if (drafted.kind === 'nothing-to-cache') {
      return noSuccessorOutcome(payload, 'the grounded draft was refused');
    }

    const createdAt = now().toISOString();
    const sourceContentHash = await sourceContentHashOf(deps.vault, target.sourcePath);
    const sourceCitation = await successorCitationOf(
      deps.vault,
      payload.predecessorInstrumentId,
      target.sourcePath,
      payload.newPassageText,
    );
    let cachedCount = 0;
    for (const [index, card] of drafted.contents.entries()) {
      // `[D-437]`: an item declaring a different demand than the one asked is an invalid draft:
      // counted, not cached. The declaration is read by the item's position in the response.
      const stamped = draftDemandForQuestion(drafted.demand, index, 'revision');
      if (stamped.kind === 'refused') {
        draftDemandRefusalCounterFor(deps.cache).record(target.conceptKey);
        continue;
      }
      const record: DraftRecord = {
        draftId: generateDraftId(),
        status: 'pending',
        courseCode: target.courseCode,
        conceptName: target.conceptName,
        conceptIds: [target.conceptKey],
        sourcePath: target.sourcePath,
        createdAt,
        ...(sourceContentHash === undefined ? {} : { sourceContentHash }),
        ...(sourceCitation === undefined ? {} : { sourceCitation }),
        card,
        provenance: drafted.provenance,
        firstServedAt: null,
        predecessorInstrumentId: payload.predecessorInstrumentId,
        // `[D-366]`: written explicitly, never left to the `undefined` ⇒
        // `'mcq'` default (`types.ts`'s own doc) — this call site now
        // legitimately produces either kind, so leaving it implicit would
        // be a guess about which default applies, not a fact already known.
        instrumentType: 'qa',
        // `[D-437]`: present exactly when the successor request carried a demand.
        ...(stamped.demand === undefined ? {} : { demand: stamped.demand }),
      };
      await deps.cache.put(record);
      cachedCount += 1;
    }
    if (cachedCount === 0) {
      return noSuccessorOutcome(payload, 'every drafted item was refused for its demand');
    }
    return { ok: true };
  }

  if (target.instrumentType === 'mcq') {
    const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
    const demandFields = await successorDemandFields(
      deps.vault,
      demandCounter,
      target,
      payload.predecessorInstrumentId,
      'quiz.generate.v1',
    );
    const drafted = await draftMcqSuccessor(
      withPassageTransport(draftDeps, payload.newPassageText),
      draftForConcept,
      target,
      demandFields,
    );
    if (drafted.kind === 'thrown') return { ok: false, retryable: true };
    if (drafted.kind === 'empty-draft') return emptyDraftOutcome(payload, attempts);
    if (drafted.kind === 'nothing-to-cache') {
      return noSuccessorOutcome(payload, 'the grounded draft was refused');
    }

    const createdAt = now().toISOString();
    const sourceContentHash = await sourceContentHashOf(deps.vault, target.sourcePath);
    const sourceCitation = await successorCitationOf(
      deps.vault,
      payload.predecessorInstrumentId,
      target.sourcePath,
      payload.newPassageText,
    );
    let cachedCount = 0;
    for (const [index, question] of drafted.contents.entries()) {
      // `[D-437]`: see the cards loop above.
      const stamped = draftDemandForQuestion(drafted.demand, index, 'revision');
      if (stamped.kind === 'refused') {
        draftDemandRefusalCounterFor(deps.cache).record(target.conceptKey);
        continue;
      }
      const record: DraftRecord = {
        draftId: generateDraftId(),
        status: 'pending',
        courseCode: target.courseCode,
        conceptName: target.conceptName,
        conceptIds: [target.conceptKey],
        sourcePath: target.sourcePath,
        createdAt,
        ...(sourceContentHash === undefined ? {} : { sourceContentHash }),
        ...(sourceCitation === undefined ? {} : { sourceCitation }),
        question,
        provenance: drafted.provenance,
        firstServedAt: null,
        predecessorInstrumentId: payload.predecessorInstrumentId,
        // `[D-437]`: present exactly when the successor request carried a demand.
        ...(stamped.demand === undefined ? {} : { demand: stamped.demand }),
      };
      await deps.cache.put(record);
      cachedCount += 1;
    }
    if (cachedCount === 0) {
      return noSuccessorOutcome(payload, 'every drafted item was refused for its demand');
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
    return runInstrumentRevisionJob(deps, job.payload, job.attempts);
  };
}
