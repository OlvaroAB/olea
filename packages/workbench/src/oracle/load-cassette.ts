/**
 * Fetches and validates the pre-computed embedding cassette
 * (`ol-opmb.2` [TB-2]) — the browser-side counterpart to
 * `vault/fixture-vault.ts`'s `loadFixtureVault`: a plain static asset,
 * fetched at runtime, never embedded in the bundle. `build.mjs`'s
 * `copyEmbeddingCassette` is what puts it at `./embedding-cassette.json`.
 *
 * `readCassette` (`../synthetic-bridge.js`) is the hard-refusal check —
 * see `embedding-cassette.ts`'s module doc for why a model or dataset
 * mismatch throws here rather than silently starting over.
 */

import {
  CASSETTE_MODEL_ID,
  type EmbeddingCassette,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
} from '../synthetic-bridge.js';

export const EMBEDDING_CASSETTE_URL = './embedding-cassette.json';

export async function loadEmbeddingCassette(
  url: string = EMBEDDING_CASSETTE_URL,
): Promise<EmbeddingCassette> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `workbench: could not load ${url} (${response.status}). Run ` +
        '`node scripts/precompute-embeddings.mjs --spend` from packages/workbench/ once, then rebuild.',
    );
  }
  const raw: unknown = await response.json();
  return readCassette(raw, { model: CASSETTE_MODEL_ID, datasetVersion: RETRIEVAL_DATASET_VERSION });
}
