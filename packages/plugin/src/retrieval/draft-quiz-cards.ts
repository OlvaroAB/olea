/**
 * `draftQuizCardsForConcept` — the production caller for `retrieve()` /
 * `assembleGroundedContext` (`ol-odb0`, `ol-odb0.2`).
 *
 * **What this file exists to close.** Before it existed, the only non-test,
 * non-mock reference to `retrieve`, `hybridRetrieve` or
 * `computeCompositeGroundingSignals` anywhere in either repo was `olea-core`'s
 * own re-export of them (`ol-odb0`'s diagnosis). It originally ran `[D-042]`'s
 * single-gate composite (`requireComposite: true` +
 * `RECOMMENDED_COMPOSITE_THRESHOLDS`, `ol-odb0.2`); `[WIRE-5]` (`ol-i0y6`)
 * switches it to `[D-089]`'s two-threshold band at the operating point
 * `[D-112]` (`ol-oqip`) ratified — see "THE BAND SWITCH" below; `[D-449]` later
 * dropped the composite requirement altogether — for the
 * card-drafting flow through `quiz.generate.v1` the bead's own notes name as
 * the chosen destination.
 *
 * ===========================================================================
 * THE BAND SWITCH (`[WIRE-5]` / `ol-i0y6`)
 * ===========================================================================
 * This call site now passes `band: D112_GROUNDING_BAND`
 * (`packages/core/src/retrieval/operating-point.ts`) and a
 * `WorkerGroundingJudge` (`./workerGroundingJudge.js`) to `retrieve()`.
 * `retrieve()` already threads `request.conceptName` through as the band's
 * `query` for escalation; this call site does not need to repeat it.
 *
 * **Every request at or above the lower bar reaches the sufficiency judge
 * (`[D-442]`, David's ruling on decision-sheet row 44, 2026-09-29,
 * implementing `[D-301]`).** The band is a cost filter: below the lower bar
 * refuses from numbers with nothing sent; at or above it — in the band, or
 * above the upper bar — `retrieve()` sends the query and the retrieved
 * passages to the judge and this call site drafts only on a supported
 * verdict. The upper bar used to skip the judge ("generate from the cheap
 * signals"); a retrieval band never certifies support, so it does not any
 * more. The lower bar is unchanged here; the composite veto was dropped for
 * drafting by `[D-449]` (see the section below).
 *
 * ===========================================================================
 * NO COMPOSITE VETO FOR DRAFTING (`[D-449]`, ruled 2026-09-30)
 * ===========================================================================
 * This call site USED to also pass `requireComposite: true` with
 * `compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS` (`[D-192]`), an
 * additional veto ahead of the band that refused `below-composite-threshold`.
 * `[D-449]` drops that veto for drafting at both production call sites (this
 * one and `../generation/draft-cards.ts`): `retrieve()` is now called with
 * the band and the judge only, so the gate order is: no hits refuses; below
 * the band's lower bar (0.555, `[D-112]`, kept as a PROVISIONAL baseline, not
 * confirmed) refuses `below-band` from numbers with nothing sent; at or above
 * it the sufficiency judge is always consulted (`[D-442]`) and drafting
 * proceeds only on a supported verdict. A request the composite alone would
 * have refused now reaches the judge. The lower bar's revisit condition is
 * open (`eval/THRESHOLDS.md`'s D-449 amendment, `olea-service`, private, is
 * the cited authority). `below-composite-threshold` is no longer produced by
 * this call site; the refusal-reason union keeps it because other callers of
 * `retrieve()` can still produce it.
 *
 * ===========================================================================
 * PERSONALIZATION CONTEXT (`[D-008]`, F3.8/F3.9, `ol-p3t07c`)
 * ===========================================================================
 * `payload.personalization.voiceExemplars` is assembled here, per request,
 * from `deps.classifyPassage` — an injectable, OPTIONAL hook, the same
 * opt-in shape `pipeline.ts`'s `deps.routing` already uses for the identical
 * reason: `[D-101]`'s passage-classification engine (authorship/curation
 * authority) is F1's block and has no production implementation yet, so this
 * call site cannot assume one exists. When `deps.classifyPassage` is
 * absent, every grounded chunk classifies as `authorship: 'unknown',
 * curationAuthority: 'unknown'` — `assembleVoiceExemplars` already handles
 * that correctly (empty exemplar sets, never a wrong one), which is the
 * honest state of the world until `[D-101]` lands.
 * **No `styleProfile` is sent.** `payload.personalization` carries
 * `voiceExemplars` only: F3.9's card-style profile is card-scoped, the
 * service's `quiz.generate.v1` ignores it, and nothing here reads her card
 * corpus. `olea-core`'s `DEFAULT_STYLE_PROFILE` (F3.9's declared numbers) and
 * `computeStyleProfile` exist for the day a per-student card-corpus feed
 * exists, and no production path calls either. Neither voice exemplars nor
 * any profile ever affects the grounding decision above: an empty-context
 * refusal happens before this section runs.
 *
 * ===========================================================================
 * PURPOSE / REGISTER (`[D-188]`, F3.8's purpose clause, `ol-0r92.35`)
 * ===========================================================================
 * `request.purpose`/`request.registerHint` are passed through to
 * `payload.purpose`/`payload.registerHint` verbatim — this function decides
 * nothing about which instruments are format-matched to an assessment. That
 * decision belongs to whichever caller can actually see the assessment data
 * (F4.8): `runGenerationSweep` (`../generation/pipeline.js`)'s own
 * `deps.formatMatch`, opt-in the same way `deps.classifyPassage` above is,
 * and absent today for the identical reason — assembling a register hint
 * from her assignments table plus classified past-paper/instructor material
 * has no production wiring yet (`main.ts`'s composition-root job, a
 * different lane's this round; see `classify-passage.ts`'s own module doc
 * for the same posture on `classifyPassage`). Every caller of this function
 * today (`pipeline.ts` with no `deps.formatMatch` supplied) sends neither
 * field, which `quiz.generate.v1` treats identically to `purpose:
 * 'learning'` — her own voice, byte-identical to before this bead.
 *
 * **The judge is constructed here, from `deps.transport`, not injected as a
 * new field on `DraftQuizCardsDeps`.** That is deliberate: `DraftQuizCardsDeps`
 * is what the live F3.3 pipeline lane is building against this same round,
 * and its own acceptance keeps this function's exported signature stable.
 * `WorkerGroundingJudge` needs nothing beyond the transport `deps` already
 * carries, so widening the deps shape to inject it would be a needless
 * surface change for a dependency this module can already assemble itself —
 * the same shape `draft-cards-controller.ts` already deliberately leaves
 * `parseDraftedResponse` uninjected for.
 *
 * **Why `quiz.generate.v1`, not `cards.generate.v1`.** Same reasoning
 * `packages/workbench/src/oracle/generate.ts` already recorded for the
 * synthetic world: `quiz.generate.v1` is the one generative task with a real
 * accept boundary already built in `olea-core` (`acceptGeneratedMcq`), so
 * this is the task whose grounded call is actually useful to something
 * downstream today.
 *
 * **The trap this file is built to avoid (`ol-odb0`'s own diagnosis).** A
 * refused retrieval and a successful generation of zero cards are BOTH "no
 * cards to show her" from a UI's point of view, but they are not the same
 * fact, and confusing them is the third option nobody chose: silently
 * degrading to "never actually refuses." So this function's one piece of
 * load-bearing control flow is the early `return` on `grounding.status ===
 * 'refused'` below — the generative transport is never sent to when
 * retrieval refused, whatever the reason. `draft-quiz-cards.spec.ts` asserts
 * this by counting transport sends, not by inspecting the shape of the
 * result, which is what makes "reachable two ways" actually distinguishable
 * (`ol-odb0.3`).
 *
 * **What this file deliberately does NOT do.** It does not check for
 * duplicate instruments, does not open a draft/accept modal, and does not
 * record an accept/edit/reject event (`ol-548w`, explicitly out of scope
 * per `ol-odb0`'s own acceptance criteria). Those are `ol-p3t07a`'s full
 * "Generation: summaries + card drafts" feature — this file gives that bead
 * a real, tested composition to call rather than a gap to fill from
 * scratch. It also does not validate the Worker's response against
 * `quizGenerateResponse`'s zod schema (`olea-service/src/tasks/quizGenerate.ts`,
 * private) — that schema lives server-side and this package has no
 * dependency on it; a caller that wants typed, validated questions parses
 * the `'drafted'` result's `response` field itself. Returning the raw response transiently
 * (never persisted here, per D-005) is enough to prove the wiring; shaping it
 * into an accept-ready `McqFields` is `ol-p3t07a`'s job.
 */

