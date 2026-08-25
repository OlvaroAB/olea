/**
 * `WorkerGroundingJudge` — the production `GroundingJudgePort` (`[D-089]`,
 * `[D-112]`, `[WIRE-5]` / `ol-i0y6`).
 *
 * `packages/core/src/retrieval/groundedContext.ts` defines the port
 * (`GroundingJudgePort`) that the band's `resolveGroundedContext` escalates
 * through; until this file existed nothing implemented it outside a test
 * fake — the wiring register's `GroundingJudgePort` row named exactly this
 * gap, deferred until `[D-112]` (`ol-oqip`) closed. This class turns a
 * `GroundingJudgeRequest` into `grounding.judge.v1`'s frozen envelope, sends
 * it through an injected `WorkerTaskTransport`, and turns the response back
 * into a `GroundingJudgeVerdict` — same seam, same shape,
 * `packages/plugin/src/concept/workerConceptReader.ts`'s `WorkerConceptReader`
 * one level over. This module deliberately follows that file's pattern (per
 * `ol-i0y6`'s own brief) rather than `packages/core/src/grading/
 * workerJudgeCaller.ts`'s factory-function shape — a class implementing the
 * port directly, since `GroundingJudgePort` is itself a one-method interface
 * rather than a bare function type, exactly `ConceptReaderPort`'s shape.
 *
 * **Fail closed, never open (F7.8, `[D-089]` §5).** `resolveGroundedContext`
 * already treats a throw, a timeout, or an unusable shape from `judge()` as
 * `judge-unavailable` — a refusal, never a generation
 * (`judgeWithinBudget` in `groundedContext.ts`). This class's whole job is to
 * make "unusable" a narrow, checked set (an object, a boolean `supported`, a
 * non-empty string `reason`) rather than to itself decide anything about
 * availability: throwing on anything else is what lets the caller's own
 * fail-closed rule do its job. There is deliberately no retry and no
 * fallback path here — the port throws or resolves once per call, and the
 * band's timeout wrapper is what turns "too slow" into a refusal.
 *
 * **Why the task id and contract version are local constants** — same
 * reasoning `workerConceptReader.ts` gives, restated for this seam:
 * `olea-contracts`' `main` points at TypeScript source, so a value import
 * would make this module unloadable from a plain Node process running
 * `packages/core` or `packages/plugin`'s built output.
 * `workerGroundingJudge.spec.ts` asserts both constants equal the frozen
 * catalogue's, the same way `workerConceptReader.spec.ts` does for
 * `concepts.extract.v1`.
 */

import type {
  GroundingJudgePort,
  GroundingJudgeRequest,
  GroundingJudgeVerdict,
  WorkerTaskTransport,
} from 'olea-core';

/** `TASK_IDS.GROUNDING_JUDGE`, mirrored — see the module doc. Pinned by `workerGroundingJudge.spec.ts`. */
export const GROUNDING_JUDGE_TASK_ID = 'grounding.judge.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const GROUNDING_JUDGE_CONTRACT_VERSION = 1;

/**
 * Anything that went wrong reaching the Worker or reading its reply.
 * `resolveGroundedContext` catches every throw from `judge()` and turns it
 * into `judge-unavailable` (fail closed) — this class does not need to
 * distinguish reasons the way `WorkerConceptReaderError` does, because the
 * band path has exactly one thing to do with any failure here.
 */
export class WorkerGroundingJudgeError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerGroundingJudgeError';
    this.code = code;
  }
}

export interface WorkerGroundingJudgeDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerGroundingJudge implements GroundingJudgePort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerGroundingJudgeDeps) {
    this.transport = deps.transport;
  }

  async judge(request: GroundingJudgeRequest): Promise<GroundingJudgeVerdict> {
    const body = await this.transport.send({
      contractVersion: GROUNDING_JUDGE_CONTRACT_VERSION,
      taskId: GROUNDING_JUDGE_TASK_ID,
      payload: { query: request.query, context: request.context },
    });
    return readVerdict(body);
  }
}

function readVerdict(body: unknown): GroundingJudgeVerdict {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerGroundingJudgeError(
      'WorkerGroundingJudge: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerGroundingJudgeError(
      `WorkerGroundingJudge: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerGroundingJudgeError(
      'WorkerGroundingJudge: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  if (typeof result !== 'object' || result === null) {
    throw new WorkerGroundingJudgeError(
      'WorkerGroundingJudge: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const supported = r['supported'];
  if (typeof supported !== 'boolean') {
    throw new WorkerGroundingJudgeError(
      'WorkerGroundingJudge: the Worker response carried no boolean `supported`.',
    );
  }
  const reason = r['reason'];
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new WorkerGroundingJudgeError(
      'WorkerGroundingJudge: the Worker response carried no reason text.',
    );
  }

  return { supported, reason };
}
