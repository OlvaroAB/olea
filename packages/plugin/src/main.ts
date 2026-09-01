import { Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import type { StudyPlanEnvelope } from 'olea-contracts';
import {
  type ClassifyKnowledgeKindOptions,
  type ClassifyKnowledgeKindRequest,
  type ConceptRelation,
  type ConfusionPairingVerdict,
  type ConfusionRoutingDecision,
  type ConfusionRoutingInput,
  type CourseDetectionProposal,
  calendarDayFromLocalDate,
  corroborateConfusionPairings,
  createFsrsScheduler,
  type DeviceCapability,
  detectCourseProposals,
  EMPTY_REGISTRY_OVERRIDES,
  type ExplainBackPromptContext,
  type ExtractedUnit,
  type FirstInvitationCandidate,
  type GradeExplainBackInput,
  loadCachedStudyPlan,
  notePathCourses,
  type PendingExplainBackGrading,
  parseDocument,
  parseFrontmatter,
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
} from 'olea-core';
import { copyDiagnosticsToClipboard } from './commands/diagnostics-clipboard.js';
import { createCardPlaceholder } from './commands/placeholders.js';
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
  type KnowledgeKindWiring,
  type ReadConceptsFromVaultOptions,
  readConceptsAndRelations,
  readConceptsFromVault,
} from './concept/wiring.js';
import { CourseSetupModal } from './course-setup/setup-modal.js';
import { ensureDeviceId } from './device/device-id.js';
import { ExplainBackModal, type ExplainBackSeed } from './explain-back/modal.js';
import { buildExplainBackObservationContext } from './explain-back/observation.js';
import {
  type ExplainBackSourceBlock,
  retrieveExplainBackSourceBlocks,
} from './explain-back/request.js';
import { recordSoloGradeAndReview } from './explain-back/solo-review.js';
import { createLocalGapProvider } from './gap/provider.js';
import { GapView, VIEW_TYPE_OLEA_GAP } from './gap/view.js';
import { createBulkReviewController } from './generation/bulk-review.js';
import { BulkReviewView, VIEW_TYPE_OLEA_BULK_REVIEW } from './generation/bulk-review-view.js';
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
import { buildIngestionRunner, type IngestionWiring } from './ingestion/wiring.js';
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
  createObsidianEditInstrumentPort,
  createObsidianOpenSourceLocationPort,
  openRegistryEntryFor,
} from './registry/obsidian-ports.js';
import { ObsidianRegistryOverridesStore } from './registry/overrides-store.js';
import { createLocalRegistryProvider } from './registry/provider.js';
import { RegistryView, VIEW_TYPE_OLEA_REGISTRY } from './registry/view.js';
import { buildClassifyPassageHook } from './retrieval/classify-passage.js';
import type { DraftQuizCardsDeps } from './retrieval/draft-quiz-cards.js';
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
import { createObsidianEditPort } from './review/obsidian-ports.js';
import { openReviewSession, type ReviewSessionPorts } from './review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  isoWithLocalOffset,
  systemClock,
} from './review/ports.js';
import type { ReviewSession } from './review/session.js';
import type { ReviewInstrument } from './review/types.js';
import { ReviewView, VIEW_TYPE_OLEA_REVIEW } from './review/view.js';
import { createLocalSessionBuilderProvider } from './session-builder/provider.js';
import { SessionBuilderView, VIEW_TYPE_OLEA_SESSION } from './session-builder/view.js';
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
  private keywordIndex: KeywordIndexWiring | null = null;
  private retrieval: RetrievalWiring | null = null;
  private grading: GradingWiring | null = null;
  private concept: ConceptWiring | null = null;
  /** Component register row 1.5's classifier port (`[KCT-2]` `ol-fx1k`, `[D-114]`) — F7.8 grey-out, same shape as `concept` above. */
  private knowledgeKind: KnowledgeKindWiring | null = null;
  /** F3.3's automatic generation pipeline (`ol-p3t07a`) — built unconditionally (unlike `retrieval`/`keywordIndex`, it needs no Worker token: the cache and accept/reject flow work offline, and only the sweep itself is a no-op with no Worker configured, F7.8). */
  private generation: GenerationWiring | null = null;
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
   * C7.8's course-detection surface (`[D-098]` point 1, F1.3, `ol-0r92.7`):
   * course codes `checkForCourseSetupProposals` has already put in front of
   * her this session, confirmed or dismissed either way — never asked about
   * twice in one session, per principle 12's "must not become nagging."
   * **Session-only memory, not a store.** Persisting which courses are
   * confirmed is a `CourseRecord`-shaped, Class C schema addition
   * (`packages/core/src/course/lifecycle.ts`'s module doc); until that lands,
   * this set is empty on every plugin load and she is asked again about every
   * course-shaped folder each time Obsidian restarts — an acknowledged gap
   * this bead stops short of closing, not a silent one.
   */
  private courseSetupSeenCodes = new Set<string>();
  /** At most one course-setup modal open at a time — a second detected course waits for this one to resolve rather than stacking prompts. */
  private courseSetupModalOpen = false;

  /**
   * The most recent pass's folded relation set (`ol-2zfj.12`) — both stages'
   * edges, deduplicated and provenance-ranked. Held in memory for the process
   * lifetime, deliberately NOT persisted: `ConceptRelation`'s endpoints are
   * concept NAMES while C7.11/`[D-088]` rule identity an opaque key never
   * derived from content, so a persisted, name-keyed edge store would bake in
   * the exact fragility that clause prevents. The persisted home is a Class C
   * proposal in `olea-service/docs/dev/relation-landing-design.md` §7.1.
   *
   * **Now read by both session-composition call sites** (`ol-v7r5.7`):
   * `composeReviewSession` and the Today panel's `createVaultInstrumentSource`
   * wiring below each pass `this.servedRelationEdges()` into
   * `buildReviewSession`'s `relations` input, which feeds `session/build.ts`'s
   * C7.9 containment co-presence filter. Of `[D-070]`'s two corpus-type
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
    // Constructed after `vault` and `deviceId` exist because F7.4's privacy
    // section (`ol-p6t01`) needs both.
    this.addSettingTab(
      new OleaSettingTab(this.app, this, this, createRecordingTransport, { vault, deviceId }),
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

    this.registerView(
      VIEW_TYPE_OLEA_REVIEW,
      (leaf) =>
        new ReviewView(
          leaf,
          () => this.composeReviewSession(),
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
        ),
    );

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
      createCard: createCardPlaceholder,
      openToday: () => {
        void this.revealTodayView();
      },
      openGap: () => {
        void this.revealGapView();
      },
      // `ol-p5t06b`: the palette's own door onto the session builder, built
      // from the whole ranking. The gap view's `build-session` affordance is
      // the other door, and seeds a concept — see `revealSessionBuilderView`.
      buildSession: () => {
        void this.revealSessionBuilderView(undefined);
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
              // C7.9's containment co-presence filter (`ol-v7r5.7`): the
              // Today count and the review queue must agree on which
              // candidates a container/part pair drops, so this reads the
              // same served fold `composeReviewSession` below passes.
              relations: this.servedRelationEdges(),
            }),
            now: () => new Date(),
            // F6.2/F6.5 (`ol-lohq`, `ol-p6t04`): the trends source feeds the
            // Today panel's insights. Absent path means "not configured",
            // which `createVaultTrendsSource` already reads as "no weights"
            // rather than a guessed folder.
            trends: createVaultTrendsSource({ vault, assessmentsBasePath: assignmentsBasePath }),
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
            // `ol-p5t06b`: the `'build-session'` affordance has been a label
            // with nothing behind it since P5-T06a. This is what it does —
            // open the session builder seeded with the row's concept, so
            // "Build a session from this" is literally about *this*.
            buildSession: (row) => {
              void this.revealSessionBuilderView(row.conceptName);
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
        new BulkReviewView(leaf, () =>
          createBulkReviewController({
            cache: generationWiring.cache,
            acceptPort: generationWiring.acceptPort,
            editPort: createObsidianEditPort(this.app),
          }),
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
        acceptToVault: (reading) => provider.acceptToVault(reading),
      });
    });

    // `ol-0r92.17` (F8.8, `[D-134]` Q1): Home hosts every standing
    // retrospective offer, unfiltered — `retrospective/offer-card.ts`'s own
    // doc names this exact shape. `openRetrospective` is supplied here
    // (navigation), never by `createLocalHomeProvider` (data) — see
    // `home/provider.ts`'s module doc for the split.
    this.registerView(VIEW_TYPE_OLEA_HOME, (leaf) => {
      const provider = createLocalHomeProvider({
        vault,
        deviceId,
        settingsHost: this,
        now: () => new Date(),
      });
      return new HomeView(leaf, {
        load: () => provider.load(),
        openRetrospective: () => {
          void this.revealRetrospectiveView();
        },
        dismiss: (assessmentPath) => provider.dismiss(assessmentPath),
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
            editPort: createObsidianEditInstrumentPort(this.app),
            // `[D-171]`/`ol-2zfj.43`: the open-source-location hand-off —
            // until this line the registry's "Open source" action logged an
            // error instead of opening anything (`ol-2zfj.47`).
            openSourceLocationPort: createObsidianOpenSourceLocationPort(this.app),
            // `ol-r5j4`: keeps `this.registryOverridesCache` current the
            // instant she renames, withdraws or restores a concept from this
            // view — see that field's own doc.
            onOverridesChanged: (overrides) => {
              this.registryOverridesCache = overrides;
            },
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
   * synthesises exactly one `ExtractedUnit` whose `provenance.embeddedIn
   * .notePath` is the note's OWN path — the only field `runGenerationSweep`'s
   * `embeddingNotePaths` reads (`generation/pipeline.ts`) to decide which
   * note, and therefore which course, "landed." `provenance.location` is a
   * placeholder (`page: 1`, the whole canonicalised text as one range): the
   * sweep never reads a synthesised unit's `text` or its non-`embeddedIn`
   * provenance fields, only `embeddedIn.notePath` — see that file's module
   * doc.
   *
   * By the same construction, the note's own path is also
   * `materializeAcceptedDraft`'s insertion target
   * (`generation/materialize-mcq.ts`'s module doc: "a draft's `sourcePath`
   * is always the note that embedded the material it was drafted from") — so
   * an authored note's drafted instrument lands back inside that same note,
   * and only at accept, through the existing passive-accept review flow
   * (`[D-097]`). That flow — not this method — is the consent gesture INV-6
   * requires; nothing here writes to the vault.
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
      onConfirm: (result) => {
        this.courseSetupModalOpen = false;
        new Notice(`Olea: "${result.name}" confirmed as a course.`);
        void this.openNextCourseSetupProposal(vault);
      },
      onDismiss: () => {
        this.courseSetupModalOpen = false;
        void this.openNextCourseSetupProposal(vault);
      },
    }).open();
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
   */
  private async onUnitsLanded(units: readonly ExtractedUnit[]): Promise<void> {
    if (this.generation === null) return;
    try {
      await this.generation.sweep(units, this.draftQuizCardsDeps(), {
        classifier: this.knowledgeKind?.classifier ?? null,
      });
    } catch (error) {
      console.error('Olea: generation sweep failed', error);
    }
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
   */
  private async composeReviewSession(): Promise<ReviewSession | null> {
    const wiring = this.review;
    if (wiring === null) return null;

    // `ol-sn1q`/`ol-h2bx`: composed fresh on every open, same "read the
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

    const outcome = await openReviewSession({
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
    });
    if (!outcome.ok) {
      console.error('Olea: could not compose a review session', outcome.error);
      new Notice(REVIEW_UNAVAILABLE_NOTICE);
      return null;
    }
    return outcome.session;
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
   */
  async acceptExplainBackGradingWithObservation(
    pending: PendingExplainBackGrading,
    context: AcceptExplainBackGradingWithObservationContext,
  ): Promise<AcceptExplainBackGradingWithObservationResult | null> {
    if (this.grading === null) return null;
    return acceptExplainBackGradingWithObservation(this.grading, pending, context);
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
   */
  private async buildExplainBackObservationContextFor(params: {
    readonly subjectConceptId: string | null;
    readonly originInstrumentId: string;
    readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  }): Promise<AcceptExplainBackGradingWithObservationContext> {
    const vault = new ObsidianSource(this.app);
    const deviceId = await ensureDeviceId(this);
    const store = createVaultMisconceptionStore({ vault, deviceId, now: () => new Date() });
    const records = (await store.load()) ?? [];
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
   */
  private async recordExplainBackSoloGradeAndReview(params: {
    readonly instrumentId: string;
    readonly subjectConceptId: string | null;
    readonly context: ExplainBackPromptContext;
    readonly answer: string;
  }): Promise<void> {
    if (this.grading === null) return;
    await recordSoloGradeAndReview(
      {
        grading: this.grading,
        vault: new ObsidianSource(this.app),
        deviceId: await ensureDeviceId(this),
        now: () => new Date(),
      },
      params,
    );
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
   * Opens the gap/coverage screen (`ol-2tyj`) in the right sidebar, or
   * reveals the one already there — the same reuse-don't-stack shape as
   * `revealTodayView` above, for the same reason.
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
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
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
   * Opens the session builder (`ol-p5t06b`, F4.6) in the right sidebar, or
   * reveals the one already there — the same reuse-don't-stack shape as
   * `revealGapView` and `revealTodayView`, for the same reason.
   *
   * `conceptName` is the gap view's `'build-session'` affordance seeding the
   * view; the palette command passes `undefined` and gets the whole ranking.
   * The seed is applied through `SessionBuilderView.setFocusConcept`, which
   * refreshes — so pressing the affordance on a *second* row rebuilds the open
   * pane around that row instead of leaving her looking at the first one's
   * session, which is exactly the staleness `ol-h3wy` is about.
   */
  private async revealSessionBuilderView(conceptName: string | undefined): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_SESSION);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_SESSION, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof SessionBuilderView) await view.setFocusConcept(conceptName);
  }

  /**
   * Opens F3.3's bulk-review triage path (`ol-jie3`) in the right sidebar,
   * or reveals the one already there — the same reuse-don't-stack shape as
   * `revealGapView`/`revealTodayView`/`revealSessionBuilderView`, for the
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
   * Opens Home (F8.8, `[D-134]` Q1, `ol-0r92.17`), or reveals the one
   * already open, in the right sidebar — the same slot `TodayView` and
   * `GapView` occupy, since this is a glance-and-return companion rather
   * than a browse-and-edit tab (`RegistryView`'s own reasoning for its
   * choice, the other way).
   *
   * Always refreshes on the way out (`ol-h3wy`'s pattern): a dismiss from
   * the grove, or an assessment that just passed, must not need a manual
   * reload to show here.
   */
  private async revealHomeView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_OLEA_HOME);
    const leaf = existing[0] ?? workspace.getRightLeaf(false);
    if (leaf === null || leaf === undefined) return;
    if (existing.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_OLEA_HOME, active: true });
    }
    await workspace.revealLeaf(leaf);
    await refreshOpenTodayViews(workspace, VIEW_TYPE_OLEA_HOME);
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
    // (`unsubscribe`) on teardown. Nothing else to tear down.
  }
}
