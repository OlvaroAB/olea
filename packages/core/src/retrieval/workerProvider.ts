/**
 * `WorkerEmbeddingProvider` — the production `EmbeddingProvider` (C2.3, C4.1,
 * D-004, P3-T05).
 *
 * `types.ts` defines the `EmbeddingProvider` *port*; until this file existed,
 * nothing in either repo implemented it outside a test fake, so the whole
 * retrieval pipeline was proven against invented vectors and had no way to
 * reach a real model. This is that implementation: it turns an
 * `EmbedRequest` into the Worker's frozen `retrieval.embed.v1` envelope,
 * sends it through an injected transport, and turns the response back into
 * one vector per input text.
 *
 * **It still makes no network call itself.** `WorkerTaskTransport` is the
 * seam: the plugin implements it over Obsidian's `requestUrl` (C1.6 — no Node
 * or Electron APIs, and INV-1 keeps that import out of this package), and a
 * Node harness implements it over `fetch`. Keeping the transport injected is
 * what lets this class — the part that carries all the *reasoning* about the
 * envelope, the model check and the re-keying — be tested exhaustively
 * without a server, and be shared by both callers instead of written twice.
 *
 * **Why the model id is checked against the stamp rather than trusted.** The
 * client cannot choose the model: slot routing is server-side config (C4.6),
 * so the Worker answers with whatever `SLOT_MODEL_CONFIG.E` currently pins and
 * stamps it (D7.3). But `PersistedEmbeddingCache` is keyed on the model the
 * *caller* believes it is using, and `EmbeddingCacheEngine` only invalidates
 * when that believed model changes. If the Worker quietly served a different
 * model, every vector from that call would be filed under the old model's key
 * and compared by cosine against vectors from a different space — a silent,
 * total corruption of ranking that no downstream test could attribute. So a
 * stamp that disagrees with the requested model is an error here, loudly, at
 * the one point where both values are in the same scope.
 *
 * **Why the task id and contract version are local constants.** They mirror
 * `olea-contracts`' frozen catalogue, which this file deliberately does not
 * import *as values*: `olea-contracts`' `main` points at TypeScript source (see
 * its `package.json`), so a value import would make this module unloadable
 * from a plain Node process running `packages/core/dist` — which is exactly
 * how the service repo's harness drives core. `workerProvider.spec.ts` asserts
 * both constants equal the frozen catalogue's, so the drift the closed
 * catalogue exists to prevent is caught by a test rather than by hope.
 */

import { hashText } from '../ingestion/hash.js';
import type { EmbeddingProvider, EmbeddingVector, EmbedRequest, EmbedResult } from './types.js';

/**
 * `TASK_IDS.RETRIEVAL_EMBED`, mirrored — see the module doc for why it is not
 * imported. Pinned to the frozen catalogue by `workerProvider.spec.ts`.
 */
export const RETRIEVAL_EMBED_TASK_ID = 'retrieval.embed.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const RETRIEVAL_EMBED_CONTRACT_VERSION = 1;

/** One `/v1/task` request envelope — the shape `olea-contracts`' `requestEnvelope` validates. */
export interface WorkerTaskRequest {
  readonly contractVersion: number;
  readonly taskId: string;
  /** Transient context. Never persisted server-side (D-005, plan §7.1). */
  readonly payload: unknown;
}

/**
 * The transport seam. An implementation POSTs `request` to the Worker's
 * `/v1/task` with whatever base URL, bearer token and platform HTTP client it
 * owns, and returns the parsed JSON body **whatever the status code** — a
 * non-2xx response still carries a well-formed `ErrorResponse` body, and
 * throwing on it here would lose the `code` this class translates into a
 * useful message. A transport throws only when there is genuinely no body:
 * network failure, or a body that is not JSON.
 */
export interface WorkerTaskTransport {
  send(request: WorkerTaskRequest): Promise<unknown>;
}

/**
 * Anything that went wrong between asking for vectors and having them.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, and `undefined` when the response was
 * unusable for some other reason (wrong model, missing vector, malformed
 * body).
 */
export class WorkerEmbeddingError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerEmbeddingError';
    this.code = code;
  }
}

export interface WorkerEmbeddingProviderDeps {
  readonly transport: WorkerTaskTransport;
}

interface EmbeddingEntry {
  readonly contentHash: string;
  readonly vector: readonly number[];
}

export class WorkerEmbeddingProvider implements EmbeddingProvider {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerEmbeddingProviderDeps) {
    this.transport = deps.transport;
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    // No texts is not an error and is not worth a round trip — the Worker's
    // schema would reject it (`chunks` is `.min(1)`), which would turn an
    // empty batch into a 400 for a caller that asked for nothing.
    if (request.texts.length === 0) return { vectors: [] };

