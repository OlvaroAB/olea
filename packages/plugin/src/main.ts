import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import type { StudyPlanEnvelope } from 'olea-contracts';
import {
  type ClassifyKnowledgeKindOptions,
  type ClassifyKnowledgeKindRequest,
  type ConceptRelation,
  type ConfusionRoutingDecision,
  type ConfusionRoutingInput,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  type DeviceCapability,
  type ExtractedUnit,
  type GradeExplainBackInput,
  loadCachedStudyPlan,
  notePathCourses,
  type PendingExplainBackGrading,
  parseDocument,
  parseFrontmatter,
  type QueueSnapshot,
  type RelationSet,
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
  type KnowledgeKindWiring,
  type ReadConceptsFromVaultOptions,
  readConceptsAndRelations,
  readConceptsFromVault,
} from './concept/wiring.js';
import { ensureDeviceId } from './device/device-id.js';
import { createLocalGapProvider } from './gap/provider.js';
import { GapView, VIEW_TYPE_OLEA_GAP } from './gap/view.js';
import { createBulkReviewController } from './generation/bulk-review.js';
import { BulkReviewView, VIEW_TYPE_OLEA_BULK_REVIEW } from './generation/bulk-review-view.js';
import { buildGenerationWiring, type GenerationWiring } from './generation/wiring.js';
import {
  buildGradingWiring,
  evaluateConfusionRouting,
  type GradingWiring,
  gradeExplainBackAttempt,
} from './grading/wiring.js';
import { obsidianDeviceCapability } from './ingestion/device-capability.js';
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
import { ObsidianQueueStore } from './ingestion/queue-store.js';
import { buildIngestionRunner, type IngestionWiring } from './ingestion/wiring.js';
import { ObsidianKeywordIndexStore } from './keyword-index/store.js';
import { buildKeywordIndexWiring, type KeywordIndexWiring } from './keyword-index/wiring.js';
import { createLocalStudyPlanProvider } from './plan/provider.js';
import { ObsidianStudyPlanSettingsStore } from './plan/settings-store.js';
import { ObsidianStudyPlanStore } from './plan/store.js';
import { obsidianRankWeightsGet } from './rank/obsidian-rank-weights-transport.js';
import { buildRankWeightsWiring, type RankWeightsWiring } from './rank/wiring.js';
import type { DraftQuizCardsDeps } from './retrieval/draft-quiz-cards.js';
import {
  buildRetrievalWiring,
  drainIntoEmbeddingCache,
  type RetrievalWiring,
} from './retrieval/wiring.js';
import { retrieveExplainWhySourceChunks, WorkerExplainWhyGenerator } from './review/explainWhy.js';
import { createObsidianEditPort } from './review/obsidian-ports.js';
import { openReviewSession, type ReviewSessionPorts } from './review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  systemClock,
} from './review/ports.js';
import type { ReviewSession } from './review/session.js';
import type { ReviewInstrument } from './review/types.js';
import { ReviewView, VIEW_TYPE_OLEA_REVIEW } from './review/view.js';
import { createLocalSessionBuilderProvider } from './session-builder/provider.js';
import { SessionBuilderView, VIEW_TYPE_OLEA_SESSION } from './session-builder/view.js';
import { OleaSettingTab } from './settings/settings-tab.js';
import {
  createRhythmSource,
  createVaultInstrumentSource,
  createVaultTrendsSource,
  loadTodayPanel,
} from './today/data-source.js';
import { ObsidianMaterialArrivalStore } from './today/material-arrival-store.js';
import { refreshOpenTodayViews } from './today/refresh.js';
import { ObsidianTermWindowStore } from './today/term-window-store.js';
import { TodayView, VIEW_TYPE_OLEA_TODAY } from './today/view.js';
import { ObsidianUsageLogStore } from './usage/log-store.js';
import { ObsidianSource } from './vault/obsidian-source.js';
import { createObsidianWorkerTransport } from './worker/obsidian-transport.js';

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
   * C7.9 containment co-presence filter. The two named readers `[D-070]`
   * gives the corpus types — the misconception record's confusion pairing and
   * queue ordering — still have no code in this tree, and no clause names a
   * triage surface (design doc §7.2); that gap is unchanged by this bead.
   */
  private relations: RelationSet | null = null;
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
      copyDiagnostics: () => {
        void copyDiagnosticsToClipboard({
          pluginVersion: this.manifest.version,
          loadQueue: () => new ObsidianQueueStore(this).load(),
          loadIndex: () => new ObsidianKeywordIndexStore(this).load(),
        });
      },
    });

    // Same store, same "read fresh on every call, never cached" discipline
    // `plan/provider.ts`, `gap/provider.ts` and `session-builder/provider.ts`
    // already hold for `assignmentsBasePath` — a settings change she makes
    // between two opens of the Today pane must not need a reload to take.
    const todayTrendsSettingsStore = new ObsidianStudyPlanSettingsStore(this);

    this.registerView(
      VIEW_TYPE_OLEA_TODAY,
      (leaf) =>
        new TodayView(leaf, {
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
        }),
    );

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
            // Same instance the Today panel's replay uses — see this file's
            // own comment above `scheduler`'s construction: "one Scheduler...
            // is what makes that literally the same computation."
            scheduler,
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
    });

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
    // F6.9's rhythm reading (`ol-v7r5.6`): both stores are local `data.json`
    // projections over `this`, same construction shape as `materiality`
    // above — no Worker token needed for either.
    this.materialArrivals = new ObsidianMaterialArrivalStore(this);
    this.termWindowStore = new ObsidianTermWindowStore(this);
    this.register(
      vault.watch((event) => {
        if (event.kind !== 'modify') return;
        void this.evaluateMaterialityChange(vault, event.path);
      }),
    );

    this.registerInterval(
      window.setInterval(() => {
        void this.tickIngestionAndMaybeRunCorpusRelations();
        void this.drainEmbeddings(capability);
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
    } catch (error) {
      console.error('Olea: materiality trigger evaluation failed', error);
    } finally {
      this.materialityPreviousText.record(path, currentText);
    }
  }

  /**
   * F6.9's per-course material-arrival timestamp (`ol-v7r5.6`) — recorded the
   * moment row 1.4's free gates (hash/debounce/floor) judge an edit
   * significant enough that a judge call would follow. That is
   * `'judge-unavailable'` in production today, because no `MaterialityJudge`
   * is wired (`this.materiality`'s own construction, above); once one is
   * (`ingestion/materiality/wiring.ts`'s named D-072 gap), a `'verdict'`
   * whose `material` is `true` counts the same way and a `false` one does
   * not — the free gates having cleared is what F6.9 needs "material
   * arrived" to mean, and a judge that goes on to say "not really" should
   * still be believed over them.
   *
   * `'unchanged'`, `'formatting-only'`, `'debounced'` and `'below-floor'` are
   * row 1.4 itself declining to treat the edit as real content movement, and
   * none of them records an arrival: doing so on every raw edit would make
   * "material is arriving" mean "she opened the file", which is a different
   * and much noisier claim than the one F6.9 licenses.
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
    const observed =
      result.kind === 'judge-unavailable' || (result.kind === 'verdict' && result.verdict.material);
    if (!observed) return;

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
      const pass = await readConceptsAndRelations(
        this.concept,
        this.corpusRelation,
        this.corpusRelationStateStore,
        { vault: new ObsidianSource(this.app), ingestionSessionClosed: true },
      );
      if (pass === null) return;
      this.relations = pass.relations;
    } catch (error) {
      console.error('Olea: corpus relation batch failed', error);
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
      },
      transport,
    };
  }

  /**
   * F3.3's "generate automatically when material lands" trigger
   * (`ol-p3t07a`), fired by `ingestion/wiring.ts`'s `onUnitsLanded` hook
   * once per drained job. Never throws into the ingestion path it rides on
   * — a generation failure is not an extraction failure (see that hook's
   * own doc); `GenerationWiring.sweep` itself already no-ops honestly when
   * the Worker isn't configured (F7.8) or `units` is empty.
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
   * No caller of this method exists in this package yet, deliberately — see
   * `grading/wiring.ts`'s module doc for why. It exists so `ol-p4t05`
   * (confusion routing) has something real to call into instead of a
   * declared-but-unimplemented port.
   */
  async gradeExplainBackAttempt(
    input: GradeExplainBackInput,
  ): Promise<PendingExplainBackGrading | null> {
    if (this.grading === null) return null;
    return gradeExplainBackAttempt(this.grading, input);
  }

  /**
   * `ol-p4t05`'s production entry point for F2.12 confusion routing: decides,
   * from a just-recorded rating and the resulting lapse count, whether to
   * surface the explain-back offer instead of just rescheduling harder — and
   * what that offer says. Pure and synchronous — see `grading/wiring.ts`'s
   * module doc for why this needs no Worker/F7.8 gating, unlike
   * `gradeExplainBackAttempt` above.
   *
   * **`ol-h2bx` closed the reachability gap this doc used to name.**
   * `composeReviewSession` above passes `(input) =>
   * this.evaluateConfusionRouting(input)` into `openReviewSession`'s
   * `ports.evaluateConfusionRouting`, which `ReviewSession.logAndAdvance`
   * (`review/session.ts`) calls after every graded Q&A/cloze/MCQ rating. The
   * accepted offer routes through the SAME on-demand channel F2.7 already
   * built (`explainWhyPort`/`requestExplainWhy`) rather than into
   * `gradeExplainBackAttempt` above — that method's own "no caller yet" gap
   * is still real and is not this bead's to close (`ol-tka5`/`ol-548w` are
   * still open Class C questions; see `grading/wiring.ts`'s module doc).
   */
  evaluateConfusionRouting(input: ConfusionRoutingInput): ConfusionRoutingDecision {
    return evaluateConfusionRouting(input);
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

  override onunload(): void {
    // Both views are registered via `registerView`, which Obsidian's own
    // `Component.onunload` detaches; the ingestion tick interval goes through
    // `registerInterval`, which it clears; the keyword index's vault-event
    // subscription goes through `register`, which runs its callback
    // (`unsubscribe`) on teardown. Nothing else to tear down.
  }
}
