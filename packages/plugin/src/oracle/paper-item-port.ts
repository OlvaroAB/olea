/**
 * `createWorkerPaperItemGenerationPort` — the composition-root implementation of
 * `PaperItemGenerationPort` (`olea-core`'s `oracle/paper-items.ts`), F4.11's practice-paper
 * pipeline (`[D-250]`/`[D-252]`, component register row 2.11, `[H-blueprint]` / `ol-0r92.75`).
 *
 * **Reachability, stated plainly (`[D-072]` clause 5).** This file composes the port; NOTHING
 * calls it yet. `main.ts` is deliberately untouched by this bead — the surfaces that would call a
 * practice-paper pipeline (the course-page affordance, the paper view, the steering dials) are a
 * separate lane's job (DP-7, `[D-255]`'s ratified unlock numbers) and no product surface exists
 * for F4.11 today (`docs/dev/surface-register.md`'s F4.11 entry, private repo, stays prose-only).
 * This mirrors the same "reachability deferred, documented rather than silently absent" posture
 * `../retrieval/classify-passage.ts` and `../generation/pipeline.ts`'s `deps.formatMatch` already
 * hold for a composed-but-unwired seam.
 *
 * **Why this is a NEW file rather than a call to `draftQuizCardsForConcept`
 * (`../retrieval/draft-quiz-cards.ts`).** That function does its own retrieval — it turns a
 * concept NAME into grounding chunks via `retrieve()`. A blueprint slot has already chosen its
 * grounding (the composition, not a fresh nearest-neighbour search, decided which held source
 * fills a slot — see `olea-core`'s `oracle/paper-items.ts` module doc) and `cards.generate.v1`
 * (the `written`/`practical` route) has no client-side drafting call in this repo at all today
 * (confirmed by search before writing this file). So this port sends the ALREADY-CHOSEN
 * `sourceChunks` straight through `WorkerTaskTransport`, the same low-level seam
 * `WorkerEmbeddingProvider` (`olea-core`'s `retrieval/workerProvider.ts`) already uses — no
 * retrieval, no prompt, no model-selection logic on this side of the wire.
 *
 * **No prompt is written here.** `payload` is exactly the shape `cards.generate.v1` /
 * `quiz.generate.v1` already validate server-side (`olea-service/src/tasks/*.ts`, private) — this
 * file only assembles the envelope `WorkerTaskTransport.send` posts to `/v1/task`; the prompt text
 * lives entirely in the private repo's prompt files, never here.
 *
 * **Refusal handling.** `WorkerTaskTransport.send`'s own contract (`workerProvider.ts`) is "return
 * the parsed JSON body whatever the status code... throw only when there is genuinely no body."
 * This port reads a well-formed `ErrorResponse` shape (`{ success: false, error: { code, message }
 * }`, `olea-contracts`' `errorResponse`) as a `'refused'` result — carrying the Worker's own error
 * `code` as the reason — rather than a thrown exception, matching `PaperItemGenerationResult`'s
 * own "both a port that could not attempt the call and a generator's own refusal" contract
 * (`olea-core`'s doc). A transport that itself throws (network failure, unparsable body) is left
 * to propagate — this port does not swallow a genuine transport failure into a false "refused".
 */

import { CONTRACT_VERSION } from 'olea-contracts';
import type {
  PaperItemGenerationPort,
  PaperItemGenerationRequest,
  PaperItemGenerationResult,
  WorkerTaskTransport,
} from 'olea-core';

export interface WorkerPaperItemGenerationPortDeps {
  readonly transport: WorkerTaskTransport;
}

function isWellFormedErrorResponse(body: unknown): body is {
  readonly success: false;
  readonly error: { readonly code: string; readonly message?: string };
} {
  if (typeof body !== 'object' || body === null) return false;
  const v = body as Record<string, unknown>;
  if (v.success !== false) return false;
  if (typeof v.error !== 'object' || v.error === null) return false;
  return typeof (v.error as Record<string, unknown>).code === 'string';
}

/**
 * Builds the `/v1/task` payload `cards.generate.v1`/`quiz.generate.v1` expect — field-for-field
 * the same shape `draft-quiz-cards.ts`'s `QuizGenerateRequestPayload` restates for its own call,
 * minus `personalization`/`registerHint` (F3.8/`[D-188]`'s per-concept context, out of scope for
 * this bead's own `owns` — a follow-on may thread it through once a caller has both this port and
 * that context in hand at the same call site).
 */
function toWorkerPayload(request: PaperItemGenerationRequest): unknown {
  return {
    courseCode: request.courseCode,
    conceptName: request.conceptName,
    sourceChunks: [...request.sourceChunks],
    purpose: request.purpose,
  };
}

/** The real `PaperItemGenerationPort` — composed here, not exported through `main.ts` (see the module doc's reachability note). */
export function createWorkerPaperItemGenerationPort(
  deps: WorkerPaperItemGenerationPortDeps,
): PaperItemGenerationPort {
  return async function workerPaperItemGenerationPort(
    request: PaperItemGenerationRequest,
  ): Promise<PaperItemGenerationResult> {
    const body = await deps.transport.send({
      contractVersion: CONTRACT_VERSION,
      taskId: request.taskId,
      payload: toWorkerPayload(request),
    });

    if (isWellFormedErrorResponse(body)) {
      return { status: 'refused', reason: body.error.code };
    }

    return {
      status: 'generated',
      taskId: request.taskId,
      // The Worker's own response envelope carries `promptVersion` on success
      // (`olea-contracts`' `successResponse`/`responseStamp`); read defensively rather than
      // assuming a shape this package has no schema dependency on (same restraint
      // `draft-quiz-cards.ts`'s own doc states for not validating the response here).
      promptVersion:
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Record<string, unknown>).promptVersion === 'string'
          ? ((body as Record<string, unknown>).promptVersion as string)
          : 'unknown',
      response: body,
    };
  };
}
