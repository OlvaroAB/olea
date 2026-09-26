/**
 * `buildIngestionRunner` — the composition root P3-T03a/DF-21a asks for:
 * ties `createExtractionJobRunner` and `IngestionQueueEngine` together over
 * whichever `VaultSource`/`QueueStore`/`DeviceCapability` it's given,
 * closing the loop `deferredEnqueuer()`'s own module doc describes ("build
 * the enqueuer first, hand it to the runner, construct the engine, then
 * bind the enqueuer to the real engine").
 *
 * Deliberately takes only the structural ports `olea-core` already defines
 * — `VaultSource`, `QueueStore`, `DeviceCapability` — and never an
 * `obsidian` type, so this file runs and is unit tested (`wiring.spec.ts`)
 * against fakes, with no real Obsidian host. `main.ts` is the only caller
 * that supplies the real, Obsidian-backed instances (`ObsidianSource`,
 * `ObsidianQueueStore`, `obsidianDeviceCapability()`) — same split
 * `queue-store.ts` and `commands/register-commands.ts` already use, for the
 * same reason.
 *
 * **The sink.** See `pending-indexing-sink.ts`'s own module doc for why
 * `PendingIndexingSink` — not a real embeddings/retrieval consumer — is
 * what this wires today, and why that's an honest, bounded placeholder
 * rather than this bead quietly deciding C2.3/C2.5's design.
 *
 * **`onUnitsLanded` (`ol-p3t07a`).** F3.3's automatic generation pipeline
 * needs to react the instant a drained job's units are accumulated — the
 * "material lands" event the contract names — without this module knowing
 * anything about generation, drafts, or the cache. So the real
 * `PendingIndexingSink` this function builds is unchanged (still exactly
 * what `IngestionWiring.sink` returns, still exactly what
 * `retrieval/wiring.ts`'s `drainIntoEmbeddingCache` reads via `.all()`), and
 * a thin, unexported wrapper sits in front of it in the runner's own
 * `ExtractedUnitSink` slot: accumulate first (unchanged behaviour), then
 * best-effort notify. A hook that throws or rejects never fails the
 * ingestion job it rode in on — a generation failure is not an extraction
 * failure, and `IngestionQueueEngine` has no notion of "extraction succeeded
 * but something downstream of it didn't."
 *
 * **`deps.generation` (`ol-2zfj.63` [GEN-3.1], `[D-238]`).** The same
 * additive, opt-in shape as `deps.revision`/`deps.vision` above: absent
 * (every caller before this bead) leaves `buildIngestionRunner`
 * byte-identical. Present, it does two things — see `generation-queue.ts`'s
 * own module doc for why that file, not `olea-core`, carries the decision
 * logic this composes: (1) `createGenerationAwareJobRunner` is composed in
 * front of whatever runner this function already built, so a drained
 * `'generation'` job reaches `deps.generation.draft` instead of falling into
 * `createExtractionJobRunner`'s honest "not an extraction job" failure; (2)
 * every landed unit batch also runs
 * `enqueuePrimaryGenerationCallsForLandedUnits` — D-238's "one call of the
 * primary kind on arrival" — through the SAME `enqueuer` `arrival-watch.ts`
 * uses, so a primary call is itself just another job this engine's own
 * tick loop drains, never a call made directly at ingestion time.
 *
 * **The drain-order comparator (`[D-368]`, `ol-2zfj.170`, F3.7).** `olea-
 * core`'s `IngestionQueueEngine` (`ingestion/engine.ts`) has carried an
 * inert, optional `EngineDeps.priority` seam since `ol-2zfj.168`: omitted,
 * `nextEligibleIndex` drains strict FIFO for every job kind sharing the
 * queue. `[D-368]` (David, 2026-09-25) ruled the ordering key F3.7 left
 * open — the drain order is now RULED, so `buildIngestionRunner` below
 * always supplies a real comparator (`compareGenerationPriority`), not the
 * `undefined` every caller has passed until this bead. The ruling: among
 * pending `'generation'` jobs, order by current recall/readiness and
 * instrument need (`GenerationPrioritySignal.need`, higher drains first),
 * breaking ties by each job's own expected item count (`.expectedYield`,
 * higher drains first), and any remaining tie by arrival order — which
 * `engine.ts`'s own seam already gives for free (a `0` comparison keeps
 * whichever job was found first). Extraction and instrument-revision jobs
 * are untouched: the comparator returns `0` for any pair where either side
 * is not `'generation'`-kind, so they "keep theirs" (arrival order) exactly
 * as before this bead.
 *
 * **Read fresh at drain time — the binding clarification.** `[D-368]`:
 * "a freshly read historical growth/mastery stage is still historical, not
 * current ability." `deps.generation.priority`, when supplied, is called
 * ONCE PER COMPARISON, from inside the engine's own `tick()` → `
 * nextEligibleIndex` loop — i.e. at drain time, never memoized at enqueue
 * time or at this function's own construction time. A caller that reads a
 * cached snapshot instead of the vault's current state breaks the ruling on
 * its own side, not this seam's: this file's contract is only "called
 * fresh, every comparison," never "computes the right number."
 *
 * **No production implementation is composed yet (named follow-up, this
 * bead's close evidence) — same posture as `deps.generation.draft`/
 * `.hasAnyBuiltKind` just below, which `main.ts`'s actual call also omits
 * today.** Omitted, `generationPrioritySignalFor` returns
 * `DEFAULT_GENERATION_PRIORITY_SIGNAL` (`{ need: 0, expectedYield: 0 }`) for
 * every `'generation'` job, so every pair compares equal and arrival order
 * governs — byte-identical to today's behaviour. The real reading
 * (`olea-core`'s `readAllConceptReadiness`/`readNeed` in
 * `mastery/attainment.ts` already compute exactly this "current recall,
 * `UNKNOWN_NEED_VALUE` when there is no current evidence" pair — `[D-348]`'s
 * open basis split is D-368's own named default policy, not a new one this
 * bead invents) and the expected-item-count reading are both a later
 * caller's to wire, once one exists that already has the vault-scoped
 * review log, scheduler and validity projection loaded.
 */

import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  conceptRegistryEntryFromRecord,
  createExtractionJobRunner,
  DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
  type DeviceCapability,
  deferredEnqueuer,
  type ExtractedUnit,
  type ExtractedUnitSink,
  type GenerationJobPayload,
  IngestionQueueEngine,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  listConceptKeyRecords,
  listOutcomeRecords,
  type OutcomeConceptReconciliationReport,
  type OutcomeConceptRegistryEntry,
  type OutcomeProvenance,
  type OutcomeRecord,
  type OutcomeSourceReference,
  type PersistedJob,
  type QueueStore,
  reconcileOutcomeConcepts,
  resolveOutcome,
  type StudyPlanStore,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import { type QueueStatusCounts, summarizeQueueStatusCounts } from '../commands/diagnostics.js';
import type { DraftCacheStore } from '../generation/cache-store.js';
import { createRevisionAwareJobRunner } from '../generation/revision-job-runner.js';
import type { DraftQuizCardsDeps } from '../retrieval/draft-quiz-cards.js';
import {
  isWorkerConfigured,
  type ObsidianDataHost,
  ObsidianWorkerConfigStore,
} from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import {
  enqueueFurtherGenerationCallsForLandedUnits,
  type FurtherGenerationTriggerDeps,
} from './further-generation-triggers.js';
import {
  buildGenerationArrivalDeps,
  createGenerationAwareJobRunner,
  enqueuePrimaryGenerationCallsForLandedUnits,
  type GenerationArrivalDeps,
  isGenerationJobPayload,
} from './generation-queue.js';
import type {
  OutcomeSourcePassage,
  OutcomesExtractDocumentKind,
  OutcomesExtractReadResult,
  PaperSectionCandidate,
} from './outcomes-extract-adapter.js';
import {
  OUTCOMES_EXTRACT_TASK_ID,
  WorkerOutcomesExtractReader,
} from './outcomes-extract-adapter.js';
import type { PageRenderPort } from './page-render/types.js';
import { PendingIndexingSink } from './pending-indexing-sink.js';
import { createWorkerVisionPageRunner, WorkerVisionPageExtractor } from './vision-page-runner.js';
import type { VisionRouteHttpGet } from './vision-route-provider.js';
import { buildVisionRouteWiring } from './vision-route-wiring.js';

