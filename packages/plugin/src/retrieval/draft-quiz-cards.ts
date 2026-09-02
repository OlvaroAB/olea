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
 * `[D-112]` (`ol-oqip`) ratified — see "THE BAND SWITCH" below — for the
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
 * ===========================================================================
 * THE COMPOSITE LOWER-BAR VETO (`[D-192]` / `ol-0r92.39`)
 * ===========================================================================
 * This call site ALSO passes `requireComposite: true` with
 * `compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS`
 * (`packages/core/src/retrieval/compositeSignals.ts`), composed with the band
 * above rather than a replacement for it — `retrieve()`'s own doc on `band`
 * says the two now compose per `[D-192]`, superseding the earlier
 * mutually-exclusive posture this comment used to describe. The composite
 * runs as an ADDITIONAL veto ahead of `D112_GROUNDING_BAND`'s own
 * classification: a query whose composite signals miss the ratified lower
 * bar refuses (`below-composite-threshold`) before the band or the judge
 * ever sees it, at the measured point 14/20 refused, 0/40 false refusals
 * (`eval/THRESHOLDS.md`'s composite section, `olea-service`, private).
 * Veto-only, provisional: it can never grant a pass on its own, so a query
 * the composite does not refuse still goes through `D112_GROUNDING_BAND`'s
 * band/judge path exactly as before this bead.
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
 * `payload.personalization.styleProfile` is `olea-core`'s
 * `DEFAULT_STYLE_PROFILE` — F3.9's own declared numbers from the functional
 * scope clause — until a real per-student card-corpus feed exists
 * (`computeStyleProfile` is built and tested for that day; nothing here
 * calls it yet because nothing here reads her card corpus). Neither ever
 * affects the grounding decision above: an empty-context refusal happens
 * before this section runs.
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

import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
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
  type GroundingRefusalReason,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  type RetrieveDeps,
  retrieve,
} from 'olea-core';
import { WorkerGroundingJudge } from './workerGroundingJudge.js';

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
 * `personalization` field one-for-one.
 */
export interface QuizGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  readonly questionCount?: number;
  readonly personalization?: {
    readonly voiceExemplars: VoiceExemplars;
  };
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
  }[];
}

export interface DraftQuizCardsRequest {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly questionCount?: number;
}

export type DraftQuizCardsResult =
  | {
      readonly status: 'refused';
      /** Which `GroundingRefusalReason` fired — since the band switch this includes `'below-band'`, `'judge-rejected'` and `'judge-unavailable'` alongside the single-gate reasons, and since `[D-192]`'s composite veto this also includes `'below-composite-threshold'` (the composite's own lower-bar refusal, reached before the band or the judge ever run). `ol-riwn`'s transient reasons (`'composite-check-unavailable'`, `'judge-unavailable'`) distinguish "we could not check" from "checked and found nothing," and a caller surfacing this to her must keep that distinction rather than collapsing both into one "your notes don't cover this" message ([D-089]). */
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
  readonly classifyPassage?: (chunk: { readonly path: string; readonly text: string }) =>
    | {
        readonly authorship: PassageAuthorship;
        readonly curationAuthority: PassageCurationAuthority;
      }
    | undefined;
}

/**
 * Drafts `quiz.generate.v1` questions for one concept, refusing before any
 * generative call unless `request.conceptName` clears BOTH: `[D-192]`'s
 * composite lower-bar veto (`RECOMMENDED_COMPOSITE_THRESHOLDS`) checked
 * first, and `[D-089]`'s two-threshold band against her indexed material, at
 * the operating point `[D-112]` ratified, checked after.
 *
 * `band: D112_GROUNDING_BAND` is passed EXPLICITLY on every call — never
 * omitted in favour of `retrieve`'s own default (no band at all, per
 * `groundedContext.ts`'s own doc: there is no default operating point that
 * can be in force by accident). That explicitness is what
 * `draft-quiz-cards.spec.ts`'s N-013 test pins: the same below-band fixture,
 * retrieved again with no `band` option, grounds — proving this call site's
 * explicit band is the only thing standing between "refuses" and "never
 * refuses" for that input. `requireComposite: true` with
 * `compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS` is passed
 * alongside it for the same reason, per `[D-192]` (see the module doc's "THE
 * COMPOSITE LOWER-BAR VETO" section) — composing rather than choosing one
 * mechanism over the other. `judge: new WorkerGroundingJudge({ transport:
 * deps.transport })` is constructed fresh per call — it is stateless and
 * holds only the transport reference `deps` already carries, so there is
 * nothing to gain from constructing it once and caching it here.
 */
export async function draftQuizCardsForConcept(
  deps: DraftQuizCardsDeps,
  request: DraftQuizCardsRequest,
): Promise<DraftQuizCardsResult> {
  const grounding = await retrieve(deps.retrieve, request.conceptName, {
    band: D112_GROUNDING_BAND,
    requireComposite: true,
    compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
    judge: new WorkerGroundingJudge({ transport: deps.transport }),
  });

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
    ...(request.questionCount === undefined ? {} : { questionCount: request.questionCount }),
    personalization: { voiceExemplars },
  };

  const response = await deps.transport.send({
    contractVersion: CONTRACT_VERSION,
    taskId: TASK_IDS.QUIZ_GENERATE,
    payload,
  });

  return { status: 'drafted', request: payload, response };
}
