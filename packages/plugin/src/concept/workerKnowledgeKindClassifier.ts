/**
 * `WorkerKnowledgeKindClassifier` — the production `KnowledgeKindClassifierPort`
 * (component register row 1.5, `[KCT-1]` `ol-kxr6`, `[KCT-2]` `ol-fx1k`,
 * `[D-114]`).
 *
 * `packages/core/src/concept/knowledge-kind.ts` defines the port; until this
 * file existed, nothing implemented it outside a test fake — `ol-kxr6` shipped
 * the classification STAGE with no production caller for exactly this reason,
 * closed as the D-072 escape hatch and handed to this bead. This class turns a
 * `ClassifyKnowledgeKindRequest` into `concepts.classify.v1`'s frozen envelope,
 * sends it through an injected `WorkerTaskTransport`, and turns the response
 * back into a `ClassifyKnowledgeKindResponse` — the same seam
 * `WorkerConceptReader` (`./workerConceptReader.ts`) and
 * `packages/core/src/retrieval/workerProvider.ts`'s `WorkerEmbeddingProvider`
 * already use.
 *
 * **This adapter lives in `packages/plugin`, not `packages/core`** — the same
 * deviation from `WorkerEmbeddingProvider`'s home that `WorkerConceptReader`
 * takes, and for the identical reason: `ol-kxr6` declared
 * `packages/core/src/concept/` as its whole ownership, and this bead does not
 * reopen that package. The port itself already lives in core
 * (`KnowledgeKindClassifierPort`, `knowledge-kind.ts`), which is all a
 * client-repo implementation needs to import.
 *
 * **Why `sourceMaterial` is sent as plain text, not a `Provenance`-carrying
 * object.** `knowledge-kind.ts`'s `KnowledgeKindSourcePassage` pairs `text`
 * with an `anchor: Provenance` for the CALLER's bookkeeping, but D-005 keeps
 * vault paths and structural identifiers out of every transient model call
 * regardless of which task sends them. Unlike `concepts.extract.v1`, this
 * task's response never cites a passage back — a classification verdict has
 * no anchor of its own to resolve — so this class needs no reverse mapping
 * from a response index to a `Provenance`, only a forward one from
 * `KnowledgeKindSourcePassage[]` to the plain `sourceChunks: string[]` the
 * Worker's schema expects.
 *
 * **Why the task id and contract version are local constants** — mirroring
 * `workerProvider.ts` and `workerConceptReader.ts`'s own reasoning, restated
 * for this seam: `olea-contracts`' `main` points at TypeScript source, so a
 * value import would make this module unloadable from a plain Node process
 * running `packages/core` or `packages/plugin`'s built output.
 * `workerKnowledgeKindClassifier.spec.ts` asserts both constants equal the
 * frozen catalogue's.
 */

import {
  type ClassifyKnowledgeKindRequest,
  type ClassifyKnowledgeKindResponse,
  isKnowledgeKind,
  type KnowledgeKindClassifierPort,
  KnowledgeKindClassifierUnavailableError,
  type WorkerTaskTransport,
} from 'olea-core';

/** `TASK_IDS.CONCEPTS_CLASSIFY`, mirrored — see the module doc. Pinned by `workerKnowledgeKindClassifier.spec.ts`. */
export const CONCEPTS_CLASSIFY_TASK_ID = 'concepts.classify.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const CONCEPTS_CLASSIFY_CONTRACT_VERSION = 1;

/**
 * Anything that went wrong reaching the Worker or reading its reply that is
 * NOT `KnowledgeKindClassifierUnavailableError` — a malformed body, a `kind`
 * outside the closed candidate set, a refusal code this class does not map to
 * an availability reason.
 */
export class WorkerKnowledgeKindClassifierError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerKnowledgeKindClassifierError';
    this.code = code;
  }
}

export interface WorkerKnowledgeKindClassifierDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerKnowledgeKindClassifier implements KnowledgeKindClassifierPort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerKnowledgeKindClassifierDeps) {
    this.transport = deps.transport;
  }

  async classify(request: ClassifyKnowledgeKindRequest): Promise<ClassifyKnowledgeKindResponse> {
    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: CONCEPTS_CLASSIFY_CONTRACT_VERSION,
        taskId: CONCEPTS_CLASSIFY_TASK_ID,
        payload: {
          conceptName: request.conceptName,
          sourceChunks: request.sourceMaterial.map((passage) => passage.text),
        },
      });
    } catch (error) {
      // A transport failure below the HTTP layer (no network, DNS, a
      // connection reset) is exactly `KnowledgeKindClassifierUnavailableReason`'s
      // "offline" — the one reason a Worker response body can never itself
      // carry, because there was no response. Mirrors
      // `WorkerConceptReader`'s identical branch.
      throw new KnowledgeKindClassifierUnavailableError(
        'offline',
        `WorkerKnowledgeKindClassifier: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return readClassification(body);
  }
}

function readClassification(body: unknown): ClassifyKnowledgeKindResponse {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerKnowledgeKindClassifierError(
      'WorkerKnowledgeKindClassifier: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    // Mirrors `WorkerConceptReader`'s reasoning: `quota-exceeded` is the one
    // Worker error code with an unambiguous mapping onto
    // `KnowledgeKindClassifierUnavailableReason`. Everything else is a real
    // failure this class does not soften into "unavailable" — an expired
    // token or an outdated plugin is the composition root's job to have
    // already ruled out (F7.8), not this class's to guess at from a code.
    if (code === 'quota-exceeded') {
      throw new KnowledgeKindClassifierUnavailableError(
        'budget-exhausted',
        `WorkerKnowledgeKindClassifier: ${message}`,
      );
    }
    throw new WorkerKnowledgeKindClassifierError(
      `WorkerKnowledgeKindClassifier: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerKnowledgeKindClassifierError(
      'WorkerKnowledgeKindClassifier: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  const entry =
    typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : undefined;
  const rawKind = entry?.['kind'];
  const rawConfidence = entry?.['confidence'];

  if (typeof rawKind !== 'string' || (rawKind !== 'unclassified' && !isKnowledgeKind(rawKind))) {
    throw new WorkerKnowledgeKindClassifierError(
      `WorkerKnowledgeKindClassifier: the Worker response carried an unrecognised \`result.kind\` (${
        typeof rawKind === 'string' ? rawKind : typeof rawKind
      }).`,
    );
  }
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    throw new WorkerKnowledgeKindClassifierError(
      'WorkerKnowledgeKindClassifier: the Worker response carried no numeric `result.confidence`.',
    );
  }

  return { kind: rawKind, confidence: rawConfidence };
}