export interface IngestionWiringDeps {
  readonly vault: VaultSource;
  readonly queueStore: QueueStore;
  readonly capability: DeviceCapability;
  /**
   * `ol-2zfj.39` (`[D-133]` end-to-end): when present, the engine's runner
   * is composed through `createRevisionAwareJobRunner`, so a drained
   * `'instrument-revision'` job drafts a successor into `cache` instead of
   * falling through to the extraction runner. `draftDeps` is read fresh per
   * drained job (F7.8: `null` defers the job, never fails it) — see
   * `generation/revision-job-runner.ts`'s module doc. Omitted means the
   * pre-`ol-2zfj.39` behaviour, used by tests that never enqueue one.
   */
  readonly revision?: {
    readonly cache: DraftCacheStore;
    readonly draftDeps: () => DraftQuizCardsDeps | null;
    /**
     * `ol-3ux7.64.9` [WBX-8]: forwarded to `createRevisionAwareJobRunner`'s
     * `RevisionJobRunnerDeps.now` — the drafted successor's `createdAt`.
     * Omitted defaults to that module's own `deps.now ?? (() => new Date())`.
     */
    readonly now?: () => Date;
  };
  /**
   * Best-effort notification that a drained job accumulated `units` into the
   * sink (`ol-p3t07a`'s F3.3 trigger). Never awaited by anything that could
   * fail the ingestion job — errors and rejections are swallowed here, not
   * propagated. Omitted means no notification, unchanged from this module's
   * pre-`ol-p3t07a` behaviour.
   */
  readonly onUnitsLanded?: (units: readonly ExtractedUnit[]) => Promise<void> | void;
  /**
   * `ol-15f8`: composes the real `visionRunner` for standalone image sources
   * (C3.1/C3.3) exactly the way `concept/wiring.ts`'s `buildConceptWiring`
   * composes its own Worker-backed port — load the persisted Worker config,
   * build a real transport only when it's usable (F7.8), and hand
   * `createExtractionJobRunner` a real `WorkerVisionPageExtractor`-backed
   * `visionRunner`. Omitted (the pre-`ol-15f8` default, and today's actual
   * `main.ts` call — see `vision-page-runner.ts`'s module doc for the named
   * follow-up) leaves `visionRunner` unset, so a drained `'vision-page'` job
   * keeps DF-21's honest, non-retryable "no visionRunner wired yet" failure
   * rather than half-working.
   */
  readonly vision?: {
    readonly dataHost: ObsidianDataHost;
    readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
  };
  /**
   * `[D-324]`, resolving `ol-9cle`: the real `PageRenderPort` for a `'pdf'`
   * `'vision-page'` job, forwarded unchanged into
   * `WorkerVisionPageRunnerDeps.pageRenderer` (`vision-page-runner.ts`'s own
   * doc, "PDF pages, rendered" section) so `createWorkerVisionPageRunner`'s
   * PDF branch can actually render rather than hitting the honest "no page
   * renderer wired" gap. Type-only import (`./page-render/types.js`) —
   * this file stays free of a runtime `obsidian` import (see this module's
   * own top doc and `wiring.spec.ts`'s: "no `obsidian` import anywhere in
   * this file, and none needed"); the real adapter is
   * `createObsidianPageRenderer` (`./page-renderer.js`), a zero-argument
   * factory with no seam of its own to thread here, composed at the true
   * production composition root (`main.ts`'s `buildIngestionRunner` call) —
   * see this bead's report for the one line that still needs adding there
   * (outside this bead's `owns` this round). Omitted (every caller before
   * this bead, including today's real `main.ts` call) leaves `pageRenderer`
   * unset, so a `'pdf'` `'vision-page'` job keeps the pre-existing honest gap
   * unchanged.
   */
  readonly pageRenderer?: PageRenderPort;
  /**
   * `[ILB-PER-4]` §8 item 2: component 1.6's delivered vision-routing
   * threshold, resolved once here (via `vision-route-wiring.ts#
   * buildVisionRouteWiring`) and threaded into `createExtractionJobRunner`'s
   * `options` below — see `buildIngestionRunner`'s own doc for why this,
   * unlike `deps.vision` immediately above, is a GET (`httpGet`) rather than
   * a `WorkerTaskTransport`. Omitted (every caller before this bead) leaves
   * `createExtractionJobRunner` unconfigured, exactly as before this field
   * existed: `routePage`'s own `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` (D-022)
   * applies. F7.8 also governs every failure INSIDE this once-resolved
   * config: no Worker configured, a transport failure, an undecodable
   * envelope, or an expired artifact all degrade to that same declared
   * default — see `vision-route-provider.ts#fetchVisionRouteOptions`'s own
   * doc for the full list.
   */
  readonly visionRoute?: {
    readonly dataHost: ObsidianDataHost;
    readonly httpGet: VisionRouteHttpGet;
    /** Injected for determinism under test; production passes `() => new Date()`. */
    readonly now?: () => Date;
  };
  /**
   * `ol-2zfj.63` [GEN-3.1] / `[D-238]`: when present, wires D-238's client
   * ingestion-queue generation policy — see this module's doc and
   * `generation-queue.ts`'s own. Omitted (every caller before this bead)
   * leaves `buildIngestionRunner` byte-identical: no `'generation'` job kind
   * is ever recognised and no primary-kind call is ever enqueued.
   */
  readonly generation?: {
    /** Services one drained `'generation'` job — see `GenerationAwareJobRunnerDeps.draft` (`generation-queue.ts`). No production implementation is composed yet (named follow-up, this bead's close evidence): the real one calls `draftQuizCardsForConcept` for `instrumentKind === 'mcq'` and returns an honest, non-retryable failure for `'qa'`/`'cloze'` (component register row 2.1 — no client generation task exists for either yet). */
    readonly draft: (job: JobRunnerView) => Promise<JobRunOutcome>;
    /** See `GenerationArrivalDeps.hasAnyBuiltKind`'s own doc — no production implementation is wired yet either. */
    readonly hasAnyBuiltKind: (courseCode: string, conceptKey: string) => Promise<boolean>;
    /** Defaults to a real vault walk (`extractConcepts`) — see `buildGenerationArrivalDeps`. Injected here only so a test never needs a real vault. */
    readonly listConceptsForCourse?: GenerationArrivalDeps['listConceptsForCourse'];
    /** F4.8, opt-in. Absent means no known format for every course. */
    readonly formatMatchFor?: GenerationArrivalDeps['formatMatchFor'];
    /** F2.14's observed order (D7.1), opt-in. Absent means nothing observed yet for every course. */
    readonly recordedPreferenceFor?: GenerationArrivalDeps['recordedPreferenceFor'];
    readonly coursesFolder?: string;
    /**
     * `[D-368]`'s drain-order key for pending `'generation'` jobs — see this
     * module's doc, "The drain-order comparator." Called FRESH on every
     * comparison the engine's own `tick()` makes (never cached by this
     * module) — the caller's job is to answer with whatever is current AT
     * THAT INSTANT, never a value carried over from enqueue time. Returning
     * `null` is for a `payload` this callback genuinely has no reading for
     * (e.g. an unrecognised `courseCode`) — it is NOT how "no current
     * evidence for this concept" is expressed; `olea-core`'s `readNeed`
     * already answers that with its own `NeedReading.basis === 'unknown'`
     * and `UNKNOWN_NEED_VALUE` default (`mastery/attainment.ts`), and a
     * caller wiring this should apply that default itself before returning,
     * per `[D-368]`'s "an explicit stated unknown/default policy." Omitted
     * (every caller before this bead, and `main.ts`'s actual call today):
     * `compareGenerationPriority` reads `DEFAULT_GENERATION_PRIORITY_SIGNAL`
     * for every `'generation'` job instead, so every pair ties and arrival
     * order governs — byte-identical to before this option existed.
     */
    readonly priority?: (payload: GenerationJobPayload) => GenerationPrioritySignal | null;
    /**
     * `ol-2zfj.136` [GEN-3.5] / `[D-238]`/`[D-269]`: when present, ALSO wires
     * D-238's three named further-call generation triggers (top-band,
     * format-ask, deck-served-out-or-lapsed — `repeatedRejectionTrigger`
     * stays inactive per D-269) to real state — see
     * `further-generation-triggers.ts`'s own module doc. Composed alongside
     * `deps.generation`'s arrival half, on the SAME landed-unit seam, scoped
     * to the same courses. Omitted (every caller before this bead, and
     * `main.ts`'s actual call today, which supplies no `deps.generation` at
     * all — `ol-2zfj.135`'s own close evidence, held for D-261) leaves this
     * additional sweep byte-identically absent: no further-call trigger is
     * ever evaluated.
     */
    readonly furtherCallTriggers?: {
      /** A2.5's cached plan (`plan/cache.ts#loadCachedStudyPlan`) — the top-band signal's source. */
      readonly studyPlanStore: StudyPlanStore;
      /** Injected for determinism under test; production passes `() => new Date()`. */
      readonly now?: () => Date;
    };
  };
  /**
   * `[D-344]` (`ol-2zfj.163`, option b) / `ol-2zfj.141` [IL-D10] / `ol-2zfj.153` [DOS-I4]: when
   * present, wires `outcomes.extract.v1`'s production trigger onto the SAME landed-unit seam
   * `onUnitsLanded`/`deps.generation` above already use — see `withOutcomesExtractHook`'s own doc
   * for why that seam, not a new job kind, is what gives this "the same queue, retries and
   * background allowance as concept extraction" the ruling asks for. Omitted (every caller before
   * this bead) leaves `buildIngestionRunner` byte-identical: no landed unit is ever checked
   * against a registered document, and `outcomes.extract.v1` is never called.
   */
  readonly outcomes?: OutcomesExtractTriggerDeps;
}

