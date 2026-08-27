/**
 * `WorkerMaterialityJudge` — the production `MaterialityJudge` for register
 * row 1.4's paid second stage (`TRG-1`, `ol-tqy3`, `ol-2zfj.15`,
 * `ol-2zfj.18`).
 *
 * `types.ts` defines the `MaterialityJudge` *port*; until this file existed,
 * nothing in either repo implemented it outside `wiring.ts`'s own `null`
 * default, so `MaterialityTrigger.evaluate` could only ever report
 * `'judge-unavailable'` for anything that cleared the free hash/debounce/
 * floor gates. This is that implementation: it turns a `MaterialityJudgeInput`
 * into the Worker's `materiality.judge.v1` envelope, sends it through an
 * injected transport, and turns the response back into a
 * `MaterialityJudgeVerdict`.
 *
 * Shaped like `../../review/explainWhy.ts`'s `WorkerExplainWhyGenerator` and
 * `../../retrieval/workerProvider.ts`'s `WorkerEmbeddingProvider`: build the
 * frozen envelope, send it through an injected `WorkerTaskTransport`, turn
 * whatever comes back into a checked shape. No retry, no fallback, no
 * caching, no state — those live at the transport/composition layer, per the
 * same precedent. **It still makes no network call itself** — the plugin
 * supplies the transport over Obsidian's `requestUrl` (C1.6, INV-1), the same
 * seam every other Worker caller in this package is injected through.
 *
 * ===========================================================================
 * OFFLINE / UNAVAILABLE DEGRADES EXACTLY AS THE EXISTING JUDGE-UNAVAILABLE
 * PATH — READ BEFORE ADDING A SECOND FALLBACK HERE
 * ===========================================================================
 * `MaterialityTrigger.evaluate` (`wiring.ts`) already has the "no route, no
 * verdict" contract: when `deps.judge` is `null`, a change that clears every
 * free gate reports `{ kind: 'judge-unavailable' }` rather than fabricating a
 * verdict or throwing. This class does **not** duplicate that decision —
 * `main.ts`'s wiring is what decides whether to construct one at all, on the
 * SAME F7.8 unconfigured-Worker condition `buildExplainWhyPort` already uses
 * (no token pasted yet ⇒ no transport ⇒ pass `judge: null` into
 * `buildMaterialityWiring`, exactly the pre-`ol-2zfj.18` state). So the only
 * new failure surface this class introduces is a **configured** Worker that
 * fails or answers unusably mid-call (network drop, malformed body, a
 * refusal). It never swallows that into a manufactured verdict: it throws
 * `WorkerMaterialityJudgeError`, the same shape every sibling Worker caller
 * uses, and `main.ts`'s `evaluateMaterialityChange` already wraps the whole
 * `this.materiality.evaluate(...)` call in a catch that logs and returns —
 * the identical non-fatal outcome a `'judge-unavailable'` result would have
 * had (no verdict committed, no crash, the next evaluation is unaffected).
 * Two different causes, one indistinguishable-to-the-student effect: this
 * change is silently not reflected in her instruments this cycle, and the
 * next edit gets a fresh try.
 *
 * ===========================================================================
 * NEVER LOGS (D-005)
 * ===========================================================================
 * `previousText`/`currentText`/`reason` are all what she wrote or what the
 * model said about it — content, never logged. This class has no logging
 * call anywhere in it, the same discipline `explainWhy.ts`/`workerProvider.ts`
 * use for the identical reason; a thrown error carries only structural
 * information (a Worker error code, a shape complaint), never a text field.
 */

import type { WorkerTaskTransport } from 'olea-core';
import type { MaterialityJudge, MaterialityJudgeInput, MaterialityJudgeVerdict } from './types.js';

/** `TASK_IDS.MATERIALITY_JUDGE`, mirrored — see the module doc for why it is not imported. */
export const MATERIALITY_JUDGE_TASK_ID = 'materiality.judge.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms. */
export const MATERIALITY_JUDGE_CONTRACT_VERSION = 2;

/**
 * Anything that went wrong reaching the Worker or reading its reply.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, `undefined` otherwise.
 */
export class WorkerMaterialityJudgeError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerMaterialityJudgeError';
    this.code = code;
  }
}

export interface WorkerMaterialityJudgeDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerMaterialityJudge implements MaterialityJudge {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerMaterialityJudgeDeps) {
    this.transport = deps.transport;
  }

  /**
   * `path` never leaves this method — it names a vault file, which is
   * content-adjacent identifying information the Worker task's own schema
   * does not accept (`materialityJudgeRequest` is `previousText`/
   * `currentText` only). Only the text pair crosses the wire.
   */
  async judge(input: MaterialityJudgeInput): Promise<MaterialityJudgeVerdict> {
    const body = await this.transport.send({
      contractVersion: MATERIALITY_JUDGE_CONTRACT_VERSION,
      taskId: MATERIALITY_JUDGE_TASK_ID,
      payload: {
        previousText: input.previousText,
        currentText: input.currentText,
      },
    });
    return readVerdict(body);
  }
}

function readVerdict(body: unknown): MaterialityJudgeVerdict {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerMaterialityJudgeError(
      'WorkerMaterialityJudge: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerMaterialityJudgeError(
      `WorkerMaterialityJudge: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerMaterialityJudgeError(
      'WorkerMaterialityJudge: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  if (typeof result !== 'object' || result === null) {
    throw new WorkerMaterialityJudgeError(
      'WorkerMaterialityJudge: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const material = r['material'];
  if (typeof material !== 'boolean') {
    throw new WorkerMaterialityJudgeError(
      'WorkerMaterialityJudge: the Worker response carried no boolean `material`.',
    );
  }
  const reason = r['reason'];
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new WorkerMaterialityJudgeError(
      'WorkerMaterialityJudge: the Worker response carried no non-empty `reason`.',
    );
  }

  return { material, reason };
}
