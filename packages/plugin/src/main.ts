import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import type { StudyPlanArtifact } from 'olea-contracts';
import {
  createFsrsScheduler,
  type DeviceCapability,
  type GradeExplainBackInput,
  loadCachedStudyPlan,
  type PendingExplainBackGrading,
  refreshStudyPlan,
  type Scheduler,
  type VaultSource,
} from 'olea-core';
import { createCardPlaceholder } from './commands/placeholders.js';
import { registerOleaCommands } from './commands/register-commands.js';
import { ensureDeviceId } from './device/device-id.js';
import { createLocalGapProvider } from './gap/provider.js';
import { GapView, VIEW_TYPE_OLEA_GAP } from './gap/view.js';
import {
  buildGradingWiring,
  type GradingWiring,
  gradeExplainBackAttempt,
} from './grading/wiring.js';
import { obsidianDeviceCapability } from './ingestion/device-capability.js';
import { ObsidianQueueStore } from './ingestion/queue-store.js';
import { buildIngestionRunner, type IngestionWiring } from './ingestion/wiring.js';
import { ObsidianKeywordIndexStore } from './keyword-index/store.js';
import { buildKeywordIndexWiring, type KeywordIndexWiring } from './keyword-index/wiring.js';
import { createLocalStudyPlanProvider } from './plan/provider.js';
import { ObsidianStudyPlanSettingsStore } from './plan/settings-store.js';
import { ObsidianStudyPlanStore } from './plan/store.js';
import {
  buildRetrievalWiring,
  drainIntoEmbeddingCache,
  type RetrievalWiring,
} from './retrieval/wiring.js';
import { createObsidianEditPort } from './review/obsidian-ports.js';
import { openReviewSession, type ReviewSessionPorts } from './review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  systemClock,
} from './review/ports.js';
import type { ReviewSession } from './review/session.js';
import { ReviewView, VIEW_TYPE_OLEA_REVIEW } from './review/view.js';
import { createLocalSessionBuilderProvider } from './session-builder/provider.js';
import { SessionBuilderView, VIEW_TYPE_OLEA_SESSION } from './session-builder/view.js';
import { OleaSettingTab } from './settings/settings-tab.js';
import {
  createVaultInstrumentSource,
  createVaultTrendsSource,
  loadTodayPanel,
} from './today/data-source.js';
import { refreshOpenTodayViews } from './today/refresh.js';
import { TodayView, VIEW_TYPE_OLEA_TODAY } from './today/view.js';
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
  plan: StudyPlanArtifact | null;
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

  override async onload(): Promise<void> {
    // `this` satisfies `ObsidianDataHost` (`loadData`/`saveData`) — same
    // narrow-port pattern `ObsidianQueueStore` and `ObsidianKeywordIndexStore`
    // already use. `createObsidianWorkerTransport` is injected rather than
    // built inside the tab so `settings-tab.ts` never has to import
    // `obsidian`'s `requestUrl` itself (ol-k57j; see `worker/obsidian-transport.ts`).
    this.addSettingTab(new OleaSettingTab(this.app, this, this, createObsidianWorkerTransport));

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

    // C5.5/A2.5 (P5-T07): the plan is a rebuildable cache (D-006), so the
    // synchronous half is just "read whatever is on disk" — fast, and awaited
    // so the very first session opened after a restart already reflects
    // yesterday's plan instead of always starting Phase A. Recomputing it is
    // `refreshCachedStudyPlan`'s job, kicked off below and never blocking
    // `onload`.
    const studyPlanStore = new ObsidianStudyPlanStore(this);
    const cachedPlan = (await loadCachedStudyPlan(studyPlanStore)).plan;

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
              }),
              now: () => new Date(),
              // F6.2/F6.5 (`ol-lohq`, `ol-p6t04`): the trends half was built and
              // could not be wired here because this file belonged to another
              // lane at the time — see `today/data-source.ts`'s own doc on
              // `TodayTrendsSource`. Absent path means "not configured", which
              // `createVaultTrendsSource` already reads as "no weights" rather
              // than a guessed folder.
              trends: createVaultTrendsSource({ vault, assessmentsBasePath: assignmentsBasePath }),
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
      createTransport: createObsidianWorkerTransport,
    });

    // ol-drfy: the explain-back grading pipeline's production JudgeCaller,
    // wired to the real Worker transport on the same F7.8 grey-out terms as
    // `this.retrieval` above. See `grading/wiring.ts`'s module doc and this
    // class's own `gradeExplainBackAttempt` method for why nothing calls
    // *that method* yet — the destination is `ol-p4t05` (confusion
    // routing), not this bead.
    this.grading = await buildGradingWiring({
      dataHost: this,
      createTransport: createObsidianWorkerTransport,
    });

    this.registerInterval(
      window.setInterval(() => {
        void this.ingestion?.engine.tick();
        void this.drainEmbeddings(capability);
      }, INGESTION_TICK_INTERVAL_MS),
    );
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
    });
    const result = await refreshStudyPlan({ store, provider });
    if (this.review !== null) this.review.plan = result.plan;
    void this.refreshGapViews();
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

    const outcome = await openReviewSession({
      vault: wiring.vault,
      scheduler: wiring.scheduler,
      deviceId: wiring.deviceId,
      ports: wiring.ports,
      // F2.8 Phase B: whatever plan is cached at this instant, read fresh —
      // never a copy captured when `this.review` was first built, so a
      // background refresh that lands between two sessions reaches the
      // second one without her having to restart Obsidian.
      plan: wiring.plan,
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

  override onunload(): void {
    // Both views are registered via `registerView`, which Obsidian's own
    // `Component.onunload` detaches; the ingestion tick interval goes through
    // `registerInterval`, which it clears; the keyword index's vault-event
    // subscription goes through `register`, which runs its callback
    // (`unsubscribe`) on teardown. Nothing else to tear down.
  }
}
