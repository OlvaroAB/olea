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
 * ## ...against its source as it stands when the job runs (`ol-egov.141.89.5.107`, `[D-508]`, `[D-567]`)
 *
 * The job's passage and version were read when the rewrite was decided, and the job may drain much
 * later (no Worker configured, offline, other work first). If the cited source changed again or was
 * renamed meanwhile, a successor citing the older version or path was set aside at every
 * presentation (or withheld at first sighting) while its predecessor stayed suspended, so the
 * question was gone. {@link successorSourceOf} therefore reads the source as it stands, BEFORE the
 * drafting call, and settles both the passage the successor is drafted from and its citation:
 *
 *  - A lecture transcript is read at the path its predecessor's anchor holds now, which only a
 *    rename Olea saw moves (`CitationRevisionTrigger.onSourceRenamed`; never a search by content),
 *    and the citation records the version read there. When that is not the version the job's
 *    passage was read from, the passage is the job's own if it still stands exactly once, else the
 *    one changed region the citation pass's own ladder finds for it, else (and for a question that
 *    named no part) the whole transcript as it stands; the part is named in that version by
 *    `[D-567]`'s rule, so a whole-transcript passage names none and the whole is protected.
 *  - A non-markdown file whose bytes changed again since its page was read is drafted from that
 *    page's text as extracted from the bytes now, once this session holds it
 *    (`CitationRevisionTrigger.landedSourceText`, the text the pass's own rewrite reads). Until it
 *    lands the job waits (`retryable`, drafting nothing), at most
 *    {@link REVISION_SOURCE_TEXT_MAX_ATTEMPTS} attempts, then ends with a recorded reason. While it
 *    waits it asks once per run of Olea for the file's catch-up extraction (below, `ol-egov.141.89.5.109`).
 *  - An ordinary Markdown note (`ol-egov.141.89.5.110`, `[D-446]`, `[D-543]`) is read as it stands
 *    too. A question that named a passage is drafted from the job's passage while it still stands
 *    word for word in the note, else from the passage the citation pass's ladder finds for it in
 *    that note, else from the whole note; a question protected at whole-note grain, from the whole
 *    note as it stands. The citation names that passage only when it stands once in the note, so a
 *    whole-note passage names none and the whole note is protected. Before this, a note changed
 *    again was drafted from the older passage and then baselined at the newer note as a whole, so
 *    the second change was never checked ({@link notePassageNow}).
 *
 * Reading once, before drafting, is the bound: the job drafts once, from what it read, and records
 * that version. A change made while the draft is being written is not chased. What the citation
 * pass knows arrives through `deps.citedSourceNow` (memory and plugin data, never a network call);
 * no field, key or format is added to the job, the draft or the citation.
 *
 * ## ...asking once for the catch-up extraction when the changed file's text has not landed (`ol-egov.141.89.5.109`, `[D-518]`, `[D-440]`)
 *
 * The landed text is memory only, and the changed file's own extraction may never deliver it during
 * this run of Olea: a restart forgot it, or the arrival watch debounced the save and nothing retries a
 * debounced arrival. The suspended predecessor is skipped by the citation pass, so the pass does not
 * ask for it either, and the job used to wait out its attempts for nothing. A waiting attempt now
 * asks for the catch-up extraction the pass already asks for a held question
 * (`CitedSourceNow.requestText`, `ol-egov.141.89.5.84`): the same request, enqueued by the same host
 * function, landing through the same route, under the spend rules of the extraction it queues.
 *
 * The bound ({@link askForSourceTextOnce}): at most one request per predecessor per run of Olea,
 * whatever bytes the file has on later attempts, so never one per attempt; none on the last
 * attempt, since no attempt is left to use the text; none when no Worker is configured (the job
 * waits uncounted before it reads its source); and each request still passes the pass's own rule,
 * once per file and bytes per run of Olea and never when text for those bytes has landed, so the pass
 * and every waiting job together ask at most once per file and bytes per run of Olea. This is a bound
 * per run, not a durable once-only guarantee: a restart may ask again, once, because the text a request brought is forgotten with it; the job's attempts, which
 * the queue keeps across restarts, bound that too. Nothing is persisted. If the text still does not
 * land, the job ends at {@link REVISION_SOURCE_TEXT_MAX_ATTEMPTS} with the same reason as before.
 *
 * ## ...and drafted again when its source moves on before she answers it (`ol-egov.141.89.5.108`, `[D-508]`)
 *
 * A successor drafted from a transcript or a non-markdown file records the version it was drafted
 * from, and the session sets the draft aside at presentation once the file no longer has it
 * (`review/open-session.ts`, `draftSourceCheckAtPresentation`): changed again, or renamed. The
 * predecessor stays suspended, so without more the question was gone. {@link
 * redraftSetAsideSuccessor} is called for such a draft when it is set aside, and sends the
 * predecessor back to this runner: it queues the predecessor's own revision job again (the payload
 * the rewrite queued, unchanged), and the job settles its passage and citation against the source as
 * it stands, exactly as above. Nothing new is drafted while a job for the predecessor is still
 * waiting to run, when a pending successor already cites the source as it stands, once she has
 * resolved any successor of it, or when the predecessor no longer stands suspended (`[D-536]`).
 *
 * The bound: one job per predecessor and source version (the queue's own content-hash idempotency,
 * keyed on the predecessor, the path and the version), each job drafting once, and at most
 * {@link REVISION_JOBS_PER_PREDECESSOR_MAX} jobs per predecessor in all, so a source that keeps
 * changing stops being drafted again at that cap and its draft stays set aside as before. The job
 * reuses the queue's existing fields (its content hash is a SHA-256 hex, as every job's is); nothing
 * is added to the job, the draft or the citation.
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
 * ## An outage leaves the job waiting (`ol-egov.141.89.5.111`)
 *
 * The boundary document's offline rule (`docs/Olea_architecture_boundary.md` §1, service repo:
 * reconnection drains the client work queue) asks that an outage leave this job waiting, never
 * failed, since a failed job leaves the old question suspended with nothing replacing it. Before
 * this, a missing Worker or a transport failure was a counted retry, so a long enough outage failed
 * the job at the queue's attempt cap (each retry also spending a grounding-judge call), and an
 * unreachable Worker reached through the real drafting call failed it at once, because the gate's
 * could-not-check refusal was read as a refusal of the successor.
 *
 * Now an attempt whose generation call could not be made returns `notAttempted` (`olea-core`'s
 * `JobRunOutcome`), which the queue defers without counting: no Worker configured; a Worker call
 * that failed with no response at all (the transport threw, which {@link watchWorkerCalls} sees),
 * on the generation call or on the judge call the gate makes first; or the gate's numeric check that
 * could not run (`composite-check-unavailable`: no embedding to compare, offline or not computed
 * yet; nothing is sent for judgment then). The job resumes on the queue's first tick after its
 * backoff once the call can be made. A judge that answered but could not be read, and a throw with
 * every call answered, are counted retries under the queue's cap; every other refusal fails the job
 * as before. While the job waits for a generation call, the judge's answer to the identical request
 * is held in memory ({@link heldJudgeAnswersFor}) and reused, so no further judge call is made until
 * the generation call goes through. Nothing is persisted: no field, key or format is added.
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
  CURRENT_PASSAGE_RULE,
  type DemandRouting,
  type DemandRoutingCounter,
  type EnqueueInput,
  type EnqueueResult,
  enumerateVaultInstruments,
  type GroundingRefusalReason,
  hashContent,
  hashText,
  type InstrumentCitation,
  type InstrumentRevisionJobPayload,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  locatePassageByText,
  MAX_ATTEMPTS,
  PAPER_DEMANDS,
  PASSAGE_RULES,
  type PaperDemand,
  type PersistedJob,
  parsePassageDigest,
  projectInstrumentValidity,
  type QuestionBindingBlock,
  readInstrumentCitation,
  readInstrumentDemand,
  readReviewLogHistory,
  routeDemandAsk,
  suspendedInstrumentIds,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import { canonicalizeForMateriality } from '../ingestion/materiality/canonical.js';