/**
 * `deps.outcomes`'s own shape — see `IngestionWiringDeps.outcomes`'s doc and
 * `withOutcomesExtractHook`'s module doc for the composition this feeds.
 */
export interface OutcomesExtractTriggerDeps {
  /** Same `ObsidianDataHost`/`createTransport` split `deps.vision` above uses — F7.8's persisted-config load, gated the identical way. */
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
  /**
   * `[D-344]`'s eligibility test: `null` for a `sourcePath` that is unregistered, or registered as
   * anything other than `'objectives'`/`'past-paper'` (`'course-material'`, F3.1's own default,
   * reads as "not this document's job", never a guess). Read fresh on every call — never cached by
   * this module — because she can register a document at any point after this wiring is built
   * (`../course-setup/register-source-wiring.ts`'s file-menu gesture). `courses` mirrors
   * `RunOutcomesExtractOptions.courses`: absent/undetermined reads as an empty array, never a
   * fabricated course.
   */
  readonly registeredDocumentFor: (sourcePath: VaultPath) => Promise<{
    readonly documentKind: OutcomesExtractDocumentKind;
    readonly courses: readonly string[];
  } | null>;
}

/**
 * `deps.vision`'s composition, split out of `buildIngestionRunner` only for
 * readability — loads `ObsidianWorkerConfigStore`'s persisted config and
 * builds a real `visionRunner` only when both a base URL and a token are
 * present (F7.8's "everything else works regardless" grey-out), the same
 * condition `concept/wiring.ts`'s `buildConceptWiring` and every sibling
 * Worker-backed wiring function in this plugin already gate on.
 *
 * `pageRenderer` (`deps.pageRenderer` above, `[D-324]`) is forwarded
 * unchanged into `WorkerVisionPageRunnerDeps.pageRenderer` — this function
 * makes no decision about it, it only carries `IngestionWiringDeps`'
 * optional field through to the one place that reads it.
 */
async function buildVisionRunner(
  vision: NonNullable<IngestionWiringDeps['vision']>,
  vault: VaultSource,
  sink: ExtractedUnitSink,
  pageRenderer: PageRenderPort | undefined,
): Promise<JobRunner | undefined> {
  const configStore = new ObsidianWorkerConfigStore(vision.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return undefined;

  const transport = vision.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const extractor = new WorkerVisionPageExtractor({ transport });
  return createWorkerVisionPageRunner({
    vault,
    extractor,
    sink,
    ...(pageRenderer ? { pageRenderer } : {}),
  });
}

export interface IngestionWiring {
  readonly engine: IngestionQueueEngine;
  readonly sink: PendingIndexingSink;
}

/** Accumulates into `pendingSink` unchanged, then best-effort notifies `onUnitsLanded` — see this module's doc. */
function withUnitsLandedHook(
  pendingSink: PendingIndexingSink,
  onUnitsLanded: (units: readonly ExtractedUnit[]) => Promise<void> | void,
): ExtractedUnitSink {
  return {
    async receive(units) {
      await pendingSink.receive(units);
      try {
        await onUnitsLanded(units);
      } catch (error) {
        console.error('Olea: generation-trigger hook failed (ingestion unaffected)', error);
      }
    },
  };
}

/**
 * Runs `inner` unchanged, then best-effort enqueues D-238's primary-kind
 * generation calls for the landed units — `deps.generation`'s arrival half —
 * and, when `furtherCallTriggerDeps` is supplied (`deps.generation
 * .furtherCallTriggers`, `ol-2zfj.136` [GEN-3.5]), ALSO sweeps the same
 * landed courses for the three named further-call triggers real state
 * currently fires (`further-generation-triggers.ts`). Wraps whatever sink
 * this function is given (`sink` alone, or `sink` already wrapped by
 * `withUnitsLandedHook`), so `deps.onUnitsLanded` and `deps.generation`
 * compose independently of each other. Never fails the ingestion job it rode
 * in on, same posture as `withUnitsLandedHook`.
 */
function withGenerationEnqueueHook(
  inner: ExtractedUnitSink,
  generationArrivalDeps: GenerationArrivalDeps,
  furtherCallTriggerDeps: FurtherGenerationTriggerDeps | undefined,
): ExtractedUnitSink {
  return {
    async receive(units) {
      await inner.receive(units);
      try {
        await enqueuePrimaryGenerationCallsForLandedUnits(units, generationArrivalDeps);
      } catch (error) {
        console.error('Olea: generation-enqueue hook failed (ingestion unaffected)', error);
      }
      if (furtherCallTriggerDeps !== undefined) {
        try {
          await enqueueFurtherGenerationCallsForLandedUnits(units, furtherCallTriggerDeps);
        } catch (error) {
          console.error(
            'Olea: further-generation-trigger hook failed (ingestion unaffected)',
            error,
          );
        }
      }
    },
  };
}

/**
 * `[D-344]`'s D7.3 gate: reads `{promptVersion, modelId}` off a Worker response's public `stamp`
 * envelope — the same fields `worker/transport.ts#WorkerHttpTransport`'s `onCallRecorded` callback
 * and `../grading/wiring.ts#extractSoloArtifactProvenance` already read for the identical reason,
 * duplicated here rather than imported (that function's own doc: neither lives in this file's
 * `owns`, and each reads its own task's response shape). `null` on any malformed or missing piece
 * — never a fabricated placeholder (D-005): a caller that cannot prove provenance does not persist
 * the outcome, the same posture `gradeSoloAttempt` already holds for a SOLO grading response.
 */
function extractOutcomeProvenanceStamp(body: unknown): OutcomeProvenance | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.ok !== true) return null;
  const stamp = envelope.stamp;
  if (typeof stamp !== 'object' || stamp === null) return null;
  const s = stamp as Record<string, unknown>;
  if (typeof s.promptVersion !== 'string' || s.promptVersion.length === 0) return null;
  if (typeof s.modelId !== 'string' || s.modelId.length === 0) return null;
  return { promptVersion: s.promptVersion, modelVersion: s.modelId };
}

