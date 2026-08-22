/**
 * What the oracle surface needs from `olea-core` and `packages/plugin`, in
 * one file — the same discipline `plugin-bridge.ts` and `synthetic-bridge.ts`
 * already hold, extended to a third boundary.
 *
 * ## Why this is a THIRD file rather than additions to the other two
 *
 * `plugin-bridge.ts`'s own docblock calls itself "the single file in this
 * package that reaches into `packages/plugin`" — true today, and this file
 * does not make it false: `GapView` is re-exported FROM `plugin-bridge.ts`
 * below, not imported a second time from plugin source. This file's own job
 * is `olea-core`'s oracle chain, which none of the other two bridges touch.
 *
 * ## Why the core imports are from SOURCE, not `from 'olea-core'`
 *
 * Every other file in this package that wants `olea-core` imports it by
 * package name (`main.ts`, `queue/derive.ts`, `today-scenarios.ts`,
 * `persona/history.ts`) — and that resolves fine, because `olea-core`'s
 * `package.json` points `main`/`types` at `./src/index.ts` directly (source,
 * not dist; see that file's own `//main` comment for why). So the
 * `plugin-bridge.ts` gate-ordering hazard (a CJS bundle built for Obsidian's
 * runtime, resolved through a `dist/` that does not exist at test time) does
 * not apply to core.
 *
 * The forcing reason here is narrower and different: `computeConceptMastery`
 * and `ConceptMasteryResult` (`mastery/rollup.ts`) are **not re-exported from
 * `olea-core`'s own `src/index.ts`** — verified by grep, not assumed. Mastery
 * has had no non-test consumer until this bead, so nothing ever added it to
 * the public surface. `packages/core` is not this lane's to edit (file
 * ownership for `ol-opmb.1` is `packages/synthetic` and `packages/workbench`
 * only), so this file reaches directly into `../../core/src/mastery/
 * rollup.js` for exactly that one gap, and — for one clear "here is
 * everything the oracle driver needs" surface rather than a mix of
 * package-name and source-path imports for functions that all belong to one
 * chain — the rest of the oracle chain (`rankOracle`, `buildStudyPlan`,
 * `buildGapView`, `executeStudyPlan`, `composeQueue`, `refreshStudyPlan`)
 * comes from source too, even though each of those individually could have
 * been imported by package name. Flagged here as a Class A naming/structure
 * call, not a second gate-ordering hazard discovered.
 *
 * INV-1 note: nothing reachable from here imports `obsidian` except through
 * `plugin-bridge.ts`'s existing `GapView` re-export, which already carries
 * that note.
 */

export type {
  BuildGapViewInput,
  ConceptMaterialPresence,
  GapCourseView,
  GapRow,
  GapViewModel,
} from '../../core/src/gap/build.js';
export { buildGapView } from '../../core/src/gap/build.js';
export type {
  CoverageScope,
  CoverageScopeSource,
  SourceReadState,
} from '../../core/src/gap/coverage.js';
export { summariseCoverageScope } from '../../core/src/gap/coverage.js';
// The retrieval chain (`ol-opmb.2` [TB-2]): query -> hybrid retrieve ->
// grounded context or refusal. Same reach-into-source discipline as the rest
// of this file (see the module doc); `retrieve.ts`/`embedding-provider.ts`
// are this chain's own two-file "what does the oracle surface need" pattern,
// exactly mirroring `plugin-bridge.ts`/`synthetic-bridge.ts`.
export { hashText } from '../../core/src/ingestion/hash.js';
export type { McqFields } from '../../core/src/instrument/mcq-format.js';
// INV-6's accept step (`ol-opmb.3` [TB-3]) — the one function P3-T07b's
// still-open accept step is expected to call between "she accepted this
// generated candidate" and writing it to the vault. Re-exported here (not
// via `./generate.js`) so a generative stage never has its own private
// notion of what "accepted" means; there is exactly one accept boundary this
// package knows about, and it is `olea-core`'s.
export type { GeneratedMcqCandidate } from '../../core/src/instrument/mcq-generated.js';
export { acceptGeneratedMcq } from '../../core/src/instrument/mcq-generated.js';
export type {
  IndexedBlock,
  IndexedDocument,
  KeywordIndexStore,
  PersistedKeywordIndex,
} from '../../core/src/keyword-index/types.js';
export { EMPTY_KEYWORD_INDEX } from '../../core/src/keyword-index/types.js';
export type {
  ConceptMasteryEvidence,
  ConceptMasteryResult,
  MasteryRollupOptions,
} from '../../core/src/mastery/rollup.js';
export { computeAllConceptMastery, computeConceptMastery } from '../../core/src/mastery/rollup.js';
export { rankOracle } from '../../core/src/oracle/rank.js';
export type {
  ConceptPriority,
  CourseOracleRanking,
  OracleConceptFactors,
  OracleEdgeContribution,
  OracleMasteryState,
  RankOracleInput,
  RankOracleOptions,
  RankOracleResult,
} from '../../core/src/oracle/types.js';
export type { BuildStudyPlanInput } from '../../core/src/plan/build.js';
export { buildStudyPlan, studyPlanVersion } from '../../core/src/plan/build.js';
export type {
  ExecutedQueue,
  ExecuteStudyPlanInput,
  PlannedQueueItem,
} from '../../core/src/plan/execute.js';
export { executeStudyPlan } from '../../core/src/plan/execute.js';
export type { RefreshStudyPlanDeps } from '../../core/src/plan/refresh.js';
export { refreshStudyPlan } from '../../core/src/plan/refresh.js';
export type {
  StudyPlanProvider,
  StudyPlanRefreshResult,
  StudyPlanSource,
  StudyPlanStore,
} from '../../core/src/plan/types.js';
export { composeQueue } from '../../core/src/queue/compose.js';
export type { ComposedQueue, QueueCandidate } from '../../core/src/queue/types.js';
export type {
  CompositeGroundingSignals,
  CompositeGroundingThresholds,
} from '../../core/src/retrieval/compositeSignals.js';
export {
  meetsCompositeThreshold,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
} from '../../core/src/retrieval/compositeSignals.js';
export type { EmbeddingCacheEngineDeps } from '../../core/src/retrieval/embeddingCache.js';
export { EmbeddingCacheEngine } from '../../core/src/retrieval/embeddingCache.js';
export type { RetrieveDeps, RetrieveOptions } from '../../core/src/retrieval/engine.js';
export { retrieve } from '../../core/src/retrieval/engine.js';
export type {
  AssembleGroundedContextOptions,
  GroundedChunk,
  GroundingRefusalReason,
  GroundingResult,
} from '../../core/src/retrieval/groundedContext.js';
export type {
  CachedEmbeddingEntry,
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbeddingVector,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from '../../core/src/retrieval/types.js';

// The plugin's real gap/coverage pane — passed through from `plugin-bridge.ts`
// rather than reached into a second time (see the module doc above).
export type { GapViewDeps, GapViewState } from './plugin-bridge.js';
export { GapView, VIEW_TYPE_OLEA_GAP } from './plugin-bridge.js';
