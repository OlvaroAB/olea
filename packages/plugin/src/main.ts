import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import type {
  ReviewLogEntry,
  SoloLevel,
  StudyPlanAllocationEntry,
  StudyPlanEnvelope,
} from 'olea-contracts';
import {
  type AcceptedGradingObservationOutcome,
  appendMisconceptionEvent,
  buildMisconceptionDigest,
  type ClassifyKnowledgeKindOptions,
  type ClassifyKnowledgeKindRequest,
  type ComposedStudySession,
  type ConceptReadCoverage,
  type ConceptRecord,
  type ConceptRelation,
  type ConfusionPairingVerdict,
  type ConfusionRoutingDecision,
  type ConfusionRoutingInput,
  type CourseDetectionProposal,
  calendarDayFromLocalDate,
  computeWindowDeficit,
  corroborateConfusionPairings,
  courseFromPath,
  createFsrsScheduler,
  DEFAULT_COURSES_FOLDER,
  type DeviceCapability,
  detectCourseProposals,
  EMPTY_REGISTRY_OVERRIDES,
  type ExplainBackPromptContext,
  type ExtractedUnit,
  extendComposedStudySession,
  type FirstInvitationCandidate,
  type GateStage,
  GateStageRecorder,
  type GradeExplainBackInput,
  type JudgeRequestRecord,
  loadCachedStudyPlan,
  notePathCourses,
  type PendingExplainBackGrading,
  parseDocument,
  parseFrontmatter,
  pastSessionsFromReviewLog,
  pickNextExplainBackInvitation,
  type QueueSnapshot,
  type RegistryOverrides,
  type RelationSet,
  readAssessments,
  readList,
  refreshStudyPlan,
  type Scheduler,
  servedRelations,
  type VaultPath,
  type VaultSource,
  type WindowDeficitEntry,
} from 'olea-core';
import {
  createCardNoticeText,
  createQaCardFromEntry,
  resolveCreateCardOutcome,
} from './commands/create-card.js';
import { copyDiagnosticsToClipboard } from './commands/diagnostics-clipboard.js';
import { QaCardModal } from './commands/qa-card-modal.js';
import { registerOleaCommands } from './commands/register-commands.js';
import { ObsidianCorpusRelationStateStore } from './concept/corpusRelationStateStore.js';
import { ingestionSessionJustClosed } from './concept/corpusRelationTrigger.js';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  buildKnowledgeKindWiring,
  type ConceptWiring,
  type CorpusRelationWiring,
  classifyConceptKnowledgeKind,
  EMBEDDING_PROXIMITY_THRESHOLD,
  extractConceptsWithAnchors,
  type KnowledgeKindWiring,
  type ReadConceptsFromVaultOptions,
  readConceptsAndRelations,
  readConceptsFromVault,
} from './concept/wiring.js';
import { wireDocumentSourceRegistration } from './course-setup/register-source-wiring.js';
import { CourseSetupModal } from './course-setup/setup-modal.js';
import { ensureDeviceId } from './device/device-id.js';
import { ExplainBackModal, type ExplainBackSeed } from './explain-back/modal.js';
import {
  buildExplainBackObservationContext,
  hasExplainBackSourceRevisionChanged,
} from './explain-back/observation.js';
import {
  type ExplainBackSourceBlock,
  retrieveExplainBackSourceBlocks,
} from './explain-back/request.js';
import { recordSoloGradeAndReview } from './explain-back/solo-review.js';
import { createLocalGapProvider } from './gap/provider.js';
import { GapView, VIEW_TYPE_OLEA_GAP } from './gap/view.js';
import { createBulkReviewController } from './generation/bulk-review.js';
import { BulkReviewView, VIEW_TYPE_OLEA_BULK_REVIEW } from './generation/bulk-review-view.js';
import { buildFormatMatch, type FormatMatchDecision } from './generation/format-match.js';
import type { GenerationRefusalNotice } from './generation/pipeline.js';
import { buildGenerationWiring, type GenerationWiring } from './generation/wiring.js';
import {
  type AcceptExplainBackGradingWithObservationContext,
  type AcceptExplainBackGradingWithObservationResult,
  acceptExplainBackGradingWithObservation,
  buildGradingWiring,
  evaluateConfusionRouting,
  type GradingWiring,
  gradeExplainBackAttempt,
} from './grading/wiring.js';
import { createLocalGroveProvider } from './grove/provider.js';
import { ObsidianGroveReadCompletenessStore } from './grove/read-completeness-store.js';
import { GroveView, VIEW_TYPE_OLEA_GROVE } from './grove/view.js';
import { createLocalHomeProvider } from './home/provider.js';
import { HomeView, VIEW_TYPE_OLEA_HOME } from './home/view.js';
import { buildIngestionArrivalWatch } from './ingestion/arrival-watch.js';
import { obsidianDeviceCapability } from './ingestion/device-capability.js';
import { ObsidianCitationHashStore } from './ingestion/materiality/citation-hash-store.js';
import {
  adaptMaterialityJudgeAsRevisionJudge,
  buildCitationRevisionWiring,
  type CitationRevisionTrigger,
} from './ingestion/materiality/citation-revision-wiring.js';
import {
  createInMemoryPreviousTextTracker,
  type PreviousTextTracker,
} from './ingestion/materiality/previous-text.js';
import {
  buildMaterialityWiring,
  type MaterialityEvaluationResult,
  type MaterialityTrigger,
} from './ingestion/materiality/wiring.js';
import { WorkerMaterialityJudge } from './ingestion/materiality/workerJudge.js';
import {
  buildAuthoredNoteUnit,
  createProcessNowAction,
  isProcessNowSupported,
  type ProcessNowAction,
  processNowNotice,
} from './ingestion/process-now.js';
import { ObsidianQueueStore } from './ingestion/queue-store.js';
import {
  buildFirstReadFolderViews,
  buildIngestionRunner,
  type FirstReadFolderCounts,
  type FirstReadFolderView,
  firstReadFoldersJustFinished,
  type IngestionWiring,
  summarizeFirstReadByFolder,
} from './ingestion/wiring.js';
import { ObsidianKeywordIndexStore } from './keyword-index/store.js';
import { buildKeywordIndexWiring, type KeywordIndexWiring } from './keyword-index/wiring.js';
import { createVaultMisconceptionStore } from './misconception/store.js';
import type { PlanPolicyHttpPost } from './plan/plan-policy-provider.js';
import { buildPlanPolicyWiring, type PlanPolicyWiring } from './plan/plan-policy-wiring.js';
import { createLocalStudyPlanProvider } from './plan/provider.js';
import { isStudyPlanConfigured, ObsidianStudyPlanSettingsStore } from './plan/settings-store.js';
import { ObsidianStudyPlanStore } from './plan/store.js';
import { obsidianRankWeightsGet } from './rank/obsidian-rank-weights-transport.js';
import { buildRankWeightsWiring, type RankWeightsWiring } from './rank/wiring.js';
import {
  createObsidianAcceptNoteOfferPort,
  createObsidianEditInstrumentPort,
  createObsidianOpenSourceLocationPort,
  openRegistryEntryFor,
} from './registry/obsidian-ports.js';
import { ObsidianRegistryOverridesStore } from './registry/overrides-store.js';
import { createLocalRegistryProvider } from './registry/provider.js';
import { RegistryView, VIEW_TYPE_OLEA_REGISTRY } from './registry/view.js';
import { buildClassifyPassageHook } from './retrieval/classify-passage.js';
import type { DraftQuizCardsDeps } from './retrieval/draft-quiz-cards.js';
import { GateStagePersistence } from './retrieval/gate-stage-persistence.js';
import {
  type GateStagePeriodSummary,
  ObsidianGateStageStore,
} from './retrieval/gate-stage-store.js';
import {
  type JudgeCaseCaptureConfig,
  JudgeCaseCaptureRecorder,
  ObsidianJudgeCaseCaptureStore,
  type PersistedJudgeCaseCapture,
} from './retrieval/judge-case-capture.js';
import { SerializingDataHost } from './retrieval/serializing-data-host.js';
import {
  buildRetrievalWiring,
  drainIntoEmbeddingCache,
  type RetrievalWiring,
} from './retrieval/wiring.js';
import { createRetrospectiveOfferEventLog } from './retrospective/offer-events.js';
import { createLocalRetrospectiveProvider } from './retrospective/provider.js';
import { RetrospectiveView, VIEW_TYPE_OLEA_RETROSPECTIVE } from './retrospective/view.js';
import { createVaultGradeContestPort } from './review/contest.js';
import { retrieveExplainWhySourceChunks, WorkerExplainWhyGenerator } from './review/explainWhy.js';
import { createHeadingOfferPort, type HeadingOfferPort } from './review/heading-offer.js';
import {
  createHeadingOfferBannerTracker,
  createHeadingOfferForItem,
  type HeadingOfferBannerTracker,
} from './review/heading-offer-wiring.js';
import { createObsidianEditPort } from './review/obsidian-ports.js';
import {
  createReviewSessionOpener,
  type OpenReviewSessionInput,
  type ReviewSessionOpener,
  type ReviewSessionPorts,
} from './review/open-session.js';
import {
  createVaultExplainBackOfferLogPort,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  isoWithLocalOffset,
  systemClock,
} from './review/ports.js';
import type { ReviewSession } from './review/session.js';
import type { ReviewInstrument, ReviewQueueItem } from './review/types.js';
import { ReviewView, VIEW_TYPE_OLEA_REVIEW } from './review/view.js';
import { createStudySessionHolder, type StudySessionHolder } from './session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from './session-builder/copy.js';
import {
  composeStudySessionForRequest,
  createLocalSessionBuilderProvider,
} from './session-builder/provider.js';
import { SessionBuilderView, VIEW_TYPE_OLEA_SESSION } from './session-builder/view.js';
import {
  type HeadingOfferSettingSnapshot,
  ObsidianHeadingOfferSettingStore,
} from './settings/heading-offer-setting.js';
import { OleaSettingTab } from './settings/settings-tab.js';
import { createTodayContestSupport } from './today/contest.js';
import {
  createRhythmSource,
  createVaultInstrumentSource,
  createVaultScopeSource,
  createVaultTrendsSource,
  loadTodayPanel,
  localToday,
  readReviewHistory,
} from './today/data-source.js';
import { ObsidianMaterialArrivalStore } from './today/material-arrival-store.js';
import { refreshOpenTodayViews } from './today/refresh.js';
import { ObsidianTermWindowStore } from './today/term-window-store.js';
import { TodayView, VIEW_TYPE_OLEA_TODAY } from './today/view.js';
import { ObsidianUsageLogStore } from './usage/log-store.js';
import { ObsidianSource } from './vault/obsidian-source.js';
import { createObsidianWorkerTransport, obsidianHttpRequest } from './worker/obsidian-transport.js';

/**
 * How often `onload` polls the ingestion queue while Obsidian is open
 * (D-002 puts both the scheduling and the drain in the plugin, running for as
 * long as the app is up, foreground or idle;
 * `IngestionQueueEngine`'s own module doc leaves *when* to call `tick()` to
 * the host; an interval is the simplest of the options it names). Nothing
 * enqueues a job yet — the command/UI surface that does is later work
 * (P3-T07 and beyond) — so today this interval mostly finds an empty queue
 * and reports `idle`; it is what makes a future job, the instant something
 * enqueues one, start draining without also needing its own polling logic.
 *
 * The same tick also drains whatever the ingestion sink has accumulated into
 * the embedding cache (`ol-odb0.1`) — piggy-backing on this interval rather
 * than a second one, since there is nothing for it to do before the queue
 * itself has produced something.
 */
const INGESTION_TICK_INTERVAL_MS = 30_000;

/** `[JEV-11]` (`ol-3ux7.96`) — the gate-stage recorder's write-coalescing quiet period. See `scheduleGateStagePersist`'s own doc for why 2000ms. */
const GATE_STAGE_PERSIST_DEBOUNCE_MS = 2_000;

/** Raised when the vault could not be walked at all, beside the view's own unavailable screen. */
const REVIEW_UNAVAILABLE_NOTICE =
  'Olea could not read your vault to build today’s review. Nothing has been changed.';

/** What `openReviewSession` needs that only `onload` can build. */
interface ReviewWiring {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  readonly deviceId: string;
  readonly ports: ReviewSessionPorts;
  /**
   * The cached study plan in force (F2.8 Phase B), or `null` (Phase A) —
   * P5-T07's switch-on. Mutated in place by `refreshCachedStudyPlan` as
   * fresher plans arrive; `composeReviewSession` reads it at the instant a
   * session opens, never a stale copy captured at `onload`.
   */
  plan: StudyPlanEnvelope | null;
}

// olea-plugin — commands, settings and ObsidianSource land in P1/P2 (plan
// §3; P2-T10 for commands/settings). `packages/plugin` is the only package
// in the monorepo permitted to import `obsidian` — see INV-1 (plan §0.5),
// scripts/check-inv1.mjs, and biome.json's noRestrictedImports override for
// packages/core and packages/contracts. Within this package, the actual
// command/view logic stays out of this file where it can be kept obsidian-
// free and unit-tested — see commands/register-commands.ts and
// settings/settings-tab.ts's module docs. `buildIngestionRunner`
// (`ingestion/wiring.ts`) is the one piece of composition that *must*
// happen here rather than in a testable module: it needs the real `App`
// (for `ObsidianSource`) and the real plugin instance (for
// `ObsidianQueueStore`'s `loadData`/`saveData`) that only `main.ts` has —
// see `wiring.ts`'s own module doc for why the composition logic itself
// still lives there, obsidian-free, and is unit tested against fakes
// (P3-T03a / DF-21a).
//
// The review session follows the same rule and is worth stating, because it
// is the newest piece here: everything about *what she is offered* lives in
// `review/open-session.ts`, which takes a `VaultSource` and ports and has a
// unit-test suite. What is left below is workspace glue — which leaf, which
// tab, reveal or open — and it is the only part that cannot be tested,
// because a `WorkspaceLeaf` has no runtime outside Obsidian.
export default class OleaPlugin extends Plugin {
  /**
   * `[JEV-11]` (`ol-3ux7.96`) — serializes EVERY `data.json` read/write this
   * plugin instance issues, closing the exposure `GateStagePersistence`
   * alone cannot: every `ObsidianDataHost`-pattern store in this plugin
   * (`./grove/ground-streak-store.ts`, `./plan/settings-store.ts`,
   * `./registry/overrides-store.ts`, and others) is constructed with `this`
   * as its host and calls `loadData()`/`saveData()` directly on it — see
   * `override loadData`/`override saveData` below, and
   * `./retrieval/serializing-data-host.ts`'s own doc for the full argument
   * and what this does not fix (each store still has no serialization of
   * its own if ever given a different host).
   */
  private readonly dataFileHost = new SerializingDataHost({
    loadData: () => super.loadData(),
    saveData: (data) => super.saveData(data),
  });
  private ingestion: IngestionWiring | null = null;
  /**
   * `[D-152]` (F3.3, `ol-0r92.21`): the manual process-now timing override —
   * one instance for the plugin's whole session so its in-flight coalescing
   * set actually coalesces across repeat invocations (`process-now.ts`'s own
   * doc). Built once `this.ingestion` exists (it needs the real engine's
   * `enqueue`/`tick`) and never rebuilt afterward.
   */
  private processNowAction: ProcessNowAction | null = null;
  private review: ReviewWiring | null = null;
  /**
   * `[SESS-8.2]`/`[SESS-8.4]` (`ol-egov.132.2`/`.4`, `docs/dev/one-assembly-
   * path.md` §3a): the ONE composed-session holder for this plugin instance
   * — "Home, the session builder, Today and the review tab all read that one
   * holder." Constructed unconditionally at class-field init (never lazily,
   * never per-leaf) so every reader added by this row or a later one shares
   * the identical instance; constructing a second one would reintroduce the
   * two-holder split `session/holder.ts`'s own module doc names as the
   * defect this bead exists to collapse.
   */
  private readonly studySessionHolder: StudySessionHolder = createStudySessionHolder();
  /**
   * `[JEV-11]` (`ol-3ux7.96`): the one recorder for this plugin instance,
   * same "constructed unconditionally at class-field init, never rebuilt"
   * posture `studySessionHolder` above already takes — a per-call recorder
   * would count exactly one event per call and answer nothing about a share,
   * and a module-level singleton would be shared state living outside this
   * instance's control (`gateStageRecorder.ts`'s own doc). `draftQuizCardsDeps()`
   * below passes `.record` as `onStage` on every call, so every band-gate
   * request this plugin instance makes accumulates into the same counts.
   *
   * **Seeded from `gateStageStore` at `onload` and persisted after every
   * record — not session-only.** A per-session, in-memory-only recorder
   * answers nothing about a share once she restarts the application, which
   * she does routinely inside any real collection window: a single read
   * would sample one session and be reported as though it covered the
   * whole window, exactly the quietly-wrong number the pre-registration
   * exists to prevent. `restore()` seeds this instance from
   * `gateStageStore.load()`'s counts at `onload` (see there); persisting the
   * running total back after each stage is `persistGateStageCounts()`'s job,
   * called fire-and-forget from `draftQuizCardsDeps()`'s `onStage`, below.
   *
   * **Failing to read or write the store must never touch the gate's own
   * decision.** Every persistence step here is best-effort and wrapped so it
   * cannot throw into the caller — same posture `groundedContext.ts`'s
   * `onStage` already takes toward a throwing callback, extended to cover a
   * disk error too: a failed load seeds zero (an honestly empty period, not
   * a crash), and a failed save leaves this in-memory total correct and
   * simply not yet written — the next successful save catches it up, since
   * every save writes the CURRENT total, not a delta.
   */
  private readonly gateStageRecorder: GateStageRecorder = new GateStageRecorder();
  // `this.dataFileHost` (declared above, first in this class) provides
  // `readModifyWrite`, so `gateStageStore.save` below runs atomically
  // against every other write this plugin issues — see that host's own doc.
  private readonly gateStageStore: ObsidianGateStageStore = new ObsidianGateStageStore(
    this.dataFileHost,
  );
  /** Set once, at `onload`, from `gateStageStore.load()` — `null` only before that first load resolves, or when nothing has ever been persisted. Never rewritten afterward; see `gateStageStore`'s own module doc on what resets it (nothing, in production). */
  private gateStagePeriodStartedAt: string | null = null;
  private gateStageLastRecordedAt: string | null = null;
  /**
   * `[JEV-11]` (`ol-3ux7.96`) — the serializing, coalescing write scheduler
   * for `gateStageStore.save()`, split into `./retrieval/gate-stage-
   * persistence.ts` so its overlap/coalescing behaviour is unit-testable
   * without an Obsidian host (this file has no runtime under Vitest). See
   * that module's own doc for why serialization and coalescing are both
   * required: `data.json` is ONE file shared with every other
   * `ObsidianDataHost`-pattern store in this plugin, so an unserialized
   * write here can silently discard a SIBLING key another store just wrote,
   * not only its own count. `deps.save` never runs directly from `onStage`
   * below — only through `schedule()`/`flush()`, which is what gives every
   * write here its serialization and coalescing.
   */
  private readonly gateStagePersistence = new GateStagePersistence<
    Readonly<Record<GateStage, number>>
  >({
    now: () => new Date().toISOString(),
    getCounts: () => this.gateStageRecorder.summary().counts,
    save: (counts, now) => this.gateStageStore.save(counts, now),
    onSaved: (now) => {
      this.gateStagePeriodStartedAt ??= now;
      this.gateStageLastRecordedAt = now;
    },
    onError: (error) => console.error('Olea: could not persist gate-stage counts', error),
    debounceMs: GATE_STAGE_PERSIST_DEBOUNCE_MS,
  });
  /**
   * `[JEV-6]` (`ol-3ux7.89`) — the real-population case capture.
   *
   * **`null` in every ordinary session, and that is the normal state.** It
   * is constructed at `onload` only when `data.json` carries a hand-edited
   * capture config whose `enabled` is exactly `true`
   * (`./retrieval/judge-case-capture.ts`). Nothing in this plugin ever
   * writes that config key, there is no setting for it, and no command
   * touches it — David's ruling of 2026-09-22 is a hand-edit and no surface
   * she can see, and the readback below follows `getGateStageSummary()`'s
   * developer-console precedent for the same reason.
   *
   * While it is `null`, `draftQuizCardsDeps()` omits `onJudgeRequest`
   * entirely, so the drafting path is byte-identical to having no capture in
   * the codebase.
   */
  private judgeCaseCapture: JudgeCaseCaptureRecorder | null = null;
  private readonly judgeCaseCaptureStore: ObsidianJudgeCaseCaptureStore =
    new ObsidianJudgeCaseCaptureStore(this.dataFileHost);
  private keywordIndex: KeywordIndexWiring | null = null;
  private retrieval: RetrievalWiring | null = null;
  private grading: GradingWiring | null = null;
  private concept: ConceptWiring | null = null;
  /** Component register row 1.5's classifier port (`[KCT-2]` `ol-fx1k`, `[D-114]`) — F7.8 grey-out, same shape as `concept` above. */
  private knowledgeKind: KnowledgeKindWiring | null = null;
  /** F3.3's automatic generation pipeline (`ol-p3t07a`) — built unconditionally (unlike `retrieval`/`keywordIndex`, it needs no Worker token: the cache and accept/reject flow work offline, and only the sweep itself is a no-op with no Worker configured, F7.8). */
  private generation: GenerationWiring | null = null;
  /**
   * `[H-1.8a]` (`ol-0r92.71`, register row 1.8a): the last sweep's classified
   * refusals, captured by `onUnitsLanded` from the `GenerationSweepReport`
   * `this.generation.sweep` already returns and previously discarded. Read
   * fresh by `BulkReviewView`'s `getRefusals` provider at the bulk-review
   * construction site below — never cached beyond "most recent sweep," same
   * posture the surrounding wiring fields (`registryOverridesCache`, etc.)
   * already take toward "latest known projection, not a persisted store."
   */
  private lastGenerationRefusals: readonly GenerationRefusalNotice[] = [];
  /**
   * F2.10's accept/dismiss verb pair (`[D-170]`/`[GEN-2]`, `ol-0r92.27`) —
   * built unconditionally, same reason `generation` above is: the cache
   * write and the in-memory dismiss set need no Worker token, only `accept`'s
   * actual draft call does, and that reads `draftQuizCardsDeps()` fresh per
   * call (F7.8), never a value captured here.
   *
   * **Reachability.** `ol-i19f` matches the current review item's own
   * source note to a `HeadingOfferCandidate`/`ConceptRecord` and mounts
   * `review/view.ts`'s `renderHeadingOfferBanner` against this port —
   * `this.headingOfferForItem`, built alongside this field, is the real
   * production caller; see that field's own doc.
   */
  private headingOffer: HeadingOfferPort | null = null;
  /**
   * `ol-i19f`'s surface wiring: a `HeadingOfferBannerTracker`
   * (`heading-offer-wiring.ts`) closing over `this.headingOffer` above, this
   * plugin's `vault`, and `this.conceptRecords` (read through the same
   * "current thunk, never a value captured once" shape `registry/provider.ts`'s
   * `conceptRecords` param already uses — see that field's own doc). Passed
   * to `ReviewView`'s constructor below; `null` before `onload` builds it,
   * same posture as every other wiring field here.
   */
  private headingOfferForItem: HeadingOfferBannerTracker | null = null;
  /** Component 3.3's delivered ranking weights (`[D-110]`, `ol-v7r5.3`) — F7.8 grey-out, same shape as `concept`/`grading`/`retrieval` above. */
  private rankWeights: RankWeightsWiring | null = null;
  /**
   * `[D-167]`/`ol-v7r5.25` component 3.5 threading, hooked up per
   * `ol-v7r5.27`: same F7.8 grey-out shape as `rankWeights` above, built
   * once here and re-invoked per plan refresh in
   * `refreshCachedStudyPlan`'s `createLocalStudyPlanProvider` call —
   * mirrors `readRankWeights` exactly.
   */
  private planPolicy: PlanPolicyWiring | null = null;
  /** `[EXT-11]` (`ol-kw4a`, `[D-118]`) — the corpus-level relation stage's production port, same F7.8 grey-out terms as `concept`/`knowledgeKind` above. */
  private corpusRelation: CorpusRelationWiring | null = null;
  private corpusRelationStateStore: ObsidianCorpusRelationStateStore | null = null;
  /**
   * Register row 1.4's materiality trigger (`TRG-1`, `ol-tqy3`, `ol-2zfj.15`)
   * — built unconditionally, unlike `retrieval`/`grading`/`concept` above:
   * the free hash/debounce/floor gates need no Worker token. `ol-2zfj.18`
   * wires a real `MaterialityJudge` (`buildMaterialityJudge` below) on the
   * same F7.8 grey-out terms as `retrieval`/`grading`/`concept` — `null`
   * until a Worker token is pasted, and the trigger degrades to
   * `'judge-unavailable'` exactly as before that bead.
   */
  private materiality: MaterialityTrigger | null = null;
  /** Session-scoped "what did this path last look like" cache feeding `materiality.evaluate`'s `previousText` — see `ingestion/materiality/previous-text.ts`'s module doc for why this is its own tiny cache rather than a read into the keyword index's. */
  private materialityPreviousText: PreviousTextTracker | null = null;
  /**
   * `[CORP-3b]` (`ol-2zfj.35`) — the citation-grain sibling of `materiality`
   * above: `[D-093]`'s "did THIS instrument's own cited passage change"
   * question, one batch pass per ingestion tick rather than per `'modify'`
   * event. Built unconditionally, same posture as `materiality`: the free
   * hash comparison and the store need no Worker token; only the judge call
   * for a genuinely changed passage does (F7.8). See
   * `ingestion/materiality/citation-revision-wiring.ts`'s module doc for the
   * MCQ-only, batch-pass scoping and `citation-hash-store.ts`'s for what
   * "the cited passage" means for this caller.
   */
  private citationRevision: CitationRevisionTrigger | null = null;
  /**
   * F6.9's per-course material-arrival timestamps (`ol-v7r5.6`) — a local
   * `data.json` projection, fed by `recordMaterialArrivalIfObserved` below on
   * the same materiality trigger path as `this.materiality`. Built
   * unconditionally in `onload`, same posture as `materiality` itself: a
   * local persisted store needs no Worker token.
   */
  private materialArrivals: ObsidianMaterialArrivalStore | null = null;
  /**
   * F6.9's asked-once term window (`ol-v7r5.6`) — read by
   * `today/data-source.ts`'s `createRhythmSource` on every panel open.
   * `save` has no production caller yet; see `today/term-window-store.ts`'s
   * module doc for the named F7.2 gap that blocks one.
   */
  private termWindowStore: ObsidianTermWindowStore | null = null;

