/**
 * The task-id catalogue — a closed vocabulary, by design (C4.1–C4.3).
 *
 * "FROZEN (P3-T02, ... D-011)" used to stand here. That was a
 * lane-coordination device from when P3-T01/P3-T02 forked in parallel; those
 * lanes finished long ago, and D-011 governs the envelope's version discipline
 * in `worker.ts`, not this file's vocabulary (ol-jnt0). What actually keeps
 * this catalogue closed is the argument below, and it is a real, ongoing
 * design rule rather than a lane-era leftover.
 *
 * `worker.ts` fixes the *envelope*: how every call is versioned, stamped and
 * refused. This file fixes the *vocabulary*: which task ids exist at all.
 * They are separate rules because they fail differently — an envelope change
 * breaks every call at once, while a task-id change breaks exactly the feature
 * that owns it.
 *
 * **Why a closed catalogue rather than an open string.** A task id is the join
 * key between four things that live in four different places: the client call
 * site, the Worker's routing table, the versioned prompt directory (C4.3), and
 * the telemetry record that D-005 permits (task id is one of the few fields it
 * *does* permit, precisely because it carries no content). If the id is a free
 * string, those four drift silently — a typo becomes a 404 in production, and
 * a renamed prompt directory becomes an un-joinable gap in a semester of cost
 * data. Freezing the vocabulary makes all four provably the same set.
 *
 * **What is deliberately NOT here: slot routing.** Which model slot serves a
 * task is config, swappable without touching a call site (C4.6), and it lives
 * server-side in `olea-service/src/slots.ts`. Putting it in a client-visible
 * contract would create a second source of truth for a value designed to be
 * changed. The slot named in each comment below is documentation of intent,
 * not a binding.
 *
 * **Naming.** `<domain>.<verb>.v<N>` — three parts, always. The trailing
 * version is per *task*, not the contract version: a task whose payload shape
 * changes incompatibly gets `.v2` and both are served during the overlap,
 * which is a smaller and cheaper migration than bumping `CONTRACT_VERSION` for
 * every feature that evolves. `CONTRACT_VERSION` moves only when the envelope
 * moves.
 *
 * **Registration is still per-bead.** Appearing here means the id is reserved
 * and spelled correctly; it does NOT mean the Worker serves it yet. Each task's
 * request/response payload shape lands in the bead that owns the feature, so
 * the shape is designed against a real caller rather than guessed in advance.
 * `registeredTaskIds()` on the Worker is the truth about what is live; this is
 * the truth about what is spellable.
 */

import { z } from 'zod';

/**
 * Every task id v0.9 will ever route, keyed by the workload shape it belongs to
 * (cost model §1) and the contract clause that demands it.
 *
 * Derived from the functional scope's feature set rather than invented: each
 * entry below is a feature the contract already names, not a capability added
 * because it seemed useful. F2.14's extensibility rule applies — adding a
 * schedulable instrument type later must not require a new task id here.
 */
