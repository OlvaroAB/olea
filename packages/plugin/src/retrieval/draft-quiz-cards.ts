/**
 * `draftQuizCardsForConcept` — the production caller for `retrieve()` /
 * `assembleGroundedContext` (`ol-odb0`, `ol-odb0.2`).
 *
 * **What this file exists to close.** Before it existed, the only non-test,
 * non-mock reference to `retrieve`, `hybridRetrieve` or
 * `computeCompositeGroundingSignals` anywhere in either repo was `olea-core`'s
 * own re-export of them (`ol-odb0`'s diagnosis). `requireComposite` is
 * opt-in by construction (`groundedContext.ts`'s own doc), so ratifying
 * `[D-042]`'s operating point did not by itself change what the alpha user
 * experiences — this is the caller that makes it real: it calls `retrieve()`
 * with `requireComposite: true` and `RECOMMENDED_COMPOSITE_THRESHOLDS`
 * passed EXPLICITLY (never relying on `assembleGroundedContext`'s own
 * default for that option), for the card-drafting flow through
 * `quiz.generate.v1` the bead's own notes name as the chosen destination.
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
import type { WorkerTaskTransport } from 'olea-core';
import {
  type GroundingRefusalReason,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  type RetrieveDeps,
  retrieve,
} from 'olea-core';

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
 * `questionCount` is optional.
 */
export interface QuizGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  readonly questionCount?: number;
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
      /** Which of `GroundingRefusalReason`'s four cases fired — `ol-riwn`'s `composite-check-unavailable` distinguishes "we could not check" from "checked and found nothing," and a caller surfacing this to her must keep that distinction rather than collapsing both into one "your notes don't cover this" message ([D-089]). */
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
}

/**
 * Drafts `quiz.generate.v1` questions for one concept, refusing before any
 * generative call when `request.conceptName` does not clear `[D-042]`'s
 * ratified composite operating point against her indexed material.
 *
 * `requireComposite: true` and `compositeThresholds:
 * RECOMMENDED_COMPOSITE_THRESHOLDS` are passed EXPLICITLY on every call —
 * never omitted in favour of `retrieve`'s own default (`false`) or
 * `assembleGroundedContext`'s own default threshold value. That explicitness
 * is what `draft-quiz-cards.spec.ts`'s N-013 test pins: the same fixture,
 * retrieved again with `requireComposite: false`, grounds — proving this
 * call site's explicit `true` is the only thing standing between "refuses"
 * and "never refuses" for that input.
 */
export async function draftQuizCardsForConcept(
  deps: DraftQuizCardsDeps,
  request: DraftQuizCardsRequest,
): Promise<DraftQuizCardsResult> {
  const grounding = await retrieve(deps.retrieve, request.conceptName, {
    requireComposite: true,
    compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
  });

  if (grounding.status === 'refused') {
    // THE load-bearing line (see module doc): no `transport.send` call has
    // happened, or ever will for this call, once we are here. A refused
    // retrieval reaches the caller as `{status: 'refused', reason}` and
    // nothing else — not an empty `drafted` result, which would be
    // indistinguishable from a generation that legitimately produced zero
    // questions.
    return { status: 'refused', reason: grounding.reason };
  }

  const payload: QuizGenerateRequestPayload = {
    courseCode: request.courseCode,
    conceptName: request.conceptName,
    sourceChunks: grounding.chunks.map((chunk) => chunk.text),
    ...(request.questionCount === undefined ? {} : { questionCount: request.questionCount }),
  };

  const response = await deps.transport.send({
    contractVersion: CONTRACT_VERSION,
    taskId: TASK_IDS.QUIZ_GENERATE,
    payload,
  });

  return { status: 'drafted', request: payload, response };
}