/**
 * `deps.outcomes`'s production trigger (`[D-344]`, `ol-2zfj.141` [IL-D10], `ol-2zfj.153`
 * [DOS-I4]) — the "existing ingestion-tick extraction runner extracts its outcomes by document
 * kind" half of the ruling. Fires for one already-landed document's units (grouped by
 * `provenance.sourcePath` in `withOutcomesExtractHook` below), checks `deps.registeredDocumentFor`,
 * and — only when it names an eligible role — makes the ONE real `outcomes.extract.v1` call this
 * document's current revision gets.
 *
 * **Why this seam, not a new job kind.** `createExtractionJobRunner` (`olea-core`) is not this
 * bead's to touch (it never heard of a "registered document" and does not need to), and the vault
 * read + retry machinery for THIS revision's text has already run by the time any sink sees units
 * — so hooking the landed-unit seam inherits the underlying `'source'`/`'note'` job's own queue
 * membership, its content-hash keying (a new revision is a new job; the SAME revision is drained
 * at most once, so this fires at most once per revision — `[D-344]`'s "never twice for one
 * revision", for free), and `IngestionQueueEngine`'s background-allowance gate (this only runs
 * inside a real `tick()` drain) — exactly "the same queue, retries and background allowance as
 * concept extraction" the ruling asks for. `[D-344]`'s "never by re-registration" falls out the
 * same way: registering an already-ingested, unchanged document creates no new job, so nothing
 * re-fires until its next real revision.
 *
 * **The single Worker call, and why provenance cannot be handed in ahead of it.**
 * `runOutcomesExtract`'s own `options.provenance` is caller-known, supplied BEFORE that function's
 * one `reader.read()` call — right for a caller that already knows its prompt/model version, wrong
 * here, where D7.3 requires the REAL stamp off THIS response, not an invented one. So this function
 * does not call `runOutcomesExtract`/`runOutcomesExtractAndReconcile` (which would mean a second,
 * budget-doubling network call just to learn the stamp first); it wraps `deps.createTransport`'s
 * transport in a capturing shim — the same technique `../grading/wiring.ts#gradeSoloAttempt` already
 * uses for SOLO grading — makes the ONE `reader.read()` call, and only then resolves/persists
 * through `resolveOutcomeCandidates`/`reconcileResolvedOutcomes` (the exact bodies
 * `runOutcomesExtract`/`runOutcomesExtractAndReconcile` already run, factored out below so neither
 * public function's tested behaviour changes).
 *
 * Never throws past its caller — `withOutcomesExtractHook` wraps this in its own try/catch, same
 * "never fails the ingestion job it rode in on" posture as `withUnitsLandedHook`/
 * `withGenerationEnqueueHook` above (a Worker outage or a missing stamp is F7.8's honest grey-out,
 * not a retryable job failure — the same posture concept extraction's own Worker-backed read
 * already holds, per `[D-344]`'s "same ... as concept extraction").
 */
async function triggerOutcomesExtractForLandedUnit(
  vault: VaultSource,
  deps: OutcomesExtractTriggerDeps,
  sourcePath: VaultPath,
  units: readonly ExtractedUnit[],
): Promise<void> {
  const registered = await deps.registeredDocumentFor(sourcePath);
  if (registered === null) return;

  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return; // F7.8 grey-out: honest skip, not a failure.

  let stamp: OutcomeProvenance | null = null;
  const innerTransport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const capturingTransport: WorkerTaskTransport = {
    send: async (request) => {
      const body = await innerTransport.send(request);
      stamp = extractOutcomeProvenanceStamp(body);
      return body;
    },
  };
  const reader = new WorkerOutcomesExtractReader({ transport: capturingTransport });
  const passages: OutcomeSourcePassage<OutcomeSourceReference>[] = units.map((unit, index) => ({
    text: unit.text,
    // `blockIndex` here is this document's own landed-unit ordinal (page/passage order), not a
    // markdown block index — `OutcomeSourceReference.blockIndex` is an opaque, per-document
    // distinguishing key (`store.ts`'s own conservation match), and `[D-344]`'s eligible documents
    // are exactly the ones `isRegisterableDocument` accepts: never markdown, so there is no block
    // structure to index into in the first place.
    anchor: { path: sourcePath, blockIndex: index },
  }));

  const result: OutcomesExtractReadResult<OutcomeSourceReference> = await reader.read({
    documentKind: registered.documentKind,
    passages,
  });

  if (stamp === null) {
    console.error(
      'Olea: outcomes-extract response carried no D7.3 stamp (promptVersion/modelId) — extraction discarded, not guessed',
      { taskId: OUTCOMES_EXTRACT_TASK_ID },
    );
    return;
  }
  const provenance: OutcomeProvenance = stamp;

  const options: RunOutcomesExtractOptions = {
    documentKind: registered.documentKind,
    courses: registered.courses,
    provenance,
  };
  const resolved = await resolveOutcomeCandidates(vault, result, options);
  await reconcileResolvedOutcomes(vault, resolved, options);
}

/**
 * Runs `inner` unchanged, then best-effort checks every distinct `provenance.sourcePath` this
 * batch of landed units carries against `deps.registeredDocumentFor` — `deps.outcomes`'s own
 * composition, independent of `onUnitsLanded`/`deps.generation` the same way those two are
 * independent of each other. A `'note'` job's units can span several embedded sources at once
 * (`extraction-runner.ts`'s own `runNoteJob`), so this groups by `sourcePath` before checking
 * eligibility, rather than assuming one call's units all belong to a single document. Never fails
 * the ingestion job it rode in on — see `triggerOutcomesExtractForLandedUnit`'s own doc.
 */
function withOutcomesExtractHook(
  inner: ExtractedUnitSink,
  vault: VaultSource,
  outcomesDeps: OutcomesExtractTriggerDeps,
): ExtractedUnitSink {
  return {
    async receive(units) {
      await inner.receive(units);
      const unitsBySourcePath = new Map<VaultPath, ExtractedUnit[]>();
      for (const unit of units) {
        const path = unit.provenance.sourcePath;
        const grouped = unitsBySourcePath.get(path);
        if (grouped) grouped.push(unit);
        else unitsBySourcePath.set(path, [unit]);
      }
      for (const [sourcePath, sourceUnits] of unitsBySourcePath) {
        try {
          await triggerOutcomesExtractForLandedUnit(vault, outcomesDeps, sourcePath, sourceUnits);
        } catch (error) {
          console.error('Olea: outcomes-extract hook failed (ingestion unaffected)', error);
        }
      }
    },
  };
}

/**
 * `[D-368]`'s per-job drain-order reading — see `IngestionWiringDeps
 * .generation.priority`'s doc for who supplies it and when it is called.
 * `need` is the ruling's "current recall/readiness and instrument need,"
 * folded into the one number `olea-core`'s `readNeed` already computes
 * (`NeedReading.value`, `[0, 1]`, higher = less current recall = more in
 * need of coverage); `expectedYield` is "each job's own expected item
 * count," the ruling's named tie-break ahead of arrival order.
 */
export interface GenerationPrioritySignal {
  readonly need: number;
  readonly expectedYield: number;
}

/**
 * `[D-368]`'s declared default when `deps.generation.priority` is omitted,
 * or is supplied but returns `null` for a particular job — every
 * `'generation'` job reads identically, so `compareGenerationPriority`
 * finds nothing to distinguish them and arrival order governs. This is NOT
 * the ruling's "no current evidence" default (that is `readNeed`'s own
 * `UNKNOWN_NEED_VALUE`, a caller's to apply); this is "no reading composed
 * at all," the honest state of every caller before this bead.
 */