export const TASK_IDS = {
  /** W1 · Slot E — embed note/section text for retrieval (C2, C3). */
  RETRIEVAL_EMBED: 'retrieval.embed.v1',
  /** W3 · Slot G — section summaries (F3.2). */
  SECTIONS_SUMMARIZE: 'sections.summarize.v1',
  /**
   * W4 · Slot G — concepts read out of her material, corroborated (never
   * overridden) by her filing conventions (F1.4, C7.3, `[D-068]`, `[D-082]`).
   * The client-side stage is `packages/core/src/concept/read.ts`'s
   * `readConcepts`, reached through the `ConceptReaderPort` seam; this id is
   * that port's join key, added by EXT-7 (`ol-5nle`) per the reservation this
   * catalogue's own test carried since P3-T02.
   */
  CONCEPTS_EXTRACT: 'concepts.extract.v1',
  /**
   * W6 · Slot J — what kind of knowledge a concept is: `fact` / `category` /
   * `principle`, or explicitly `unclassified` (component register row 1.5,
   * `[KCT-1]` `ol-kxr6`, `[KCT-2]` `ol-fx1k`). A verdict over given material —
   * a concept plus its source passages — echoing `explain-back.judge.v1` and
   * `grounding.judge.v1`'s shape rather than `concepts.extract.v1`'s, the same
   * distinction `grounding.judge.v1`'s own comment draws: judging, not
   * generating. The client-side stage is
   * `packages/core/src/concept/knowledge-kind.ts`'s `classifyKnowledgeKind`,
   * reached through the `KnowledgeKindClassifierPort` seam; this id is that
   * port's join key, added by `[D-114]` / KCT-2 (`ol-fx1k`).
   */
  CONCEPTS_CLASSIFY: 'concepts.classify.v1',
  /** W3 · Slot G — Q&A and cloze card drafts, INV-6 accept step downstream (F3.3). */
  CARDS_GENERATE: 'cards.generate.v1',
  /** W3 · Slot G — MCQ generation incl. distractors (F3.10, amendment F2.14–F2.17). */
  QUIZ_GENERATE: 'quiz.generate.v1',
  /** W5 · Slot J — "explain why I got this wrong", mid-review, strict latency (F2.7, F2.10). */
  EXPLAIN_WHY_GENERATE: 'explain-why.generate.v1',
  /** W6 · Slot J — grade an explain-back attempt (F5, F4.6, R7). */
  EXPLAIN_BACK_JUDGE: 'explain-back.judge.v1',
  /**
   * W6 · Slot J — the SOLO depth verdict on a graded explain-back response
   * (`ol-95vv.2` [MAT-5], `[D-117]`, knowledge model R7/R9): five-level SOLO
   * taxonomy structure, never a numeric mastery estimate and never a second
   * scored concept (R9's structural rule). A separate task from
   * `explain-back.judge.v1` — that task verdicts correctness against a
   * reference answer; this one verdicts the STRUCTURE of an answer that
   * already exists, orthogonal to whether it is right. Payload/response
   * fixed by `olea-service/src/tasks/explainBackSolo.ts`; the client-side
   * caller is `packages/core/src/grading/explainBackSolo.ts`'s `gradeSolo`,
   * fed by `../mastery/gradingInputContract.ts`'s `buildGradingSourceMaterial`
   * (`[D-083]`).
   */
  EXPLAIN_BACK_SOLO: 'explain-back.solo.v1',
  /** W7 · Slot O — the exam oracle's yield ranking (F4.2–F4.4). */
  ORACLE_RANK: 'oracle.rank.v1',
  /**
   * W1 · Slot R — cross-encoder rerank of the hybrid retrieval candidate set;
   * scores (query, chunk) pairs together rather than comparing independent
   * embeddings (C2.5's "reranked", Run 13 Ruling 1).
   */
  RETRIEVAL_RERANK: 'retrieval.rerank.v1',
  /**
   * W6 · Slot J — the explicit support check: given the query and the
   * assembled context, does that context actually support answering it
   * (C4.7's grounding-refusal path; Run 13 Ruling 1). Echoes
   * `explain-back.judge.v1`'s shape because it is the same kind of act — a
   * verdict over material that already exists, not a generation.
   */
  GROUNDING_JUDGE: 'grounding.judge.v1',
  /**
   * W4 · Slot G — the corpus-level relation verdict: given a candidate pair
   * of concepts and BOTH endpoints' introducing-passage text, does the
   * material support `prerequisite` or `contrasts-with` between them
   * (`[D-082]`, component register row 1.2a, `[EXT-5]` `ol-2zfj.7`)? Sits
   * beside `concepts.extract.v1` and `concepts.classify.v1` in the same
   * family — extract proposes within-document relations, classify types a
   * concept, this task verdicts corpus-level candidates — rather than a
   * bare-noun `relations.verdict.v1`, which no existing id shape uses
   * (`[D-118]`). Payload/response fixed by
   * `packages/core/src/concept/corpus-relations/verdict.ts`'s
   * `CorpusVerdictRequest`/`CorpusVerdictResponse`: a batch of candidates,
   * each carrying both endpoints' names and introducing-passage TEXT; a
   * verdict per candidate, or silence for abstention. The client-side stage
   * is that same module's `CorpusRelationVerdictPort` seam, wired to this id
   * by `[EXT-11]` (`ol-kw4a`), added by `[D-118]`.
   */
  CONCEPTS_RELATIONS: 'concepts.relations.v1',
  /**
   * W6 · Slot J — register row 1.4's paid second stage of the two-stage
   * materiality trigger (`TRG-1`, `ol-tqy3`): given a changed file's
   * previous and current text, does the change say anything new about the
   * concepts it touches? A verdict over material already given, not a
   * generation — grouped with W6 alongside `concepts.classify.v1` and
   * `grounding.judge.v1` for the same reason those two are, and echoing
   * their shape rather than `concepts.extract.v1`'s. The free first stage
   * (hash/debounce/minimum-edit-size gates) runs entirely client-side at
   * `packages/plugin/src/ingestion/materiality/trigger.ts`'s
   * `evaluateMaterialityGate` and never reaches this task; the seam this id
   * joins to is that same directory's `MaterialityJudge` port
   * (`ingestion/materiality/types.ts`). Payload/response fixed by
   * `olea-service/src/tasks/materialityJudge.ts`'s
   * `MaterialityJudgeRequest`/`MaterialityJudgeResponse`. Reserved by
   * `ol-2zfj.18`, closing the D-072 gap `ol-2zfj.15` left named (the task
   * was built and tested service-side with no catalogue entry to route
   * through).
   */
  MATERIALITY_JUDGE: 'materiality.judge.v1',
  /**
   * Slot A — audio transcription for F5.1's spoken explain-back input
   * (`ol-p4t01`, `[D-007]`). Carries no W-number the way W1–W7 do: the cost
   * model doc's own Slot A entry
   * (`docs/Olea_ai_workload_and_cost_model.md` §2, `olea-service` repo) gives
   * it none either, because voice is an input *method* for F5's existing
   * flow, not a new generative workload.
   *
   * **Voice is an input method, not a new grading path.** This task turns
   * spoken audio into text; the transcript is handed to
   * `explain-back.judge.v1` / `explain-back.solo.v1` exactly as typed input
   * would be — it produces no verdict of its own. Payload/response fixed by
   * `olea-service/src/tasks/audioTranscribe.ts`
   * (`@cf/openai/whisper-large-v3-turbo`, per that repo's `src/slots.ts` Slot
   * A pin). The client-side port is `packages/core/src/transcription/`'s
   * `TranscriptionCaller`, feeding `GradeExplainBackInput.studentAnswer`
   * (`gradingPipeline.ts`) — no new grading input shape.
   *
   * **Reserved, not yet routed** — the same status `retrieval.rerank.v1` and
   * `retrieval.embed.v1` once had, for a different reason: `whisper-large-v3-turbo`
   * carries no `NEURON_PRICING` row and no measured output ceiling in
   * `olea-service/src/modelCeilings.ts` (`ol-91sr`'s standing "measure before
   * pinning" rule). The service-side dispatch exists
   * (`olea-service/src/audioDispatch.ts`) but is deliberately not wired into
   * `POST /v1/task` — that wiring is the pin-completion act `ol-91sr` gates,
   * not a client-side concern.
   */
  AUDIO_TRANSCRIBE: 'audio.transcribe.v1',
  /**
   * W2 · Slot V — perception: OCR/vision over a digitally-generated page
   * image (slide pages, screenshots, diagrams), component register row 1.6,
   * cost model §2 Slot V. Absent from this catalogue since the freeze as a
   * DELIBERATE omission (`ol-visiontaskid`), then twice measured
   * (`ol-6e11`, `ol-3ux7.12`) and deferred with a named revisit (`[D-141]` /
   * `ol-5ggh`). **Minted by `[D-141]`'s own revisit condition firing:**
   * `[D-153]` (`ol-egov.53`) ruled MINT once both measurement halves closed,
   * on the corrected ~10.7% boilerplate-adjusted visual-need figure.
   *
   * **Reserved and routed, not yet functional — mirrors `audio.transcribe.v1`'s
   * own reserve-then-route shape (`ol-p4t01`/`ol-3ux7.29`), built by
   * `ol-3ux7.33`.** Unlike that task, this one IS a standard chat-completion
   * `TaskDefinition` (`olea-service/src/tasks/registry.ts`) — Slot V's
   * pinned model (`@cf/meta/llama-4-scout-17b-16e-instruct`) is reached
   * through the same call shape every Slot G/J/O task uses, so no new port
   * or dispatch table was needed the way Whisper's bespoke call shape
   * required one. Payload/response fixed by
   * `olea-service/src/tasks/visionExtract.ts`, which also records — loudly,
   * in its own module doc — that image bytes are NOT forwarded to the model
   * by this build (`WorkersAiClient.run` sends only text messages) and that
   * `grounding`/`groundResponse` are deliberately `null` as a FLAGGED
   * DEFERRAL, not a judgement that this task is exempt from INV-5. Real
   * OCR/vision behaviour — actually reading a page image, grounding the
   * extracted text against it, and a real `GroundingContract` for the
   * confabulation risk this task genuinely carries — is the consuming
   * feature's job (DF-21's `vision-page` job /
   * `packages/core/src/ingestion/extraction-runner.ts`'s `visionRunner`
   * seam in this repo), which designs the real request/response shape
   * against that caller rather than having it guessed here. This
   * reservation exists so `ol-91sr`'s standing "measure the output ceiling
   * before treating a pin as complete" rule has something to probe
   * (`ol-3ux7.31`) — the same reason `retrieval.rerank.v1` and
   * `retrieval.embed.v1` were once reserved ahead of their own completion.
   */
  VISION_EXTRACT: 'vision.extract.v1',
  /**
   * Slot O — the whole-term governor OBSERVER for the `[D-157]` shadow
   * experiment (`ol-3ux7.5.13`, task built by `ol-itkl`). Carries no
   * W-number: it serves a pre-registered measurement
   * (`olea-service/findings/governor-shadow-preregistration.md`), not a
   * production workload — nothing it returns reaches any surface, plan, or
   * student-visible artifact, by the experiment's own construction.
   *
   * **Reserved and routed for the harness only.** Its sole caller is
   * `olea-service/scripts/harness/playback-governor-observer.mjs`; whether a
   * governor STAGE ever joins the periodic plan computation is decided on the
   * shadow evidence via a later decision bead (`[D-157]`'s adopt/decline),
   * and adoption would design its production task shape against the real
   * consumer at that point rather than inheriting this observer's. Payload/
   * response fixed by `olea-service/src/tasks/planGovernor.ts`: named-input
   * re-weight proposals with one-plain-sentence reasons; `grounding`/
   * `groundResponse` deliberately `null` — the observer's expressibility
   * constraint (measurement 3) is enforced harness-side by the frozen
   * pre-registration's own `applyProposals`, and a Worker-side filter would
   * change what that frozen measurement records.
   */
  PLAN_GOVERNOR: 'plan.governor.v1',
} as const;