import { stripQuestionBlocks } from '../ingestion/materiality/citation-material.js';
import { resolveAnchoredPassage } from '../ingestion/materiality/passage-grain.js';
import {
  hasTranscriptExtension,
  namedTranscriptPart,
  readTranscriptVersion,
  resolveTranscriptPassage,
  type TranscriptVersion,
  wholeTranscriptText,
} from '../ingestion/materiality/transcript-grain.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../retrieval/draft-quiz-cards.js';
import { draftQuizCardsForConcept } from '../retrieval/draft-quiz-cards.js';
import { GROUNDING_JUDGE_TASK_ID } from '../retrieval/workerGroundingJudge.js';
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
import { stripOleaFrontmatter } from './strip-olea-frontmatter.js';
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
    typeof v.newPassageText === 'string' &&
    (v.sourceRevision === undefined || typeof v.sourceRevision === 'string')
  );
}

/**
 * How many attempts an empty or unparseable successor draft gets before the job is recorded as
 * failed. A declared constant, not fitted: each attempt is a generation call, so the bound is small;
 * a malformed reply is usually a one-off the next attempt clears. It sits below the queue's own
 * attempt cap, which still governs every other counted retry (an outage is not counted: module
 * doc, "An outage leaves the job waiting").
 */
export const REVISION_EMPTY_DRAFT_MAX_ATTEMPTS = 3;

/**
 * `ol-egov.141.89.5.107`: how many attempts a successor job waits for the text of a non-markdown
 * source that changed again after its page was read, before ending with a recorded reason. A
 * declared constant, not fitted: the queue's own attempt cap, so the job waits as long as the queue
 * retries any job (its backoff spans about an hour, enough for the changed file's own extraction to
 * land) and ends with its own reason one attempt before the queue would park it. A waiting attempt
 * reads a hash and memory only; it makes no drafting call. `ol-egov.141.89.5.109`: one waiting
 * attempt per run of Olea, never the last, also asks for the file's catch-up extraction.
 */
export const REVISION_SOURCE_TEXT_MAX_ATTEMPTS = MAX_ATTEMPTS;

/**
 * `ol-egov.141.89.5.108`: how many revision jobs one predecessor may have in the queue in all (the
 * rewrite that drafted its first successor included) before a successor set aside for a source that
 * moved on is no longer drafted again (module doc, "drafted again when its source moves on"). A
 * declared constant, not fitted: the queue's own attempt cap, the number that already bounds a
 * successor's wait for changed text, so a source that keeps changing costs at most that many
 * drafting jobs over the question's life, whatever happens to the file. Each job drafts once.
 */
export const REVISION_JOBS_PER_PREDECESSOR_MAX = MAX_ATTEMPTS;

/**
 * `ol-egov.141.89.5.107`: what the citation pass knows about a rewritten question's cited source
 * that the vault alone does not say, read when the successor is drafted (module doc, "against its
 * source as it stands"). Production builds it from the plugin's one `CitationRevisionTrigger`
 * (`citedSourceNowFrom`, composed in `main.ts`). Both reads are memory or plugin data; the one
 * request (`ol-egov.141.89.5.109`) goes to the pass's own catch-up extraction.
 */
