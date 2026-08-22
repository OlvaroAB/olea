/**
 * Fetches and validates the pre-computed generation cassette
 * (`ol-opmb.3` [TB-3]) — the generative-stage counterpart to
 * `load-cassette.ts`'s `loadEmbeddingCassette`: a plain static asset,
 * fetched at runtime, never embedded in the bundle. `build.mjs`'s
 * `copyGenerationCassette` is what puts it at `./generation-cassette.json`.
 *
 * `readGenerationCassette` (`../synthetic-bridge.js`) is the hard-refusal
 * check — see `generation-cassette.ts`'s module doc for why a schema or
 * dataset-version mismatch throws here rather than silently starting over.
 */

import {
  GENERATION_DATASET_VERSION,
  type GenerationCassette,
  readGenerationCassette,
} from '../synthetic-bridge.js';

export const GENERATION_CASSETTE_URL = './generation-cassette.json';

export async function loadGenerationCassette(
  url: string = GENERATION_CASSETTE_URL,
): Promise<GenerationCassette> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `workbench: could not load ${url} (${response.status}). Run ` +
        '`node scripts/precompute-generation.mjs --spend` from packages/workbench/ once, then rebuild.',
    );
  }
  const raw: unknown = await response.json();
  return readGenerationCassette(raw, { datasetVersion: GENERATION_DATASET_VERSION });
}