/** The closed catalogue as a value, sorted for stable diffs and golden output. */
export const ALL_TASK_IDS = Object.values(TASK_IDS).slice().sort() as readonly KnownTaskId[];

export type KnownTaskId = (typeof TASK_IDS)[keyof typeof TASK_IDS];

/**
 * Validator for a task id drawn from the closed catalogue.
 *
 * Deliberately **not** substituted into `requestEnvelope.taskId`, which stays a
 * permissive string. The distinction is worth keeping: a malformed envelope is
 * `invalid-request`, while a well-formed request naming an id this build does
 * not serve is a routing miss the Worker can answer precisely. Collapsing the
 * two would tell a client with a newer plugin that its JSON was broken, when in
 * fact its Worker is simply older — which is exactly the confusion D-011's
 * version floor exists to prevent.
 */
export const knownTaskId = z.enum(ALL_TASK_IDS as unknown as [KnownTaskId, ...KnownTaskId[]]);

/** Is this id in the closed catalogue? Cheap guard for routing tables. */
export function isKnownTaskId(id: string): id is KnownTaskId {
  return (ALL_TASK_IDS as readonly string[]).includes(id);
}

/**
 * The one endpoint. Every task goes through it, discriminated by task id in the
 * envelope rather than by URL path.
 *
 * A path per task would put the task vocabulary in two places — the router and
 * this file — and would make adding a task a deploy-shaped change rather than a
 * registration. It would also leak the feature set to anyone watching request
 * URLs, which is a small thing, but free to avoid.
 */
export const TASK_ENDPOINT_PATH = '/v1/task' as const;