const DEFAULT_GENERATION_PRIORITY_SIGNAL: GenerationPrioritySignal = { need: 0, expectedYield: 0 };

/** `payload` narrowed to a `'generation'` job's own reading, or `null` for any other kind — see `compareGenerationPriority`. */
function generationPrioritySignalFor(
  payload: unknown,
  priorityFor: ((payload: GenerationJobPayload) => GenerationPrioritySignal | null) | undefined,
): GenerationPrioritySignal | null {
  if (!isGenerationJobPayload(payload)) return null;
  if (!priorityFor) return DEFAULT_GENERATION_PRIORITY_SIGNAL;
  return priorityFor(payload) ?? DEFAULT_GENERATION_PRIORITY_SIGNAL;
}

/**
 * `[D-368]`'s comparator, passed as `EngineDeps.priority` (`olea-core`
 * `ingestion/engine.ts`) — see this module's doc, "The drain-order
 * comparator," for the ruling this fulfils. Same contract as
 * `Array.prototype.sort`: negative when `a` should drain before `b`,
 * positive for the reverse, `0` for "no opinion" (the engine's own seam
 * then keeps arrival order — `[D-368]`'s final tie-break, for free, never
 * reimplemented here).
 *
 * Returns `0` — untouched — for ANY pair where at least one side is not a
 * `'generation'`-kind job: extraction and instrument-revision jobs are
 * never reordered by this, whether paired against each other or against a
 * generation job, so they "keep theirs" exactly as this bead's acceptance
 * asks. Between two generation jobs: higher `need` drains first
 * (descending); a tie on `need` breaks by higher `expectedYield`
 * (descending, `[D-368]`'s named tie-break); a tie on both leaves `0`, so
 * arrival order decides — `[D-368]`'s LAST tie-break, already the seam's
 * own default.
 */
function compareGenerationPriority(
  a: PersistedJob,
  b: PersistedJob,
  priorityFor: ((payload: GenerationJobPayload) => GenerationPrioritySignal | null) | undefined,
): number {
  const signalA = generationPrioritySignalFor(a.payload, priorityFor);
  const signalB = generationPrioritySignalFor(b.payload, priorityFor);
  if (signalA === null || signalB === null) return 0;
  if (signalA.need !== signalB.need) return signalB.need - signalA.need;
  if (signalA.expectedYield !== signalB.expectedYield) {
    return signalB.expectedYield - signalA.expectedYield;
  }
  return 0;
}

/**
 * Builds one real, drainable ingestion pipeline: `createExtractionJobRunner`
 * wired to `deps.vault` and a fresh `PendingIndexingSink`, fed into
 * `IngestionQueueEngine.create` with `deps.queueStore`/`deps.capability`,
 * with the runner's `deferredEnqueuer` bound to the constructed engine
 * before this resolves. `engine.enqueue`/`engine.tick` are safe to call the
 * instant this promise settles — the ordering `deferredEnqueuer`'s own
 * module doc requires (build the enqueuer, construct the runner, construct
 * the engine, bind) is exactly what this function does, in that order.
 *
 * **`ol-2zfj.38`: the engine is always constructed with `enqueueDebounce:
 * DEFAULT_ENQUEUE_DEBOUNCE_POLICY`.** Unconditional and additive-only — every
 * existing caller (this file's own tests included) never supplies
 * `EnqueueInput.lastChangedAt`, so `enqueue`'s behaviour for them is
 * byte-identical to before this policy was configured (`EngineDeps
 * .enqueueDebounce`'s own doc: "both sides must opt in"). `main.ts`'s
 * `ingestion/arrival-watch.ts` is the production caller that supplies
 * `lastChangedAt` and so actually exercises the debounce.
 */
export async function buildIngestionRunner(deps: IngestionWiringDeps): Promise<IngestionWiring> {
  const sink = new PendingIndexingSink();
  const enqueuer = deferredEnqueuer();
  let runnerSink: ExtractedUnitSink = deps.onUnitsLanded
    ? withUnitsLandedHook(sink, deps.onUnitsLanded)
    : sink;
  // `deps.outcomes` (`[D-344]`): composed right after `onUnitsLanded`'s hook, before
  // `deps.generation`'s — independent of both, in the same "add-ons over the same base sink"
  // shape this file's own doc already describes for the other two.
  if (deps.outcomes) {
    runnerSink = withOutcomesExtractHook(runnerSink, deps.vault, deps.outcomes);
  }
  // `deps.generation`'s arrival half: composed AFTER `onUnitsLanded`'s hook
  // (if any) so the two are independent add-ons over the same base sink, in
  // the order this file's own doc lists them. `enqueuer` is safe to close
  // over here even though `bind()` hasn't run yet — this hook only ever
  // fires from `receive()`, which only runs during a drain, which cannot
  // happen before `enqueuer.bind(engine)` below (`deferredEnqueuer`'s own
  // doc: "enqueue calls made before bind are a programmer error," and
  // nothing calls `tick()` until the caller does, after this function
  // returns).
  if (deps.generation) {
    const generationArrivalDeps = buildGenerationArrivalDeps(
      {
        enqueuer,
        hasAnyBuiltKind: deps.generation.hasAnyBuiltKind,
        ...(deps.generation.listConceptsForCourse
          ? { listConceptsForCourse: deps.generation.listConceptsForCourse }
          : {}),
        ...(deps.generation.formatMatchFor
          ? { formatMatchFor: deps.generation.formatMatchFor }
          : {}),
        ...(deps.generation.recordedPreferenceFor
          ? { recordedPreferenceFor: deps.generation.recordedPreferenceFor }
          : {}),
        ...(deps.generation.coursesFolder ? { coursesFolder: deps.generation.coursesFolder } : {}),
      },
      deps.vault,
    );
    // `ol-2zfj.136` [GEN-3.5]: `deps.generation.furtherCallTriggers`'s own
    // composition — reuses `generationArrivalDeps.listConceptsForCourse`
    // (already resolved above, real-vault-walk by default) rather than
    // re-deriving it a second way.
    const furtherCallTriggerDeps: FurtherGenerationTriggerDeps | undefined = deps.generation
      .furtherCallTriggers
      ? {
          vault: deps.vault,
          studyPlanStore: deps.generation.furtherCallTriggers.studyPlanStore,
          enqueuer,
          listConceptsForCourse: generationArrivalDeps.listConceptsForCourse,
          ...(deps.generation.formatMatchFor
            ? { formatMatchFor: deps.generation.formatMatchFor }
            : {}),
          ...(deps.generation.coursesFolder
            ? { coursesFolder: deps.generation.coursesFolder }
            : {}),
          ...(deps.generation.furtherCallTriggers.now
            ? { now: deps.generation.furtherCallTriggers.now }
            : {}),
        }
      : undefined;
    runnerSink = withGenerationEnqueueHook(
      runnerSink,
      generationArrivalDeps,
      furtherCallTriggerDeps,
    );
  }
  const visionRunner = deps.vision
    ? await buildVisionRunner(deps.vision, deps.vault, runnerSink, deps.pageRenderer)
    : undefined;
  // `[ILB-PER-4]` §8 item 2: the delivered vision-routing threshold,
  // resolved at most once here (never per extraction call) and forwarded
  // verbatim as `ExtractOptions` — see `IngestionWiringDeps.visionRoute`'s
  // own doc for why once, here, is the right cadence, and
  // `fetchVisionRouteOptions` for the full list of failures this already
  // degrades on. Omitted `deps.visionRoute` or any failure inside it leaves
  // `extractOptions` `undefined`, so `createExtractionJobRunner` below is
  // unconfigured exactly as it was before this bead — `routePage`'s own
  // `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` (D-022) applies.
  const visionRouteWiring = deps.visionRoute
    ? await buildVisionRouteWiring(deps.visionRoute)
    : undefined;
  const extractOptions = await visionRouteWiring?.readVisionRouteOptions?.();
  const runner = createExtractionJobRunner({
    vault: deps.vault,
    enqueuer,
    sink: runnerSink,
    ...(visionRunner ? { visionRunner } : {}),
    ...(extractOptions ? { options: extractOptions } : {}),
  });
  const composedRunner = deps.revision
    ? createRevisionAwareJobRunner({
        vault: deps.vault,
        cache: deps.revision.cache,
        draftDeps: deps.revision.draftDeps,
        fallback: runner,
        ...(deps.revision.now !== undefined ? { now: deps.revision.now } : {}),
      })
    : runner;
  // `deps.generation`'s execution half: recognises a drained `'generation'`
  // job and routes it to `deps.generation.draft`, falling through to
  // `composedRunner` (extraction, optionally revision-aware) for anything
  // else — see `createGenerationAwareJobRunner`'s own doc.
  const generationAwareRunner = deps.generation
    ? createGenerationAwareJobRunner({ draft: deps.generation.draft, fallback: composedRunner })
    : composedRunner;
  const engine = await IngestionQueueEngine.create({
    store: deps.queueStore,
    capability: deps.capability,
    runner: generationAwareRunner,
    // `ol-2zfj.38`: the ENQUEUE debounce is always in force from this
    // construction onward — see `enqueue-debounce.ts`'s own doc for why it
    // is declared, not derived, and `EngineDeps.enqueueDebounce`'s doc for
    // why this alone is inert until a caller also supplies
    // `EnqueueInput.lastChangedAt` (`ingestion/arrival-watch.ts` is the
    // production caller that does).
    enqueueDebounce: DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
    // `[D-368]` (`ol-2zfj.170`): always supplied now that the ordering key
    // is ruled — see this module's doc, "The drain-order comparator." With
    // no `deps.generation.priority` (every caller today, `main.ts` included)
    // this compares every pair as equal for every job kind, which is
    // byte-identical to the DRAIN order every caller already had with no
    // comparator at all (`nextEligibleIndex`'s own doc: a `0` comparison
    // never moves `bestIndex` off the first eligible job found).
    priority: (a, b) => compareGenerationPriority(a, b, deps.generation?.priority),
  });
  enqueuer.bind(engine);
  return { engine, sink };
}

