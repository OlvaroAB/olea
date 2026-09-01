/**
 * The one file in this package that reaches into `packages/plugin` for the
 * bulk-review surface (F3.3, `ol-jie3`) — same discipline as
 * `plugin-bridge.ts`, `oracle-bridge.ts` and `session-bridge.ts`: one bridge
 * file per surface, so "what does the workbench take from the plugin to
 * mount this" is answerable by reading one short file.
 *
 * `bulk-review.ts`, `cache-store.ts` and `accept.ts` are all Obsidian-free
 * (their own module docs) — no `obsidian` import anywhere in this chain, so
 * none of this needs the INV-1 shim redirect every other bridge file notes
 * for its own view. `bulk-review-view.ts` (the DOM layer) DOES import
 * `obsidian`; it is pulled in the same way `GapView`/`TodayView` are,
 * through `tsconfig.json`'s `paths` + `build.mjs`'s esbuild alias.
 */

export { createDraftAcceptPort } from '../../plugin/src/generation/accept.js';
export type { BulkReviewEditPort, BulkReviewControllerDeps } from '../../plugin/src/generation/bulk-review.js';
export { BulkReviewController } from '../../plugin/src/generation/bulk-review.js';
export { BulkReviewView } from '../../plugin/src/generation/bulk-review-view.js';
export { createVaultDraftCacheStore } from '../../plugin/src/generation/cache-store.js';
export type { DraftCacheStore } from '../../plugin/src/generation/cache-store.js';
export type { DraftRecord } from '../../plugin/src/generation/types.js';
