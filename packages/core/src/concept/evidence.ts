/**
 * Compatibility shim — the real module moved to `../tier3-evidence/`
 * ([EXT-8], `ol-ac7g`).
 *
 * `extractTier3Evidence` and its types were filed here on the assumption
 * that they were concept-extraction machinery. Measured against their real
 * consumers, only ONE of three is concept identity — `./extract.ts`'s
 * tier-3 minting block, which is already off in production
 * (`[D-068]`, `[EXT-2]`/`ol-468f`) and superseded by `./read.ts`
 * (`ol-2zfj.1`). The other two — `../gap/build.ts`/`../gap/coverage.ts`
 * (consuming `SourceCoverage`) and `../evidence-edge/build.ts` (calling
 * `extractTier3Evidence` directly to build the concept↔assessment evidence
 * edge) — have nothing to do with concept identity and survive the
 * extraction-method change. So the machinery itself moved to
 * `../tier3-evidence/` (see `../tier3-evidence/types.ts`'s module doc for
 * the full accounting), leaving this file as a re-export.
 *
 * **This file exists ONLY because `./extract.ts` (this bead's tier-3
 * minting consumer) still imports from `./evidence.js`, and `./extract.ts`
 * is owned by another lane this round — editing it here would be exactly
 * the two-live-lanes-one-file conflict the ownership protocol forbids.**
 * The one-line fix that retires this shim: repoint `./extract.ts`'s
 * `import { extractTier3Evidence } from './evidence.js'` (and drop the
 * `includeTier3` option and its call site) once the tier-3 minting path
 * itself is deleted — see `ol-ac7g`'s acceptance criteria and close notes
 * for the exact line. `./read.ts` carries one stale doc-comment mention of
 * `./evidence.js` (line ~485) that resolves through this shim too; harmless,
 * but worth folding into the same one-line pass.
 *
 * Delete this file once nothing imports it.
 */

export { extractTier3Evidence } from '../tier3-evidence/build.js';
export * from '../tier3-evidence/types.js';
