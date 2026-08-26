/**
 * `computeMaterialityHashes` — the async wrapper `trigger.ts`'s pure gate
 * deliberately has no room for. Hashes both the raw text (reusing `olea-core`'s
 * `hashText`, the same SHA-256-over-UTF-8 the ingestion queue already keys
 * jobs on — one hash algorithm, one guarantee, never a second one invented
 * here) and the canonicalised text (`canonical.ts`).
 */

import { hashText } from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';
import type { MaterialityHashes } from './types.js';

export async function computeMaterialityHashes(text: string): Promise<MaterialityHashes> {
  const canonical = canonicalizeForMateriality(text);
  const [rawHash, canonicalHash] = await Promise.all([hashText(text), hashText(canonical)]);
  return { rawHash, canonicalHash };
}