import {
  type AuthoringDemand,
  type AuthoringRequestedAsk,
  CONTRACT_VERSION,
  TASK_IDS,
} from 'olea-contracts';
import type {
  ClassifiedPassage,
  PassageAuthorship,
  PassageCurationAuthority,
  VoiceExemplars,
  WorkerTaskTransport,
} from 'olea-core';
import {
  assembleVoiceExemplars,
  D112_GROUNDING_BAND,
  demandToJudgeOperation,
  type GateStage,
  type GroundingRefusalReason,
  type JudgeRequestRecord,
  type RetrieveDeps,
  type RetrieveOptions,
  retrieve,
} from 'olea-core';
import {
  type SourceChunkOrigins,
  type SourceOriginFrontmatterHost,
  sourceChunkOriginsFragment,
} from '../source-origin.js';
import { WorkerGroundingJudge } from './workerGroundingJudge.js';

/**
 * `[D-188]` / `ol-0r92.35`'s purpose, restated locally for the same reason
 * `QuizGenerateRequestPayload` below is — field-for-field match with
 * `olea-service/src/tasks/personalizationContext.ts`'s `purposeSchema`
 * (private; read for shape only, never quoted). Absent means `'learning'` —
 * F3.8's existing her-own-voice rule — which is what every request
 * predating this bead is equivalent to.
 */
