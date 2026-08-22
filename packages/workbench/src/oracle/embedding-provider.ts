/**
 * `CassetteEmbeddingProvider` — the cassette-backed `EmbeddingProvider`
 * (`olea-service`'s `ol-opmb.2` [TB-2]).
 *
 * Implements `olea-core`'s `EmbeddingProvider` port (`../oracle-bridge.js`)
 * by replaying a pre-computed `EmbeddingCassette`
 * (`olea-synthetic`'s `embedding-cassette.ts`, `../synthetic-bridge.js`).
 * **This class never makes a network call.** The one place in this project
 * that calls a real embedding model for the synthetic world is
 * `packages/workbench/scripts/precompute-embeddings.mjs`, a Node harness
 * script outside the browser bundle entirely — see that script's own header
 * for the spend discipline. Keeping the live call out of this class (and
 * therefore out of the workbench's browser bundle) is what D-021 and INV-1
 * both need: the workbench is dev tooling, not a product surface, and it
 * must never carry a path that calls a model on its own.
 *
 * ## Never falls back to "close enough"
 *
 * A cassette that has already passed `readCassette`'s model/dataset check
 * (`embedding-cassette.ts`) is trusted at the WHOLE-CASSETTE level. This
 * class adds one more, narrower check: a single requested text whose content
 * hash the cassette does not carry at all is **refused**, not approximated —
 * no nearest-neighbour substitution, no zero vector, no silent skip. Core's
 * `retrieve()` (`engine.ts`) already documents what happens next: a
 * provider that throws degrades the pipeline to keyword-only (a missing
 * corpus chunk) or to a `queryVector: null` (a missing query), which is the
 * SAME honest "offline" posture a real network failure would produce — this
 * class does not need to reimplement that degradation, only to fail loudly
 * enough for it to fire.
 */

import type {
  EmbeddingProvider,
  EmbeddingVector,
  EmbedRequest,
  EmbedResult,
} from '../oracle-bridge.js';
import { hashText } from '../oracle-bridge.js';
import type { EmbeddingCassette } from '../synthetic-bridge.js';
import { cassetteEntriesByHash } from '../synthetic-bridge.js';

export interface CassetteEmbeddingProviderDeps {
  /** Already validated by `readCassette` against the expected model + dataset version — this class does not re-check the whole-cassette stamp, only per-request. */
  readonly cassette: EmbeddingCassette;
}

export class CassetteEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string;
  private readonly byHash: ReadonlyMap<string, readonly number[]>;

  constructor(deps: CassetteEmbeddingProviderDeps) {
    this.model = deps.cassette.model;
    this.byHash = cassetteEntriesByHash(deps.cassette);
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    if (request.model !== this.model) {
      throw new Error(
        `CassetteEmbeddingProvider: asked to embed with model ${JSON.stringify(request.model)} but this cassette is pinned to ${JSON.stringify(this.model)}. Refusing rather than comparing two vector spaces.`,
      );
    }
    const vectors: EmbeddingVector[] = [];
    for (const text of request.texts) {
      const hash = await hashText(text);
      const vector = this.byHash.get(hash);
      if (vector === undefined) {
        throw new Error(
          `CassetteEmbeddingProvider: no cached vector for content hash ${hash}. Run ` +
            'packages/workbench/scripts/precompute-embeddings.mjs to embed this text once ' +
            'before replaying it here — a cassette that invented a vector for text it never ' +
            'saw would be a harness reporting on code that no longer exists.',
        );
      }
      vectors.push(vector);
    }
    return { vectors };
  }
}
