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
 */

import {
  createExtractionJobRunner,
  DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
  type DeviceCapability,
  deferredEnqueuer,
  type ExtractedUnit,
  type ExtractedUnitSink,
  IngestionQueueEngine,
  type JobRunner,
  type OutcomeProvenance,
  type OutcomeRecord,
  type OutcomeSourceReference,
  type PersistedJob,
  type QueueStore,
  resolveOutcome,
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
import type {
  OutcomeSourcePassage,
  OutcomesExtractDocumentKind,
  PaperSectionCandidate,
} from './outcomes-extract-adapter.js';
import { WorkerOutcomesExtractReader } from './outcomes-extract-adapter.js';
import { PendingIndexingSink } from './pending-indexing-sink.js';
import { createWorkerVisionPageRunner, WorkerVisionPageExtractor } from './vision-page-runner.js';

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
}

/**
 * `deps.vision`'s composition, split out of `buildIngestionRunner` only for
 * readability — loads `ObsidianWorkerConfigStore`'s persisted config and
 * builds a real `visionRunner` only when both a base URL and a token are
 * present (F7.8's "everything else works regardless" grey-out), the same
 * condition `concept/wiring.ts`'s `buildConceptWiring` and every sibling
 * Worker-backed wiring function in this plugin already gate on.
 */
async function buildVisionRunner(
  vision: NonNullable<IngestionWiringDeps['vision']>,
  vault: VaultSource,
  sink: ExtractedUnitSink,
): Promise<JobRunner | undefined> {
  const configStore = new ObsidianWorkerConfigStore(vision.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return undefined;

  const transport = vision.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const extractor = new WorkerVisionPageExtractor({ transport });
  return createWorkerVisionPageRunner({ vault, extractor, sink });
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
  const runnerSink: ExtractedUnitSink = deps.onUnitsLanded
    ? withUnitsLandedHook(sink, deps.onUnitsLanded)
    : sink;
  const enqueuer = deferredEnqueuer();
  const visionRunner = deps.vision
    ? await buildVisionRunner(deps.vision, deps.vault, runnerSink)
    : undefined;
  const runner = createExtractionJobRunner({
    vault: deps.vault,
    enqueuer,
    sink: runnerSink,
    ...(visionRunner ? { visionRunner } : {}),
  });
  const composedRunner = deps.revision
    ? createRevisionAwareJobRunner({
        vault: deps.vault,
        cache: deps.revision.cache,
        draftDeps: deps.revision.draftDeps,
        fallback: runner,
      })
    : runner;
  const engine = await IngestionQueueEngine.create({
    store: deps.queueStore,
    capability: deps.capability,
    runner: composedRunner,
    // `ol-2zfj.38`: the ENQUEUE debounce is always in force from this
    // construction onward — see `enqueue-debounce.ts`'s own doc for why it
    // is declared, not derived, and `EngineDeps.enqueueDebounce`'s doc for
    // why this alone is inert until a caller also supplies
    // `EnqueueInput.lastChangedAt` (`ingestion/arrival-watch.ts` is the
    // production caller that does).
    enqueueDebounce: DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
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
// `buildOutcomesExtractWiring` and `runOutcomesExtract` have no production
// caller. Two things block one, in order: (1) `outcomes.extract.v1` is not in
// the frozen task-id catalogue (`olea-contracts`'s `TASK_IDS`) — the adapter's
// own module doc names this, and it is a Class C contract-schema change this
// lane does not make unilaterally. `[D-254]` approves the catalogue addition
// (David, 2026-09-16) but the landing itself (the contracts edit, the
// service-side re-vendor, and the one registry line) is explicitly NOT done
// by this commit — it is the next lane's work (`[EXT-14]` gates the
// PLUGIN TRIGGER specifically, not the catalogue edit, on a measured
// five-course real-model run first). (2) Even once the catalogue is amended,
// WHERE in `main.ts` an outcomes-extraction run is triggered from (which
// command, which ingestion event, sourced from which folder-scoped
// documents) is a surface decision this bead was not asked to make — "a bead
// saying 'needs a caller/surface' names a requirement for *some* caller;
// WHICH caller is the contract's to answer, not the brief's" (this repo's
// own `CLAUDE.md`). Until both land, this composition is exercised by its
// own unit tests alone.

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