/**
 * The first-read readout's data half (F1.4/`[D-213]`, `ol-0r92.47`): per
 * folder, the same five honest counts `commands/diagnostics.ts` already
 * computes for the whole queue, scoped to one course folder instead of the
 * whole vault (`[D-213]` point 5 — "the readouts are per folder, because the
 * folders are her filing", and no separate design for a later bulk read).
 *
 * **What this deliberately does not build.** The clause's OTHER truth — "the
 * concepts as they land, one at a time" — has no incremental producer to
 * read from yet: `concept/extract.ts`'s `extractConceptsWithAnchors` is a
 * single whole-vault batch call `main.ts` makes once an ingestion session
 * closes (`tickIngestionAndMaybeRunCorpusRelations`'s `readConceptsFromVault`
 * caller), not a per-folder stream a landed extraction job could feed as it
 * happens. Fabricating concept names out of `ExtractedUnit` text (the only
 * thing `PendingIndexingSink` actually holds — raw extracted passages, not
 * concept identities, see `extract/types.ts`) would misrepresent the very
 * thing F1.4 is strict about naming precisely. So `FirstReadFolderView`
 * below takes landed concepts as an opaque, caller-supplied
 * `readonly string[]` per folder rather than deriving them here — the counts
 * half is real and wired to `PersistedJob`; the concept half is a typed
 * slot this module never fills on its own.
 *
 * **`ol-9c0k` (`[D-219]`) closed the reachability gap this doc used to
 * name.** The real producer is one layer up, in `main.ts`: this module's own
 * `firstReadFoldersJustFinished` (below) tells the host which folders just
 * drained (their queued/in-flight work reached zero), and `main.ts`'s
 * `readLandedConceptsForFinishedFolders` fires one real `readConceptsFromVault`
 * call per such folder, scoped to that folder's subtree, and feeds the
 * concept names it returns into `buildFirstReadFolderViews`'
 * `landedConceptsByFolder` argument. Nothing here changed to make that
 * true — the slot was always real and tested; only the feed was missing.
 */
export type FirstReadFolderCounts = QueueStatusCounts;

/**
 * Which of `folders` a `'source'`-kind job's `sourcePath` falls under, by
 * path prefix — `sourcePath === folder` or `sourcePath.startsWith(folder +
 * '/')`, so a course organised into sub-folders (PSYCH326's `WEEK 2/WEEK
 * 3/...`, F1.3) still counts toward that course's one line. `null` when the
 * job's payload isn't a recognised `'source'` job (no `sourcePath` at all —
 * e.g. a future `'instrument-revision'` job) or matches none of `folders`;
 * such jobs are silently excluded from every folder's count, the same way
 * `commands/diagnostics.ts` reads `job.status` alone and nothing else.
 */
function firstReadFolderOf(payload: unknown, folders: readonly VaultPath[]): VaultPath | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== 'source' || typeof record.sourcePath !== 'string') return null;
  const sourcePath = record.sourcePath as VaultPath;
  for (const folder of folders) {
    if (sourcePath === folder || sourcePath.startsWith(`${folder}/`)) return folder;
  }
  return null;
}

/**
 * Per-folder queue counts for the first-read readout. `folders` are course
 * root paths (`CourseSetupProposal.rootPath`); the result has exactly one
 * entry per folder given, in the same order, whatever the jobs contain —
 * five folders of very different sizes each keep their own line rather than
 * being merged into one vault-wide figure (`[D-213]` point 2 and point 5).
 */
export function summarizeFirstReadByFolder(
  jobs: readonly PersistedJob[],
  folders: readonly VaultPath[],
): readonly { readonly folder: VaultPath; readonly counts: FirstReadFolderCounts }[] {
  return folders.map((folder) => {
    const inFolder = jobs.filter((job) => firstReadFolderOf(job.payload, folders) === folder);
    return {
      folder,
      counts: summarizeQueueStatusCounts({ version: 1, jobs: inFolder, headroom: null }),
    };
  });
}

/**
 * Which of `current`'s folders just finished extracting — the per-folder
 * analogue of `concept/corpusRelationTrigger.ts`'s `ingestionSessionJustClosed`,
 * at folder grain instead of whole-queue grain (`ol-9c0k`, `[D-219]`). A
 * folder "just finished" when it had queued or in-flight work as of
 * `previousCounts` and has neither as of its matching `current` entry —
 * the same non-empty-to-empty transition, scoped to one folder's own jobs
 * rather than the whole engine.
 *
 * `previousCounts` never having an entry for a folder — the first tick that
 * has ever seen it, or a folder idle from the moment tracking started — can
 * never report that folder as just-finished: there is nothing recorded to
 * have finished, the same guard `ingestionSessionJustClosed` applies for
 * `previous === null`. A folder that already fired once and later gains new
 * files (F1's "registering a source mid-term re-runs extraction") fires
 * again the next time it drains — `[D-219]` is one call per finish, not one
 * call ever per folder.
 *
 * Pure and synchronous, mirroring `ingestionSessionJustClosed`: the host
 * calls this once per tick with the counts map it held after the previous
 * tick and the counts this tick just computed.
 */
export function firstReadFoldersJustFinished(
  previousCounts: ReadonlyMap<VaultPath, FirstReadFolderCounts>,
  current: readonly { readonly folder: VaultPath; readonly counts: FirstReadFolderCounts }[],
): readonly VaultPath[] {
  return current
    .filter(({ folder, counts }) => {
      const previous = previousCounts.get(folder);
      if (previous === undefined) return false;
      const wasActive = previous.queued > 0 || previous['in-flight'] > 0;
      const isIdleNow = counts.queued === 0 && counts['in-flight'] === 0;
      return wasActive && isIdleNow;
    })
    .map(({ folder }) => folder);
}