export type GenerationPurpose = 'learning' | 'readiness';

/**
 * `[D-188]`'s register hint, sent only alongside `purpose: 'readiness'`.
 * Mirrors `registerHintSchema` one-for-one: `terminology` is instructor-
 * curated terms for the assessment's subject, quoted verbatim (the same
 * discipline `VoiceExemplars.terminology` uses); `sentenceShapes` is
 * past-paper sentence-shape exemplars, present only where past-paper
 * material is held for the matched assessment — absent or empty means past
 * papers are thin, and the service falls back to plain declarative wording
 * rather than a manufactured examiner.
 */
export interface RegisterHint {
  readonly terminology: readonly string[];
  readonly sentenceShapes?: readonly string[];
}

/**
 * `quiz.generate.v1`'s request shape, restated locally rather than imported
 * from the private service repo — same discipline
 * `packages/workbench/src/oracle/generate.ts` already documents for the
 * same task: this package has no dependency on `olea-service`'s prompt or
 * schema source, by construction, so a request built here can never
 * accidentally carry a task's own prompt or model literal. Field-for-field
 * match with `olea-service/src/tasks/quizGenerate.ts`'s `quizGenerateRequest`
 * zod schema (private; read for shape only, never quoted): `courseCode` and
 * `conceptName` are both required, `sourceChunks` is a plain string array,
 * `questionCount` is optional. `personalization` is new (`ol-p3t07c`, F3.8):
 * transient `[D-008]` context, mirroring `quizGenerateRequest`'s own
 * `personalization` field one-for-one. `purpose`/`registerHint`
 * (`ol-0r92.35`, `[D-188]`) mirror `quizGenerateRequest`'s own fields the
 * same way — both optional, both absent by default, so a caller that never
 * supplies them sends exactly the request it sent before this bead.
 */
export interface QuizGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  /** `ol-egov.141.89.8.56`: aligned with `sourceChunks`; present only when a chunk is a supplied transcript. */
  readonly sourceChunkOrigins?: SourceChunkOrigins;
  readonly questionCount?: number;
  readonly personalization?: {
    readonly voiceExemplars: VoiceExemplars;
  };
  readonly purpose?: GenerationPurpose;
  readonly registerHint?: RegisterHint;
  /**
   * `[D-437]` (`ol-egov.141.89.2.19`, the authoring wire): the SECONDARY mapping of the practice
   * need's ask onto `[D-262]`'s five words. Present only when the need routed as served, so
   * `quiz.generate.v1` (which serves `recall-a-fact` only, `AUTHORING_SERVED_DEMANDS`) never
   * receives one it refuses. Authoring intent and nothing more: the produced item is not thereby
   * recorded as delivering the demand. Absent means today's request, byte for byte.
   */
  readonly intendedDemand?: AuthoringDemand;
  /**
   * The PRIMARY request (row 35): the heading exactly as she wrote it and the question word read
   * from it. Sent whenever a served need came from a heading; absent for a need that did not
   * (the sweep's constant, a revision), and absent for every unserved or underspecified ask.
   */
  readonly requestedAsk?: AuthoringRequestedAsk;
}

