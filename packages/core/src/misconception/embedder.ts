/**
 * `WorkerMisconceptionEmbedder` — the production `MisconceptionEmbedder`
 * (M1, D-004, `ol-nagi`), mirroring `../retrieval/workerProvider.ts`'s
 * `WorkerEmbeddingProvider` for the retrieval port `./types.ts`'s module doc
 * explicitly says this one reuses: "The production implementation is the
 * same Worker `retrieval.embed.v1` task either port would call."
 *
 * ===========================================================================
 * REUSE, NOT A SECOND ENDPOINT
 * ===========================================================================
 * This class does not talk to a transport or build a request envelope
 * itself. Every one of `WorkerEmbeddingProvider`'s documented reasons for
 * existing — the envelope shape, the model-stamp check against a silent
 * server-side model swap, the empty/blank-text guard, the ragged-batch
 * check — apply unchanged to misconception statement text, so re-deriving
 * them here would be exactly the duplication `matcher.ts` already argues
 * against for cosine similarity ("imported, not re-implemented, so M1 and
 * C2.3/C2.5 share one tested definition"). This class instead takes an
 * already-built `TextEmbeddingBackend` as a dependency. The production one
 * is a `WorkerEmbeddingProvider` instance built the same way retrieval
 * builds its own — see `packages/plugin/src/misconception-embedder.ts`,
 * this port's composition root, for where that instance actually comes
 * from and why it still counts as reusing the one registered task rather
 * than inventing a new Worker endpoint.
 *
 * ===========================================================================
 * WHY `TextEmbeddingBackend` IS A FRESH LOCAL SHAPE, NOT AN IMPORT
 * ===========================================================================
 * `./types.ts` already ruled this out for the *port* itself
 * (`MisconceptionEmbedder`): "Deliberately a fresh, local interface rather
 * than an import of `../retrieval/types.js`'s `EmbeddingProvider`... that
 * directory is a concurrently-live lane's, and importing its port would
 * create a coupling this store does not need (it needs the shape, not the
 * module)." This file is that port's one production implementation, and it
 * keeps the same discipline for its own dependency: `TextEmbeddingBackend`
 * is structurally identical to `EmbeddingProvider`, so any real
 * `EmbeddingProvider` — in particular `WorkerEmbeddingProvider` — already
 * satisfies it with zero adapter code, but this directory never imports
 * `../retrieval/*` to say so.
 */

import type { EmbeddingVector, MisconceptionEmbedder } from './types.js';

export interface TextEmbeddingRequest {
  readonly model: string;
  readonly texts: readonly string[];
}

export interface TextEmbeddingResult {
  readonly vectors: readonly EmbeddingVector[];
}

/**
 * Structurally identical to `../retrieval/types.js`'s `EmbeddingProvider` —
 * see the module doc for why this is a fresh local shape rather than an
 * import. A production `WorkerEmbeddingProvider` instance satisfies this
 * with no adapter; tests inject a fake.
 */
export interface TextEmbeddingBackend {
  embed(request: TextEmbeddingRequest): Promise<TextEmbeddingResult>;
}

export interface WorkerMisconceptionEmbedderDeps {
  readonly backend: TextEmbeddingBackend;
  /**
   * The pinned embedding model id — the same one retrieval's caller pins
   * (`packages/plugin/src/retrieval/wiring.ts`'s `SLOT_E_MODEL_ID`). Passed
   * in rather than hardcoded: `olea-core` has no business knowing which
   * Slot E model the product currently targets (C4.6 — slot routing is
   * server-side config), the same reason `EmbeddingCacheEngine` takes
   * `model` as a dependency instead of a constant.
   */
  readonly model: string;
}

/**
 * The production `MisconceptionEmbedder`. `embed([])` short-circuits to `[]`
 * without calling the backend at all — an empty batch is not worth a round
 * trip, the same guard `WorkerEmbeddingProvider.embed` makes for the
 * identical case.
 */
export class WorkerMisconceptionEmbedder implements MisconceptionEmbedder {
  private readonly backend: TextEmbeddingBackend;
  private readonly model: string;

  constructor(deps: WorkerMisconceptionEmbedderDeps) {
    this.backend = deps.backend;
    this.model = deps.model;
  }

  async embed(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
    if (texts.length === 0) return [];
    const result = await this.backend.embed({ model: this.model, texts });
    return result.vectors;
  }
}
