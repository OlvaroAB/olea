/**
 * `WorkerExplainWhyGenerator` — the production `ExplainWhyPort` for F2.7
 * ("Explain why I got this wrong", `features/F2-review.md:287` in
 * `olea-service`, cited by path per INV-3). `ol-p3t08` closed the
 * service-side half of `ol-rem6` (registering `explain-why.generate.v1` in
 * `olea-service`); this file is the client-side caller that gives that task
 * id its first real caller, closing the other half.
 *
 * **F2.7 has two halves, and this file is only one of them** — the same
 * split this repo's own `packages/workbench/src/explain/ground.ts` module
 * doc draws (see that file for the retrieval half, already built):
 *
 * - The GROUNDING half — turning a wrong answer into a set of quoted,
 *   citeable source passages — is `packages/core/src/retrieval/engine.ts`'s
 *   `retrieve()` (and, where a live grounding judge is wired, `groundedContext
 *   .ts`'s `resolveGroundedContext`). Composing that against a real vault,
 *   embedding provider and grounding judge is NOT this file's job, and is
 *   not done here — see the lane report for exactly what remains.
 * - The PROSE half — turning grounded source chunks into an actual
 *   explanation of why the correct answer is correct — is
 *   `explain-why.generate.v1`, the Worker task this class calls. That is
 *   this file's whole job.
 *
 * Shaped like `../retrieval/workerGroundingJudge.ts`'s `WorkerGroundingJudge`
 * and `olea-core`'s `createWorkerJudgeCaller` (`grading/workerJudgeCaller.ts`):
 * build the frozen envelope, send it through an injected `WorkerTaskTransport`,
 * turn whatever comes back into a checked shape. No retry, no fallback, no
 * state — those live at the transport/composition layer, per the same
 * precedent.
 *
 * **Grounding is enforced by the Worker, not re-checked here** — unlike
 * `createWorkerJudgeCaller`'s explicit "grounding is deliberately not done
 * here" (which hands the job to `gradeExplainBack`'s `groundCitations`),
 * `explain-why.generate.v1` carries a REQUIRED grounding contract server-side
 * (`olea-service/src/tasks/explainWhyGenerate.ts`'s `groundExplanation`) and
 * never returns a citation it cannot verify against the `sourceChunks` this
 * class sent. So `readOutcome` below only ever needs to read the shape, not
 * re-verify a citation against a copy of the request.
 *
 * **`explanations: []` is the refusal, not an error** — same "zero is the
 * refusal" idiom the Worker task's own doc establishes. `ExplainWhyOutcome`
 * makes that a checked union rather than an empty-array convention leaking
 * into every caller.
 */

import type { WorkerTaskTransport } from 'olea-core';
import type { ReviewInstrument } from './types.js';

/** `TASK_IDS.EXPLAIN_WHY_GENERATE`, mirrored — see the module doc for why it is not imported. */
export const EXPLAIN_WHY_GENERATE_TASK_ID = 'explain-why.generate.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms. */
export const EXPLAIN_WHY_GENERATE_CONTRACT_VERSION = 2;

/**
 * What the Worker needs to produce an explanation. `sourceChunks` is
 * transient grounding context (D-005) — the caller's own retrieved passage
 * text, never a note or block id — and is this class's caller's
 * responsibility to supply; see the module doc.
 */
export interface ExplainWhyRequest {
  readonly courseCode: string;
  readonly question: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
  readonly sourceChunks: readonly string[];
}

/** F2.7: at most one explanation. `refused` is the array-length-zero case, named rather than left implicit. */
export type ExplainWhyOutcome =
  | { readonly refused: true }
  | { readonly refused: false; readonly text: string; readonly citedChunkIndex: number };

export interface ExplainWhyPort {
  explainWhy(request: ExplainWhyRequest): Promise<ExplainWhyOutcome>;
}

/**
 * Anything that went wrong reaching the Worker or reading its reply.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, `undefined` otherwise.
 */
export class WorkerExplainWhyError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerExplainWhyError';
    this.code = code;
  }
}

export interface WorkerExplainWhyGeneratorDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerExplainWhyGenerator implements ExplainWhyPort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerExplainWhyGeneratorDeps) {
    this.transport = deps.transport;
  }

  async explainWhy(request: ExplainWhyRequest): Promise<ExplainWhyOutcome> {
    const body = await this.transport.send({
      contractVersion: EXPLAIN_WHY_GENERATE_CONTRACT_VERSION,
      taskId: EXPLAIN_WHY_GENERATE_TASK_ID,
      payload: {
        courseCode: request.courseCode,
        question: request.question,
        studentAnswer: request.studentAnswer,
        correctAnswer: request.correctAnswer,
        sourceChunks: [...request.sourceChunks],
      },
    });
    return readOutcome(body);
  }
}

function readOutcome(body: unknown): ExplainWhyOutcome {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerExplainWhyError(
      `WorkerExplainWhyGenerator: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  if (typeof result !== 'object' || result === null) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response carried no `result` object.',
    );
  }
  const explanations = (result as Record<string, unknown>)['explanations'];
  if (!Array.isArray(explanations)) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response carried no `explanations` array.',
    );
  }
  if (explanations.length === 0) {
    return { refused: true };
  }

  const first = explanations[0] as Record<string, unknown>;
  const text = first['text'];
  const citedChunkIndex = first['citedChunkIndex'];
  if (typeof text !== 'string' || text.length === 0) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response carried no non-empty `text`.',
    );
  }
  if (
    typeof citedChunkIndex !== 'number' ||
    !Number.isInteger(citedChunkIndex) ||
    citedChunkIndex < 1
  ) {
    throw new WorkerExplainWhyError(
      'WorkerExplainWhyGenerator: the Worker response carried no valid `citedChunkIndex`.',
    );
  }

  return { refused: false, text, citedChunkIndex };
}

/**
 * Composes an `ExplainWhyRequest` from a review instrument and her answer —
 * the "hook" F2.7's on-demand trigger calls into. Pure: no I/O, no port call.
 *
 * `studentAnswer` is `''` for Q&A/cloze (the review view never captures typed
 * text for those instrument types — she self-rates instead) unless the
 * caller has something better to offer; MCQ carries a real selected label.
 * F2.20's "Available help ... stays available at every stage, to every
 * concept, regardless of how well she knows it" is why this is never gated
 * on whether the answer was actually wrong — see this file's module doc.
 */
export function buildExplainWhyRequest(
  instrument: ReviewInstrument,
  studentAnswer: string,
  sourceChunks: readonly string[],
): ExplainWhyRequest {
  const { question, correctAnswer } = questionAndCorrectAnswer(instrument);
  return {
    courseCode: instrument.courseCode,
    question,
    studentAnswer,
    correctAnswer,
    sourceChunks: [...sourceChunks],
  };
}

function questionAndCorrectAnswer(instrument: ReviewInstrument): {
  question: string;
  correctAnswer: string;
} {
  switch (instrument.type) {
    case 'qa':
      return { question: instrument.question, correctAnswer: instrument.answer };
    case 'cloze':
      return {
        question: `${instrument.before}____${instrument.after}`,
        correctAnswer: instrument.clozeText,
      };
    case 'mcq': {
      const correct = instrument.options.find((option) => option.correct);
      return {
        question: instrument.stem,
        correctAnswer: correct?.label ?? '(no correct option recorded)',
      };
    }
  }
}