  /**
   * `ol-r5j4`: a cached `RegistryOverrides` snapshot, loaded once in `onload`
   * and refreshed every time `registry/provider.ts`'s `rename`/
   * `withdrawConcept`/`restoreConcept` write a new one
   * (`onOverridesChanged` below). Exists solely so `draftQuizCardsDeps` and
   * `composeExplainWhySourceChunks` — both synchronous assemblers of
   * `RetrieveDeps` — can supply `registryOverrides` without awaiting
   * `ObsidianRegistryOverridesStore.load()`'s own async read on every
   * generative call. `EMPTY_REGISTRY_OVERRIDES` (no expansion) until the
   * first load resolves or she has ever renamed/pruned a concept — the same
   * "absent means no change in behaviour" default `RetrieveDeps
   * .registryOverrides` itself documents.
   */
  private registryOverridesCache: RegistryOverrides = EMPTY_REGISTRY_OVERRIDES;

  /**
   * `ol-0r92.90` (`[IL-P1c2]`): idempotency memo for persisting an accepted
   * explain-back grading's misconception observation events to the vault —
   * keyed on `originInstrumentId`, mirroring `GradingWiring
   * .acceptedObservationsByAttempt`'s own "memoize the in-flight Promise
   * itself" technique (`grading/wiring.ts`) one layer up, so a retry or a
   * concurrent double-accept for the SAME attempt persists the event(s)
   * exactly once rather than once per caller.
   */
  private readonly persistedMisconceptionObservationsByAttempt = new Map<string, Promise<void>>();

  /**
   * C7.8's course-detection surface (`[D-098]` point 1, F1.3, `ol-0r92.7`):
   * course codes `checkForCourseSetupProposals` has already put in front of
   * her this session, confirmed or dismissed either way — never asked about
   * twice in one session, per principle 12's "must not become nagging."
   * **Session-only memory, not a store.** Persisting which courses are
   * confirmed is a `CourseRecord`-shaped, Class C schema addition
   * (`packages/core/src/course/lifecycle.ts`'s module doc); until that lands,
   * this set is empty on every plugin load and she is asked again about every
   * course-shaped folder each time Obsidian restarts.
   *
   * **`[SET-1]` (`ol-egov.141.7.1`) closed this out as the declared path, not
   * a gap left open.** The alternative — persisting confirmed codes — still
   * needs the same `CourseRecord` schema this comment already named, for the
   * same reason: a bare `Set<string>` written to the plugin's own
   * `data.json` would fix a shape before the lifecycle work that also needs
   * the running flip, the archive proposal, retake-is-a-new-record and the
   * leaving-reason enum gets to design it once. That is a Class C call this
   * bead does not make unilaterally, so the restart re-ask is instead
   * recorded as expected behaviour in the exclusions list on
   * `olea-service/docs/dev/alpha-first-user-disclosure.md` (owned by
   * `[OPS-B1]` / `ol-ppxj.36`) — see that bead for the exact sentence.
   */
  private courseSetupSeenCodes = new Set<string>();
  /** At most one course-setup modal open at a time — a second detected course waits for this one to resolve rather than stacking prompts. */
  private courseSetupModalOpen = false;
  /**
   * `ol-ppa9` (F1.4/`[D-213]`): course-folder root paths confirmed this
   * session, in confirmation order — the "which folders were ticked this
   * run" notion `ingestion/wiring.ts`'s `buildFirstReadFolderViews` and
   * `home/view.ts`'s `'first-read'` state both need and neither owns. Never
   * persisted, same in-memory-for-the-process-lifetime posture as
   * `courseSetupSeenCodes` above (and the same acknowledged gap: empty again
   * on every plugin restart). Read by `firstReadFolderViewsFor` below.
   */
  private tickedCourseFolders: VaultPath[] = [];
  /**
   * `[D-219]` (`ol-9c0k`): the previous tick's per-folder queue counts, keyed
   * by folder — this method's own folder-grain half of
   * `ingestionSessionJustClosed`'s two-snapshot pattern.
   * `firstReadFoldersJustFinished` (`ingestion/wiring.ts`) compares this
   * against the current tick's counts to find which folders just drained.
   * Empty until the first tick that has any ticked folder to track; never
   * persisted, same in-memory-for-the-process-lifetime posture as
   * `tickedCourseFolders` above.
   */
  private lastFirstReadCountsByFolder: ReadonlyMap<VaultPath, FirstReadFolderCounts> = new Map();
  /**
   * `[D-219]` (`ol-9c0k`): real concept display names landed so far this
   * session, per course folder — the production feed
   * `ingestion/wiring.ts`'s `FirstReadFolderView.landedConcepts` names as a
   * typed slot with no real producer behind it (`ol-0r92.47`'s own module
   * doc, now closed by this field and `readLandedConceptsForFinishedFolders`
   * below). Populated one `readConceptsFromVault` call per folder, fired the
   * instant that folder's own queued/in-flight work reaches zero. Never
   * persisted, same posture as `tickedCourseFolders` above; a folder absent
   * from this map renders as "nothing landed yet" (`buildFirstReadFolderViews`'s
   * own fallback), never a fabricated placeholder.
   */
  private landedConceptsByFolder = new Map<VaultPath, readonly string[]>();

  /**
   * The most recent pass's folded relation set (`ol-2zfj.12`) — both stages'
   * edges, deduplicated and provenance-ranked. Held in memory for the process
   * lifetime, deliberately NOT persisted: `ConceptRelation`'s endpoints are
   * concept NAMES while C7.11/`[D-088]` rule identity an opaque key never
   * derived from content, so a persisted, name-keyed edge store would bake in
   * the exact fragility that clause prevents. The persisted home is a Class C
   * proposal in `olea-service/docs/dev/relation-landing-design.md` §7.1.
   *
   * **Read by `buildReviewSessionInput`'s `composeReviewSession` call site**
   * (`ol-v7r5.7`), which passes `this.servedRelationEdges()` into
   * `buildReviewSession`'s `relations` input, feeding `session/build.ts`'s
   * C7.9 containment co-presence filter. The Today panel's
   * `createVaultInstrumentSource` wiring stopped being a second reader of
   * this field at `[SESS-8.5]` (`ol-egov.132.5`): its due count now reads
   * the shared study-session composition instead of running its own
   * `buildReviewSession` walk, and that composer has no containment logic of
   * its own yet (`[SESS-11]`, `ol-egov.132.12`) — so threading this fold
   * into it would be a no-op, not a fix. Of `[D-070]`'s two corpus-type
   * readers, the misconception record's confusion pairing now has real code
   * and a real caller (`ol-2zfj.32`, `[D-130]`, `tickIngestionAndMaybeRunCorpusRelations`
   * below); queue ordering does not. No clause names a triage surface (design
   * doc §7.2); that gap is unchanged by this bead.
   */
  private relations: RelationSet | null = null;
  /**
   * The most recent pass's confusion-pairing corroboration verdicts
   * (`ol-2zfj.32`, `[D-130]`) — `corroborateConfusionPairings` run against
   * `this.relations` and the misconception projection, held in memory for the
   * process lifetime same as `this.relations` itself and never persisted.
   * `[D-130]` names no student surface for this reader; nothing here reads
   * this field yet, which is the "no surface" half of that ruling rather than
   * a gap — a future consumer bead is what would give it one.
   */
  private confusionPairingVerdicts: readonly ConfusionPairingVerdict[] = [];
  /**
   * The most recent tick's `ConceptRecord[]`, folded with that same tick's
   * completed read's passage anchors (`ol-2zfj.49` second half,
   * `extractConceptsWithAnchors`) — held in memory for the process lifetime,
   * same posture as `this.relations`, and never persisted.
   *
   * **Reachability.** This IS a real production caller of `foldReadAnchors`:
   * every corpus-relation-batch tick below re-walks the vault
   * (`extractConceptsWithAnchors`, no new network call — only the local walk
   * plus the in-memory fold) and folds that walk's `ConceptRecord`s against
   * this same tick's already-completed `pass.read.concepts`. The registry
   * view's wiring below reads this field through a thunk
   * (`conceptRecords: () => this.conceptRecords`) so `registry/provider.ts`'s
   * `load()` can overlay `anchor`/`alsoIn` onto the vault walk's own
   * concepts — F8.4's `[D-171]` click-through shows passage grain once a
   * read has completed, note-grain-only before that (`ol-2zfj.49` closing
   * step).
   */
  private conceptRecords: readonly ConceptRecord[] | null = null;
  /** The ingestion queue's snapshot as of the PREVIOUS tick — `ingestionSessionJustClosed`'s other half. */
  private lastIngestionSnapshot: QueueSnapshot | null = null;

  /**
   * The C7.9 containment filter's edge argument (`ol-v7r5.7`) — every served
   * edge in `this.relations`, or `[]` before the first corpus-relation batch
   * has ever folded one in. `servedRelations` applies the `[D-093]`
   * abstention gate; this method exists only so both session-composition call
   * sites read the identical, current fold rather than each re-deriving the
   * `null` case its own way.
   */
  private servedRelationEdges(): readonly ConceptRelation[] {
    return this.relations === null ? [] : servedRelations(this.relations);
  }

  /**
   * `[JEV-11]` (`ol-3ux7.96`) — routes every `data.json` read through
   * `dataFileHost`, so it queues behind any write already in flight from
   * ANY store built with `this` as its host, not only `gateStageStore`. See
   * `dataFileHost`'s own field doc.
   */
  override loadData(): Promise<unknown> {
    return this.dataFileHost.loadData();
  }

  /** The write half of the same routing — see `override loadData` just above. */
  override saveData(data: unknown): Promise<void> {
    return this.dataFileHost.saveData(data);
  }