export interface CitedSourceNow {
  /**
   * Where the citation pass last saw this instrument's cited passage (its anchor's path), or
   * `undefined` when it holds no anchor. A rewritten question keeps its anchor, and a rename Olea
   * saw moves a transcript anchor, so for a lecture transcript this is where the file stands now.
   */
  readonly anchoredPath: (instrumentId: string) => Promise<VaultPath | undefined>;
  /**
   * The text this session extracted from `path` when its bytes hashed to `bytesHash`: `page`'s, or
   * every page's when `page` is `undefined`. `undefined` when none is held for those bytes.
   */
  readonly landedText: (
    path: VaultPath,
    bytesHash: string,
    page: number | undefined,
  ) => Promise<string | undefined>;
  /**
   * `ol-egov.141.89.5.109` ([D-518]): asks for the catch-up extraction of `path`, the one a question
   * held for a changed file already asks for (`ol-egov.141.89.5.84`), under that route's rule: at
   * most once per file and bytes per run of Olea, shared with the citation pass, and not when text for
   * `bytesHash` has landed. Never throws; what it asks for lands through the ordinary landing route,
   * where {@link landedText} reads it.
   */
  readonly requestText: (path: VaultPath, bytesHash: string) => Promise<void>;
}

const GENERATION_TASK_IDS: ReadonlySet<string> = new Set(['quiz.generate.v1', 'cards.generate.v1']);

/**
 * `ol-egov.141.89.5.111`: the call this job exists for could not be made (module doc, "An outage
 * leaves the job waiting"). The queue defers the job without counting the attempt (`olea-core`'s
 * `JobRunOutcome.notAttempted`).
 */
const NOT_ATTEMPTED: JobRunOutcome = { ok: false, retryable: true, notAttempted: true };

/**
 * `ol-egov.141.89.5.111`: the grounding judge's answer to one request, kept in memory while the job
 * waits for a generation call that cannot be made, so a retry asks the judge nothing it has already
 * answered. `requestKey` is a hash of the whole request (task, contract, query and passages); any
 * difference is a new question for the judge.
 */
interface HeldJudgeAnswer {
  readonly requestKey: string;
  readonly response: unknown;
}

const heldJudgeAnswersByCache = new WeakMap<DraftCacheStore, Map<string, HeldJudgeAnswer>>();

/**
 * The judge answers held for jobs waiting through an outage, by predecessor id: one map per draft
 * cache instance, so per plugin session in production (the posture `demandRoutingCounterFor` takes).
 * An entry lives only while its job is waiting; any other outcome of that job removes it.
 */
function heldJudgeAnswersFor(cache: DraftCacheStore): Map<string, HeldJudgeAnswer> {
  let held = heldJudgeAnswersByCache.get(cache);
  if (held === undefined) {
    held = new Map();
    heldJudgeAnswersByCache.set(cache, held);
  }
  return held;
}

const sourceTextAsksByCache = new WeakMap<DraftCacheStore, Set<string>>();

/**
 * `ol-egov.141.89.5.109`: the predecessors whose successor job has asked for the catch-up
 * extraction of its cited file this run of Olea (module doc, "...asking once for the catch-up
 * extraction"). One set per draft cache instance, so per run of Olea in production, as {@link
 * heldJudgeAnswersFor} is. Memory only: what the request brings (landed text) is memory only too,
 * so a restart forgets both together.
 */
function sourceTextAsksFor(cache: DraftCacheStore): Set<string> {
  let asked = sourceTextAsksByCache.get(cache);
  if (asked === undefined) {
    asked = new Set();
    sourceTextAsksByCache.set(cache, asked);
  }
  return asked;
}

async function judgeRequestKey(request: WorkerTaskRequest): Promise<string> {
  return hashText(
    JSON.stringify([request.contractVersion, request.taskId, request.payload ?? null]),
  );
}

function isAnsweredBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
}

/** One drafting attempt's Worker calls, as {@link watchWorkerCalls} saw them. */
interface WatchedWorkerCalls<T> {
  readonly deps: T;
  /** Whether a call failed with no response at all (the transport threw: no connection, or no usable body). */
  readonly unreachable: () => boolean;
  /** The judge's answer this attempt received or reused, if it got one. */
  readonly judged: () => HeldJudgeAnswer | undefined;
}

/**
 * `ol-egov.141.89.5.111`: `draftDeps` with its transport watched, so the runner can tell an outage
 * from a refusal (module doc, "An outage leaves the job waiting"). A send that throws marks the
 * attempt unreachable and rethrows unchanged. A grounding-judge request identical to `held`'s is
 * answered from `held` without being sent. Every other request, and every response, passes through.
 */
function watchWorkerCalls<T extends { readonly transport: WorkerTaskTransport }>(
  draftDeps: T,
  held: HeldJudgeAnswer | undefined,
): WatchedWorkerCalls<T> {
  const inner = draftDeps.transport;
  let unreachable = false;
  let judged: HeldJudgeAnswer | undefined;
  return {
    deps: {
      ...draftDeps,
      transport: {
        send: async (request) => {
          const requestKey =
            request.taskId === GROUNDING_JUDGE_TASK_ID ? await judgeRequestKey(request) : undefined;
          if (requestKey !== undefined && held !== undefined && held.requestKey === requestKey) {
            judged = held;
            return held.response;
          }
          let response: unknown;
          try {
            response = await inner.send(request);
          } catch (error) {
            unreachable = true;
            throw error;
          }
          if (requestKey !== undefined && isAnsweredBody(response)) {
            judged = { requestKey, response };
          }
          return response;
        },
      },
    },
    unreachable: () => unreachable,
    judged: () => judged,
  };
}

/**
 * `draftDeps` with its transport wrapped so a generation request carries `passage` first in
 * `sourceChunks` (see the module doc). Everything else passes through unchanged.
 */