/**
 * One folder's whole first-read view: its live counts plus whichever
 * concepts have already landed for it, in landing order. The two are
 * computed independently and merged with no gating between them — nothing
 * here waits for a folder's counts to settle (`done` reaching its total)
 * before a concept it already produced is included, which is the whole of
 * what "streaming rather than arriving at the end" (`[D-213]` point 2) means
 * at this layer. See this module's doc for why `landedConcepts` is supplied
 * by the caller rather than derived from the sink.
 */
export interface FirstReadFolderView {
  readonly folder: VaultPath;
  readonly counts: FirstReadFolderCounts;
  readonly landedConcepts: readonly string[];
}

/**
 * Merges `summarizeFirstReadByFolder`'s counts with whatever concepts have
 * landed so far for each folder. `landedConceptsByFolder` omitting a folder
 * (or naming one not in `folders`) is not an error — that folder simply
 * renders with an empty `landedConcepts`, the honest "nothing has landed yet"
 * state rather than a fabricated placeholder.
 */
export function buildFirstReadFolderViews(
  jobs: readonly PersistedJob[],
  folders: readonly VaultPath[],
  landedConceptsByFolder: ReadonlyMap<VaultPath, readonly string[]>,
): readonly FirstReadFolderView[] {
  return summarizeFirstReadByFolder(jobs, folders).map(({ folder, counts }) => ({
    folder,
    counts,
    landedConcepts: landedConceptsByFolder.get(folder) ?? [],
  }));
}

// =============================================================================
// `buildOutcomesExtractWiring` / `runOutcomesExtract` — the composition root
// for `outcomes.extract.v1` (`ol-4s30` [EXT-13], component register row 1.1b,
// `[ONT-R5]`, F4.1). This is step 4 of `outcomes-extract-adapter.ts`'s own
// module doc ("A composition root ... still needs writing"), landed by the
// orchestrator now that `packages/core/src/outcome/` (steps 1–3: a real
// `OutcomeSourceReference` anchor, `OutcomeRecord`, and `resolveOutcome`) has
// landed alongside it in the same round.
// =============================================================================
//
// **`TAnchor` is instantiated here, at last, as `OutcomeSourceReference`**
// (`olea-core`'s `../outcome/types.js`) — the concrete anchor the adapter's
// own module doc named as point 1. `packages/core/src/outcome/` never grew an
// `OutcomeReaderPort` (point 2 of that doc) to `implements` against, so
// `WorkerOutcomesExtractReader` is used directly rather than through an
// interface that does not exist; nothing here invents one on that module's
// behalf, per its own note that the shape is `packages/core/src/outcome/`'s
// call to make, not this file's.
//
// **Follows `buildVisionRunner`'s pattern exactly**: load the persisted
// Worker config, build a real transport only when it is usable (F7.8's
// grey-out — everything else keeps working when the Worker isn't
// configured), and hand back `undefined`/`null` rather than a reader doomed
// to fail its first call.
//
// **`OutcomeCandidate.confidence` lands as `OutcomeRecord.extractorSelfRating`
// (`[D-253]`'s ratifying amendment, David, 2026-09-16).** This composition
// originally surfaced a gap rather than papering over it: the adapter reads a
// numeric `confidence` off every outcome candidate, and `OutcomeRecord` had
// nowhere for it to land. David ruled it in, with a hard constraint carried
// on the field itself, in `../outcome/types.js`'s `OutcomeRecord` doc and in
// `ol-d37g`'s close notes: it is an uncalibrated model self-rating, and NO
// consumer may branch or threshold on it until calibrated against a judged
// read (`[OUT-2]`). `runOutcomesExtract` below threads it through unchanged —
// it does not calibrate, gate or interpret the number, only carries it.
//
// **Reachability (`[D-072]`, plan §2.7 clause 5) — deliberately incomplete.**
// **RETRACTED IN PART, `ol-ppxj.43` [DOS-C9]: the catalogue half of this note
// went stale.** `outcomes.extract.v1` landed in the frozen task-id catalogue
// via `ol-2jod.21` [D-254] (three commits: `olea`'s `TASK_IDS.OUTCOMES_EXTRACT`,
// the `olea-service` re-vendor, and the registry line in
// `olea-service/src/tasks/registry.ts`) — that blocker is closed, and it was
// never this bead's own service-side bead that closed it. **Still true, and
// still the reason there is no production caller:** `ol-2jod.21`'s own ruling
// explicitly withheld the PLUGIN TRIGGER (this file calling
// `buildOutcomesExtractWiring`/`runOutcomesExtract` from somewhere real in
// `main.ts`), gating it on a measured five-course real-model run (`[EXT-14]`)
// rather than landing it alongside the catalogue addition. WHERE in `main.ts`
// that trigger belongs (which command, which ingestion event, sourced from
// which folder-scoped documents) is a surface decision still unmade — "a bead
// saying 'needs a caller/surface' names a requirement for *some* caller;
// WHICH caller is the contract's to answer, not the brief's" (this repo's
// own `CLAUDE.md`). Until `[EXT-14]` lands that trigger, this composition is
// exercised by its own unit tests alone.
//
// **`runOutcomesExtractAndReconcile`, added below (`[OUT-3]`), inherits this exact gate rather
// than opening a second one.** It is a strict extension of `runOutcomesExtract` — same inputs,
// same `[EXT-14]` wait — so its own reachability note sits with it, just below, instead of
// repeating this one.

/**
 * `deps.dataHost`/`deps.createTransport` compose exactly the way
 * `buildVisionRunner` above does: load the persisted Worker config and build
 * a real transport only when a base URL and token are both present.
 */
export interface OutcomesExtractWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface OutcomesExtractWiring {
  /** `null` under F7.8's grey-out — the Worker has never been configured. */
  readonly reader: WorkerOutcomesExtractReader | null;
}

/**
 * Composes a real `WorkerOutcomesExtractReader` when (and only when) the
 * Worker is configured — see this section's module doc.
 */
export async function buildOutcomesExtractWiring(
  deps: OutcomesExtractWiringDeps,
): Promise<OutcomesExtractWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { reader: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { reader: new WorkerOutcomesExtractReader({ transport }) };
}

/**
 * Context a single extraction run needs that the Worker response cannot
 * supply itself: which course(s) the source document belongs to
 * (`OutcomeRecord.courses`, M:N, mirroring `ConceptRecord.courses`) and the
 * D7.3 provenance stamp (`OutcomeProvenance`) this run's prompt/model version
 * carries. Never derived here — a caller one layer up (the eventual `main.ts`
 * trigger this section's doc says does not exist yet) is the one that knows
 * which course folder is being read and which prompt version it is running.
 */
export interface RunOutcomesExtractOptions {
  readonly documentKind: OutcomesExtractDocumentKind;
  readonly courses: readonly string[];
  readonly provenance: OutcomeProvenance;
}

export interface RunOutcomesExtractResult {
  /**
   * Resolved through `resolveOutcome` (mint-or-lookup, `[D-088]`-shaped
   * conservation) — never a bare `OutcomeCandidate`, so a caller always gets
   * back the durable, opaque-id record rather than a transient proposal.
   */
  readonly outcomes: readonly OutcomeRecord[];
  /**
   * Paper-structure sections are NOT resolved through the outcome store —
   * `[ONT-R5]`'s Outcome node is examiner-declared SCOPE, and a past paper's
   * section/mark structure is a different shape with no sibling persistence
   * decision yet (component register row 1.1b names outcomes and their
   * concept children; it names no persisted paper-structure schema). Passed
   * through verbatim so a caller has it without this function inventing
   * somewhere to put it.
   */
  readonly paperStructure: {
    readonly sections: readonly PaperSectionCandidate<OutcomeSourceReference>[];
  };
}