/**
 * `quiz.generate.v1`'s response shape, restated for the same reason — mirrors
 * `quizGenerateResponse` in the private service repo. This module never
 * validates a real response against it (see the module doc's "what this file
 * deliberately does not do"); it exists so a caller of `DraftedQuizCards`
 * has something more specific than `unknown` to narrow into.
 */
export interface QuizGenerateResponsePayload {
  readonly questions: readonly {
    readonly stem: string;
    readonly correctAnswer: string;
    readonly distractors: readonly string[];
    readonly feedback: string;
    /**
     * `[D-446]` (`ol-egov.141.89.2.29`, `quiz.generate.v1` 2.5.0): the 0-based positions in the
     * request's `sourceChunks` this question rests on, the Worker's mapping of the model's own
     * citation (`olea-contracts`' `authoring-citation.ts`). Optional: absent from an older Worker's
     * response and whenever nothing was cited. Read only through `generation/response.ts`'s
     * `extractDraftedGroundedIn`, never indexed directly.
     */
    readonly groundedIn?: readonly number[];
  }[];
}

export interface DraftQuizCardsRequest {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly questionCount?: number;
  /**
   * `[D-188]` / `ol-0r92.35`. Absent (the default for every caller today)
   * sends no `purpose` at all, which `quiz.generate.v1` treats identically
   * to `'learning'` — her own voice, unchanged from before this field
   * existed. Set to `'readiness'` only by a caller that has independently
   * decided this build is matched to an assessment's format (F4.8) — this
   * function makes no such decision itself; see `runGenerationSweep`
   * (`../generation/pipeline.js`) for the one production caller that does.
   */
  readonly purpose?: GenerationPurpose;
  /**
   * `[D-188]`'s register hint. Meaningful only alongside `purpose:
   * 'readiness'` — sent without it, the service ignores it (see
   * `quizGenerateRequest`'s own doc, private), so a caller that always
   * assembles both need not conditionally omit this one.
   */
  readonly registerHint?: RegisterHint;
  /**
   * `[D-437]` — the mapping of the practice need's ask, set ONLY by a caller whose routing
   * (`olea-core`'s `routeDemandAsk`) came out `served` for this generator; the caller's
   * `authoringDemandFields(routing)` is the one way to build this and `requestedAsk` below, so an
   * unserved, deferred or underspecified ask sends neither (design §4.2). Sent on the request, and
   * also handed to retrieval as the sufficiency judge's operation (`demandToJudgeOperation`:
   * stratification only, until `[D-289]`'s wire change). Absent: the request and the judge call are
   * exactly what they were before this field existed.
   */
  readonly intendedDemand?: AuthoringDemand;
  /** `[D-437]`, row 35 — the heading as she wrote it and its question word; see `QuizGenerateRequestPayload.requestedAsk`. */
  readonly requestedAsk?: AuthoringRequestedAsk;
}

export type DraftQuizCardsResult =
  | {
      readonly status: 'refused';
      /**
       * Which `GroundingRefusalReason` fired, kept as its own value end to end
       * (`[D-441]`, ruled 2026-09-29): a caller surfacing this to her must not
       * flatten reasons that mean different things. Only `'judge-rejected'` is
       * a checked insufficiency (the judge read the query and the passages).
       * `'no-hits'` and `'below-relevance-threshold'` are a retrieval failure;
       * `'below-composite-threshold'` and `'below-band'` are threshold-blocked,
       * not assessed (decided from numbers with nothing sent); and
       * `'composite-check-unavailable'`, `'judge-unavailable'` mean the check
       * could not run (`ol-riwn`, `[D-089]`). None of these but the first may be
       * worded as "your notes don't cover this". `draft-cards-copy.ts`'s
       * `describeRefusal` is the one mapping from reason to words.
       */
      readonly reason: GroundingRefusalReason;
    }
  | {
      readonly status: 'drafted';
      readonly request: QuizGenerateRequestPayload;
      /** The Worker's raw `/v1/task` response body, whatever it was — success or a well-formed `ErrorResponse` (see `WorkerTaskTransport`'s own contract). Never persisted here (D-005); a caller that wants to act on it narrows/validates it itself. */
      readonly response: unknown;
    };