function withPassageTransport<T extends { readonly transport: WorkerTaskTransport }>(
  draftDeps: T,
  rawPassage: string,
): T {
  // `ol-egov.141.89.2.32`: a whole-note passage carries the note's frontmatter, so Olea's own
  // `olea-*` stamp keys come out before the text reaches any model request.
  const passage = stripOleaFrontmatter(rawPassage);
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
   * isn't configured (F7.8); the job then waits (`notAttempted`, not counted
   * against the queue's attempts: module doc, "An outage leaves the job
   * waiting") rather than failing, since this is a transient configuration
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
   * predecessor, an attempt the outage kept from its generation call) is not counted. Local and in
   * memory (D-005); nothing is persisted or sent.
   */
  readonly demandCounter?: DemandRoutingCounter;
  /**
   * `ol-egov.141.89.5.107`: see {@link CitedSourceNow}. Absent (tests, and any host without a
   * citation pass), a transcript is read at the path its citation names and a non-markdown source
   * keeps the version its job carries, as before.
   */
  readonly citedSourceNow?: CitedSourceNow;
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
 * The successor's demand routing (`[D-437]`): the predecessor's declared demand restated as the
 * ask and routed against the generator the successor goes through; `authoringDemandFields` reduces
 * it to what the request carries, empty (and the request today's) unless the predecessor declared a
 * demand the generator serves. Not counted here: the caller counts it once the attempt is known to
 * have been made (`ol-egov.141.89.5.111`). Reads the predecessor's record and writes nothing.
 */
async function successorDemandRouting(
  vault: VaultSource,
  target: RevisionTarget,
  predecessorInstrumentId: string,
  taskId: 'quiz.generate.v1' | 'cards.generate.v1',
): Promise<DemandRouting> {
  const reading = await readInstrumentDemand(vault, predecessorInstrumentId, target.block);
  return routeDemandAsk(askFromInstrumentReading(reading), taskId);
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
  /** The grounding gate refused, for this reason (`ol-egov.141.89.5.111`: an outage is told apart by it). */
  | { readonly kind: 'refused'; readonly reason: GroundingRefusalReason }
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
    // uses and `createExtractionJobRunner`'s own catch-all. Whether it was an
    // outage is the caller's to tell (`ol-egov.141.89.5.111`).
    return { kind: 'thrown' };
  }

  if (result.status === 'refused') {
    // Nothing to cache. Which refusal it was decides what the job does: a
    // check that could not run is not a refusal of the successor
    // (`ol-egov.141.89.5.111`, {@link undraftedOutcome}); this runner only
    // owns not pretending one is the other.
    return { kind: 'refused', reason: result.reason };
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
    return { kind: 'refused', reason: result.reason };
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
 * `ol-egov.141.89.5.107`: the passage a successor is drafted from and the citation it records,
 * settled from the cited source as it stands before the drafting call (module doc, "against its
 * source as it stands").
 */
type SuccessorSource =
  | {
      readonly kind: 'ready';
      readonly passage: string;
      readonly citation: InstrumentCitation | undefined;
    }
  /**
   * A non-markdown source changed again after its page was read, and its new text has not landed:
   * the file (`path`, where the predecessor's citation names it) and its bytes now.
   */
  | { readonly kind: 'waiting'; readonly path: VaultPath; readonly bytesHash: string };

/**
 * `ol-egov.141.89.5.79` ([D-508]): the successor's source citation. The sweep builds one from a
 * sweep unit; this job has none, so it is rebuilt from the predecessor's own citation (which note,
 * page and section the question cited) and the passage the successor is drafted from. For a
 * Markdown note the passage digest is minted by `withGroundingPassage` with the passage as the one
 * chunk, the same sealing the sweep applies, so it equals what a new question on this passage would
 * get; it is omitted (whole-note grain) when the passage is not exactly one passage of the cited
 * note. A lecture transcript is {@link transcriptSuccessorSource}'s; any other file
 * {@link binarySuccessorSource}'s.
 *
 * No citation at all when the predecessor had none or cited its own note (the self-referential
 * fallback): accept then mints its own, as before, and the job's passage is drafted from. Never
 * throws: a read that fails leaves no citation and the job's passage, today's behaviour.
 */
async function successorSourceOf(
  deps: RevisionJobRunnerDeps,
  payload: InstrumentRevisionJobPayload,
  ownNotePath: VaultPath,
): Promise<SuccessorSource> {
  const passage = payload.newPassageText;
  try {
    const predecessor = await readInstrumentCitation(deps.vault, payload.predecessorInstrumentId);
    if (predecessor === undefined || predecessor.sourcePath === ownNotePath) {
      return { kind: 'ready', passage, citation: undefined };
    }
    const base: InstrumentCitation = {
      sourcePath: predecessor.sourcePath,
      ...(predecessor.page !== undefined ? { page: predecessor.page } : {}),
      ...(predecessor.section !== undefined ? { section: predecessor.section } : {}),
    };
    const transcript = await transcriptSuccessorSource(
      deps,
      payload,
      predecessor,
      base,
      ownNotePath,
    );
    if (transcript !== undefined) return transcript;
    if (predecessor.sourcePath.toLowerCase().endsWith('.md')) {
      // `ol-egov.141.89.5.110`: the note as it stands, when it changed again before drafting.
      const now = await notePassageNow(deps.vault, predecessor, passage);
      return {
        kind: 'ready',
        passage: now,
        citation:
          now.trim().length === 0
            ? base
            : await withGroundingPassage(deps.vault, base, ownNotePath, [now]),
      };
    }
    return await binarySuccessorSource(deps, payload, predecessor, base);
  } catch {
    return { kind: 'ready', passage, citation: undefined };
  }
}

/**
 * `ol-egov.141.89.5.110` ([D-446], [D-543], [D-508]): the passage to draft a successor from when its
 * predecessor cites an ordinary Markdown note, read from the note as it stands when the job runs
 * (its material: the text minus question blocks, as the presentation check reads it). The citation
 * is then made from that passage by the shared rule (`withGroundingPassage`), so it names a passage
 * only when that passage stands once in the note; otherwise the whole note is its grain.
 *
 *  - A question that named a passage: the job's own passage while it still stands word for word in
 *    the note (drafted and cited as before); otherwise the note changed again before drafting, and
 *    the passage is the one the citation pass's own ladder finds for it in this note alone
 *    (`resolveAnchoredPassage`: a formatting-only change, or the one edited region resembling it),
 *    else the whole note.
 *  - A question protected at whole-note grain: the whole note as it stands, when it reads
 *    differently from the job's beyond formatting.
 *
 * A note that cannot be read keeps the job's passage, as before. Never another note: a passage
 * moved elsewhere is the citation pass's to heal, not this job's to follow.
 */
async function notePassageNow(
  vault: VaultSource,
  predecessor: InstrumentCitation,
  passage: string,
): Promise<string> {
  const cited = predecessor.sourcePath;
  let material: string;
  try {
    material = stripQuestionBlocks(await vault.read(cited));
  } catch {
    return passage;
  }
  const digest = predecessor.passageDigest;
  if (digest === undefined) {
    return canonicalizeForMateriality(material) === canonicalizeForMateriality(passage)
      ? passage
      : material;
  }
  const parsed = parsePassageDigest(digest);
  const rule =
    (parsed === null
      ? undefined
      : PASSAGE_RULES.find((candidate) => candidate.version === parsed.version)) ??
    CURRENT_PASSAGE_RULE;
  if (locatePassageByText(rule.segment(material), rule.normalise(passage)).status !== 'absent') {
    return passage;
  }
  const found = await resolveAnchoredPassage(
    { text: passage, passageDigest: digest, anchorPath: cited, citedPath: cited },
    {
      exists: async (path) => path === cited,
      material: async () => material,
      markdownPaths: async () => [],
    },
  );
  return found.kind === 'present' ? found.text : material;
}

/**
 * `ol-egov.141.89.5.104`, `ol-egov.141.89.5.107` ([D-567], [D-508]): the successor's passage and
 * citation when the predecessor cites a lecture transcript (a `.txt`/`.vtt`/`.srt` file, or Markdown
 * that declares itself one); `undefined` for any other source.
 *
 * The transcript is read where it stands now: at the path the predecessor's anchor holds
 * (`deps.citedSourceNow.anchoredPath`), which a rename Olea saw moved there, else the path the
 * citation names. An anchor at the question's own note (one made before part grain applied) is not
 * a transcript path and is not followed. The citation records that path and the version read there
 * (its bytes hash), so the successor is seeded and presented on first sighting, and names the part
 * its passage names in that version by the rule a new question gets (`namedTranscriptPart`): a part
 * only when the passage stands once inside one part, otherwise none, and the whole transcript is
 * protected.
 *
 * The passage is the job's own (`newPassageText`, the passage the change left) when the version read
 * is the one it was read from (the job's `sourceRevision`, or for a job queued by an earlier build
 * the predecessor's). Otherwise the transcript changed again before drafting, and the passage is
 * {@link transcriptPassageNow}'s. A transcript that is gone or cannot be read records no version,
 * as before; a Markdown file that does not read as a transcript is her note (`undefined`).
 */
async function transcriptSuccessorSource(
  deps: RevisionJobRunnerDeps,
  payload: InstrumentRevisionJobPayload,
  predecessor: InstrumentCitation,
  base: InstrumentCitation,
  ownNotePath: VaultPath,
): Promise<SuccessorSource | undefined> {
  const cited = predecessor.sourcePath;
  const markdown = cited.toLowerCase().endsWith('.md');
  if (!markdown && !hasTranscriptExtension(cited)) return undefined;
  const anchored = await deps.citedSourceNow?.anchoredPath(payload.predecessorInstrumentId);
  const path = anchored !== undefined && anchored !== ownNotePath ? anchored : cited;
  const read = await readTranscriptVersion(deps.vault, path);
  // An undeclared Markdown file is her note; a Markdown file that is gone cannot be told apart and
  // keeps the note handling, as the citation pass does.
  if (markdown && read.kind !== 'read') return undefined;
  const here: InstrumentCitation = path === cited ? base : { ...base, sourcePath: path };
  if (read.kind !== 'read') {
    return { kind: 'ready', passage: payload.newPassageText, citation: here };
  }
  const version = read.version;
  const readFrom = payload.sourceRevision ?? predecessor.sourceRevision;
  const passage =
    readFrom === version.bytesHash
      ? payload.newPassageText
      : transcriptPassageNow(predecessor, payload.newPassageText, version);
  const named = await namedTranscriptPart(version.parts, passage);
  return {
    kind: 'ready',
    passage,
    citation:
      named === undefined
        ? { ...here, sourceRevision: version.bytesHash }
        : {
            ...here,
            page: named.page,
            passageDigest: named.passageDigest,
            sourceRevision: version.bytesHash,
          },
  };
}

/**
 * `ol-egov.141.89.5.107` ([D-567]): the passage to draft from in a transcript version other than the
 * one the job's passage was read from. A question whose citation named a part is followed by the
 * citation pass's own ladder (`resolveTranscriptPassage`, text only, this one file): its passage
 * standing exactly once is drafted from as it is; the one changed region the ladder finds for it is
 * the passage as it reads now. A passage that is missing or ambiguous, and a question that named no
 * part (the whole transcript was its grain), are drafted from the whole transcript as it stands,
 * which then names no part and is protected whole. Never a guessed part.
 */
function transcriptPassageNow(
  predecessor: InstrumentCitation,
  passage: string,
  version: TranscriptVersion,
): string {
  if (predecessor.passageDigest !== undefined) {
    const found = resolveTranscriptPassage(passage, version.words);
    if (found.kind === 'present') return passage;
    if (found.kind === 'changed') return found.text;
  }
  return wholeTranscriptText(version);
}

/**
 * `ol-egov.141.89.5.81` ([D-518]), `ol-egov.141.89.5.107`: the successor's passage and citation for
 * a non-markdown source (a PDF, slide deck or document). The citation keeps the predecessor's path,
 * page and section and records the bytes its passage was extracted from, which the accept guard and
 * the presentation check verify against the file later. The predecessor's citation names the file
 * where it stands: a rename Olea saw moves it (`ol-egov.141.89.5.111`,
 * `CitationRevisionTrigger.onSourceRenamed`), so the successor cites the new path.
 *
 *  - The job carries the hash of the bytes its page text was re-extracted from. While the file still
 *    has those bytes (or cannot be read, or no citation pass is composed), that hash is recorded
 *    with the job's passage, as a fresh question's citation would record it.
 *  - The file changed again since: the successor is drafted from the cited page's text as extracted
 *    from the bytes now, once this session holds it (`deps.citedSourceNow.landedText`), and records
 *    those bytes. Until then the job waits (`'waiting'`, naming the file and its bytes now); the
 *    changed file's own extraction lands it, or the catch-up extraction the job asks for
 *    (`ol-egov.141.89.5.109`).
 *  - A job queued by an earlier build carries no hash: the predecessor's is kept only while it is
 *    still the file's bytes hash, never a stale one.
 */
async function binarySuccessorSource(
  deps: RevisionJobRunnerDeps,
  payload: InstrumentRevisionJobPayload,
  predecessor: InstrumentCitation,
  base: InstrumentCitation,
): Promise<SuccessorSource> {
  const passage = payload.newPassageText;
  const now = await bytesHashNow(deps.vault, predecessor.sourcePath);
  const readFrom = payload.sourceRevision;
  if (readFrom === undefined) {
    return {
      kind: 'ready',
      passage,
      citation:
        predecessor.sourceRevision !== undefined && predecessor.sourceRevision === now
          ? { ...base, sourceRevision: now }
          : base,
    };
  }
  if (now === undefined || now === readFrom || deps.citedSourceNow === undefined) {
    return { kind: 'ready', passage, citation: { ...base, sourceRevision: readFrom } };
  }
  const text = await deps.citedSourceNow.landedText(predecessor.sourcePath, now, predecessor.page);
  return text === undefined
    ? { kind: 'waiting', path: predecessor.sourcePath, bytesHash: now }
    : { kind: 'ready', passage: text, citation: { ...base, sourceRevision: now } };
}

/** The file's bytes hash now, as a citation's `sourceRevision` records it; `undefined` when it is gone or cannot be read. */
async function bytesHashNow(vault: VaultSource, path: VaultPath): Promise<string | undefined> {
  try {
    return (await vault.exists(path)) ? await hashContent(await vault.readBinary(path)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `ol-egov.141.89.5.109` ([D-518], [D-440]): while a successor waits for its changed file's text,
 * asks once per run of Olea for the catch-up extraction of that file (module doc, "...asking once for the catch-up
 * extraction"). Asks nothing on the last attempt, since no attempt is left to use the text, nor
 * when this predecessor's job already asked in this run of Olea, whatever bytes it waited for then. The
 * request itself goes through the citation pass's own once-per-file-and-bytes rule. A request that
 * fails is logged by error name only, and the job waits as before.
 */
async function askForSourceTextOnce(
  deps: RevisionJobRunnerDeps,
  payload: InstrumentRevisionJobPayload,
  waiting: { readonly path: VaultPath; readonly bytesHash: string },
  attempts: number,
): Promise<void> {
  const port = deps.citedSourceNow;
  if (port === undefined || attempts >= REVISION_SOURCE_TEXT_MAX_ATTEMPTS) return;
  const asked = sourceTextAsksFor(deps.cache);
  if (asked.has(payload.predecessorInstrumentId)) return;
  asked.add(payload.predecessorInstrumentId);
  try {
    await port.requestText(waiting.path, waiting.bytesHash);
  } catch (error) {
    console.error(
      'Olea: instrument-revision catch-up extraction request failed',
      error instanceof Error ? error.name : 'unknown',
    );
  }
}

/**
 * `ol-egov.141.89.5.107`: a successor waiting for a changed non-markdown source's new text is
 * retried by the queue until {@link REVISION_SOURCE_TEXT_MAX_ATTEMPTS}, then recorded as failed with
 * a reason. A waiting attempt makes no drafting call.
 */
function sourceTextWaitOutcome(
  payload: InstrumentRevisionJobPayload,
  attempts: number,
): JobRunOutcome {
  if (attempts < REVISION_SOURCE_TEXT_MAX_ATTEMPTS) return { ok: false, retryable: true };
  return {
    ok: false,
    retryable: false,
    reason: `instrument-revision job: the cited file of predecessor ${payload.predecessorInstrumentId} changed again after its page was read, and no text for its bytes now landed within ${REVISION_SOURCE_TEXT_MAX_ATTEMPTS} attempts; the predecessor stays suspended`,
  };
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
 * `ol-egov.141.89.5.111`: what a drafting attempt that cached nothing tells the queue (module doc,
 * "An outage leaves the job waiting"). `unreachable` is whether one of the attempt's Worker calls
 * failed with no response at all.
 *
 *  - The generation call, or the judge call before it, failed with no response: an outage, so the
 *    job waits uncounted ({@link NOT_ATTEMPTED}). The gate's numeric check that could not run
 *    (`composite-check-unavailable`: no embedding to compare, offline or not yet computed) is the
 *    same, decided before any judge call, so nothing was sent for judgment.
 *  - A throw with every call answered, and a judge that answered but could not be read
 *    (`judge-unavailable`: an error, a timeout or an unusable verdict): a counted retry, bounded by
 *    the queue's cap. Neither is a fact about the successor.
 *  - An empty or unparseable reply: {@link emptyDraftOutcome}.
 *  - Every other refusal is the gate refusing the successor, which fails the job as before.
 */
function undraftedOutcome(
  drafted: Exclude<SuccessorDraftOutcome<unknown>, { readonly kind: 'drafted' }>,
  unreachable: boolean,
  payload: InstrumentRevisionJobPayload,
  attempts: number,
): JobRunOutcome {
  switch (drafted.kind) {
    case 'thrown':
      return unreachable ? NOT_ATTEMPTED : { ok: false, retryable: true };
    case 'empty-draft':
      return emptyDraftOutcome(payload, attempts);
    case 'refused':
      if (drafted.reason === 'composite-check-unavailable') return NOT_ATTEMPTED;
      if (drafted.reason === 'judge-unavailable') {
        return unreachable ? NOT_ATTEMPTED : { ok: false, retryable: true };
      }
      return noSuccessorOutcome(payload, 'the grounded draft was refused');
  }
}

/**
 * `ol-egov.141.89.5.111`: settles one drafting attempt's bookkeeping. While the job waits uncounted
 * (`waiting`), the judge's answer is held so the next attempt asks the judge nothing it already
 * answered; any other outcome drops it. The demand ask is counted only when the attempt was made.
 */
function settleDraftAttempt(
  waiting: boolean,
  watched: WatchedWorkerCalls<unknown>,
  held: Map<string, HeldJudgeAnswer>,
  payload: InstrumentRevisionJobPayload,
  countAsk: () => void,
): void {
  if (waiting) {
    const judged = watched.judged();
    if (judged !== undefined) held.set(payload.predecessorInstrumentId, judged);
    return;
  }
  held.delete(payload.predecessorInstrumentId);
  countAsk();
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
    // permanent property of the job. `ol-egov.141.89.5.111`: it waits
    // uncounted, so it is resumed once a Worker is configured however long
    // that takes (module doc, "An outage leaves the job waiting").
    return NOT_ATTEMPTED;
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

  // `ol-egov.141.89.5.107`: the passage to draft from and the citation to record, read from the
  // cited source as it stands, once, before any drafting call or demand ask (module doc, "against
  // its source as it stands"). A changed file whose new text has not landed waits, bounded, and
  // asks once per run of Olea for its catch-up extraction (`ol-egov.141.89.5.109`). A cloze predecessor drafts
  // nothing (below), so nothing is read for it.
  const source: SuccessorSource =
    target.instrumentType === 'cloze'
      ? { kind: 'ready', passage: payload.newPassageText, citation: undefined }
      : await successorSourceOf(deps, payload, target.sourcePath);
  if (source.kind === 'waiting') {
    await askForSourceTextOnce(deps, payload, source, attempts);
    return sourceTextWaitOutcome(payload, attempts);
  }

  if (target.instrumentType === 'qa') {
    // `ol-egov.141.89.5.92` ([D-508], [D-541]): defaults to the real `draftCardsForConcept`, as the
    // quiz branch does, so a withheld generated card gets a `cards.generate.v1` successor in
    // production. It drafts under the drafting scope ([D-544]) inside `draft-cards.ts`. Spend stays
    // gated by [D-261] at deploy, not by a missing seam. A test injects its own to avoid a Worker.
    const draftCardForConcept = deps.draftCardForConcept ?? draftCardsForConcept;
    const routing = await successorDemandRouting(
      deps.vault,
      target,
      payload.predecessorInstrumentId,
      'cards.generate.v1',
    );
    // `ol-egov.141.89.5.111`: the attempt's Worker calls are watched, so an outage is told from a
    // refusal (module doc, "An outage leaves the job waiting").
    const held = heldJudgeAnswersFor(deps.cache);
    const watched = watchWorkerCalls(draftDeps, held.get(payload.predecessorInstrumentId));
    const drafted = await draftQaSuccessor(
      withPassageTransport(watched.deps, source.passage),
      draftCardForConcept,
      target,
      authoringDemandFields(routing),
    );
    const countAsk = (): void => {
      demandCounter.record(target.conceptKey, routing);
    };
    if (drafted.kind !== 'drafted') {
      const outcome = undraftedOutcome(drafted, watched.unreachable(), payload, attempts);
      settleDraftAttempt(outcome === NOT_ATTEMPTED, watched, held, payload, countAsk);
      return outcome;
    }
    settleDraftAttempt(false, watched, held, payload, countAsk);

    const createdAt = now().toISOString();
    const sourceContentHash = await sourceContentHashOf(deps.vault, target.sourcePath);
    const sourceCitation = source.citation;
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
    const routing = await successorDemandRouting(
      deps.vault,
      target,
      payload.predecessorInstrumentId,
      'quiz.generate.v1',
    );
    // `ol-egov.141.89.5.111`: see the cards branch above.
    const held = heldJudgeAnswersFor(deps.cache);
    const watched = watchWorkerCalls(draftDeps, held.get(payload.predecessorInstrumentId));
    const drafted = await draftMcqSuccessor(
      withPassageTransport(watched.deps, source.passage),
      draftForConcept,
      target,
      authoringDemandFields(routing),
    );
    const countAsk = (): void => {
      demandCounter.record(target.conceptKey, routing);
    };
    if (drafted.kind !== 'drafted') {
      const outcome = undraftedOutcome(drafted, watched.unreachable(), payload, attempts);
      settleDraftAttempt(outcome === NOT_ATTEMPTED, watched, held, payload, countAsk);
      return outcome;
    }
    settleDraftAttempt(false, watched, held, payload, countAsk);

    const createdAt = now().toISOString();
    const sourceContentHash = await sourceContentHashOf(deps.vault, target.sourcePath);
    const sourceCitation = source.citation;
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
 * `ol-egov.141.89.5.108`: what {@link redraftSetAsideSuccessor} did with a set-aside draft. Only
 * `'queued'` changes anything; the rest name why nothing was queued. Returned for its callers and
 * tests; nothing is recorded or logged.
 */
export type SetAsideRedraft =
  | 'queued'
  /** Not a rewritten question's successor citing a separate transcript or file. */
  | 'not-a-successor'
  /** The source cannot be read where it stands (gone, renamed unseen, no longer a transcript, unreadable): nothing to draft against. */
  | 'source-unread'
  /** The source stands where and as the draft cites it, so it was set aside for something else. */
  | 'source-unchanged'
  /** No revision job for the predecessor is on record in this queue, so its passage is not known here. */
  | 'no-job'
  /** A job for the predecessor is still waiting to run; it drafts against the source as it stands when it runs. */
  | 'job-waiting'
  /** The predecessor has had {@link REVISION_JOBS_PER_PREDECESSOR_MAX} jobs. */
  | 'bound-reached'
  /** She has resolved a successor of the predecessor, or the predecessor no longer stands suspended. */
  | 'settled'
  /** A pending successor of the predecessor already cites the source as it stands. */
  | 'drafted-for-source-now'
  /** The queue already holds the job for this predecessor, path and version. */
  | 'duplicate';

/** `ol-egov.141.89.5.108`: what {@link redraftSetAsideSuccessor} reads and where it queues. */
export interface SetAsideRedraftDeps {
  readonly vault: VaultSource;
  /** The cache the runner drafts into: every draft naming the predecessor is read. */
  readonly cache: DraftCacheStore;
  /** Every job the queue holds, whatever its status (`IngestionQueueEngine.list`); done jobs are kept there. */
  readonly jobs: () => readonly PersistedJob[];
  readonly enqueue: (input: EnqueueInput) => Promise<EnqueueResult>;
  /** As the runner's own: where a transcript's anchor stands now. */
  readonly citedSourceNow?: CitedSourceNow;
}

/**
 * `ol-egov.141.89.5.108` ([D-508]): sends a rewritten question's successor draft, set aside because
 * the transcript or file it cites no longer has the version it was drafted from, back to this runner
 * (module doc, "drafted again when its source moves on"). Queues the predecessor's revision job
 * again with the payload the rewrite queued, under a content hash naming the predecessor and the
 * source as it stands, so the queue holds one such job per version; the job then drafts against the
 * source as it stands when it runs ({@link successorSourceOf}). Reads only, apart from that one
 * enqueue. The caller ignores the result and keeps the draft set aside either way.
 */
export async function redraftSetAsideSuccessor(
  deps: SetAsideRedraftDeps,
  draft: DraftRecord,
): Promise<SetAsideRedraft> {
  const predecessorId = draft.predecessorInstrumentId;
  const citation = draft.sourceCitation;
  if (
    predecessorId === undefined ||
    citation === undefined ||
    citation.sourcePath === draft.sourcePath
  ) {
    return 'not-a-successor';
  }
  const now = await citedSourceStanding(deps, predecessorId, citation.sourcePath, draft.sourcePath);
  if (now === undefined) return 'source-unread';
  if (now.path === citation.sourcePath && now.version === citation.sourceRevision) {
    return 'source-unchanged';
  }

  const jobs = deps
    .jobs()
    .filter(
      (job) =>
        isInstrumentRevisionJobPayload(job.payload) &&
        job.payload.predecessorInstrumentId === predecessorId,
    );
  const [rewrite] = jobs;
  if (rewrite === undefined || !isInstrumentRevisionJobPayload(rewrite.payload)) return 'no-job';
  if (jobs.some((job) => job.status !== 'done' && job.status !== 'failed')) return 'job-waiting';
  if (jobs.length >= REVISION_JOBS_PER_PREDECESSOR_MAX) return 'bound-reached';

  const successors = (await deps.cache.list()).filter(
    (record) => record.predecessorInstrumentId === predecessorId,
  );
  if (successors.some((record) => record.status !== 'pending')) return 'settled';
  if (
    successors.some(
      (record) =>
        record.sourceCitation?.sourcePath === now.path &&
        record.sourceCitation.sourceRevision === now.version,
    )
  ) {
    return 'drafted-for-source-now';
  }
  // `[D-536]`: a predecessor she unsuspended (or restored) gets no further successor.
  const { entries } = await readReviewLogHistory(deps.vault);
  if (!suspendedInstrumentIds(entries).has(predecessorId)) return 'settled';

  const payload: InstrumentRevisionJobPayload = {
    kind: 'instrument-revision',
    predecessorInstrumentId: predecessorId,
    newPassageText: rewrite.payload.newPassageText,
    ...(rewrite.payload.sourceRevision !== undefined
      ? { sourceRevision: rewrite.payload.sourceRevision }
      : {}),
  };
  const result = await deps.enqueue({
    contentHash: await hashContent(
      new TextEncoder().encode(
        `instrument-revision again\n${predecessorId}\n${now.path}\n${now.version}`,
      ),
    ),
    label: rewrite.label,
    payload,
  });
  return result.status === 'queued' ? 'queued' : 'duplicate';
}

/**
 * Where a successor's cited source stands now and its version there, read the way the runner will
 * read it ({@link transcriptSuccessorSource}, {@link binarySuccessorSource}): a lecture transcript
 * (a `.txt`/`.vtt`/`.srt` file, or Markdown that declares itself one) at the path its predecessor's
 * anchor holds (moved only by a rename Olea saw), else the path cited, versioned only when it reads
 * as a transcript; any other file by its bytes hash, at the path the predecessor's own citation names
 * now (`ol-egov.141.89.5.111`: a rename Olea saw moves it, `CitationRevisionTrigger.onSourceRenamed`),
 * else the path cited. `undefined` when it cannot be read there.
 */
async function citedSourceStanding(
  deps: SetAsideRedraftDeps,
  predecessorId: string,
  cited: VaultPath,
  ownNotePath: VaultPath,
): Promise<{ readonly path: VaultPath; readonly version: string } | undefined> {
  if (cited.toLowerCase().endsWith('.md') || hasTranscriptExtension(cited)) {
    const anchored = await deps.citedSourceNow?.anchoredPath(predecessorId);
    const path = anchored !== undefined && anchored !== ownNotePath ? anchored : cited;
    const read = await readTranscriptVersion(deps.vault, path);
    return read.kind === 'read' ? { path, version: read.version.bytesHash } : undefined;
  }
  const followed = (await readInstrumentCitation(deps.vault, predecessorId))?.sourcePath;
  const path =
    followed !== undefined &&
    followed !== ownNotePath &&
    !followed.toLowerCase().endsWith('.md') &&
    !hasTranscriptExtension(followed)
      ? followed
      : cited;
  const version = await bytesHashNow(deps.vault, path);
  return version === undefined ? undefined : { path, version };
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