    const blank = request.texts.findIndex((text) => text.trim() === '');
    if (blank !== -1) {
      // `retrievalEmbedRequest` requires `text: z.string().min(1)`, so one
      // blank chunk 400s the *whole* batch. Failing here names the actual
      // fault (a caller produced an empty chunk) instead of surfacing as an
      // opaque invalid-request over up to `batchSize` unrelated chunks.
      throw new WorkerEmbeddingError(
        `WorkerEmbeddingProvider: text at index ${blank} is empty; the Worker's retrieval.embed.v1 schema rejects empty chunk text.`,
      );
    }

    const hashes = await Promise.all(request.texts.map((text) => hashText(text)));
    const chunks = request.texts.map((text, index) => ({
      contentHash: hashes[index] ?? '',
      text,
    }));

    const body = await this.transport.send({
      contractVersion: RETRIEVAL_EMBED_CONTRACT_VERSION,
      taskId: RETRIEVAL_EMBED_TASK_ID,
      payload: { chunks },
    });

    const entries = readEmbeddings(body, request.model);
    const byHash = new Map(entries.map((entry) => [entry.contentHash, entry.vector] as const));

    const vectors: EmbeddingVector[] = [];
    let dimensions: number | null = null;
    for (let index = 0; index < hashes.length; index++) {
      const hash = hashes[index] ?? '';
      const vector = byHash.get(hash);
      if (vector === undefined) {
        throw new WorkerEmbeddingError(
          `WorkerEmbeddingProvider: the Worker returned no vector for input text at index ${index}.`,
        );
      }
      if (vector.length === 0 || vector.some((component) => !Number.isFinite(component))) {
        throw new WorkerEmbeddingError(
          `WorkerEmbeddingProvider: the vector for input text at index ${index} is empty or contains a non-finite component.`,
        );
      }
      // Every cached embedding is compared against the query by brute-force
      // cosine (D-004), and `cosineSimilarity` answers 0 — not an error — for
      // a dimension mismatch. A ragged batch would therefore degrade ranking
      // silently rather than fail, so it is caught at the only point where the
      // whole batch is visible at once. This still has to happen here, on the
      // full-precision vectors: quantisation (`quantise.ts`, `ol-l1qz`)
      // preserves length exactly, so a ragged batch stays ragged in the cache
      // and stays just as silent.
      if (dimensions === null) dimensions = vector.length;
      else if (vector.length !== dimensions) {
        throw new WorkerEmbeddingError(
          `WorkerEmbeddingProvider: inconsistent vector dimensions in one batch (${dimensions} then ${vector.length}).`,
        );
      }
      vectors.push(vector);
    }

    return { vectors };
  }
}

function readEmbeddings(body: unknown, expectedModel: string): readonly EmbeddingEntry[] {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerEmbeddingError(
      'WorkerEmbeddingProvider: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerEmbeddingError(
      `WorkerEmbeddingProvider: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerEmbeddingError(
      'WorkerEmbeddingProvider: the Worker response carried no `ok` discriminant.',
    );
  }

  const stamp = response['stamp'];
  const stampedModel =
    typeof stamp === 'object' && stamp !== null
      ? (stamp as Record<string, unknown>)['modelId']
      : undefined;
  if (typeof stampedModel !== 'string' || stampedModel.length === 0) {
    throw new WorkerEmbeddingError(
      'WorkerEmbeddingProvider: the Worker response carried no stamped modelId (D7.3).',
    );
  }
  if (stampedModel !== expectedModel) {
    // See the module doc: filing these vectors under `expectedModel` would
    // mix two vector spaces in one cache.
    throw new WorkerEmbeddingError(
      `WorkerEmbeddingProvider: the Worker served "${stampedModel}" but the cache is keyed to "${expectedModel}"; vectors from two models are not comparable.`,
    );
  }

  const result = response['result'];
  const rawEntries =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['embeddings']
      : undefined;
  if (!Array.isArray(rawEntries)) {
    throw new WorkerEmbeddingError(
      'WorkerEmbeddingProvider: the Worker response carried no `result.embeddings` array.',
    );
  }

  return rawEntries.map((raw, index) => {
    const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const contentHash = entry['contentHash'];
    const vector = entry['vector'];
    if (typeof contentHash !== 'string' || contentHash.length === 0) {
      throw new WorkerEmbeddingError(
        `WorkerEmbeddingProvider: embedding ${index} carried no contentHash.`,
      );
    }
    if (!Array.isArray(vector) || vector.some((component) => typeof component !== 'number')) {
      throw new WorkerEmbeddingError(
        `WorkerEmbeddingProvider: embedding ${index} carried no numeric vector.`,
      );
    }
    return { contentHash, vector: vector as readonly number[] };
  });
}