/**
 * Reads outcomes and paper-structure sections from `passages` through
 * `reader`, then resolves every outcome candidate into a persisted
 * `OutcomeRecord` via `resolveOutcome` — the adapter-plus-store composition
 * this section's module doc names as step 3/4. Concept attachment
 * (`attachConceptToOutcome`) is deliberately NOT called here: nothing in this
 * function has inferred concept keys from the outcome yet — that is a later
 * stage's job, once one exists, not this read-and-persist seam's.
 *
 * `candidate.confidence` is threaded through as `extractorSelfRating`
 * verbatim (`[D-253]`'s ratifying amendment) — never rounded, clamped or
 * interpreted here. See this section's module doc for the no-branching rule
 * attached to that field.
 */
export async function runOutcomesExtract(
  vault: VaultSource,
  reader: WorkerOutcomesExtractReader,
  passages: readonly OutcomeSourcePassage<OutcomeSourceReference>[],
  options: RunOutcomesExtractOptions,
): Promise<RunOutcomesExtractResult> {
  const result = await reader.read<OutcomeSourceReference>({
    documentKind: options.documentKind,
    passages,
  });
  return resolveOutcomeCandidates(vault, result, options);
}

/**
 * The resolve-and-persist half of `runOutcomesExtract`, factored out so `[D-344]`'s production
 * trigger (`triggerOutcomesExtractForLandedUnit` above) can supply a result it already read
 * through its own capturing transport — see that function's own doc for why calling
 * `runOutcomesExtract` itself there would mean a second, budget-doubling `reader.read()` call just
 * to learn the response's D7.3 stamp before this step can run. Behaviour is byte-identical to
 * `runOutcomesExtract`'s own inline version before this bead — this function's body IS that
 * version, unmoved apart from taking `result` as a parameter instead of producing it.
 */
async function resolveOutcomeCandidates(
  vault: VaultSource,
  result: OutcomesExtractReadResult<OutcomeSourceReference>,
  options: RunOutcomesExtractOptions,
): Promise<RunOutcomesExtractResult> {
  const outcomes = await Promise.all(
    result.outcomes.map((candidate) =>
      resolveOutcome(vault, {
        courses: options.courses,
        source: candidate.anchor,
        label: candidate.label,
        provenance: options.provenance,
        extractorSelfRating: candidate.confidence,
      }),
    ),
  );

  return { outcomes, paperStructure: result.paperStructure };
}

// =============================================================================
// `runOutcomesExtractAndReconcile` — `[OUT-3]` (F4.1, ONT-R1 `ol-2zfj.86`, component register row
// 1.1b), composed here rather than inside `runOutcomesExtract` itself so that function's own
// tests (and any future caller that genuinely only wants the read-and-persist seam) keep working
// unchanged. This is the "later stage" `runOutcomesExtract`'s own doc names above: "Concept
// attachment (`attachConceptToOutcome`) is deliberately NOT called here ... that is a later
// stage's job, once one exists, not this read-and-persist seam's." `olea-core`'s
// `outcome/reconcile.ts` is that stage; this function is its one composition root.
//
// **Course scoping happens here, not in `reconcileOutcomeConcepts`.** `olea-core`'s registry
// entry type deliberately carries no course field (`reconcile.ts`'s own doc), because a
// `NoteAnchor`-bound concept carries no course at this layer at all. `TopicAnchor` concepts DO
// carry one, so `courseScopedConceptRegistry` below filters those to `options.courses` and passes
// every `NoteAnchor` concept through unfiltered — an honest, named limitation (a note-anchored
// concept from an unrelated course could theoretically be offered as a match here) rather than a
// silent one, matching `key-store.ts`'s own course-scoping asymmetry between anchor kinds.
//
// **Reachability (`[D-072]`, plan §2.7 clause 5) — deliberately incomplete, same gate as
// `runOutcomesExtract` above.** This function has no `main.ts` caller for the same two reasons
// that section's doc already gives, plus the fact that it is a strict extension of that
// function's own call: `[EXT-14]` (`ol-2zfj.126`) gates the plugin trigger on a measured
// five-course real-model run first, and until that lands, this composition is exercised only by
// `wiring.spec.ts`'s own unit tests.
// =============================================================================

export interface RunOutcomesExtractAndReconcileResult extends RunOutcomesExtractResult {
  readonly reconciliation: OutcomeConceptReconciliationReport;
}

/**
 * `TopicAnchor` concepts are scoped to `courses`; every `NoteAnchor` concept passes through
 * unfiltered — see this section's module doc for why. `conceptRegistryEntryFromRecord` (`olea-
 * core`) does the actual name/alias projection.
 */
function courseScopedConceptRegistry(
  records: readonly { readonly record: ConceptKeyRecord }[],
  courses: readonly string[],
): readonly OutcomeConceptRegistryEntry[] {
  const courseSet = new Set(courses);
  return records
    .filter(({ record }) => record.anchor.kind !== 'topic' || courseSet.has(record.anchor.course))
    .map(({ record }) => conceptRegistryEntryFromRecord(record));
}

/**
 * `runOutcomesExtract` (above), then `reconcileOutcomeConcepts` (`olea-core`) against every
 * concept key record already on disk, scoped to `options.courses` (see this section's module
 * doc). Concept extraction itself is not run here — this function reads whatever the concept
 * key store already holds, the same "given a course's ... concept registry" input shape
 * `reconcile.ts`'s own doc names, never triggering a fresh extraction pass of its own.
 *
 * **`outcomes` on the result is the POST-reconciliation state, not `runOutcomesExtract`'s own
 * return value.** `reconcileOutcomeConcepts` writes concept attachments straight to the vault
 * (`attachConceptToOutcome`) without handing back updated records, so the `outcomes` array
 * `runOutcomesExtract` returns is a stale, pre-attachment snapshot by the time reconciliation has
 * run. This function re-reads the store once reconciliation settles and returns that instead —
 * a caller of this composition wants what is actually on disk, not the moment before it.
 */
export async function runOutcomesExtractAndReconcile(
  vault: VaultSource,
  reader: WorkerOutcomesExtractReader,
  passages: readonly OutcomeSourcePassage<OutcomeSourceReference>[],
  options: RunOutcomesExtractOptions,
): Promise<RunOutcomesExtractAndReconcileResult> {
  const resolved = await runOutcomesExtract(vault, reader, passages, options);
  return reconcileResolvedOutcomes(vault, resolved, options);
}

/**
 * The reconcile half of `runOutcomesExtractAndReconcile`, factored out for the same reason
 * `resolveOutcomeCandidates` was above: `[D-344]`'s production trigger already has a
 * `RunOutcomesExtractResult` from its own single `reader.read()` call and must not make a second
 * one just to reach this step. Body unmoved from `runOutcomesExtractAndReconcile`'s own inline
 * version before this bead.
 *
 * **Concept keys by identity (`[D-378]`, `ol-egov.141.89.9.56`).** The concept key store's
 * canonical-key index is built once, from the same listing the registry is built from, and handed
 * to both the reconciliation (which folds same-anchor duplicates into one entry under the
 * canonical key, so an outcome attaches that identity once) and the re-read of the outcome store
 * (which reads each attached key as its canonical key). No concept key record is written here.
 */
async function reconcileResolvedOutcomes(
  vault: VaultSource,
  resolved: RunOutcomesExtractResult,
  options: RunOutcomesExtractOptions,
): Promise<RunOutcomesExtractAndReconcileResult> {
  const { outcomes, paperStructure } = resolved;
  const conceptRecords = await listConceptKeyRecords(vault);
  const canonicalKeys = buildConceptKeyCanonicalIndex(conceptRecords.map(({ record }) => record));
  const concepts = courseScopedConceptRegistry(conceptRecords, options.courses);
  const reconciliation = await reconcileOutcomeConcepts(vault, outcomes, concepts, {
    canonicalKeys,
  });

  const persisted = await listOutcomeRecords(vault, { canonicalKeys });
  const byId = new Map(persisted.map(({ record }) => [record.id, record]));
  const reconciledOutcomes = outcomes.map((outcome) => byId.get(outcome.id) ?? outcome);

  return { outcomes: reconciledOutcomes, paperStructure, reconciliation };
}