export interface DraftQuizCardsDeps {
  /** Everything `retrieve()` needs — assembled by the caller from `RetrievalWiring` (`wiring.ts`) plus the live keyword index, since that join is `main.ts`'s composition-root job, not this module's. */
  readonly retrieve: RetrieveDeps;
  /** Sends the `quiz.generate.v1` envelope. The SAME transport instance `RetrievalWiring.transport` exposes is the intended one — see that field's doc — but any `WorkerTaskTransport` works, which is what makes this testable without a real Worker. */
  readonly transport: WorkerTaskTransport;
  /**
   * `[D-101]`'s passage classification, injected the same opt-in way
   * `pipeline.ts`'s `deps.routing` is (see the module doc's PERSONALIZATION
   * CONTEXT section) — absent today because the classifier has no
   * production implementation, and every real caller of this function
   * currently supplies nothing. Returning `undefined` for a chunk is
   * equivalent to `{authorship: 'unknown', curationAuthority: 'unknown'}`.
   */
  /** `ol-egov.141.89.8.56`: cached frontmatter, so a `.md` that declares a transcript role is recognised as one. Absent: only `.txt`, `.vtt` and `.srt` are. */
  readonly frontmatterHost?: SourceOriginFrontmatterHost;
  readonly classifyPassage?: (chunk: { readonly path: string; readonly text: string }) =>
    | {
        readonly authorship: PassageAuthorship;
        readonly curationAuthority: PassageCurationAuthority;
      }
    | undefined;
  /**
   * `[JEV-11]` (`ol-3ux7.96`) — records which of `retrieve()`'s band-gate
   * stages decided this call, when `retrieve()` is run with a `band` (this
   * function always passes `D112_GROUNDING_BAND`, so this fires on every
   * call once supplied). Recording only: this function's control flow does
   * not change whether or not a recorder is supplied, and a call made
   * without one behaves byte-identically to before this field existed.
   *
   * **Lifetime, deliberately not decided here.** A recorder passed fresh per
   * call would count exactly one event and answer nothing about a share; a
   * recorder held in a module-level variable in this file would be shared
   * state living outside any composition root's control, indistinguishable
   * from the server-side state this project's execution model forbids
   * (`docs/Olea_architecture_boundary.md` §1, private repo). Neither is this
   * function's call to make. The right home is a single instance that lives
   * as long as whatever assembles `DraftQuizCardsDeps` does — the plugin
   * session, in production — constructed once there and threaded through on
   * every call, the same way `deps.transport` already is. This field exists
   * so that composition root has somewhere to plug it in; it does not itself
   * pick where that instance is constructed.
   */
  readonly onStage?: (stage: GateStage) => void;
  /**
   * `[JEV-6]` (`ol-3ux7.89`) — the real-population case capture's hook, with
   * exactly the same ownership argument as `onStage` above: this function
   * does not decide where the recorder lives, it only gives the composition
   * root somewhere to plug one in.
   *
   * **Absent in every ordinary session.** `main.ts` supplies it only when
   * the hand-edited capture config says so (`./judge-case-capture.ts`), so
   * the default path is byte-identical to having no capture at all — and
   * unlike `onStage`, which fires on every call, this one fires only for the
   * requests that actually reach the grounding judge, which is the operating
   * population the study is defined over. Pointers only, never passages:
   * `JudgeRequestRecord` has no field a passage could arrive in.
   */
  readonly onJudgeRequest?: (record: JudgeRequestRecord) => void;
}

/**
 * Drafts `quiz.generate.v1` questions for one concept, refusing before any
 * generative call unless `request.conceptName` clears `[D-089]`'s
 * two-threshold band against her indexed material, at the operating point
 * `[D-112]` ratified (no composite veto: `[D-449]`) — and then the
 * sufficiency judge says the passages support it (`[D-442]`: at or above the
 * lower bar the judge is always consulted, the upper bar no longer skips it).
 *
 * `band: D112_GROUNDING_BAND` is passed EXPLICITLY on every call — never
 * omitted in favour of `retrieve`'s own default (no band at all, per
 * `groundedContext.ts`'s own doc: there is no default operating point that
 * can be in force by accident). That explicitness is what
 * `draft-quiz-cards.spec.ts`'s N-013 test pins: the same below-band fixture,
 * retrieved again with no `band` option, grounds — proving this call site's
 * explicit band is the only thing standing between "refuses" and "never
 * refuses" for that input. No composite option is passed (`[D-449]`; see the
 * module doc's "NO COMPOSITE VETO FOR DRAFTING" section). `judge: new WorkerGroundingJudge({ transport:
 * deps.transport })` is constructed fresh per call — it is stateless and
 * holds only the transport reference `deps` already carries, so there is
 * nothing to gain from constructing it once and caching it here.
 */