  override async onload(): Promise<void> {
    // F7.3 usage view (`ol-p3t09`): every Worker transport built below records
    // the D-005-safe per-call subset (task id, prompt version, model id) into
    // `usage/log-store.ts`'s own `data.json` key, which the settings pane's
    // usage section aggregates. The wrapper keeps the factory signature every
    // wiring site already expects.
    const usageLogStore = new ObsidianUsageLogStore(this);
    const createRecordingTransport: typeof createObsidianWorkerTransport = (config) =>
      createObsidianWorkerTransport(config, (entry) => {
        void usageLogStore.record({ ...entry, recordedAt: new Date().toISOString() });
      });

    const vault = new ObsidianSource(this.app);
    // The queue and the panel must agree about what "due" means, so both read
    // the same walk and the same replay. One `Scheduler`, built here, is what
    // makes that literally the same computation rather than two that match.
    const scheduler = createFsrsScheduler();

    // The device id names this install's review-log file (C5.2). The Today
    // panel is the first reader of that log, so this is where minting it
    // first has to happen — `ensureDeviceId` is idempotent and writes only on
    // the run that mints.
    const deviceId = await ensureDeviceId(this);

    // `this` satisfies `ObsidianDataHost` (`loadData`/`saveData`) — same
    // narrow-port pattern `ObsidianQueueStore` and `ObsidianKeywordIndexStore`
    // already use. `createObsidianWorkerTransport` is injected rather than
    // built inside the tab so `settings-tab.ts` never has to import
    // `obsidian`'s `requestUrl` itself (ol-k57j; see `worker/obsidian-transport.ts`).
    // F2.10's toggle (`ol-0r92.29`): one mutable object shared by reference
    // with `OleaSettingTab` (which updates it live on every toggle) and the
    // `enabled` thunk built below — see `settings/heading-offer-setting.ts`'s
    // module doc for why a synchronous thunk needs this rather than the
    // store's own `load()`. Default `true` (on) until the fire-and-forget
    // load just below resolves, matching F2.10's own default-on framing;
    // never blocks `onload`, same posture `cachedPlan`'s refresh takes.
    const headingOfferSetting: HeadingOfferSettingSnapshot = { enabled: true };
    void new ObsidianHeadingOfferSettingStore(this).load().then((persisted) => {
      headingOfferSetting.enabled = persisted.enabled;
    });

    // Constructed after `vault` and `deviceId` exist because F7.4's privacy
    // section (`ol-p6t01`) needs both.
    this.addSettingTab(
      new OleaSettingTab(
        this.app,
        this,
        this,
        createRecordingTransport,
        { vault, deviceId },
        headingOfferSetting,
      ),
    );

    // C5.5/A2.5 (P5-T07): the plan is a rebuildable cache (D-006), so the
    // synchronous half is just "read whatever is on disk" — fast, and awaited
    // so the very first session opened after a restart already reflects
    // yesterday's plan instead of always starting Phase A. Recomputing it is
    // `refreshCachedStudyPlan`'s job, kicked off below and never blocking
    // `onload`.
    const studyPlanStore = new ObsidianStudyPlanStore(this);
    const cachedPlan = (await loadCachedStudyPlan(studyPlanStore, new Date())).plan;

    // `ol-p3t07a`: built here, before `this.review`, so `this.review.ports`
    // below can wire the real `DraftAcceptPort` rather than a placeholder.
    // Needs only `vault`/`deviceId` — no Worker token, unlike `retrieval`/
    // `keywordIndex` below — so the cache and accept/reject flow work
    // offline; only the sweep itself (never called from here) needs a
    // configured Worker (F7.8).
    // Captured as a local, not re-read through `this.generation` below: a
    // plain local of type `GenerationWiring` stays non-null across every
    // closure that captures it (the bulk-review view factory included),
    // where re-reading `this.generation` inside a lazily-invoked
    // `registerView` callback would need a redundant null check for
    // something that is, in fact, built unconditionally right here.
    const generationWiring = buildGenerationWiring({ vault, deviceId });
    this.generation = generationWiring;

    // F2.10's accept/dismiss verb pair (`[D-170]`/`[GEN-2]`, `ol-0r92.27`) —
    // shares `generationWiring.cache` with the automatic sweep above, so a
    // heading-offer-accepted draft and a sweep-drafted one live in the same
    // cache and are indistinguishable to `open-session.ts`. `draftDeps` is a
    // thunk, not `this.draftQuizCardsDeps()` called once here, for the exact
    // reason `revision.draftDeps` below is one too (F7.8: read fresh per call).
    this.headingOffer = createHeadingOfferPort({
      cache: generationWiring.cache,
      draftDeps: () => this.draftQuizCardsDeps(),
    });
    // `ol-i19f`: the surface-wiring layer over the port above — reads
    // `vault` (already in scope) and `this.conceptRecords` fresh on every
    // check (F7.8-shaped "never captured once", same as `draftDeps` just
    // above). `ol-0r92.29` adds the real settings field: `enabled` reads
    // `headingOfferSetting` (built above, shared with `OleaSettingTab`),
    // never a value captured once — same reasoning as `conceptRecords`
    // here and `draftDeps` above.
    this.headingOfferForItem = createHeadingOfferBannerTracker(
      createHeadingOfferForItem({
        vault,
        port: this.headingOffer,
        conceptRecords: () => this.conceptRecords,
        enabled: () => headingOfferSetting.enabled,
      }),
    );

    this.review = {
      vault,
      scheduler,
      deviceId,
      plan: cachedPlan,
      ports: {
        // The authoritative D7.1 write path (INV-4): logging exists before the
        // feature that produces the data, which is what makes the data
        // recoverable at all.
        reviewLog: createVaultReviewLogPort(vault, deviceId),
        // F2.6's durable half (D-020, `ol-xvmx`): every suspend now reaches
        // the log through the same append discipline as a review, so the set
        // survives past this session instead of a `Notice` being the only
        // trace it ever happened.
        suspendPort: createVaultSuspendPort(vault, deviceId),
        // F2.12's offer/decline write (`ol-0r92.28`, `ol-nqtz`): without this
        // the banner's `recordExplainBackOfferShown`/`recordExplainBackOfferDeclined`
        // calls have nothing to write through, and the offer renders but
        // leaves no trace.
        explainBackOfferLog: createVaultExplainBackOfferLogPort(vault, deviceId),
        editPort: createObsidianEditPort(this.app),
        // Note the absence of an `App` here: `createVaultNoteExistsPort` asks
        // the `VaultSource` (`ol-t5lj`), which is why the workbench can mount
        // this whole path against a shim that knows nothing about vaults.
        noteExists: createVaultNoteExistsPort(vault),
        clock: systemClock,
        // F3.3/`[D-097]`'s accept-at-first-presentation seam (`ol-p3t07a`,
        // `ol-mfn0`): resolves a cached, unreviewed draft the moment she
        // answers, edits, or rejects it.
        draftAcceptPort: this.generation.acceptPort,
        // `[D-046]` clause 4 / `[D-095]` (`ol-fgba` [DISP-1]): the grade the
        // session asserts about an answered MCQ is a claim about her
        // knowledge, so it carries the same gesture every other claim
        // carries. Absent means the gesture is not drawn at all — never
        // drawn and inert.
        gradeContestPort: createVaultGradeContestPort(vault, deviceId, () =>
          isoWithLocalOffset(new Date()),
        ),
      },
    };

    // Never awaited: `composeOracleRanking` walks and re-segments her past
    // papers and objectives (tier-3 extraction), real vault I/O that must not
    // hold up view registration or the command palette. F2.8's Phase B simply
    // is not in force until this resolves — Phase A (the plan above, possibly
    // `null`) is what she gets meanwhile, which is exactly plan §7.1.4's
    // "may refresh," never "must, before anything else works."
    void this.refreshCachedStudyPlan(vault, deviceId, studyPlanStore);

    this.registerView(VIEW_TYPE_OLEA_REVIEW, (leaf) => {
      // `ol-v7r5.35` (`[D-193]`): ONE frozen queue per opened review tab —
      // held in THIS closure (one per leaf, this factory's own scope),
      // never on `this`, which is shared across every open tab. Same "per
      // surface, not per call" scope `session-builder/provider.ts` already
      // gives its own sitting inside this identical `registerView` pattern.
      const reviewSessionOpener = createReviewSessionOpener({ now: () => new Date() });
      return new ReviewView(
        leaf,
        () => this.composeReviewSession(reviewSessionOpener),
        // ol-h3wy: the Today panel used to keep showing whatever it
        // computed when it was opened, because nothing called
        // `TodayView.refresh` after a session. Whatever closing the tab
        // meant — queue finished, closed early, or never composed — is
        // exactly when her due counts may have changed underneath it.
        //
        // Run 11: this now also fires when the queue RUNS OUT with the tab
        // still open, which is the ordinary case rather than an edge one —
        // `revealTodayView` below puts Today in the right sidebar, so it sits
        // visible beside review, and nothing obliges her to close review when
        // she finishes. `review/activity.ts` owns which moments fire.
        () => {
          void this.refreshTodayViews();
        },
        // `ol-sn1q`: F2.7's grounding half, composed against whatever the
        // real keyword index and embedding cache currently hold.
        (instrument) => this.composeExplainWhySourceChunks(instrument),
        // F2.12, `[D-163]` (`ol-12gs`): the confusion banner's "Explain it
        // back" accept action opens `ExplainBackModal` for the offered
        // instrument — see `openExplainBackModal`'s own doc.
        (instrument) => this.openExplainBackModal({ kind: 'instrument', instrument }),
        // `[D-171]`/`ol-2zfj.47`: the review view's one-step affordance to
        // an instrument's registry entry — see `ReviewView`'s own param
        // doc for why this is a callback rather than an `App` import.
        (instrumentId) => void openRegistryEntryFor(this.app, { instrumentId }),
        // `ol-i19f`: F2.10's surface wiring — see `ReviewView`'s own param
        // doc and `heading-offer-wiring.ts`.
        this.headingOfferForItem ?? undefined,
        // `ol-v7r5.35`: the "Keep going" continue path extends the SAME
        // opener's frozen sitting — see `ReviewView`'s own param doc and
        // `extendReviewSession` below.
        () => this.extendReviewSession(reviewSessionOpener),
        // `ol-v7r5.35`: releases this tab's own sitting on close.
        () => reviewSessionOpener.close(),
      );
    });

    // Registered *after* `this.review` is built, not before. `ensureDeviceId`
    // is awaited above, and a command registered ahead of it has a window —
    // short, but real — in which running it would compose no session and put
    // the "could not read your vault" screen in front of her for a reason that
    // is not true. Nothing else in `onload` needs the commands to exist
    // earlier.
    registerOleaCommands(this, {
      startReview: () => {
        void this.revealReviewView();
      },
      createCard: () => {
        void this.handleCreateCardCommand();
      },
      openToday: () => {
        void this.revealTodayView();
      },
      openGap: () => {
        void this.revealGapView();
      },
      // `ol-p5t06b`, amended by `[D-243]` (`ol-egov.132.7` [SESS-8.7]): the
      // palette's own door onto session assembly used to open the (now
      // shrunk) session-builder screen; F4.6 rules "there is no builder
      // screen to pass through" — this opens Home instead, unfocused, built
      // from the whole ranking. The gap view's `build-session` affordance is
      // the other door, and seeds a concept — see `revealHomeView`.
      buildSession: () => {
        void this.revealHomeView();
      },
      // `ol-jie3`: F3.3's bulk-review triage path.
      openBulkReview: () => {
        void this.revealBulkReviewView();
      },
      // `ol-r68l` (F8.8, `[D-134]`): the retrospective's own F7.7 command —
      // still the one door that opens the reading itself. `ol-0r92.17`
      // added the standing OFFER's two hosts (`openHome`/`openGrove`
      // below), which reveal this same view when their own "Open" button is
      // clicked; this command remains the direct door for anyone who
      // reaches for it by name.
      openRetrospective: () => {
        void this.revealRetrospectiveView();
      },
      copyDiagnostics: () => {
        void copyDiagnosticsToClipboard({
          pluginVersion: this.manifest.version,
          loadQueue: () => new ObsidianQueueStore(this).load(),
          loadIndex: () => new ObsidianKeywordIndexStore(this).load(),
        });
      },
      // `ol-l5og.11`: the registry's open command, folded into the shared
      // command module (`commands/ids.ts` / `register-commands.ts`) — the
      // Class A tidy `ol-4v2l`'s direct registration named for a later lane.
      openRegistry: () => {
        void this.revealRegistryView();
      },
      // `ol-0r92.17` (F8.8, `[D-134]` Q1, F7.7) / `ol-2zfj.38`: Home's and
      // the grove's own open commands, folded into the same shared command
      // module `openRegistry` above already uses — the identical Class A
      // tidy `docs/dev/surface-register.md` named as still owed for these
      // two. No longer registered directly on `Plugin` here.
      openHome: () => {
        void this.revealHomeView();
      },
      openGrove: () => {
        void this.revealGroveView();
      },
      // `ol-s46v` (`[D-152]`, F3.3): the process-now command palette entry,
      // folded from `main.ts`'s own direct `this.addCommand` call
      // (`ol-0r92.21`) into the shared module — same conditional-handler
      // shape `openRegistry`/`openHome`/`openGrove` above use, extended with
      // `checkCallback` (`commands/types.ts`) since this is the first Olea
      // command whose PALETTE VISIBILITY itself has to react to which file is
      // active, not just what runs when it's invoked. Identical logic to the
      // direct registration it replaces: hidden from the palette with no
      // active file, or a file `isProcessNowSupported` declines. The note
      // context-menu door onto the same action stays a direct
      // `this.registerEvent` call below — `register-commands.ts` has no
      // precedent for an event registration, and this bead does not invent
      // one.
      processNoteNowCheckCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null || !isProcessNowSupported(file.path)) return false;
        if (checking) return true;
        void this.processNoteNow(file.path);
        return true;
      },
      // F5.1, `[D-163]` (`ol-12gs`): the on-demand door onto `ExplainBackModal`,
      // free-form — she names the topic herself. The SAME modal is also
      // opened from the confusion banner, the session builder and Today, via
      // `this.openExplainBackModal` directly (see that method's own doc).
      openExplainBack: () => {
        this.openExplainBackModal({ kind: 'freeform' });
      },
    });

    // Same store, same "read fresh on every call, never cached" discipline
    // `plan/provider.ts`, `gap/provider.ts` and `session-builder/provider.ts`
    // already hold for `assignmentsBasePath` — a settings change she makes
    // between two opens of the Today pane must not need a reload to take.
    const todayTrendsSettingsStore = new ObsidianStudyPlanSettingsStore(this);

    this.registerView(VIEW_TYPE_OLEA_TODAY, (leaf) => {
      // F7.2's term-dates ask (`[D-147]`, `ol-0r92.6`) — read once per leaf
      // creation (not at `registerView` registration time, which runs
      // before `onload` has constructed `this.termWindowStore` — see that
      // field's own doc), and narrowed into a local so the `termDatesAsk`
      // closures below never need a non-null assertion on the mutable
      // `this.termWindowStore` field. Same deferred-to-leaf-creation timing
      // the `rhythm` field's own `this.termWindowStore !== null` guard
      // below relies on.
      const termWindowStoreForAsk = this.termWindowStore;
      return new TodayView(leaf, {
        load: async () => {
          const { assignmentsBasePath } = await todayTrendsSettingsStore.load();
          return loadTodayPanel({
            vault,
            deviceId,
            // Real, as of the session pipeline: it walks the vault for
            // instruments and replays the log for their state. It still
            // returns `null` — which the panel renders as "cannot count yet"
            // rather than as a zero — when the walk fails.
            instruments: createVaultInstrumentSource({
              vault,
              scheduler,
              deviceId,
              now: () => new Date(),
              // `[SESS-8.5]` (`ol-egov.132.5`, one-assembly-path.md §3a/§3c):
              // the same holder and on-demand port Start and the review tab
              // use, so Today's due count reads "the list she is working"
              // off the identical shared composition rather than its own
              // `buildReviewSession` walk — see `data-source.ts`'s own doc
              // for what this narrows (the study plan must now be
              // configured) and what it no longer re-applies (C7.9
              // containment, `[SESS-11]`/`ol-egov.132.12`).
              studySessionHolder: this.studySessionHolder,
              composeDefaultStudySession: () => this.composeDefaultStudySession(),
            }),
            now: () => new Date(),
            // F6.2/F6.5 (`ol-lohq`, `ol-p6t04`): the trends source feeds the
            // Today panel's insights. Absent path means "not configured",
            // which `createVaultTrendsSource` already reads as "no weights"
            // rather than a guessed folder.
            trends: createVaultTrendsSource({
              vault,
              assessmentsBasePath: assignmentsBasePath,
              // F6.5(b) (ol-v7r5.38): floor shares come from the cached plan
              // artifact, never recomputed client-side.
              studyPlanStore,
              now: () => new Date(),
              // F6.2 (ol-95vv.6): her rename overlay for the tending line's
              // concept names; the cache is refreshed by the overrides store
              // subscription above, so this read is current per load.
              registryOverrides: this.registryOverridesCache,
            }),
            // F6.2's cross-course scope reading (`ol-4qvc`): one grove model
            // per running course, placed side by side — counts never summed
            // or ranked (F8.3/C5.7).
            scope: createVaultScopeSource({ vault, deviceId, now: () => new Date() }),
            // F6.9's rhythm reading (`ol-v7r5.6`): both stores are built
            // unconditionally in `onload`, same as `materiality` itself, so
            // this is absent only before `onload` has run — never in a
            // reachable production render.
            ...(this.materialArrivals !== null && this.termWindowStore !== null
              ? {
                  rhythm: createRhythmSource({
                    materialArrivals: this.materialArrivals,
                    termWindow: this.termWindowStore,
                  }),
                }
              : {}),
          });
        },
        // The panel's one primary action and the command palette entry reach
        // the same tab, by the same call — F6.1's "Start review is the one
        // way in" is only true if it is literally one way in.
        startReview: () => {
          void this.revealReviewView();
        },
        // `[D-046]` clause 4 / `[D-095]` (`ol-fgba` [DISP-1]): every reading
        // this panel asserts carries the one ratified contest gesture, and
        // the dispute is recorded either way. Built from her own log, on
        // device — the sheet issues no request.
        contest: createTodayContestSupport({
          vault,
          deviceId,
          conceptIdsByCourse: async () => {
            const source = createVaultTrendsSource({ vault });
            const records = await source.listConceptCourses();
            const byCourse: Record<string, string[]> = {};
            for (const record of records ?? []) {
              for (const course of record.courses) {
                const bucket = byCourse[course] ?? [];
                bucket.push(record.conceptId);
                byCourse[course] = bucket;
              }
            }
            return byCourse;
          },
          today: () => localToday(new Date()),
          now: () => isoWithLocalOffset(new Date()),
          readHistory: () => readReviewHistory(vault, deviceId, { today: localToday(new Date()) }),
        }),
        // F7.2's term-dates ask (`[D-147]`, `ol-0r92.6`) — same
        // `this.termWindowStore !== null` guard `rhythm` above uses: the
        // store is built unconditionally in `onload`, so absent here means
        // only "before `onload` has run", never a reachable production
        // render.
        ...(termWindowStoreForAsk !== null
          ? {
              termDatesAsk: {
                state: () => termWindowStoreForAsk.askState(),
                openSettings: () => this.openSettingsTab(),
              },
            }
          : {}),
      });
    });

    // `ol-2tyj`: the gap/coverage screen's production reader.
    // `createLocalGapProvider` recomputes on every `load()` — no cache, see
    // that module's doc — so this factory closure captures nothing that goes
    // stale; each open (and each `refreshGapViews` call below) re-derives the
    // model fresh from the vault and the review log.
    this.registerView(
      VIEW_TYPE_OLEA_GAP,
      (leaf) =>
        new GapView(
          leaf,
          createLocalGapProvider({
            vault,
            deviceId,
            settingsHost: this,
            now: () => new Date(),
            // `exactOptionalPropertyTypes`: omit the key entirely rather than
            // assign `undefined` to it when the Worker isn't configured
            // (F7.8) — same pattern `refreshCachedStudyPlan` below uses for
            // `createLocalStudyPlanProvider`. [ol-v7r5.61 / IL-D7b]
            ...(this.rankWeights?.readRankWeights
              ? { readRankWeights: this.rankWeights.readRankWeights }
              : {}),
            // `ol-p5t06b`: the `'build-session'` affordance has been a label
            // with nothing behind it since P5-T06a. This is what it does —
            // open Home seeded with the row's concept as F4.6's stated-
            // interest steering input, so "Build a session from this" is
            // literally about *this*. Amended by `[D-243]`
            // (`ol-egov.132.7` [SESS-8.7]): this used to open the
            // session-builder screen directly; F4.6 rules that a pre-fill
            // from the gap view is "a pre-fill of a steering input on Home,
            // never a second entry" — see `revealHomeView`.
            buildSession: (row) => {
              void this.revealHomeView(row.conceptName);
            },
          }),
        ),
    );

    // `ol-p5t06b`: the session builder (F4.6, F4.7, F4.8).
    // `createLocalSessionBuilderProvider` recomputes on every `load()` — no
    // cache, for the reason `gap/provider.ts` gives — so this factory closure
    // captures nothing that goes stale, and a budget change inside the view is
    // a fresh composition rather than a re-slice of an old one.
    this.registerView(
      VIEW_TYPE_OLEA_SESSION,
      (leaf) =>
        new SessionBuilderView(
          leaf,
          createLocalSessionBuilderProvider({
            vault,
            deviceId,
            settingsHost: this,
            now: () => new Date(),
            // `exactOptionalPropertyTypes`: omit the key entirely rather than
            // assign `undefined` to it when the Worker isn't configured
            // (F7.8) — same pattern `refreshCachedStudyPlan` below uses for
            // `createLocalStudyPlanProvider`. [ol-v7r5.61 / IL-D7b]
            ...(this.rankWeights?.readRankWeights
              ? { readRankWeights: this.rankWeights.readRankWeights }
              : {}),
            // F4.6 / F6.4, `[D-163]` (`ol-12gs`): this screen's own door onto
            // `ExplainBackModal` — nothing to refresh on close, since the
            // screen underneath is never torn down (hand-off, not a rebuild)
            // and this bead deliberately does not wire F4.6's session-time
            // accounting fold (`explain-back/modal.ts`'s module doc).
            openExplainBack: () => {
              this.openExplainBackModal({ kind: 'freeform' });
            },
            // Same instance the Today panel's replay uses — see this file's
            // own comment above `scheduler`'s construction: "one Scheduler...
            // is what makes that literally the same computation."
            scheduler,
            // F2.19 (`ol-v7r5.11`): the same served relation fold
            // `composeReviewSession` and the Today panel's instrument source
            // already read (`this.servedRelationEdges()`'s own doc) — a thunk
            // so a later ingestion tick's fresh batch reaches a session built
            // after this leaf was first opened, not just the one at hand when
            // it was.
            relations: () => this.servedRelationEdges(),
            // `ol-egov.132.1` [SESS-8.1] (A2.5, C5.6): the same cached plan
            // `buildReviewSessionInput` reads as `this.review.plan` — a
            // thunk, not a captured value, so a background
            // `refreshCachedStudyPlan` that lands after this leaf opened
            // still reaches the next composition, exactly like `plan` on
            // `ReviewWiring` already does for the answered path.
            plan: () => this.review?.plan ?? null,
            // `[SESS-13]` (`ol-egov.132.14`): the same `[D-092]` window
            // reading the Start-button door gets, so the session-builder leaf
            // and the composed session she sits cannot disagree about how far
            // behind a course is — see `windowDeficitFromReviewLog` below.
            windowDeficit: (deficitInput) => this.windowDeficitFromReviewLog(deficitInput),
          }),
        ),
    );

    // `ol-jie3`: F3.3's bulk-review triage path — the same accept/edit/reject
    // resolution first-presentation review offers, at list density, grouped
    // by document. `createBulkReviewController` is called fresh on every
    // open (mirrors `createLocalGapProvider`'s "no cache, recompute" posture
    // above), so a draft accepted from first-presentation review a moment
    // earlier does not linger here.
    this.registerView(
      VIEW_TYPE_OLEA_BULK_REVIEW,
      (leaf) =>
        new BulkReviewView(
          leaf,
          () =>
            createBulkReviewController({
              cache: generationWiring.cache,
              acceptPort: generationWiring.acceptPort,
              editPort: createObsidianEditPort(this.app),
            }),
          // `[D-216]`/`ol-mbh6`: the clearing row's source peek, mirroring
          // `ReviewView`'s own `instrumentId`-keyed call to the identical
          // `[D-171]` affordance a few hundred lines above — targeted by
          // `conceptKey` here because a still-pending draft has no
          // `instrumentId` yet (see `BulkReviewView`'s own `openSource` doc).
          (conceptKey) => void openRegistryEntryFor(this.app, { conceptKey }),
          // `ol-0r92.71` (`[H-1.8a]`): the classified-refusal render surface's
          // last reachability hop — reads `this.lastGenerationRefusals` fresh
          // on every render (`getRefusals` is called, never captured, by
          // `BulkReviewView.renderRefusals`), so a sweep that lands while this
          // view is open is reflected on the next render without a rebuild.
          () => this.lastGenerationRefusals,
        ),
    );

    // `ol-r68l` (F8.8, `[D-134]`): the post-assessment retrospective.
    // `createLocalRetrospectiveProvider` recomputes on every `load()` — no
    // cache, same posture `createLocalGapProvider`/`createLocalSessionBuilder
    // Provider` already hold — so this factory closure captures nothing that
    // goes stale.
    this.registerView(VIEW_TYPE_OLEA_RETROSPECTIVE, (leaf) => {
      const provider = createLocalRetrospectiveProvider({
        vault,
        deviceId,
        offerStore: createRetrospectiveOfferEventLog({ vault, deviceId, now: () => new Date() }),
        settingsHost: this,
        now: () => new Date(),
      });
      return new RetrospectiveView(leaf, {
        load: async () => {
          try {
            const result = await provider.load();
            return result === null ? { kind: 'none' } : { kind: 'reading', result };
          } catch {
            return { kind: 'unavailable' };
          }
        },
        markOpened: (assessmentPath) => provider.markOpened(assessmentPath),
        acceptToVault: (reading, ownWords) => provider.acceptToVault(reading, ownWords),
      });
    });

    // `[D-223]` (F6.10, `ol-l5og.21` [HOME-2]): Home is now the landing
    // dashboard — the composed session (F6.4, via the SAME session-builder
    // provider `VIEW_TYPE_OLEA_SESSION` below uses) plus F8.1's per-course
    // coverage strips (via the SAME grove provider `VIEW_TYPE_OLEA_GROVE`
    // below uses), never a second computation of either. `scheduler` and
    // `servedRelationEdges()` are the identical instance/thunk every other
    // reader of them already shares — see `home/provider.ts`'s own module
    // doc. `openRetrospective`/`startSession`/`openGrove`/`openExplainBack`
    // are supplied here (navigation), never by `createLocalHomeProvider`
    // (data) — the same split `ol-0r92.17` already drew for
    // `openRetrospective`.
    //
    // `[D-243]` (`ol-egov.132.7` [SESS-8.7]): `openSessionBuilder` is gone —
    // `startSession` replaces it, wired to the review surface she actually
    // answers from (`revealReviewView`, the same door `startReview`/the Today
    // button already use) rather than to a session-assembly screen.
    // `[SESS-8.4]` (`ol-egov.132.4`): Start now also enters
    // `session/holder.ts`'s shared sitting first — see
    // `enterStudySessionHolderForStart`'s own doc — closing the gap
    // `home/view.ts`'s module doc named ("What Start does NOT yet do").
    this.registerView(VIEW_TYPE_OLEA_HOME, (leaf) => {
      const provider = createLocalHomeProvider({
        vault,
        deviceId,
        settingsHost: this,
        now: () => new Date(),
        scheduler,
        relations: () => this.servedRelationEdges(),
        // `ol-egov.132.1` [SESS-8.1] (A2.5, C5.6): passed straight through
        // to the session-builder provider Home wraps — see that call
        // site's own comment above, and `home/provider.ts`'s `plan` doc.
        plan: () => this.review?.plan ?? null,
        // `ol-ppa9` (F1.4/`[D-213]`): a thunk, not a snapshot, so a later
        // ingestion tick's fresh queue state and a later course-setup
        // confirmation both reach a Home leaf built before either happened —
        // same "read fresh" reasoning `servedRelationEdges`'s callers already
        // give for their own thunked reads.
        firstRead: () => this.firstReadFolderViewsFor(this.tickedCourseFolders),
      });
      return new HomeView(leaf, {
        load: (request) => provider.load(request),
        openRetrospective: () => {
          void this.revealRetrospectiveView();
        },
        startSession: () => {
          void (async () => {
            await this.enterStudySessionHolderForStart();
            void this.revealReviewView();
          })();
        },
        openGrove: () => {
          void this.revealGroveView();
        },
        dismiss: (assessmentPath) => provider.dismiss(assessmentPath),
        // F4.6 / F6.4, `[D-163]` (`ol-12gs`): relocated from the (now
        // shrunk) session-builder screen — see `HomeViewDeps.openExplainBack`'s
        // own doc for why.
        openExplainBack: () => {
          this.openExplainBackModal({ kind: 'freeform' });
        },
      });
    });

    // `ol-0r92.17` (F8.1, `[D-134]` Q1): the course grove — `createLocalGroveProvider`
    // now reads `olea-core`'s real F8.1 six-state computation (`ol-o8eo`) where a
    // course has a registered source; see `grove/provider.ts`'s module doc for the
    // three-way status and the remaining naming call (`ol-z0j9`). Each course
    // section carries its own filtered slice of the standing offer
    // (`retrospective/offer-card.ts`: "a future grove view would filter to
    // its own course").
    this.registerView(VIEW_TYPE_OLEA_GROVE, (leaf) => {
      const provider = createLocalGroveProvider({
        vault,
        deviceId,
        settingsHost: this,
        now: () => new Date(),
        // `ol-kghd` (C7.9): the same served relation fold `session-builder/
        // provider.ts` and `composeReviewSession` already read — a thunk so
        // a later ingestion tick's fresh batch reaches a grove built after
        // this leaf was first opened, not just the one at hand when it was.
        relations: () => this.servedRelationEdges(),
      });
      return new GroveView(leaf, {
        load: () => provider.load(),
        openRetrospective: () => {
          void this.revealRetrospectiveView();
        },
        dismiss: (assessmentPath) => provider.dismiss(assessmentPath),
        // `[D-226]` ruling 1, S1.
        registerSource: (input) => provider.registerSource(input),
        app: this.app,
      });
    });

    // `ol-4v2l` (F8.4/F8.5, `[REG-1]`, amended acceptance `[D-135]`): the
    // concept and instrument registry — the one browsable inventory over
    // her concept spine, since tiers 2/3 of it never touch the vault (see
    // `registry/provider.ts`'s module doc). `createLocalRegistryProvider`
    // recomputes on every `load()` — no cache, same posture every other
    // local provider in this file holds. `createObsidianEditInstrumentPort`
    // is the one Obsidian-backed piece (INV-1) — everything else the
    // provider needs is a `VaultSource` and a device id.
    this.registerView(
      VIEW_TYPE_OLEA_REGISTRY,
      (leaf) =>
        new RegistryView(
          leaf,
          createLocalRegistryProvider({
            vault,
            deviceId,
            settingsHost: this,
            now: () => new Date(),
            // `exactOptionalPropertyTypes`: omit the key entirely rather than
            // assign `undefined` to it when the Worker isn't configured
            // (F7.8) — same pattern `refreshCachedStudyPlan` below uses for
            // `createLocalStudyPlanProvider`. [ol-v7r5.61 / IL-D7b]
            ...(this.rankWeights?.readRankWeights
              ? { readRankWeights: this.rankWeights.readRankWeights }
              : {}),
            editPort: createObsidianEditInstrumentPort(this.app),
            // `[D-171]`/`ol-2zfj.43`: the open-source-location hand-off —
            // until this line the registry's "Open source" action logged an
            // error instead of opening anything (`ol-2zfj.47`).
            openSourceLocationPort: createObsidianOpenSourceLocationPort(this.app),
            // F8.4a/`[D-176]` (`ol-r1by`): the note-offer accept hand-off —
            // without this line, accepting the offer would log an error
            // instead of creating a note. See `obsidian-ports.ts`'s own doc
            // for what this port does and does not yet do (key binding).
            acceptNoteOfferPort: createObsidianAcceptNoteOfferPort(vault),
            // `ol-r5j4`: keeps `this.registryOverridesCache` current the
            // instant she renames, withdraws or restores a concept from this
            // view — see that field's own doc.
            onOverridesChanged: (overrides) => {
              this.registryOverridesCache = overrides;
            },
            // `ol-2zfj.49` (second half): threads `this.conceptRecords` in —
            // a thunk (matching the grove view's `relations` thunk above) so
            // a corpus-relation tick that completes after this view was
            // constructed still reaches the next `load()`. `null` before the
            // first such tick; `provider.ts`'s `load()` falls back to the
            // plain vault walk's concepts in that case, identical to before
            // this field existed.
            conceptRecords: () => this.conceptRecords,
          }),
        ),
    );

    // Read once and shared by every drain below — D-002's "mobile enqueues,
    // desktop drains" applies to the keyword index rebuild and the embedding
    // drain for the same reason it applies to the ingestion queue: both are
    // real, possibly-lengthy work a backgrounded mobile Obsidian can be
    // suspended mid-way through, with no resume story.
    const capability = obsidianDeviceCapability();

    this.ingestion = await buildIngestionRunner({
      vault,
      queueStore: new ObsidianQueueStore(this),
      capability,
      // `ol-p3t07a`: F3.3's "generate automatically when material lands"
      // trigger. Fires once per drained job, best-effort (see `wiring.ts`'s
      // own doc for why a generation failure can never fail the ingestion
      // job it rode in on).
      onUnitsLanded: (units) => this.onUnitsLanded(units),
      // `ol-2zfj.39` (`[D-133]` end-to-end): a drained `'instrument-revision'`
      // job drafts its successor into the same cache the F3.3 sweep fills,
      // carrying the predecessor id that `accept.ts` stamps on materialize.
      // `draftDeps` read fresh per job — F7.8 grey-out, never a failure.
      revision: {
        cache: generationWiring.cache,
        draftDeps: () => this.draftQuizCardsDeps(),
      },
      // `ol-15f8`/`ol-ua2f`: the standalone-image vision runner (C3.1/C3.3),
      // wired the same F7.8 way every other Worker-backed port in this
      // method is (`this.retrieval`/`this.grading`/`this.concept` below) —
      // `this` satisfies `ObsidianDataHost`, and `createRecordingTransport`
      // (defined above) is the one shared transport factory so vision calls
      // land in the same F7.3 usage log as every other task. See
      // `ingestion/wiring.ts`'s `buildVisionRunner` for the F7.8 grey-out
      // gate (no Worker config yet ⇒ `visionRunner` stays unset, same DF-21
      // honest failure as before this bead).
      vision: {
        dataHost: this,
        createTransport: createRecordingTransport,
      },
    });

    // `ol-0r92.21` [D-152]: the manual process-now timing override, built the
    // instant `this.ingestion` exists — it needs the real engine's own
    // `enqueue`/`tick` (see `process-now.ts`'s module doc for why it cannot,
    // and does not try to, jump the queue). `navigator.onLine` is the
    // production `isOnline` source; `process-now.ts` defaults to `() => true`
    // for tests that never inject one.
    const ingestionForProcessNow = this.ingestion;
    this.processNowAction = createProcessNowAction({
      vault,
      enqueuer: ingestionForProcessNow.engine,
      tick: () => ingestionForProcessNow.engine.tick(),
      onAuthoredNoteUnits: (units) => this.onUnitsLanded(units),
      isOnline: () => navigator.onLine,
    });

    // `ol-0r92.21` [D-152] / `ol-s46v`: the note context menu's own door onto
    // `processNoteNow` — F7.7's existing "two doors, one action" shape
    // (`OLEA_COMMAND_OPEN`/`OLEA_COMMAND_TODAY_OPEN` above), the other door
    // now being the palette entry folded into the `registerOleaCommands` call
    // above via `processNoteNowCheckCallback`. This one stays a direct
    // `this.registerEvent` call: `register-commands.ts` has no precedent for
    // an event registration, and this bead does not invent one.
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || !isProcessNowSupported(file.path)) return;
        menu.addItem((item) => {
          item
            .setTitle('Olea: Process this note now')
            .setIcon('refresh-cw')
            .onClick(() => {
              void this.processNoteNow(file.path);
            });
        });
      }),
    );

    // `[D-226]` ruling 1, S2: the document's own file-menu control — the
    // "same control reachable from the document itself" F1.5(c) names, so
    // registration stays available for the life of a course. See
    // `course-setup/register-source-wiring.ts`'s own module doc for the
    // gate and the documented flat-F7.9-folder scope cut.
    wireDocumentSourceRegistration(this, {
      vault,
      deviceId,
      now: () => new Date(),
      onRegistered: () => {
        void refreshOpenTodayViews(this.app.workspace, VIEW_TYPE_OLEA_GROVE);
      },
    });

    // `ol-2zfj.38`: the vault-watch-to-`engine.enqueue` glue for the
    // multi-format ingestion path — see `ingestion/arrival-watch.ts`'s
    // module doc. Wired the instant `this.ingestion` exists, same ordering
    // `buildKeywordIndexWiring`'s own `watch` wiring follows immediately
    // below; `this.ingestion.engine` satisfies `JobEnqueuer` structurally,
    // no separate handle needed.
    this.register(
      buildIngestionArrivalWatch({
        vault,
        enqueuer: this.ingestion.engine,
        watch: (handler) => vault.watch(handler),
      }),
    );

    // ol-tuvx: `ObsidianKeywordIndexStore` was a finished adapter nothing
    // ever constructed. This is that construction — see
    // `keyword-index/wiring.ts`'s module doc for the rebuild-once and
    // stay-live-via-watch policy.
    this.keywordIndex = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(this),
      capability,
      watch: (handler) => vault.watch(handler),
    });
    this.register(this.keywordIndex.unsubscribe);

    // ol-odb0.1: the embeddings half of retrieval. `null` when no Worker
    // token is pasted yet (F7.8) — see `retrieval/wiring.ts`'s module doc.
    this.retrieval = await buildRetrievalWiring({
      dataHost: this,
      createTransport: createRecordingTransport,
    });

    // ol-drfy: the explain-back grading pipeline's production JudgeCaller,
    // wired to the real Worker transport on the same F7.8 grey-out terms as
    // `this.retrieval` above. See `grading/wiring.ts`'s module doc and this
    // class's own `gradeExplainBackAttempt` method for why nothing calls
    // *that method* yet. `ol-p4t05`/`ol-h2bx` (confusion routing, fully
    // wired now) deliberately route into F2.7's on-demand explain-why
    // channel instead — building the real "write your own explanation and
    // get graded" destination is still blocked on `ol-tka5`/`ol-548w`, both
    // open Class C questions.
    this.grading = await buildGradingWiring({
      dataHost: this,
      createTransport: createRecordingTransport,
    });

    // EXT-7 (`ol-5nle`): the concept-reading stage's production port, wired
    // to the real Worker transport on the same F7.8 grey-out terms as
    // `this.retrieval`/`this.grading` above. See `concept/wiring.ts`'s module
    // doc and this class's own `readConceptsFromVault` for why nothing calls
    // *that method* yet — the same deliberate gap `gradeExplainBackAttempt`
    // documents for grading.
    this.concept = await buildConceptWiring({
      dataHost: this,
      createTransport: createRecordingTransport,
    });

    // KCT-2 (`ol-fx1k`, `[D-114]`): the knowledge-kind classifier's production
    // port, same F7.8 terms and the same deliberate no-trigger gap as
    // `this.concept` — see `classifyKnowledgeKindForConcept` below.
    this.knowledgeKind = await buildKnowledgeKindWiring({
      dataHost: this,
      createTransport: createRecordingTransport,
    });

    // `[EXT-11]` (`ol-kw4a`, `[D-118]`): the corpus-level relation stage's
    // production port. Unlike `this.concept`/`this.knowledgeKind` above, this
    // bead's charge was to close the "nothing calls it yet" gap — see
    // `tickIngestionAndMaybeRunCorpusRelations` below.
    this.corpusRelation = await buildCorpusRelationWiring({
      dataHost: this,
      createTransport: createRecordingTransport,
    });
    this.corpusRelationStateStore = new ObsidianCorpusRelationStateStore(this);

    // Component 3.3's delivered ranking weights (`[D-110]`, `ol-v7r5.3`) —
    // the fetch-or-null wiring built here, threaded into
    // `refreshCachedStudyPlan`'s `createLocalStudyPlanProvider` call below.
    this.rankWeights = await buildRankWeightsWiring({
      dataHost: this,
      httpGet: obsidianRankWeightsGet,
    });

    // Component 3.5's plan-policy fetch (`[D-167]`, `ol-v7r5.25`), hooked
    // up here per `ol-v7r5.27`: same fetch-or-null wiring shape as
    // `rankWeights` above, POSTing over the same `obsidianHttpRequest`
    // adapter `this.retrieval`/`this.grading`/etc already use for the
    // Worker (`PlanPolicyHttpPost` is shape-compatible with `HttpRequestFn`
    // minus the `method`, which is always `'POST'` here).
    this.planPolicy = await buildPlanPolicyWiring({
      dataHost: this,
      httpPost: ((params) =>
        obsidianHttpRequest({ ...params, method: 'POST' })) satisfies PlanPolicyHttpPost,
    });

    // `ol-2zfj.15`: register row 1.4's materiality trigger goes live —
    // `buildMaterialityWiring` existed with nothing in this package
    // constructing it; see `ingestion/materiality/wiring.ts`'s module doc for
    // exactly what this call site needed and why it waited for a lane with
    // `main.ts` free. `ol-2zfj.18` closed the judge gap: `materiality.judge.v1`
    // is reserved in the frozen catalogue (`packages/contracts/src/tasks.ts`),
    // routed in `olea-service/src/tasks/registry.ts`, and
    // `buildMaterialityJudge()` below supplies the transport-backed client on
    // the same F7.8 grey-out terms `retrieval`/`grading`/`concept` above use
    // for an unconfigured Worker. With no Worker token the judge is `null`
    // and `evaluate` degrades to `'judge-unavailable'`, unchanged. The free
    // gates (hash/debounce/floor) run for real either way.
    this.materiality = buildMaterialityWiring({
      dataHost: this,
      clock: { now: () => Date.now() },
      judge: this.buildMaterialityJudge(),
    });
    this.materialityPreviousText = createInMemoryPreviousTextTracker();
    // `ol-2zfj.35` [CORP-3b]: the citation-grain sibling's production caller
    // — see `citationRevision`'s own field doc and
    // `ingestion/materiality/citation-revision-wiring.ts`'s module doc.
    // Reuses the SAME `WorkerMaterialityJudge` construction as `materiality`
    // above (`RevisionJudgePort` is shape-identical to `MaterialityJudge` —
    // `concept/revision/types.ts`'s own doc), adapted rather than relied on
    // via TS method bivariance (`adaptMaterialityJudgeAsRevisionJudge`).
    this.citationRevision = buildCitationRevisionWiring({
      store: new ObsidianCitationHashStore(this),
      clock: { now: () => Date.now() },
      judge: adaptMaterialityJudgeAsRevisionJudge(this.buildMaterialityJudge()),
    });
    // F6.9's rhythm reading (`ol-v7r5.6`): both stores are local `data.json`
    // projections over `this`, same construction shape as `materiality`
    // above — no Worker token needed for either.
    this.materialArrivals = new ObsidianMaterialArrivalStore(this);
    this.termWindowStore = new ObsidianTermWindowStore(this);

    // `ol-r5j4`: prime the registry-overrides cache once at load — see this
    // field's own doc for why `draftQuizCardsDeps`/`composeExplainWhySourceChunks`
    // need a synchronous read rather than this store's own async `load()`.
    // A read failure leaves the cache at `EMPTY_REGISTRY_OVERRIDES` (no
    // expansion), never crashes `onload` — same posture every other
    // best-effort load in this method already takes.
    this.registryOverridesCache = await new ObsidianRegistryOverridesStore(this)
      .load()
      .catch((error: unknown) => {
        console.error('Olea: could not load registry overrides', error);
        return EMPTY_REGISTRY_OVERRIDES;
      });

    // `[JEV-11]` (`ol-3ux7.96`): seed the gate-stage recorder from whatever
    // period is already persisted, so counts continue across this reload
    // rather than restarting at zero. A load failure or a first-ever run
    // both degrade to an honestly empty period — never a crashed `onload`,
    // same posture the registry-overrides load just above already takes.
    const persistedGateStagePeriod = await this.gateStageStore.load().catch((error: unknown) => {
      console.error('Olea: could not load gate-stage counts', error);
      return null;
    });
    if (persistedGateStagePeriod !== null) {
      this.gateStageRecorder.restore(persistedGateStagePeriod.counts);
      this.gateStagePeriodStartedAt = persistedGateStagePeriod.periodStartedAt;
      this.gateStageLastRecordedAt = persistedGateStagePeriod.lastRecordedAt;
    }

    // `[JEV-6]` (`ol-3ux7.89`): the case capture, off unless `data.json`
    // carries a deliberately hand-written config. Every failure path here
    // leaves `judgeCaseCapture` null, which is the ordinary state anyway, so
    // nothing about drafting depends on any of it succeeding.
    const captureConfig: JudgeCaseCaptureConfig | null = await this.judgeCaseCaptureStore
      .loadConfig()
      .catch(() => null);
    if (captureConfig !== null) {
      const recorder = new JudgeCaseCaptureRecorder(captureConfig);
      const persistedCapture = await this.judgeCaseCaptureStore.load().catch(() => null);
      // Continue the window this config already started rather than opening a
      // second one — a window that silently restarted every reload would make
      // "sampled uniformly from the window" false without anything looking
      // wrong, the same defect the gate-stage period exists to avoid.
      if (persistedCapture !== null && persistedCapture.seed === captureConfig.seed) {
        recorder.seed(persistedCapture);
      }
      this.judgeCaseCapture = recorder;
      console.warn(
        'Olea: grounding-judge case capture is ENABLED (see judge-case-capture.ts). Remove the config key in data.json to stop it.',
      );
    }

    this.register(
      vault.watch((event) => {
        if (event.kind !== 'modify') return;
        void this.evaluateMaterialityChange(vault, event.path);
      }),
    );

    // `ol-0r92.7`: C7.8's course-detection surface (`[D-098]` point 1, F1.3).
    // `'create'`/`'rename'` are the events that can introduce a course code
    // `courseFromPath` has not seen before — a `'modify'` inside an already-
    // known folder never changes which codes exist. Filtered here rather than
    // inside `checkForCourseSetupProposals`, matching the materiality watch's
    // own shape immediately above.
    this.register(
      vault.watch((event) => {
        if (event.kind !== 'create' && event.kind !== 'rename') return;
        this.checkForCourseSetupProposals(vault);
      }),
    );
    // Cold-start scan: a vault opened with course-shaped folders already in
    // it needs detection to run once without waiting for the next edit.
    // Never awaited — same "may refresh, must not block onload" posture
    // `refreshCachedStudyPlan` above documents.
    this.checkForCourseSetupProposals(vault);

    this.registerInterval(
      window.setInterval(() => {
        void this.tickIngestionAndMaybeRunCorpusRelations();
        void this.drainEmbeddings(capability);
        void this.tickCitationRevisions();
        // `[DOS-3]` (`ol-2zfj.159`): see `drainPendingMaterialityEdits`'s own
        // doc for why this interval is the intended caller.
        void this.drainPendingMaterialityEdits();
      }, INGESTION_TICK_INTERVAL_MS),
    );
  }

  /**
   * Feeds one observed `'modify'` event into the materiality trigger
   * (register row 1.4, `TRG-1`). `VaultEvent` carries only a path — no text
   * payload — so this reads the file fresh, then evaluates it against
   * whatever text this session last saw for that path
   * (`materialityPreviousText`), which is `undefined` on the first modify
   * event ever observed for a path this session (a safe "first sighting",
   * per `MaterialityTrigger.evaluate`'s own doc — never a guess).
   *
   * TRG-1's verdict has **two** consumers from this one evaluation: F6.9's
   * material-arrival timestamp (`recordMaterialArrivalIfObserved`, original),
   * and, per `ol-0r92.12` [AUTH-1b] (David's ruled mechanism, 2026-08-28),
   * F3.3's generation sweep for the authored-note case
   * (`triggerAuthoredNoteGenerationIfObserved`). Both read the same
   * `observedMaterialChange` verdict — the materiality gate is the one churn
   * control for both, not a second, independent one.
   *
   * Never lets a read or evaluation failure propagate: the same
   * "a downstream failure must never make this look like it misfired"
   * posture `wiring.ts`'s own `onVerdict` doc argues for the verdict hook
   * one level in, applied here to the event plumbing that feeds it.
   */
  private async evaluateMaterialityChange(vault: VaultSource, path: VaultPath): Promise<void> {
    if (this.materiality === null || this.materialityPreviousText === null) return;
    let currentText: string;
    try {
      currentText = await vault.read(path);
    } catch (error) {
      console.error('Olea: materiality trigger could not read a modified path', error);
      return;
    }
    const previousText = this.materialityPreviousText.get(path);
    try {
      const result = await this.materiality.evaluate(path, currentText, previousText);
      await this.recordMaterialArrivalIfObserved(path, currentText, result);
      await this.triggerAuthoredNoteGenerationIfObserved(path, currentText, result);
    } catch (error) {
      console.error('Olea: materiality trigger evaluation failed', error);
    } finally {
      this.materialityPreviousText.record(path, currentText);
    }
  }

  /**
   * `[DOS-3]` (`ol-2zfj.159`): the production caller
   * `MaterialityTrigger.drainDuePendingEdits`'s own doc names as missing --
   * folded into the SAME periodic interval `tickCitationRevisions`/
   * `tickIngestionAndMaybeRunCorpusRelations` already run from below
   * (`INGESTION_TICK_INTERVAL_MS`), the intended caller that method's doc
   * points at. Without this, a below-floor edit that never recurs on its
   * own path stays pending until something else happens to touch that path
   * again -- see `drainDuePendingEdits`'s own doc for why.
   *
   * Never throws into the interval: a failure here must not stop the
   * neighbouring ticks (`tickCitationRevisions`'s own doc argues the same
   * for its own tick), same "last line of defence, not the primary
   * error-handling path" posture `drainEmbeddings`'s doc states outright.
   */
  private async drainPendingMaterialityEdits(): Promise<void> {
    if (this.materiality === null) return;
    try {
      await this.materiality.drainDuePendingEdits(Date.now());
    } catch (error) {
      console.error('Olea: materiality pending-edit drain failed', error);
    }
  }

  /**
   * Whether one `MaterialityTrigger.evaluate` result counts as a real
   * content change — the single reading both of row 1.4's consumers
   * (`recordMaterialArrivalIfObserved` for F6.9, `triggerAuthoredNoteGeneration
   * IfObserved` for F3.3's authored-note case, `ol-0r92.12`) key on, so the
   * free gates (hash/debounce/floor) stay the one churn control rather than
   * each consumer inventing its own. `'judge-unavailable'` counts the same
   * way a `'verdict'` with `material: true` does — no `MaterialityJudge` is
   * wired in production today (`this.materiality`'s own construction,
   * above), so the free gates clearing is what "material changed" means
   * until a judge exists; a judge that later says "not really" is still
   * believed over them. `'unchanged'`, `'formatting-only'`, `'debounced'`
   * and `'below-floor'` are row 1.4 itself declining to treat the edit as
   * real content movement, for neither consumer.
   */
  private observedMaterialChange(result: MaterialityEvaluationResult): boolean {
    return (
      result.kind === 'judge-unavailable' || (result.kind === 'verdict' && result.verdict.material)
    );
  }

  /**
   * F6.9's per-course material-arrival timestamp (`ol-v7r5.6`) — recorded the
   * moment row 1.4's free gates (hash/debounce/floor) judge an edit
   * significant enough that a judge call would follow. See
   * `observedMaterialChange` for exactly what counts.
   *
   * Course association follows F1.3 exactly — her own `course` frontmatter
   * first, the course folder the path sits under otherwise
   * (`notePathCourses`) — the same derivation `concept/extract.ts` already
   * uses, so a path this fires for and a path concept extraction reads agree
   * on which course it belongs to. A path resolving to no course records
   * nothing: F6.9's reading is per-course, and there is no course to
   * attribute an arrival to.
   *
   * Never lets a parse or store failure propagate — same "a downstream
   * failure must never make the trigger look like it misfired" posture the
   * caller already holds for `materiality.evaluate` itself.
   */
  private async recordMaterialArrivalIfObserved(
    path: VaultPath,
    currentText: string,
    result: MaterialityEvaluationResult,
  ): Promise<void> {
    if (this.materialArrivals === null) return;
    if (!this.observedMaterialChange(result)) return;

    try {
      const doc = parseDocument(currentText);
      const first = doc.blocks[0];
      const fm = first?.kind === 'frontmatter' ? parseFrontmatter(first.inner) : null;
      const courses = notePathCourses(path, fm === null ? [] : readList(fm, 'course').items);
      if (courses.length === 0) return;

      const today = calendarDayFromLocalDate(new Date());
      for (const course of courses) {
        await this.materialArrivals.recordArrival(course, today);
      }
    } catch (error) {
      console.error('Olea: could not record a material arrival', error);
    }
  }

  /**
   * `ol-0r92.12` [AUTH-1b]'s second consumer of TRG-1's material verdict —
   * David's ruled mechanism (2026-08-28) for closing the authored-note gap
   * `findings/sis4-authored-generation.md` (private, `olea-service`) traced:
   * F3.3's generation hook only ever fired from a drained ingestion job over
   * the four non-markdown formats `KNOWN_FORMATS` covers
   * (`packages/core/src/ingestion/extraction-runner.ts`), so a markdown note
   * she authors herself — Zettelkasten, Research, anywhere — could never
   * reach it, structurally, regardless of which folder it sat in.
   *
   * **No fifth ingestion format, no markdown ingestion path.** TRG-1 already
   * runs its free gates on every note vault-wide; this reuses that verdict
   * (the same `observedMaterialChange` reading `recordMaterialArrivalIfObserved`
   * above uses, so the materiality gate — not a second, independent debounce
   * — is the one churn control for both consumers) as a second caller of
   * `onUnitsLanded`, the SAME hook the ingestion path already drives. It
   * synthesises exactly one `ExtractedUnit` whose `provenance.sourcePath` is
   * the note's OWN path and whose `provenance.embeddedIn` is ABSENT.
   *
   * **`[D-214]` (`ol-0r92.45`): the note is never the drafting target.**
   * Before `[D-214]`, `embeddedIn.notePath` named the note itself, which put
   * this unit on `runGenerationSweep`'s F1.6 "embedded" branch
   * (`generation/pipeline.ts`) and made the note her drafted instrument's
   * insertion target — a write into an authored note INV-6 never permits,
   * accept or no accept. Omitting `embeddedIn` instead routes the unit
   * through the SAME bare-drop branch `[D-179]` already built for a
   * standalone source with no embedding note: Olea creates or reuses a home
   * note BESIDE this one, in her own layer, and that sibling — never this
   * note — is what `materializeAcceptedDraft` later writes into, only at
   * accept, through the existing passive-accept review flow (`[D-097]`).
   * `provenance.sourcePath` staying this note's own path is what keeps the
   * drafted instrument's citation (`[D-171]`) opening HER note at the
   * passage, even though materialization lands elsewhere — see
   * `ingestion/process-now.ts`'s `buildAuthoredNoteUnit` (this method's own
   * unit-building function) for the full argument, including the one
   * naming-collision fix this required in `generation/home-note.ts`
   * (outside this bead's own `owns`, touched only for that fix).
   * `provenance.location` is a placeholder (`page: 1`, the whole
   * canonicalised text as one range) — the passage-scoped revision this
   * implies is a separate, later bead (`ol-0r92.46`).
   *
   * A note outside every course folder (`courseFromPath` finds none) is a
   * silent, disclosed no-op — `runGenerationSweep` already returns its zero
   * report for an empty course-code set, the same course-folder scope
   * `ol-2zfj.33`'s finding names for the ingested case; this bead does not
   * widen that scope. Delegates to `onUnitsLanded`, which already never lets
   * a sweep failure propagate.
   */
  private async triggerAuthoredNoteGenerationIfObserved(
    path: VaultPath,
    currentText: string,
    result: MaterialityEvaluationResult,
  ): Promise<void> {
    if (!this.observedMaterialChange(result)) return;

    // `ol-0r92.21` [D-152]: this exact unit shape is now shared with the
    // manual process-now override (`ingestion/process-now.ts`'s
    // `buildAuthoredNoteUnit`) so the debounce-driven path and the manual
    // timing override stay one function rather than drifting copies.
    await this.onUnitsLanded([buildAuthoredNoteUnit(path, currentText)]);
  }

  /**
   * `[D-152]` (F3.3, `ol-0r92.21`): the command-palette and note-context-menu
   * handler for the manual process-now timing override — both doors call
   * this one method (see the two registrations above). Delegates entirely to
   * `this.processNowAction` (`process-now.ts`'s own doc covers what each
   * outcome means and why); this method's only job is the Obsidian-specific
   * bit that module deliberately has no import for — showing her a `Notice`
   * — and the `this.processNowAction === null` guard for the (session-only,
   * never seen in practice) window before `onload` reaches its construction.
   */
  private async processNoteNow(path: VaultPath): Promise<void> {
    if (this.processNowAction === null) return;
    const outcome = await this.processNowAction.processNow(path);
    new Notice(processNowNotice(outcome));
  }

  /**
   * C7.8's course-detection surface (`[D-098]` point 1, F1.3, `ol-0r92.7`) —
   * the entry point both the cold-start scan and the `'create'`/`'rename'`
   * watch above call. Fire-and-forget by design (`void` at both call sites):
   * a listing failure or an in-flight modal must never surface as anything
   * other than "detection did not run this time," the same posture
   * `evaluateMaterialityChange` takes for a read failure on its own trigger
   * path.
   */
  private checkForCourseSetupProposals(vault: VaultSource): void {
    if (this.courseSetupModalOpen) return;
    void this.openNextCourseSetupProposal(vault);
  }

  /**
   * Lists the vault, asks `detectCourseProposals` (`olea-core`) for the first
   * course code she has not been asked about this session, and — if one
   * exists — opens `CourseSetupModal` on it. `onConfirm`/`onDismiss` both
   * mark the code seen and chain to the next proposal, so several
   * course-shaped folders detected in the same pass are asked about one at a
   * time rather than stacked.
   *
   * **The persistence seam (`ol-0r92.7`'s brief).** `onConfirm` receives a
   * plain `{ name, kinshipAnswer }` result and does nothing with it beyond a
   * `Notice` and marking the code seen for this session — writing a
   * `CourseRecord` is the Class C schema addition this bead stops short of.
   * `recognitionClaims` is passed as `[]` and `kinshipCandidateCourse` is
   * omitted for the same reason `../today/earlier-course-recognition.ts`'s
   * own module doc gives: nothing yet assembles the concepts+entries a real
   * recognition read needs at proposal time, so an honest "not computed" (the
   * confirmation view renders neither section when given nothing, by
   * contract) is what ships here rather than a fabricated claim.
   */
  private async openNextCourseSetupProposal(vault: VaultSource): Promise<void> {
    let paths: readonly VaultPath[];
    try {
      paths = await vault.list({ extensions: ['md'] });
    } catch (error) {
      console.error('Olea: course detection could not list the vault', error);
      return;
    }

    const proposals: readonly CourseDetectionProposal[] = detectCourseProposals(
      paths,
      this.courseSetupSeenCodes,
    );
    const next = proposals[0];
    if (next === undefined) return;

    this.courseSetupSeenCodes.add(next.code);
    this.courseSetupModalOpen = true;
    new CourseSetupModal(this.app, {
      proposal: { suggestedName: next.code, rootPath: next.rootPath },
      recognitionClaims: [],
      // `ol-ppa9` (F1.4/`[D-213]`): this proposal's own folder already has a
      // live queue state the instant she is looking at it — extraction runs
      // from file arrival, independent of confirming anything
      // (`confirmation-view.ts`'s own module doc) — plus any folder already
      // ticked earlier this session, each keeping its own line.
      firstRead: this.firstReadFolderViewsFor(
        this.tickedCourseFolders.includes(next.rootPath)
          ? this.tickedCourseFolders
          : [next.rootPath, ...this.tickedCourseFolders],
      ),
      onConfirm: (result) => {
        this.courseSetupModalOpen = false;
        new Notice(`Olea: "${result.name}" confirmed as a course.`);
        void this.openNextCourseSetupProposal(vault);
        if (!this.tickedCourseFolders.includes(next.rootPath)) {
          this.tickedCourseFolders.push(next.rootPath);
        }
      },
      onDismiss: () => {
        this.courseSetupModalOpen = false;
        void this.openNextCourseSetupProposal(vault);
      },
    }).open();
  }

  /**
   * `ol-ppa9` (F1.4/`[D-213]`): the first-read readout's live data, scoped to
   * `folders` — `[]` before `this.ingestion` exists (the brief window before
   * `onload` reaches its construction, same guard `processNoteNow` takes for
   * its own not-yet-constructed field) or when `folders` is empty (nothing
   * ticked yet). `landedConcepts` is now fed from `this.landedConceptsByFolder`
   * (`[D-219]`, `ol-9c0k`) — real concept names, per folder, as
   * `readLandedConceptsForFinishedFolders` below lands them — rather than the
   * always-empty map this method used to pass; a folder with nothing landed
   * yet still renders honestly empty (`buildFirstReadFolderViews`'s own
   * fallback), never fabricated.
   */
  private firstReadFolderViewsFor(folders: readonly VaultPath[]): readonly FirstReadFolderView[] {
    if (this.ingestion === null || folders.length === 0) return [];
    return buildFirstReadFolderViews(
      this.ingestion.engine.list(),
      folders,
      this.landedConceptsByFolder,
    );
  }

  /**
   * `[D-219]` (`ol-9c0k`): one `readConceptsFromVault` call per folder in
   * `folders`, scoped to that folder's own subtree (`under: folder`) rather
   * than the whole vault, so this stays a bounded per-folder cost and never
   * an extra whole-vault batch read — the whole-vault read
   * `tickIngestionAndMaybeRunCorpusRelations` already performs at ingestion-
   * session close is unchanged and remains the corpus-relations trigger.
   *
   * **The budget.** No `budget` is passed, so each call falls back to
   * `readConceptsFromVault`'s own declared default
   * (`concept/wiring.ts`'s `DEFAULT_MAX_PASSAGES_PER_READ` /
   * `DEFAULT_PASSAGES_PER_CALL`) — the same D-210-governed per-call ceiling
   * every other read in this plugin already falls back to. This method
   * declares no budget constant of its own.
   *
   * Folders run one at a time, in the order given, rather than concurrently
   * — two folders finishing on the same tick cost their calls in a fixed,
   * readable order; nothing here depends on running them in parallel. A
   * folder whose call comes back `null` (Worker unconfigured, F7.8) or
   * `'unrecognised'` is left untouched in `landedConceptsByFolder` rather
   * than cleared — a call that could not read is not evidence that nothing
   * has landed. A thrown error is logged and never propagated, the same
   * posture `tickIngestionAndMaybeRunCorpusRelations`'s own `catch` takes for
   * the corpus stage.
   *
   * Refreshes any open Home leaf once every folder in this batch has been
   * attempted, so a concept that just landed reaches the screen without
   * waiting for the next ingestion tick's own refresh.
   */
  private async readLandedConceptsForFinishedFolders(folders: readonly VaultPath[]): Promise<void> {
    for (const folder of folders) {
      try {
        const result = await this.readConceptsFromVault({ under: folder });
        if (result !== null && result.outcome === 'read') {
          this.landedConceptsByFolder.set(
            folder,
            result.concepts.map((concept) => concept.name),
          );
        }
      } catch (error) {
        console.error(
          'Olea: per-folder concept read failed (first-read readout unaffected)',
          error,
        );
      }
    }
    void refreshOpenTodayViews(this.app.workspace, VIEW_TYPE_OLEA_HOME);
  }

  /**
   * Ticks the ingestion queue, then checks whether that tick just closed an
   * ingestion session — never a per-document event (component register row
   * 1.2a; F1's batch-boundary scenario) — and if so, runs the corpus-level
   * relation stage's batch (`[EXT-11]`, `ol-kw4a`, `[D-118]`). Also EXT-7's
   * first real caller for `readConceptsFromVault`.
   *
   * Both stages' edges are folded into `this.relations` rather than dropped
   * (`ol-2zfj.12`); see that field's doc for what still has no consumer.
   */
  private async tickIngestionAndMaybeRunCorpusRelations(): Promise<void> {
    const previous = this.lastIngestionSnapshot;
    await this.ingestion?.engine.tick();
    const current = this.ingestion?.engine.snapshot() ?? null;
    if (current === null) return;
    this.lastIngestionSnapshot = current;

    // `[D-219]` (`ol-9c0k`): one D-068 reader call per course folder, fired
    // the instant that folder's own queued/in-flight work reaches zero —
    // the per-folder analogue of `ingestionSessionJustClosed` below, at
    // folder grain instead of engine grain. Deliberately never gated on the
    // corpus stage's own early return further down: a folder finishing is a
    // distinct event from an ingestion session closing, and this fires
    // whether or not the whole engine has caught up. Fire-and-forget
    // (`void`) so a slow per-folder read never delays this tick's own
    // corpus-relation-batch check below.
    if (this.ingestion !== null && this.tickedCourseFolders.length > 0) {
      const currentFirstReadCounts = summarizeFirstReadByFolder(
        this.ingestion.engine.list(),
        this.tickedCourseFolders,
      );
      const justFinished = firstReadFoldersJustFinished(
        this.lastFirstReadCountsByFolder,
        currentFirstReadCounts,
      );
      this.lastFirstReadCountsByFolder = new Map(
        currentFirstReadCounts.map(({ folder, counts }) => [folder, counts]),
      );
      if (justFinished.length > 0) {
        void this.readLandedConceptsForFinishedFolders(justFinished);
      }
    }

    // `ol-ppa9` (F1.4/`[D-213]`): an open Home leaf's first-read readout
    // renders live counts off `this.ingestion.engine.list()` — refresh it on
    // every tick, mirroring `lastIngestionSnapshot`'s own per-tick update,
    // but only once a folder has actually been ticked this session (no point
    // refreshing a leaf with nothing first-read to show).
    if (this.tickedCourseFolders.length > 0) {
      void refreshOpenTodayViews(this.app.workspace, VIEW_TYPE_OLEA_HOME);
    }

    if (!ingestionSessionJustClosed(previous, current)) return;
    if (this.corpusRelation === null || this.corpusRelationStateStore === null) return;
    if (this.concept === null) return;

    try {
      // Both producers' edges land in one fold (`ol-2zfj.12`): the
      // per-document read's `is-a`/`part-of` and the corpus batch's
      // `prerequisite`/`contrasts-with`, deduplicated, ranked by provenance
      // ahead of confidence (`[D-070]`), with `[D-093]`'s abstention state
      // carried per edge. Nothing is persisted and nothing lands in her layer
      // — `[D-097]` keeps edges gated.
      // Assessment-error-adjacency records (`ol-2zfj.19`/`ol-2zfj.22`/
      // `ol-2zfj.23`): a `null` load means "could not read the vault" and
      // maps to OMITTING the option — absent, not guessed, per
      // `AssessmentErrorAdjacencyOptions`' own contract.
      //
      // `embeddingProximity` (`ol-2zfj.23` round-2, `ol-2zfj.13`) is now
      // threaded too: `[D-DERIVE-EMB]` (`ol-u2uj`) ratified the required
      // `threshold` this option needs (`EMBEDDING_PROXIMITY_THRESHOLD`, see
      // `concept/wiring.ts`'s doc for the measured basis and the four
      // revisit conditions), and it reads off `this.retrieval.embeddingCache`
      // — the SAME already-built local cache `drainEmbeddings` feeds, never a
      // new embedding call. Omitted, same F7.8-shaped posture as every other
      // option here, when the Worker isn't configured yet and that cache is
      // `null`.
      //
      // **Known, recorded consequence of `ol-2zfj.29` landing alongside this
      // round:** that bead threads `courses` through `corpusConceptsFrom`,
      // making the corpus batch course-scoped in production for the first
      // time — which fires `[D-DERIVE-EMB]`'s revisit condition 1 the moment
      // it lands. Production therefore now runs course-scoped nomination
      // against a threshold measured under the OLD, unscoped candidate
      // space, pending `ol-3ux7.26`'s re-derivation (zero spend, already
      // filed and running concurrently) and its ratification.
      const vault = new ObsidianSource(this.app);
      const deviceId = await ensureDeviceId(this);
      const misconceptionStore = createVaultMisconceptionStore({
        vault,
        deviceId,
        now: () => new Date(),
      });
      const records = await misconceptionStore.load();
      const embeddingCache = this.retrieval?.embeddingCache;
      const pass = await readConceptsAndRelations(
        this.concept,
        this.corpusRelation,
        this.corpusRelationStateStore,
        {
          vault,
          ingestionSessionClosed: true,
          ...(records !== null ? { assessmentErrorAdjacency: { records } } : {}),
          ...(embeddingCache !== null && embeddingCache !== undefined
            ? {
                embeddingProximity: {
                  cache: embeddingCache,
                  threshold: EMBEDDING_PROXIMITY_THRESHOLD,
                },
              }
            : {}),
        },
      );
      if (pass === null) return;
      this.relations = pass.relations;

      // `ol-2zfj.49` (second half): fold this tick's already-completed read
      // (`pass.read.concepts`) onto a fresh, purely-local vault walk's
      // `ConceptRecord`s — see `extractConceptsWithAnchors`'s own doc for why
      // this makes no new network call, and `this.conceptRecords`'s own doc
      // for what still has no consumer.
      this.conceptRecords = await extractConceptsWithAnchors(vault, pass.read.concepts);

      // `ol-2zfj.157` [DOS-I15]: `pass.read.coverage` (`ol-2zfj.144`
      // [IL-D5]'s `truncatedByBudget`/`sections`, per document) is the row
      // 4.1 coverage-audit consumer that bead's own close evidence left
      // open — grouped here by course (`courseFromPath`, F1.3) and saved to
      // the durable store `./grove/provider.ts`'s `load()` reads back on a
      // completely separate cadence (see `./grove/read-completeness-
      // store.ts`'s module doc for why this seam has to exist). A row whose
      // path resolves to no course is dropped, matching this method's own
      // discovered-cause discipline elsewhere: nothing here guesses a
      // course for a document outside the courses folder. A write failure
      // is logged and swallowed — same posture the ground-streak/prior-
      // denominator saves inside `./grove/provider.ts` already take for
      // their own best-effort persistence, never turning a successful read
      // into a failed tick.
      try {
        const readCompletenessByCourse = new Map<string, ConceptReadCoverage[]>();
        for (const row of pass.read.coverage) {
          const course = courseFromPath(row.sourcePath, DEFAULT_COURSES_FOLDER);
          if (course === undefined) continue;
          const rows = readCompletenessByCourse.get(course) ?? [];
          rows.push(row);
          readCompletenessByCourse.set(course, rows);
        }
        await new ObsidianGroveReadCompletenessStore(this).save(readCompletenessByCourse);
      } catch (error) {
        console.error('Olea: could not save read-coverage for the grove', error);
      }

      // `ol-2zfj.32` (`[D-130]`): the confusion-pairing corroboration
      // reader's first production caller — makes `relation-reader-check.mjs`'s
      // `contrasts-with` observation real rather than audited. `records`
      // already loaded above for the nomination signal; `null` means "could
      // not read the vault" and is skipped here too, same absent-not-guessed
      // posture (a store read failure must never read as "zero confusions").
      // Pure, no persistence, no surface — see `corroborateConfusionPairings`'s
      // module doc.
      if (records !== null) {
        this.confusionPairingVerdicts = corroborateConfusionPairings(
          pass.relations,
          records,
          pass.read.concepts.map((concept) => ({ name: concept.name, aliases: concept.aliases })),
        );
      }
    } catch (error) {
      console.error('Olea: corpus relation batch failed', error);
    }
  }

  /**
   * `[CORP-3b]` (`ol-2zfj.35`): one batch pass of the citation-grain revision
   * caller — see `citationRevision`'s own field doc and
   * `ingestion/materiality/citation-revision-wiring.ts`'s module doc for why
   * this runs per ingestion tick rather than per `'modify'` event.
   *
   * **The reachable chain, end to end, this method closes:** a vault-wide
   * walk (`enumerateVaultInstruments`, inside `CitationRevisionTrigger.tick`)
   * finds a changed MCQ citation → `evaluateCitedPassageRevision`
   * (`olea-core`) judges it → a `'revised'` outcome calls back into
   * `actions.suspend` (this method's `createVaultSuspendPort(vault,
   * deviceId).suspend`, F2.6's existing durable suspend write, no new field)
   * and `actions.enqueue` (`this.ingestion.engine.enqueue`, the SAME
   * `IngestionQueueEngine` `createRevisionAwareJobRunner` is already composed
   * into via `buildIngestionRunner`'s `revision` option above) — which is
   * exactly the confirmation-queue admission `revision-job-runner.ts`'s own
   * module doc names as the one remaining gap ("nothing yet calls
   * `evaluateCitedPassageRevision`... to produce a real `'instrument-revision'`
   * job in the first place").
   *
   * A fresh `ObsidianSource`/`deviceId` per call, not the `onload`-scoped
   * ones — same posture `tickIngestionAndMaybeRunCorpusRelations` above
   * takes, and for the same reason: this method stands alone rather than
   * depending on `onload`'s closure. Never lets a failure propagate into the
   * interval, same posture every tick in this file takes.
   */
  private async tickCitationRevisions(): Promise<void> {
    if (this.citationRevision === null) return;
    try {
      const vault = new ObsidianSource(this.app);
      const deviceId = await ensureDeviceId(this);
      const suspendPort = createVaultSuspendPort(vault, deviceId);
      await this.citationRevision.tick(vault, {
        enqueue: (input) =>
          this.ingestion === null
            ? Promise.resolve(undefined)
            : this.ingestion.engine.enqueue(input),
        suspend: (instrumentId, conceptIds) => suspendPort.suspend(instrumentId, conceptIds),
        // `[D-093]` forbids healing a near-match re-bind silently. Surfacing
        // it to her is the structural-proposal registry's own admission path
        // (`features/F3-learn-from-anything.md`'s `core/accept/*` cluster) —
        // a different lane's `owns` (see this bead's close notes for the
        // hand-back). No content, no path, no instrument identifier logged
        // here (D-005) — a structural notice only, so a re-bind is never
        // silently dropped even though nothing yet surfaces it to her.
        onRelocationProposed: () => {
          console.info(
            'Olea: a citation relocation proposal is pending confirmation-registry admission (ol-2zfj.35 hand-back)',
          );
        },
      });
    } catch (error) {
      console.error('Olea: citation-revision batch pass failed', error);
    }
  }

  /**
   * Feeds whatever the ingestion sink and the keyword index currently hold
   * into the embedding cache (`ol-odb0.1`). A no-op, cheaply, whenever the
   * Worker isn't configured (`this.retrieval.embeddingCache` is `null`),
   * this device cannot drain (mobile, D-002), or there is nothing new to
   * embed — `drainIntoEmbeddingCache`/`ensureEmbeddings` both short-circuit
   * before any network call in that last case (C2.3).
   *
   * Never throws into the interval: `EmbeddingCacheEngine.ensureEmbeddings`
   * already swallows a provider failure and keeps partial progress (see its
   * own module doc), so nothing here should be able to reject — the `catch`
   * exists only as a last line of defence against something this function
   * did not anticipate, not as the primary error-handling path.
   */
  private async drainEmbeddings(capability: DeviceCapability): Promise<void> {
    const embeddingCache = this.retrieval?.embeddingCache;
    if (embeddingCache === null || embeddingCache === undefined) return;
    if (!capability.canDrain) return;
    if (this.ingestion === null) return;
    try {
      await drainIntoEmbeddingCache({
        embeddingCache,
        sink: this.ingestion.sink,
        // `exactOptionalPropertyTypes`: omit the key entirely rather than
        // assign `undefined` to it when the keyword index isn't wired.
        ...(this.keywordIndex ? { keywordIndex: this.keywordIndex.engine } : {}),
      });
    } catch (error) {
      console.error('Olea: embedding drain failed', error);
    }
  }

  /**
   * Assembles `DraftQuizCardsDeps` for a grounded generative call
   * (`ol-p3t07a`), or `null` when any half is unavailable — no Worker token
   * pasted yet (F7.8), or the keyword index has not built its first
   * snapshot. Mirrors `retrieval/wiring.ts`'s own `null`-on-unconfigured
   * posture rather than inventing a second one.
   *
   * `retrieve.registryOverrides` (`ol-r5j4`) reads `this.registryOverridesCache`
   * — see that field's own doc for why a cache rather than this store's own
   * async `load()`: this function is called synchronously from
   * `buildIngestionRunner`'s `revision.draftDeps` and `onUnitsLanded`, and
   * cannot itself become `async` without widening both of those seams.
   */
  private draftQuizCardsDeps(): DraftQuizCardsDeps | null {
    const embeddingCache = this.retrieval?.embeddingCache;
    const embeddingProvider = this.retrieval?.embeddingProvider;
    const transport = this.retrieval?.transport;
    if (
      embeddingCache === null ||
      embeddingCache === undefined ||
      embeddingProvider === null ||
      embeddingProvider === undefined ||
      transport === null ||
      transport === undefined ||
      this.keywordIndex === null
    ) {
      return null;
    }
    return {
      retrieve: {
        keywordIndex: this.keywordIndex.engine.toPersisted(),
        embeddingCache,
        embeddingProvider,
        registryOverrides: this.registryOverridesCache,
      },
      transport,
      // `ol-2zfj.36` ([D-101], F3.8/F3.9): the source-materiality hook —
      // categorical facts for presentation (hers→phrasing,
      // instructor→terminology), never an evidence weight. Absent frontmatter
      // degrades to 'unknown', same as before this hook existed.
      classifyPassage: buildClassifyPassageHook({
        frontmatterHost: {
          frontmatterFor: (path) => this.app.metadataCache.getCache(path)?.frontmatter,
        },
      }),
      // `[JEV-11]` (`ol-3ux7.96`): `this.gateStageRecorder.record` runs
      // synchronously and in-memory — the gate's decision never waits on
      // disk I/O. `gateStagePersistence.schedule()` only ever arms (or
      // leaves armed) a debounce timer; it never writes synchronously and
      // never throws, so a save failure or a slow disk cannot affect
      // whether a card is drafted, exactly as a throwing recorder already
      // cannot (`groundedContext.ts`'s `stage` helper). See
      // `./retrieval/gate-stage-persistence.ts` for the serialization and
      // coalescing this delegates to.
      onStage: (stage) => {
        this.gateStageRecorder.record(stage);
        this.gateStagePersistence.schedule();
      },
      // `[JEV-6]` (`ol-3ux7.89`): omitted entirely unless the capture is
      // switched on by hand, so the ordinary drafting path is unchanged. When
      // it is on, `observe()` is synchronous, in-memory and cannot throw, and
      // the save is fire-and-forget with its rejection swallowed here — a
      // disk error costs this window's newest cases, never a drafted card.
      // The gate swallows a throwing recorder anyway (`groundedContext.ts`'s
      // `onJudgeRequest` block); both halves are deliberate.
      ...(this.judgeCaseCapture !== null
        ? {
            onJudgeRequest: (record: JudgeRequestRecord) => {
              const capture = this.judgeCaseCapture;
              if (capture === null) return;
              if (!capture.observe(record, new Date().toISOString())) return;
              const snapshot = capture.snapshot();
              if (snapshot !== null) void this.judgeCaseCaptureStore.save(snapshot).catch(() => {});
            },
          }
        : {}),
    };
  }

  /**
   * `[JEV-6]` (`ol-3ux7.89`) — the developer-console readback and controls
   * for the case capture, following `getGateStageSummary()`'s precedent
   * exactly: reached as `app.plugins.plugins['olea'].getJudgeCaseCapture()`,
   * and **deliberately not a command, a view or a setting**. No clause
   * defines a student-facing surface for a research capture and none should
   * be invented for one; adding an affordance she can see is a stop.
   *
   * `stopJudgeCaseCapture()` ends recording for this session and closes the
   * window; `clearJudgeCaseCapture()` deletes every captured case from
   * `data.json` and leaves the config key alone, so "I stopped it" and "I
   * deleted it" stay distinguishable afterwards.
   */
  getJudgeCaseCapture(): PersistedJudgeCaseCapture | null {
    return this.judgeCaseCapture?.snapshot() ?? null;
  }

  stopJudgeCaseCapture(): void {
    this.judgeCaseCapture?.stop(new Date().toISOString());
  }

  async clearJudgeCaseCapture(): Promise<void> {
    this.judgeCaseCapture = null;
    await this.judgeCaseCaptureStore.clear();
  }

  /**
   * `[JEV-11]` (`ol-3ux7.96`) — the diagnostic readback for the study's
   * denominator, and its operating procedure in full (the study lane should
   * not have to reconstruct this):
   *
   * - **How the share is obtained.** A developer or the study harness reaches
   *   this live plugin instance through Obsidian's own developer console, the
   *   way any plugin's internals are already reachable there —
   *   `app.plugins.plugins['olea'].getGateStageSummary()`. **Deliberately not
   *   a command, a view, or anything else she would see**: no clause defines
   *   a student-facing surface for "what share of grounding requests did the
   *   judge decide," and none should be invented to answer this bead
   *   (`docs/dev/CLAUDE-incidents-log.md`'s worked example is exactly this
   *   mistake made once already, for a different feature).
   * - **What window it covers.** `periodStartedAt`/`lastRecordedAt` on the
   *   returned `GateStagePeriodSummary` name the window `counts`/`judgeShare`
   *   actually cover — the first and most recent stage this store has ever
   *   recorded, across every session since. A reader states the share
   *   ALONGSIDE that window, never as a bare number: "62% judge-consulted
   *   over N=340 requests, `periodStartedAt`..`lastRecordedAt`," not "62%."
   * - **What resets it.** Nothing in production code — see
   *   `gate-stage-store.ts`'s own module doc. The count accumulates
   *   indefinitely across every plugin reload, restart and vault switch
   *   until she clears `data.json`, reinstalls the plugin, or a future
   *   deliberate developer action calls `ObsidianGateStageStore.clear()`
   *   (never wired to production).
   * - **What it will never give you.** A single read taken once mid-study is
   *   the running total as of that moment, not a period boundary the study
   *   chose — if the study wants a bounded window (e.g. "the 90 days after
   *   toggling the candidate judge"), it must read `periodStartedAt` once at
   *   the start and diff two reads, since this store never resets on its
   *   own to mark a new window.
   *
   * Counts and the two ISO timestamps only (`GateStagePeriodSummary`), per
   * `[JEV-11]`'s own privacy rule — never a query, a path, or anything
   * derived from her content.
   */
  getGateStageSummary(): GateStagePeriodSummary {
    return {
      ...this.gateStageRecorder.summary(),
      periodStartedAt: this.gateStagePeriodStartedAt,
      lastRecordedAt: this.gateStageLastRecordedAt,
    };
  }

  /**
   * F3.3's "generate automatically when material lands" trigger
   * (`ol-p3t07a`). **Two production callers now feed it**: `ingestion
   * /wiring.ts`'s `onUnitsLanded` hook, once per drained ingestion job over
   * the four non-markdown formats; and, per `ol-0r92.12` [AUTH-1b],
   * `triggerAuthoredNoteGenerationIfObserved` above, once per authored
   * markdown note TRG-1's free gates judge materially changed. Never throws
   * into whichever path rides on it — a generation failure is not an
   * extraction or trigger failure (see that hook's own doc and
   * `evaluateMaterialityChange`'s); `GenerationWiring.sweep` itself already
   * no-ops honestly when the Worker isn't configured (F7.8) or `units` is
   * empty.
   *
   * **`ol-0r92.71` (`[H-1.8a]`):** the `GenerationSweepReport` this already
   * awaited and discarded — `report?.refusals` captured onto
   * `this.lastGenerationRefusals` so `BulkReviewView`'s `getRefusals`
   * provider (constructed below) has something real to read; `?? []` covers
   * the F7.8 degrade (`report === null`, no Worker configured or `units`
   * empty), never a stale prior sweep's refusals surviving a no-op one.
   */
  private async onUnitsLanded(units: readonly ExtractedUnit[]): Promise<void> {
    if (this.generation === null) return;
    try {
      const formatMatch = await this.buildFormatMatchProducer();
      const report = await this.generation.sweep(
        units,
        this.draftQuizCardsDeps(),
        { classifier: this.knowledgeKind?.classifier ?? null },
        formatMatch,
      );
      this.lastGenerationRefusals = report?.refusals ?? [];
    } catch (error) {
      console.error('Olea: generation sweep failed', error);
    }
  }

  /**
   * `ol-v7r5.37`'s production `deps.formatMatch` (F4.8, `[D-188]`):
   * `generation/format-match.ts`'s `buildFormatMatch`, given a fresh
   * `ObsidianSource` and whatever her assignments table currently holds — the
   * same `ObsidianStudyPlanSettingsStore`/`isStudyPlanConfigured`/
   * `readAssessments` join `buildReviewSessionInput` already uses for F2.19,
   * read fresh here for the identical reason `draftQuizCardsDeps` and the
   * routing classifier below are read fresh per tick rather than once at
   * `onload`. Returns `() => undefined` for every course — never `null` —
   * when study-plan settings are not configured yet, so an unconfigured
   * assignments Base degrades to exactly the pre-`ol-v7r5.37` behaviour
   * (`purpose`/`registerHint` both absent) rather than throwing into
   * `onUnitsLanded`'s own `try`.
   */
  private async buildFormatMatchProducer(): Promise<
    (courseCode: string) => FormatMatchDecision | undefined
  > {
    const vault = new ObsidianSource(this.app);
    const assignmentsConfig = await new ObsidianStudyPlanSettingsStore(this).load();
    if (!isStudyPlanConfigured(assignmentsConfig)) return () => undefined;
    const assessments = (await readAssessments(vault, assignmentsConfig.assignmentsBasePath))
      .records;
    return buildFormatMatch({ vault, assessments, now: () => new Date() });
  }

  /**
   * F2.8's switch-on, the recompute half (P5-T07). Runs `composeOracleRanking`
   * → `buildStudyPlan` through `refreshStudyPlan`'s cache-first, never-throws
   * discipline, and updates `this.review.plan` in place when it settles —
   * never reassigns `this.review` itself, so a session mid-open never sees a
   * different `vault`/`scheduler`/`ports` underneath it.
   *
   * A `null` plan (never configured, no evidence in her vault yet, or the
   * walk failed) is not an error here: F7.8 already requires review to work
   * with no plan at all, exactly as it works with no AI configured, and
   * `refreshStudyPlan` reports the reason rather than throwing past this.
   *
   * Also refreshes any open gap-view leaves (`ol-2tyj`). `createLocalGap
   * Provider` holds nothing itself to invalidate — it recomputes on every
   * `load()` — so a leaf opened *before* this background refresh landed is
   * the one case that needs a nudge: without it, that leaf keeps showing
   * whatever it composed at open time until she closes and reopens it.
   */
  private async refreshCachedStudyPlan(
    vault: VaultSource,
    deviceId: string,
    store: ObsidianStudyPlanStore,
  ): Promise<void> {
    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId,
      settingsHost: this,
      now: () => new Date(),
      // `[DOS-C4-a]` / `ol-feza`: the same store this refresh reads/writes
      // the cached plan through doubles as `sittingsSinceFloorMet`'s floor-
      // share source — the previous cached plan's own allocation, read
      // before this call overwrites it below.
      studyPlanStore: store,
      // `exactOptionalPropertyTypes`: omit the key entirely rather than
      // assign `undefined` to it when the Worker isn't configured (F7.8) —
      // same pattern `drainEmbeddings` uses for `keywordIndex` above.
      ...(this.rankWeights?.readRankWeights
        ? { readRankWeights: this.rankWeights.readRankWeights }
        : {}),
      ...(this.planPolicy?.readPlanPolicy
        ? { readPlanPolicy: this.planPolicy.readPlanPolicy }
        : {}),
    });
    const result = await refreshStudyPlan({ store, provider, now: () => new Date() });
    if (this.review !== null) this.review.plan = result.plan;
    void this.refreshGapViews();
  }

  /**
   * `ol-sn1q`'s production `ExplainWhyPort`: the SAME `WorkerTaskTransport`
   * `this.retrieval.transport` already exposes (the "one instance, many task
   * ids" reuse `draftQuizCardsDeps` above already establishes for
   * `quiz.generate.v1`), sending `explain-why.generate.v1` instead. `null`
   * on the same unconfigured-Worker condition as every other AI-gated
   * wiring in this file (F7.8).
   */
  /**
   * `ol-2zfj.18`'s production `MaterialityJudge`: the SAME
   * `WorkerTaskTransport` `this.retrieval.transport` already exposes,
   * sending `materiality.judge.v1`. `null` on the same unconfigured-Worker
   * condition as every other AI-gated wiring in this file (F7.8).
   */
  private buildMaterialityJudge(): WorkerMaterialityJudge | null {
    const transport = this.retrieval?.transport;
    if (transport === null || transport === undefined) return null;
    return new WorkerMaterialityJudge({ transport });
  }

  private buildExplainWhyPort(): WorkerExplainWhyGenerator | null {
    const transport = this.retrieval?.transport;
    if (transport === null || transport === undefined) return null;
    return new WorkerExplainWhyGenerator({ transport });
  }

  /**
   * F2.7's grounding half (`ol-sn1q`): a real `retrieve()` call
   * (`review/explainWhy.ts`'s `retrieveExplainWhySourceChunks`) over
   * whatever the keyword index and embedding cache currently hold — the
   * same two instances `draftQuizCardsDeps` above assembles for the
   * generation sweep's own grounded call. `[]` when either half isn't ready
   * yet (no Worker token pasted, or the index has not built its first
   * snapshot): this function's own contract is "refuse honestly downstream"
   * (see that function's doc), not "throw here."
   *
   * `retrieve.registryOverrides` (`ol-r5j4`) is the same
   * `this.registryOverridesCache` read `draftQuizCardsDeps` above reads —
   * one cache, both production callers of `retrieve()`, never two
   * independent readings of the same override state.
   */
  private async composeExplainWhySourceChunks(
    instrument: ReviewInstrument,
  ): Promise<readonly string[]> {
    const embeddingCache = this.retrieval?.embeddingCache;
    const embeddingProvider = this.retrieval?.embeddingProvider;
    if (embeddingCache === null || embeddingCache === undefined) return [];
    if (embeddingProvider === null || embeddingProvider === undefined) return [];
    if (this.keywordIndex === null) return [];
    return retrieveExplainWhySourceChunks(
      {
        retrieve: {
          keywordIndex: this.keywordIndex.engine.toPersisted(),
          embeddingCache,
          embeddingProvider,
          registryOverrides: this.registryOverridesCache,
        },
      },
      instrument,
    );
  }

  /**
   * `[SESS-13]` (`ol-egov.132.14`, discovered-from `[FOCUS-3b]`/`ol-ulj7`):
   * `[D-092]`'s session-denominated fairness window, read off her review log
   * — the production caller `study-session/window.ts`'s `computeWindowDeficit`
   * did not have, and the reason C5.5's session clustering (`[D-091]`) had to
   * be implemented at all (`session/cluster.ts`).
   *
   * Handed the review entries, the concept walk and the cached allocation by
   * `composeStudySessionForRequest`, which has all three in hand already —
   * see `CreateLocalSessionBuilderProviderDeps.windowDeficit` for why this
   * takes them as arguments rather than reading them itself.
   *
   * `undefined` — no cached allocation, so no running-course set to divide
   * between; or no clustered session in the log at all — omits the composer
   * input entirely and `compose.ts` keeps its own days-since-last-seen
   * substitute, exactly as before this bead. Never an empty map, which
   * `compose.ts` would read as "every course has zero deficit" and is a
   * different, false claim.
   *
   * **`sharesByPlanVersion` now carries the one plan version this side can
   * actually name — `[SESS-14]` (`ol-egov.132.15`).** SESS-13's own doc here
   * used to say every writer on this side recorded `planVersion: null`
   * (`review/queue-adapter.ts`, `explain-back/solo-review.ts`,
   * `generation/review-adapter.ts`) and left the map out because it could
   * never match. On inspection two of those three were already wrong by the
   * time SESS-13 closed: `[SESS-8.3]`'s `executeStudyPlanOverComposedRows`
   * (`open-session.ts`'s live path) stamps `plan.policyVersion` onto EVERY
   * item's `selectionContext`, ranked or not — asserted green already at
   * `open-session.spec.ts`'s `selectionContext.planVersion` checks — so a
   * review served from a plan-composed session already names that plan's
   * version in the log. `explain-back/solo-review.ts` and
   * `generation/review-adapter.ts` keep `planVersion: null` on purpose: an
   * explain-back attempt or an accepted draft was never selected by the plan
   * (`[D-126]`, "priced, never selected"), so joining them to it would be a
   * false claim, not a fix — `session/cluster.ts`'s own join already ignores
   * a `null` entry for exactly this reason (it only adds non-null versions to
   * the set it joins against).
   *
   * So the one real gap was here, the READER: this method never built the map
   * `session/cluster.ts` was ready to join against. `allocation` above IS
   * `wiring.plan?.body.allocation` (`session-builder/provider.ts`'s own
   * `deps.plan?.()?.body.allocation`, threaded through unchanged by this
   * method's caller), so pairing it with that SAME cached plan's
   * `policyVersion` — read fresh off `this.review?.plan`, same "never a
   * captured copy" discipline every other reader of it in this file already
   * takes — is not a guess; it restates what produced `allocation` in the
   * first place. A session whose reviews name a DIFFERENT (older, no longer
   * cached) plan version still finds no entry in this one-version map and
   * falls back to `currentShares`, exactly the honest degrade
   * `computeWindowDeficit` already documents; only the current plan's shares
   * are known here, not any retained history of older ones (there is none to
   * retain — see this bead's close evidence for what that leaves undone).
   */
  private windowDeficitFromReviewLog(input: {
    readonly entries: readonly ReviewLogEntry[];
    readonly concepts: readonly ConceptRecord[];
    readonly allocation: readonly StudyPlanAllocationEntry[] | undefined;
  }): ReadonlyMap<string, WindowDeficitEntry> | undefined {
    const { allocation } = input;
    if (allocation === undefined || allocation.length === 0) return undefined;

    const runningCourses = allocation.map((entry) => entry.courseId);
    const currentShares = new Map(allocation.map((entry) => [entry.courseId, entry.share]));
    const coursesOfConcept = new Map(
      input.concepts.map((concept) => [concept.key, concept.courses] as const),
    );

    // `[SESS-14]`: the current cached plan's own version, paired with the SAME
    // plan's allocation `currentShares` above already carries — a one-entry
    // map is honest here because this side retains no older plan version to
    // pair a second entry with.
    const planVersion = this.review?.plan?.policyVersion ?? null;
    const sharesByPlanVersion =
      planVersion === null ? undefined : new Map([[planVersion, currentShares]]);

    const history = pastSessionsFromReviewLog(input.entries, {
      coursesOfConcept,
      runningCourses,
      ...(sharesByPlanVersion !== undefined ? { sharesByPlanVersion } : {}),
    });
    if (history.length === 0) return undefined;
    return computeWindowDeficit(history, runningCourses, currentShares);
  }

  /**
   * `[SESS-8.4]` (`ol-egov.132.4`, `docs/dev/one-assembly-path.md` §3c) —
   * the port: composes a `ComposedStudySession` through the SAME assembly
   * `createLocalSessionBuilderProvider` uses for Home and the session
   * builder (`session-builder/provider.ts`'s `composeStudySessionForRequest`,
   * extracted there for exactly this reuse), with no course/topic/concept
   * steering and C5.5's declared default budget
   * (`DEFAULT_SESSION_BUDGET_MINUTES`) — the identical one-liner
   * `home/provider.ts` already calls for Home's own preview
   * (`sessionProvider.load({ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES })`).
   * One composer, two doors (`[D-033]` as amended by `[D-223]`) — this
   * never calls `buildComposedStudySession`/`composeReentrySession` a second,
   * differently-assembled way.
   *
   * `null` means either the vault wiring is not up yet (`this.review` is
   * `null`, the same "not composed at all" posture `buildReviewSessionInput`
   * below gives) or the study plan is not configured yet — the same
   * `isStudyPlanConfigured` gate Home and the session builder already apply,
   * now reached by the review tab's on-demand door too. Both `open-
   * session.ts` (finding the holder idle) and `startSession` below (entering
   * the holder at Start) call this and treat `null` as "nothing to compose",
   * never a thrown error.
   */
  private async composeDefaultStudySession(): Promise<ComposedStudySession | null> {
    const wiring = this.review;
    if (wiring === null) return null;
    const now = new Date();
    const result = await composeStudySessionForRequest(
      {
        vault: wiring.vault,
        deviceId: wiring.deviceId,
        settingsHost: this,
        // Unused by `composeStudySessionForRequest` itself (it takes `now`
        // as its own explicit argument, below) — supplied only to satisfy
        // `CreateLocalSessionBuilderProviderDeps`'s shape, the same deps
        // shape `createLocalSessionBuilderProvider`'s own `registerView`
        // call site below constructs.
        now: () => now,
        scheduler: wiring.scheduler,
        relations: () => this.servedRelationEdges(),
        plan: () => wiring.plan,
        // `[SESS-13]` (`ol-egov.132.14`): `[D-092]`'s window deficit, read off
        // her review log through C5.5's clustering — see
        // `windowDeficitFromReviewLog` above.
        windowDeficit: (deficitInput) => this.windowDeficitFromReviewLog(deficitInput),
        // `exactOptionalPropertyTypes`: omit the key entirely rather than
        // assign `undefined` to it when the Worker isn't configured (F7.8) —
        // same pattern `refreshCachedStudyPlan` below uses for
        // `createLocalStudyPlanProvider`. [ol-v7r5.61 / IL-D7b]
        ...(this.rankWeights?.readRankWeights
          ? { readRankWeights: this.rankWeights.readRankWeights }
          : {}),
      },
      { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
      now,
    );
    return result?.composed.full ?? null;
  }

  /**
   * `[SESS-8.6]` (`ol-egov.132.6`): the outrun-the-target port
   * (`open-session.ts`'s `OpenReviewSessionInput.extendDefaultStudySession`)
   * — F2.17/C5.8's "she outran the target" growth for the ONE shared
   * composed-session holder, closing the gap `[SESS-11]`
   * (`ol-egov.132.12`) named and filed here: `extendComposedStudySession`
   * (`olea-core`) had no production caller, because a frozen
   * `ComposedStudySession` has no way to grow its own `model.items`
   * mid-sitting.
   *
   * Re-assembles the SAME composer input `composeDefaultStudySession` uses —
   * `composeStudySessionForRequest`'s own `composedInput`
   * (`session-builder/provider.ts`) — fresh, at outrun time, the same "always
   * composes a fresh candidate list" posture `queue-adapter.ts`'s own
   * `FrozenReviewQueue.extend` already takes for the retiring path. Only
   * `budgetMinutes` differs from `previous`'s own composition: widened by one
   * more `DEFAULT_SESSION_BUDGET_MINUTES`-sized step — a declared, plain-
   * English default (C5.5's "her typical session length" unit, reused as the
   * growth step rather than inventing a second number), not a fitted
   * threshold, so it needs no decision bead — and every other steering input
   * (courses, conceptIds, allocation, focusPolicy) held identical, which is
   * what makes the growth "the same plan's shares" (C5.5) by construction,
   * per `extendComposedStudySession`'s own doc.
   *
   * `null` means the same "nothing to compose" condition
   * {@link composeDefaultStudySession} already reports — `open-session.ts`
   * reads that as "nothing new to append," never a failure.
   */
  private async extendDefaultStudySession(
    previous: ComposedStudySession,
  ): Promise<ComposedStudySession | null> {
    const wiring = this.review;
    if (wiring === null) return null;
    const now = new Date();
    const result = await composeStudySessionForRequest(
      {
        vault: wiring.vault,
        deviceId: wiring.deviceId,
        settingsHost: this,
        now: () => now,
        scheduler: wiring.scheduler,
        relations: () => this.servedRelationEdges(),
        plan: () => wiring.plan,
        // `[SESS-13]` (`ol-egov.132.14`): `[D-092]`'s window deficit, read off
        // her review log through C5.5's clustering — see
        // `windowDeficitFromReviewLog` above.
        windowDeficit: (deficitInput) => this.windowDeficitFromReviewLog(deficitInput),
        // `exactOptionalPropertyTypes`: omit the key entirely rather than
        // assign `undefined` to it when the Worker isn't configured (F7.8) —
        // same pattern `refreshCachedStudyPlan` below uses for
        // `createLocalStudyPlanProvider`. [ol-v7r5.61 / IL-D7b]
        ...(this.rankWeights?.readRankWeights
          ? { readRankWeights: this.rankWeights.readRankWeights }
          : {}),
      },
      { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
      now,
    );
    if (result === null) return null;

    const widerBudgetMinutes = previous.model.budgetMinutes + DEFAULT_SESSION_BUDGET_MINUTES;
    const items = extendComposedStudySession(
      { ...result.composedInput, budgetMinutes: widerBudgetMinutes },
      previous,
    );
    return { ...previous, model: { ...previous.model, items } };
  }

  /**
   * `[SESS-8.4]` (`ol-egov.132.4`, `docs/dev/one-assembly-path.md` §3b):
   * Home's Start button is the freeze point — one `decideRebuild` call
   * against the shared holder, then a recompose BEFORE entering if one is
   * warranted, never during ("the only place a recompose is allowed to
   * disagree with what Home drew"). Called by `startSession` below, before
   * `revealReviewView`, so the review tab it opens finds the holder already
   * holding the composition Start just committed to.
   *
   * **The `decideRebuild` call fires only when the holder already holds an
   * active sitting.** An idle holder has nothing to decide from:
   * `decideRebuild`'s between-sittings branch needs a memory of a sitting
   * that has already ended, which this holder does not keep past `exit()`
   * (`session/holder.ts`'s own doc — no memory across processes, and none
   * within one either) — the identical "not reachable from this surface
   * today, deliberately not wired" posture `session-builder/provider.ts`'s
   * own module doc states for its own between-sittings trigger set. An idle
   * holder simply composes, below, exactly as a genuine first Start of the
   * plugin session must.
   *
   * `trigger`/`staleness` are honest zeros, not fabricated facts — the same
   * posture `session-builder/provider.ts` took for its own `trigger` field
   * before `ol-v7r5.26` wired real staleness signals for ITS sitting.
   * `decideRebuild` never reads `trigger` while a sitting is active, so only
   * `staleness` is live here, and honest zeros mean this can only ever
   * decide `'hold'` today — real material-change detection for the SHARED
   * holder (items due, material arrived, an assessment band crossed, since
   * whichever surface entered it) is real future work, not this row's to
   * build; see this bead's close evidence.
   */
  private async enterStudySessionHolderForStart(): Promise<void> {
    const now = new Date();
    const sitting = this.studySessionHolder.getSitting();
    if (sitting.status === 'active') {
      const decision = this.studySessionHolder.decide({
        now,
        trigger: {
          lastRebuiltDay: localToday(now),
          today: localToday(now),
          materialLandedSinceLastRebuild: false,
          assessmentDatePassedSinceLastRebuild: false,
        },
        staleness: {
          itemsDueInScope: false,
          materialArrivedInScope: false,
          assessmentProximityBandCrossedInScope: false,
        },
      });
      if (decision.action === 'hold') return;
      // `[D-162]`: the sitting ENDS — never a recompose of the unreviewed
      // tail — so this falls through to a fresh compose below, exactly like
      // the idle case.
      this.studySessionHolder.exit();
    }
    const composed = await this.composeDefaultStudySession();
    if (composed !== null) this.studySessionHolder.enter(now, composed);
  }

  /**
   * Everything `openReviewSession` needs, read fresh at composition time —
   * shared between the ordinary open (`composeReviewSession`) and the C5.8
   * extend path (`extendReviewSession`, `ol-v7r5.35`), which otherwise would
   * either duplicate this join or risk drifting from it. `null` means the
   * vault wiring is not up yet — same "not composed at all" posture both
   * callers already gave a `null`/`[]` reading for before this bead.
   */
  private async buildReviewSessionInput(): Promise<OpenReviewSessionInput | null> {
    const wiring = this.review;
    if (wiring === null) return null;

    // `ol-sn1q`/`ol-h2bx`: composed fresh on every call, same "read the
    // current wiring, never a copy captured earlier" posture the plan and
    // draft cache below already follow. `explainWhyPort` is `null` on the
    // same F7.8 unconfigured-Worker condition as `this.retrieval` itself;
    // `evaluateConfusionRouting` needs no such gate (pure, local).
    const explainWhyPort = this.buildExplainWhyPort();

    // F2.19 (`ol-vr8z`): assessment records for within-block scope grouping,
    // sourced the same way `session-builder/provider.ts` does — the study-plan
    // settings store's assignments base, gated on it being configured at all.
    const assignmentsConfig = await new ObsidianStudyPlanSettingsStore(this).load();
    const assessments = isStudyPlanConfigured(assignmentsConfig)
      ? (await readAssessments(wiring.vault, assignmentsConfig.assignmentsBasePath)).records
      : [];

    return {
      vault: wiring.vault,
      scheduler: wiring.scheduler,
      deviceId: wiring.deviceId,
      ports: {
        ...wiring.ports,
        ...(explainWhyPort ? { explainWhyPort } : {}),
        evaluateConfusionRouting: (input) => this.evaluateConfusionRouting(input),
      },
      // F2.8 Phase B: whatever plan is cached at this instant, read fresh —
      // never a copy captured when `this.review` was first built, so a
      // background refresh that lands between two sessions reaches the
      // second one without her having to restart Obsidian.
      plan: wiring.plan,
      // F3.3/`[D-097]`'s new-badge merge (`ol-p3t07a`): whatever the cache
      // holds pending, read fresh at open time, exactly like the plan above.
      ...(this.generation ? { draftCache: this.generation.cache } : {}),
      // C7.9's containment co-presence filter (`ol-v7r5.7`, `session/build.ts`):
      // the live, served relation fold, read fresh at open time — `[]` before
      // the first corpus-relation batch has run.
      relations: this.servedRelationEdges(),
      // F2.19 (`ol-vr8z`): resolved into `assessmentContext` inside
      // `buildReviewSession`, alongside `relations` above.
      assessments,
      // `[SESS-8.2]`/`[SESS-8.4]` (`docs/dev/one-assembly-path.md` §3a/§3c):
      // the one plugin-wide composed-session holder, and the port
      // `open-session.ts` calls through when it finds that holder idle —
      // never a private composition step of its own.
      studySessionHolder: this.studySessionHolder,
      composeDefaultStudySession: () => this.composeDefaultStudySession(),
      // `[SESS-8.6]` (`ol-egov.132.6`): F2.17/C5.8's outrun-the-target growth
      // for the held composition — see `extendDefaultStudySession`'s own doc.
      extendDefaultStudySession: (previous) => this.extendDefaultStudySession(previous),
    };
  }

  /**
   * Composes today's session, or `null` if the vault could not be read.
   *
   * Called by `ReviewView` on open — including when Obsidian restores the tab
   * at startup with no command behind it, which is why the composition is
   * deferred to here rather than done once and stashed.
   *
   * The `Notice` and the view's own unavailable screen are both raised on
   * failure, deliberately: the screen explains why the tab is empty and the
   * Notice is visible even if she is not looking at the tab. Neither says a
   * feature is missing, because none is — the read failed.
   *
   * `ol-v7r5.35` (`[D-193]`): `opener` is the ONE `ReviewSessionOpener` the
   * `registerView` factory built for this open tab (`main.ts`'s own
   * `registerView` call) — `opener.open` routes composition through C5.8's
   * freeze rather than a bare, always-recomposing `openReviewSession` call,
   * so a re-render of an already-open, non-stale sitting holds its list
   * still instead of picking up whatever came due in the meantime.
   */
  private async composeReviewSession(opener: ReviewSessionOpener): Promise<ReviewSession | null> {
    const input = await this.buildReviewSessionInput();
    if (input === null) return null;

    const outcome = await opener.open(input);
    if (!outcome.ok) {
      console.error('Olea: could not compose a review session', outcome.error);
      new Notice(REVIEW_UNAVAILABLE_NOTICE);
      return null;
    }
    return outcome.session;
  }

  /**
   * `ol-v7r5.35` (`[D-193]`): the "Keep going" continue path
   * (`ReviewView.continueSessionAfterComplete`) — extends the SAME opener's
   * frozen sitting rather than a second, unfrozen `composeReviewSession`
   * call. `[]` when the vault wiring is not up, matching
   * `ReviewSession.continueWith`'s own no-op-on-empty reading.
   */
  private async extendReviewSession(
    opener: ReviewSessionOpener,
  ): Promise<readonly ReviewQueueItem[]> {
    const input = await this.buildReviewSessionInput();
    if (input === null) return [];
    return opener.extend(input);
  }

  /**
   * `ol-drfy`'s production entry point for the explain-back grading
   * pipeline: reaches `gradeExplainBack` through the real, composed
   * `JudgeCaller` when the Worker is configured, `null` otherwise (F7.8) —
   * propagated through `gradeExplainBackAttempt` (`grading/wiring.ts`)
   * rather than re-checked here.
   *
   * **`ol-12gs` (`[D-163]`) closed the reachability gap this doc used to
   * name.** `openExplainBackModal` below is the real caller: every one of
   * `ExplainBackModal`'s four entry points reaches this method through the
   * `deps.grade` it is constructed with.
   */
  async gradeExplainBackAttempt(
    input: GradeExplainBackInput,
  ): Promise<PendingExplainBackGrading | null> {
    if (this.grading === null) return null;
    return gradeExplainBackAttempt(this.grading, input);
  }

  /**
   * `ol-4053`'s production entry point for the accept-and-observe step:
   * reaches `acceptExplainBackGradingWithObservation` through the same
   * `GradingWiring` `gradeExplainBackAttempt` above uses. `null` under the
   * identical F7.8 condition (no Worker configured, or the kill-switch has
   * tripped) — see that function's own doc for why the two failure reasons
   * are not distinguished in the return type.
   *
   * **`ol-12gs` (`[D-163]`) gives this its first production caller**, the
   * same way it did for `gradeExplainBackAttempt` above: `openExplainBackModal`
   * below builds the `AcceptExplainBackGradingWithObservationContext`
   * (`buildExplainBackObservationContextFor`) and calls this method when she
   * accepts a grading.
   *
   * **`ol-0r92.90` (`[IL-P1c2]`) gives the built-but-never-persisted
   * observation event(s) their production write.** `ol-0r92.89` found that
   * `buildObservationEventsFromAcceptedGrading`'s output reached this far and
   * was then discarded — `appendMisconceptionEvent` (`olea-core`) had no
   * caller anywhere in the plugin. When `wiring`'s result is `'accepted'`,
   * this method now appends every non-skipped outcome's event to the vault
   * through `persistMisconceptionObservations` below, awaited before
   * returning — INV-6: this is Olea's own layer (the misconception log), not
   * her authored notes, so nothing here needs her consent to land.
   */
  async acceptExplainBackGradingWithObservation(
    pending: PendingExplainBackGrading,
    context: AcceptExplainBackGradingWithObservationContext,
  ): Promise<AcceptExplainBackGradingWithObservationResult | null> {
    if (this.grading === null) return null;
    const result = await acceptExplainBackGradingWithObservation(this.grading, pending, context);
    if (result !== null && result.status === 'accepted') {
      await this.persistMisconceptionObservations(context.originInstrumentId, result.observations);
    }
    return result;
  }

  /**
   * `ol-0r92.90`: appends every non-skipped `AcceptedGradingObservationOutcome`
   * (`olea-core`'s `buildObservationEventsFromAcceptedGrading` output) to the
   * vault's misconception log via `appendMisconceptionEvent`, idempotent on
   * `originInstrumentId` — `this.persistedMisconceptionObservationsByAttempt`
   * memoizes the in-flight `Promise` itself, the same technique
   * `GradingWiring.acceptedObservationsByAttempt` (`grading/wiring.ts`) uses
   * one layer up, so a sequential retry or a concurrent double-accept for the
   * SAME attempt id persists at most once rather than re-appending a
   * duplicate line per caller. A per-event append failure is logged (D-005:
   * count only, never the event's own statement/correction text) and never
   * rethrown — an observation-persistence failure must not surface as a
   * failure of the grade acceptance it rode on, mirroring
   * `buildObservationEventsFromAcceptedGrading`'s own embedder-failure
   * isolation one layer down.
   */
  private persistMisconceptionObservations(
    originInstrumentId: string,
    outcomes: readonly AcceptedGradingObservationOutcome[],
  ): Promise<void> {
    const existing = this.persistedMisconceptionObservationsByAttempt.get(originInstrumentId);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const vault = new ObsidianSource(this.app);
      const deviceId = await ensureDeviceId(this);
      for (const outcome of outcomes) {
        if (outcome.skipped) continue;
        try {
          await appendMisconceptionEvent(vault, outcome.result.event, deviceId);
        } catch (error) {
          console.error('Olea: failed to persist a misconception observation event', error);
        }
      }
    })();
    this.persistedMisconceptionObservationsByAttempt.set(originInstrumentId, promise);
    return promise;
  }

  /**
   * F5.2's grounding half for the "Explain it back" view (`ol-12gs`):
   * `explain-back/request.ts`'s `retrieveExplainBackSourceBlocks` over
   * whatever the keyword index and embedding cache currently hold — the
   * same two instances `composeExplainWhySourceChunks` above assembles for
   * F2.7's grounding half. `[]` when either half isn't ready yet, same
   * "refuse honestly downstream, not here" contract.
   */
  private async composeExplainBackSourceBlocks(
    query: string,
  ): Promise<readonly ExplainBackSourceBlock[]> {
    const embeddingCache = this.retrieval?.embeddingCache;
    const embeddingProvider = this.retrieval?.embeddingProvider;
    if (embeddingCache === null || embeddingCache === undefined) return [];
    if (embeddingProvider === null || embeddingProvider === undefined) return [];
    if (this.keywordIndex === null) return [];
    return retrieveExplainBackSourceBlocks(
      {
        retrieve: {
          keywordIndex: this.keywordIndex.engine.toPersisted(),
          embeddingCache,
          embeddingProvider,
          registryOverrides: this.registryOverridesCache,
        },
      },
      query,
    );
  }

  /**
   * Builds the `AcceptExplainBackGradingWithObservationContext` the accept
   * step needs — a fresh misconception-store read every call, same
   * "load fresh, never cache" discipline `ingestSessionJustClosed`'s own
   * `misconceptionStore` read above already follows, since a projection this
   * cheap gains nothing from staleness risk.
   *
   * **`ol-gavc` gives `sourceRevisionStale` its first live producer.**
   * `ol-0r92.89` built `hasExplainBackSourceRevisionChanged`
   * (`explain-back/observation.ts`) and the reject-on-stale guard one layer
   * down, but named this method — the only place a fresh retrieval can be
   * composed — as the missing caller. `params.query` (the same string the
   * view retrieved `params.sourceBlocks` against originally —
   * `modal.ts`'s `acceptGrading` now threads `prompt.context.question`
   * through) is re-run through `composeExplainBackSourceBlocks`, mirroring
   * how `resolveInstrumentPrompt`/`resolveTopicPrompt` retrieved the graded
   * blocks in the first place; the two block lists are compared and the
   * verdict is passed through as `sourceRevisionStale`, never re-derived
   * downstream.
   */
  private async buildExplainBackObservationContextFor(params: {
    readonly subjectConceptId: string | null;
    readonly originInstrumentId: string;
    readonly sourceBlocks: readonly ExplainBackSourceBlock[];
    readonly query: string;
  }): Promise<AcceptExplainBackGradingWithObservationContext> {
    const vault = new ObsidianSource(this.app);
    const deviceId = await ensureDeviceId(this);
    const store = createVaultMisconceptionStore({ vault, deviceId, now: () => new Date() });
    const records = (await store.load()) ?? [];
    const freshSourceBlocks = await this.composeExplainBackSourceBlocks(params.query);
    return buildExplainBackObservationContext({
      subjectConceptId: params.subjectConceptId,
      originInstrumentId: params.originInstrumentId,
      // Recording the graded verdict into a review-log event is `ol-95vv`'s
      // mastery-fold job, not this view's (see `explain-back/modal.ts`'s
      // module doc) — so there is never a review-log event id to attach here.
      originReviewEventId: null,
      sourceBlocks: params.sourceBlocks,
      records,
      now: () => new Date(),
      sourceRevisionStale: hasExplainBackSourceRevisionChanged(
        params.sourceBlocks,
        freshSourceBlocks,
      ),
    });
  }

  /**
   * `ol-38kp`: the last reachability hop for `ol-cqz8`'s SOLO review-log
   * write. Builds a real `RecordSoloGradeAndReviewDeps` — `this.grading`
   * plus a fresh `ObsidianSource`/device id, mirroring
   * `buildExplainBackObservationContextFor`'s own vault/deviceId
   * construction just above — and calls `recordSoloGradeAndReview`
   * (`./explain-back/solo-review.js`). No-op when `this.grading` is `null`,
   * the same guard `gradeExplainBackAttempt`/
   * `acceptExplainBackGradingWithObservation` above already take, since
   * `GradingWiring` itself is optional at plugin level.
   *
   * `ol-iti2` (`[D-217]`): forwards the graded `SoloLevel` back out —
   * `solo-review.ts`'s `recordSoloGradeAndReview` now resolves a
   * `RecordSoloGradeAndReviewOutcome` (`{ result, soloLevel }`) rather than
   * the bare `AppendReviewLogResult`, and this wrapper's own return type
   * widens from `Promise<void>` to `Promise<SoloLevel | void>` to match
   * `ExplainBackModalDeps.recordSoloGradeAndReview`'s declared shape
   * (`modal.ts`), so `renderAcceptedPhase`'s depth heading has a real level
   * to render instead of always taking the "no level" branch.
   */
  private async recordExplainBackSoloGradeAndReview(params: {
    readonly instrumentId: string;
    readonly subjectConceptId: string | null;
    readonly context: ExplainBackPromptContext;
    readonly answer: string;
  }): Promise<SoloLevel | undefined> {
    if (this.grading === null) return;
    const outcome = await recordSoloGradeAndReview(
      {
        grading: this.grading,
        vault: new ObsidianSource(this.app),
        deviceId: await ensureDeviceId(this),
        now: () => new Date(),
      },
      params,
    );
    return outcome?.soloLevel;
  }

  /**
   * `ol-2zfj.75` (C7.9/F5.6): the transient misconception digest for one
   * explain-back prompt's concept(s) — a fresh misconception-store read
   * every call, same "load fresh, never cache" discipline
   * `buildExplainBackObservationContextFor` above already follows for the
   * identical store. `[]` (never a throw) when the store cannot read the
   * vault, mirroring `buildExplainBackObservationContextFor`'s own
   * `?? []` collapse of `store.load()`'s null case.
   */
  private async buildExplainBackMisconceptionDigestFor(
    conceptIds: readonly string[],
  ): Promise<GradeExplainBackInput['misconceptionDigest']> {
    const vault = new ObsidianSource(this.app);
    const deviceId = await ensureDeviceId(this);
    const store = createVaultMisconceptionStore({ vault, deviceId, now: () => new Date() });
    const records = (await store.load()) ?? [];
    return buildMisconceptionDigest(records, { conceptIds: [...conceptIds] });
  }

  /**
   * The ONE construction point for `ExplainBackModal` (`[D-163]`, `ol-12gs`)
   * — every one of the four ruled entry points (the command below, F2.12's
   * confusion banner in `review/view.ts`, and the session-builder/Today
   * affordance in `session-builder/view.ts`) calls this same method rather
   * than constructing the modal itself, which is what makes "one dedicated
   * view, single rendering implementation" true of the wiring and not just
   * of the class.
   */
  private openExplainBackModal(seed: ExplainBackSeed, onClosed?: () => void): void {
    new ExplainBackModal(
      this.app,
      {
        grade: (input) => this.gradeExplainBackAttempt(input),
        acceptWithObservation: (pending, context) =>
          this.acceptExplainBackGradingWithObservation(pending, context),
        retrieveSourceBlocks: (query) => this.composeExplainBackSourceBlocks(query),
        buildObservationContext: (params) => this.buildExplainBackObservationContextFor(params),
        recordSoloGradeAndReview: (params) => this.recordExplainBackSoloGradeAndReview(params),
        loadMisconceptionDigest: (conceptIds) =>
          this.buildExplainBackMisconceptionDigestFor(conceptIds),
        generateInstrumentId: () => `explain-back:${globalThis.crypto.randomUUID()}`,
        ...(onClosed ? { onClosed } : {}),
      },
      seed,
    ).open();
  }

  /**
   * `ol-p4t05`'s production entry point for F2.12 confusion routing: decides,
   * from a just-recorded rating and the resulting lapse count, whether to
   * surface the explain-back offer instead of just rescheduling harder — and
   * what that offer says. Pure and synchronous — see `grading/wiring.ts`'s
   * module doc for why this needs no Worker/F7.8 gating, unlike
   * `gradeExplainBackAttempt` above.
   *
   * **`ol-h2bx` closed the reachability gap this doc used to name; `ol-12gs`
   * (`[D-163]`) changed WHERE the accepted offer goes.**
   * `composeReviewSession` above passes `(input) =>
   * this.evaluateConfusionRouting(input)` into `openReviewSession`'s
   * `ports.evaluateConfusionRouting`, which `ReviewSession.logAndAdvance`
   * (`review/session.ts`) calls after every graded Q&A/cloze/MCQ rating. The
   * accepted offer used to route through F2.7's on-demand channel
   * (`explainWhyPort`/`requestExplainWhy`) — a placeholder destination while
   * F5's own view did not exist. `ReviewView`'s confusion banner now opens
   * `openExplainBackModal` above directly instead; see that view's own
   * `handleAcceptConfusionOffer` doc.
   */
  evaluateConfusionRouting(input: ConfusionRoutingInput): ConfusionRoutingDecision {
    return evaluateConfusionRouting(input);
  }

  /**
   * `ol-0r92.22`'s production entry point for F5.1's first-suggestion picker:
   * given a tier-labelled candidate list (the shape
   * `olea-service/eval/explainback/SEEDING.md`'s schema documents,
   * generalised — real per-student seeding data stays in the private repo)
   * and the ids already invited, returns the earliest-tier candidate not yet
   * offered. Pure and synchronous, exactly like `evaluateConfusionRouting`
   * above — no Worker/F7.8 gating applies here either.
   *
   * **No caller of this method exists in this package yet, deliberately —
   * the same gap `gradeExplainBackAttempt`/`readConceptsFromVault` document
   * above.** There is no command, view or onboarding surface today that
   * decides WHEN to offer the first explain-back invitation or supplies a
   * real tiered candidate list; building either is a separate bead's job
   * (a new user-visible surface needs its own citing clause, per this
   * repo's own standing rule), not implied by wiring this picker. Nor does
   * anything in this package compute `InvitationTier` automatically from an
   * arbitrary vault — `SEEDING.md`'s depth-to-tier labelling was a human
   * judgement applied once to one real extraction run, not a pipeline
   * output; a real per-vault tier signal is future work.
   */
  pickFirstExplainBackInvitation<T extends FirstInvitationCandidate>(
    candidates: readonly T[],
    alreadyInvitedIds: ReadonlySet<string> | readonly string[] = [],
  ): T | null {
    return pickNextExplainBackInvitation(candidates, alreadyInvitedIds);
  }

  /**
   * `ol-5nle`'s production entry point for the concept-reading stage:
   * reaches `readConcepts` through the real, composed `ConceptReaderPort`
   * when the Worker is configured, `null` otherwise (F7.8) — propagated
   * through `readConceptsFromVault` (`concept/wiring.ts`) rather than
   * re-checked here.
   *
   * No caller of this method exists in this package yet, deliberately — the
   * same gap `gradeExplainBackAttempt` documents above. There is no command,
   * view or schedule today that decides WHEN to read her vault for concepts;
   * building one is a separate bead's job, not implied by wiring the port.
   */
  async readConceptsFromVault(options: ReadConceptsFromVaultOptions = {}) {
    if (this.concept === null) return null;
    return readConceptsFromVault(this.concept, new ObsidianSource(this.app), options);
  }

  /**
   * `ol-fx1k`'s production entry point for knowledge-kind classification
   * (`[KCT-2]`, `[D-114]`): reaches `classifyKnowledgeKind` through the
   * composed `KnowledgeKindClassifierPort` when the Worker is configured,
   * `null` otherwise (F7.8) — propagated through
   * `classifyConceptKnowledgeKind` (`concept/wiring.ts`).
   *
   * No caller of this method exists in this package yet, deliberately — the
   * same gap `readConceptsFromVault` documents above. The named consumer is
   * component 2.2's instrument-type routing (`ol-dlr1`), which decides WHEN a
   * concept's kind is worth a model call; `options.confidenceFloor` stays
   * caller-supplied because register row 1.5 rules it DERIVED and nobody has
   * run the derivation.
   */
  async classifyKnowledgeKindForConcept(
    request: ClassifyKnowledgeKindRequest,
    options: ClassifyKnowledgeKindOptions,
  ) {
    if (this.knowledgeKind === null) return null;
    return classifyConceptKnowledgeKind(this.knowledgeKind, request, options);
  }

  /**
   * Opens the review session as a full tab (F2.2), or reveals the one already
   * open.
   *
   * Never stacks a second review tab, for the same reason `revealTodayView`
   * does not: a command that opens a duplicate every time she presses it is a
   * command she stops pressing. Revealing rather than replacing also means a
   * half-finished session survives her pressing it again — `ReviewView` builds
   * its queue in `onOpen`, so an existing tab is never re-composed underneath
   * her.
   */
  /**
   * Opens Olea's settings tab — the door F7.2's term-dates quiet pointer
   * (`[D-147]`, `today/view.ts`'s `renderTermDatesPointer`) offers onto the
   * ask. `app.setting` is Obsidian's own settings-modal controller; it has
   * no public type (`obsidian.d.ts` declares no `setting` member on `App`),
   * so every plugin that jumps a user to its own settings reaches for it the
   * same undocumented way. Wrapped in `try`/`catch` because this button is
   * not load-bearing for anything else on the panel — a future host that
   * removes or renames this API should make the pointer a dead end, never a
   * thrown error (degrade-never-block, F6.9).
   */
  private openSettingsTab(): void {
    try {
      const settingController = (
        this.app as unknown as {
          setting?: { open?: () => void; openTabById?: (id: string) => void };
        }
      ).setting;
      settingController?.open?.();
      settingController?.openTabById?.(this.manifest.id);
    } catch {
      // Best effort — see this method's doc.
    }
  }

  /**
   * `OLEA_COMMAND_CREATE_CARD`'s real destination (F2.1, C1.4, `ol-0r92.76`;
   * Q&A half `[D-268]`/`ol-0r92.77` [H-qa-card-modal]) —
   * `commands/create-card.ts`'s own module doc explains the split. Reads the
   * active note fresh through a throwaway `ObsidianSource`, the same
   * "construct one per call, never cache" shape every other command handler
   * in this file uses. A `'no-selection'` outcome now opens `QaCardModal`
   * (`[D-268]`'s entry surface) in place of the honest "not yet" notice this
   * branch used to give — `completeQaCardEntry` below is its confirm
   * callback's destination.
   */
  private async handleCreateCardCommand(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file ?? null;
    if (view === null || file === null) {
      new Notice('Olea: open a note first to create a card from it.');
      return;
    }

    const editor = view.editor;
    const start = editor.posToOffset(editor.getCursor('from'));
    const end = editor.posToOffset(editor.getCursor('to'));

    const vault = new ObsidianSource(this.app);
    const source = await vault.read(file.path);
    const outcome = resolveCreateCardOutcome(source, { start, end });

    if (outcome.kind === 'no-selection') {
      const path = file.path;
      const cursorOffset = outcome.cursorOffset;
      new QaCardModal(this.app, ({ front, back }) => {
        void this.completeQaCardEntry(vault, path, source, cursorOffset, front, back);
      }).open();
      return;
    }

    const notice = createCardNoticeText(outcome);
    if (notice !== null) new Notice(notice);

    if (outcome.kind === 'clozed') {
      await vault.write(file.path, outcome.content);
    }
  }

  /**
   * `QaCardModal`'s confirm callback (F2.1, `[D-268]`) — resolves the
   * confirmed front/back text through `create-card.ts`'s
   * `createQaCardFromEntry` (which calls `olea-core#createQaCard`) and
   * writes the result back through the vault on success; a rejection (a
   * non-anchorable block, or blank text the modal's own disabled-Confirm
   * state should already have prevented) surfaces as the same kind of
   * `Notice` the cloze branch above uses, never a silent no-op. Kept as its
   * own method, not inlined in the modal's `onConfirm`, only so a
   * synchronous callback can hand off to this `async` write without making
   * `handleCreateCardCommand` itself wait on the modal being answered.
   */
  private async completeQaCardEntry(
    vault: VaultSource,
    path: VaultPath,
    source: string,
    cursorOffset: number,
    front: string,
    back: string,
  ): Promise<void> {
    const outcome = createQaCardFromEntry({ source, cursorOffset, front, back });
    if (outcome.kind === 'rejected') {
      new Notice(`Olea: couldn't create a card there — ${outcome.message}`);
      return;
    }
    await vault.write(path, outcome.content);
  }

  private async revealReviewView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_REVIEW);
    const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_REVIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /**
   * Opens the Today panel in the right sidebar, or reveals the one already
   * there. Never opens a second copy: F7.7's ⌥1 is a "show me" key, and a
   * command that stacks panes is a command she stops pressing.
   *
   * Always refreshes on the way out (`ol-h3wy`). A freshly-created leaf
   * already refreshes once in `TodayView.onOpen`, so this is a harmless
   * repeat there; for a leaf that already existed, it is the only refresh —
   * without it, "open Olea" on an already-open panel would just reveal
   * whatever was last drawn, which is exactly the staleness this bead
   * describes when she checks Today without closing an in-progress review.
   */
  private async revealTodayView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_TODAY);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_TODAY, active: true });
    }
    await workspace.revealLeaf(leaf);
    await this.refreshTodayViews();
  }

  /** Refreshes every open Today leaf. See `today/refresh.ts` for the mechanism. */
  private async refreshTodayViews(): Promise<void> {
    await refreshOpenTodayViews(this.app.workspace, VIEW_TYPE_OLEA_TODAY);
  }

  /**
   * Opens the gap/coverage screen (`ol-2tyj`) as a full tab, or reveals the
   * one already there — the same reuse-don't-stack shape as
   * `revealTodayView` above, for the same reason.
   *
   * **A tab, not the right sidebar (`[D-224]` / `ol-l5og.20`,
   * `ol-l5og.18.3`).** `GapView` grew from a compact ranked-row list into the
   * corrected kit's full-width per-concept detail pages — the same "sidebar
   * width forces a simplification the container chose, not the design"
   * argument that already justified `revealReviewView`'s own
   * `workspace.getLeaf('tab')` door for F2.2. This is that same door,
   * reused rather than a second pattern invented for it.
   *
   * Always refreshes on the way out, mirroring `revealTodayView`'s own
   * `ol-h3wy` reasoning: a freshly-created leaf already refreshes once in
   * `GapView.onOpen`, so this is a harmless repeat there; for a leaf that
   * already existed, it is what keeps "open the worth-studying panel" from
   * just revealing whatever it last composed.
   */
  private async revealGapView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_GAP);
    const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_GAP, active: true });
    }
    await workspace.revealLeaf(leaf);
    await this.refreshGapViews();
  }

  /** Refreshes every open gap-view leaf. Reuses `today/refresh.ts`'s mechanism — it names no Today specifics, only a `viewType`. */
  private async refreshGapViews(): Promise<void> {
    await refreshOpenTodayViews(this.app.workspace, VIEW_TYPE_OLEA_GAP);
  }

  /**
   * Opens F3.3's bulk-review triage path (`ol-jie3`) in the right sidebar,
   * or reveals the one already there — the same reuse-don't-stack shape as
   * `revealGapView`/`revealTodayView`/`revealHomeView`, for the
   * same reason: a command that stacks panes is a command she stops
   * pressing.
   *
   * Always refreshes on the way out, mirroring `revealTodayView`'s/
   * `revealGapView`'s own `ol-h3wy` reasoning: a first-presentation review
   * resolved elsewhere (or a change on another device, `[CACHE-1]`) could
   * land between two reveals of an already-open leaf, and this is what
   * keeps that leaf from just showing whatever it last composed.
   */
  private async revealBulkReviewView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_BULK_REVIEW);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_BULK_REVIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_BULK_REVIEW);
  }

  /**
   * Opens F8.8's retrospective (`ol-r68l`, `[D-134]`) in the right sidebar,
   * or reveals the one already there — the same reuse-don't-stack shape as
   * `revealGapView`/`revealBulkReviewView`, for the same reason.
   *
   * Always refreshes on the way out, mirroring `revealBulkReviewView`'s own
   * `ol-h3wy` reasoning — a passed assessment noticed between two opens (or
   * an offer opened/dismissed on another device) must not need a reload to
   * show. `RetrospectiveView.refresh` is also where opening is recorded
   * (`deps.markOpened`), so this reveal is the moment F8.8's "offered once"
   * actually fires, not merely a redraw.
   */
  private async revealRetrospectiveView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_RETROSPECTIVE);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_RETROSPECTIVE, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_RETROSPECTIVE);
  }

  /**
   * Opens the concept and instrument registry (F8.4, `ol-4v2l`), or reveals
   * the one already open — the same reuse-don't-stack shape as
   * `revealGapView`/`revealRetrospectiveView`, for the same reason.
   *
   * Always refreshes on the way out (`ol-h3wy`'s pattern): a rename or a
   * withdraw/restore already refreshes the leaf that issued it
   * (`RegistryView`'s own button handlers call `this.refresh()`), but a
   * second open leaf, or a session completed elsewhere since this one last
   * drew, should not need a manual reload to show current mastery.
   */
  private async revealRegistryView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_REGISTRY);
    const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_REGISTRY, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_REGISTRY);
  }

  /**
   * Opens Home (F6.10, `[D-223]`, `ol-l5og.21` [HOME-2]), or reveals the one
   * already open, in a main-pane tab — the same slot `RegistryView`/
   * `GroveView` occupy, not the right sidebar this method used before
   * `[D-223]`. Home was a glance-and-return companion when it hosted only
   * the F8.8 standing offer; it is now the landing dashboard `[D-033]`'s
   * front-door ruling attaches to, and a sidebar strip cannot carry F6.10's
   * headline plus a row per running course at any honest width — the same
   * "sidebar width forces a simplification the container chose, not the
   * design" reasoning `revealGapView`'s own module doc already states for
   * choosing a tab over a sidebar.
   *
   * Always refreshes on the way out (`ol-h3wy`'s pattern): a dismiss from
   * the grove, or an assessment that just passed, must not need a manual
   * reload to show here.
   *
   * `conceptName` is the gap view's `'build-session'` affordance pre-filling
   * F4.6's stated-interest steering input (`[D-243]`, `ol-egov.132.7`
   * [SESS-8.7]) — the palette command passes nothing and gets the whole
   * ranking. The seed is applied through `HomeView.setFocusConcept`, which
   * refreshes — so pressing the affordance on a *second* row rebuilds the
   * open pane around that row instead of leaving her looking at the first
   * one's session, the same reasoning `revealSessionBuilderView` (retired by
   * this ruling) always gave for its own identical seed.
   */
  private async revealHomeView(conceptName?: string): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_HOME);
    const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_HOME, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_HOME);
    if (conceptName !== undefined) {
      const view = leaf.view;
      if (view instanceof HomeView) await view.setFocusConcept(conceptName);
    }
  }

  /**
   * Opens the course grove (F8.1, `[D-134]` Q1, `ol-0r92.17`), or reveals
   * the one already open, in a main-pane tab — the same slot `RegistryView`
   * occupies, since this is a per-course browse rather than a sidebar
   * glance.
   *
   * Always refreshes on the way out, same reasoning as `revealHomeView`.
   */
  private async revealGroveView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_GROVE);
    const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeaf('tab');
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_GROVE, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_GROVE);
  }

  override onunload(): void {
    // Both views are registered via `registerView`, which Obsidian's own
    // `Component.onunload` detaches; the ingestion tick interval goes through
    // `registerInterval`, which it clears; the keyword index's vault-event
    // subscription goes through `register`, which runs its callback
    // (`unsubscribe`) on teardown.
    //
    // `[JEV-11]` (`ol-3ux7.96`): flush a pending COALESCED gate-stage write
    // rather than losing a session's tail to `GateStagePersistence`'s
    // debounce window — without this, a reload landing inside that window
    // would discard whatever attributions triggered it. `onunload` is
    // synchronous (`Component`'s own contract), so this cannot be awaited
    // here; it is fired and left to settle on whatever time Obsidian
    // actually gives teardown, same best-effort posture every write on this
    // path already takes.
    this.gateStagePersistence.flush();
  }
}