export async function draftQuizCardsForConcept(
  deps: DraftQuizCardsDeps,
  request: DraftQuizCardsRequest,
): Promise<DraftQuizCardsResult> {
  // `ol-egov.141.89.1.47`: typed, and every field written out as a property, so an option
  // `retrieve()` does not declare is a compile error here. A conditional spread of the recorder
  // was silently dropped for as long as `RetrieveOptions` lacked the field.
  const retrieveOptions: RetrieveOptions = {
    band: D112_GROUNDING_BAND,
    judge: new WorkerGroundingJudge({ transport: deps.transport }),
    onStage: deps.onStage,
    onJudgeRequest: deps.onJudgeRequest,
    // `[D-437]`: the need's demand as the judge's operation, when it has one (a printed-result
    // reading has none) and only for a need that carried a demand at all.
    intendedOperation:
      request.intendedDemand === undefined
        ? undefined
        : demandToJudgeOperation(request.intendedDemand),
  };
  const grounding = await retrieve(deps.retrieve, request.conceptName, retrieveOptions);

  if (grounding.status === 'refused') {
    // THE load-bearing line (see module doc): the GENERATIVE `transport.send`
    // call (`quiz.generate.v1`) never happens, or ever will for this call,
    // once we are here — whatever the reason, including a band escalation
    // that DID send the query and passages to the judge (`grounding.judge.v1`)
    // and was refused. A refused retrieval reaches the caller as
    // `{status: 'refused', reason}` and nothing else — not an empty
    // `drafted` result, which would be indistinguishable from a generation
    // that legitimately produced zero questions.
    return { status: 'refused', reason: grounding.reason };
  }

  // F3.8 (`[D-101]`) — see the module doc's PERSONALIZATION CONTEXT section.
  // `deps.classifyPassage` degrades to `'unknown'`/`'unknown'` for every
  // chunk when absent, which is today's honest default: `[D-101]`'s
  // classifier is not wired anywhere yet.
  const classifiedPassages: ClassifiedPassage[] = grounding.chunks.map((chunk) => {
    const classified = deps.classifyPassage?.(chunk);
    return {
      text: chunk.text,
      authorship: classified?.authorship ?? 'unknown',
      curationAuthority: classified?.curationAuthority ?? 'unknown',
    };
  });
  const voiceExemplars = assembleVoiceExemplars(classifiedPassages);

  const payload: QuizGenerateRequestPayload = {
    courseCode: request.courseCode,
    conceptName: request.conceptName,
    sourceChunks: grounding.chunks.map((chunk) => chunk.text),
    // `ol-egov.141.89.8.56` (D-465): aligned origins when a chunk is a supplied transcript; omitted otherwise.
    ...sourceChunkOriginsFragment(grounding.chunks, deps.frontmatterHost),
    ...(request.questionCount === undefined ? {} : { questionCount: request.questionCount }),
    personalization: { voiceExemplars },
    // `[D-188]` / `ol-0r92.35`: passed through verbatim, never decided here —
    // `exactOptionalPropertyTypes` forbids an explicit `undefined`, so both
    // keys are omitted entirely when the caller didn't set them, the same
    // discipline `questionCount` above already uses.
    ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
    ...(request.registerHint === undefined ? {} : { registerHint: request.registerHint }),
    // `[D-437]`: passed through verbatim, never decided here (the caller's routing decides), and
    // omitted entirely when absent so the request stays byte-identical for every caller that
    // carries no demand.
    ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
    ...(request.requestedAsk === undefined ? {} : { requestedAsk: request.requestedAsk }),
  };

  const response = await deps.transport.send({
    contractVersion: CONTRACT_VERSION,
    taskId: TASK_IDS.QUIZ_GENERATE,
    payload,
  });

  return { status: 'drafted', request: payload, response };
}
