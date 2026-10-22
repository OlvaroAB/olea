// `ol-egov.141.89.5.109` ([D-508], [D-518], [D-440]): a rewritten question's successor, cited to a
// PDF-type source that changed again after its page was read, waits for that page's text as
// extracted from the bytes now. When that text has not landed, the job now asks once per run of Olea for the
// catch-up extraction the held-question route already uses (`ol-egov.141.89.5.84`), and drafts once
// the text lands; if it never lands, the job ends exactly as before. Driven through the production
// pieces: the real queue (`IngestionQueueEngine`, its own attempt counting and backoff, persisted
// across a simulated restart), the real citation pass and its catch-up rule, the real catch-up
// enqueue (`requestSourceCatchUpExtraction`), and the composed revision-aware runner. Only the
// extractor is fake: it counts what reaches it and lands the page's text or nothing. Every file,
// course and sentence is invented ("course A"); nothing comes from a real vault. No Worker is
// called: drafting is injected.
import {
  appendSuspendRecord,
  citationStorePath,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  IngestionQueueEngine,
  type InstrumentRevisionJobPayload,
  type JobRunner,
  MAX_ATTEMPTS,
  type PersistedJob,
  type PersistedQueue,
  type QueueStore,
  type RevisionJudgePort,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createVaultDraftCacheStore,
  type DraftCacheStore,
} from '../../src/generation/cache-store.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import {
  type CitedSourceNow,
  createRevisionAwareJobRunner,
  isInstrumentRevisionJobPayload,
  REVISION_SOURCE_TEXT_MAX_ATTEMPTS,
  runInstrumentRevisionJob,
} from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { requestSourceCatchUpExtraction } from '../../src/ingestion/arrival-watch.js';
import { EXTRACTION_WORKFLOW_VERSION } from '../../src/ingestion/extraction-workflow-version.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import {
  CitationRevisionTrigger,
  citedSourceNowFrom,
} from '../../src/ingestion/materiality/citation-revision-wiring.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../src/review/open-session.js';
import { resolveCitationPendingRevalidation } from '../../src/session-builder/provider.js';
import {
  bytesHashOf,
  FakeDataHost,
  homeNote,
  MemoryVault,
  sidecar,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides (Olea).md';
const VERSIONS = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10'];

/** The reason the job has always ended with when the text never landed (`ol-egov.141.89.5.107`), word for word. */
const UNCHANGED_REASON =
  'instrument-revision job: the cited file of predecessor q-slide changed again after its page was read, and no text for its bytes now landed within 8 attempts; the predecessor stays suspended';

const bytesOf = (version: string): Uint8Array =>
  new TextEncoder().encode(`invented slide bytes, ${version}`);
const hashOf = (version: string): Promise<string> =>
  bytesHashOf(`invented slide bytes, ${version}`);
const pageText = (version: string, page: number): string =>
  `Invented page ${page} text, ${version}.`;

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
  result: {
    questions: [
      {
        stem: 'Which invented statement holds after the correction?',
        correctAnswer: 'Alpha',
        distractors: ['Beta', 'Gamma', 'Delta'],
        feedback: 'Invented feedback.',
      },
    ],
  },
};

/** Drafting injected as the production function shapes it; records every request it carried. */
function recordingDrafter() {
  const sent: WorkerTaskRequest[] = [];
  const draftDeps = {
    transport: {
      send: async (request: WorkerTaskRequest) => {
        sent.push(request);
        return goodResponse;
      },
    },
  } as unknown as DraftQuizCardsDeps;
  const draftForConcept = vi.fn(
    async (
      deps: DraftQuizCardsDeps,
      request: DraftQuizCardsRequest,
    ): Promise<DraftQuizCardsResult> => {
      const sourceChunks = ['retrieved one', 'retrieved two'];
      const response = await deps.transport.send({
        taskId: 'quiz.generate.v1',
        payload: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
      } as unknown as WorkerTaskRequest);
      return {
        status: 'drafted',
        request: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
        response,
      };
    },
  );
  /** The first chunk of the one generation request: the passage the successor was drafted from. */
  const draftedFrom = (): string => {
    const generation = sent.filter((request) => request.taskId === 'quiz.generate.v1');
    expect(generation).toHaveLength(1);
    const [request] = generation;
    if (request === undefined) throw new Error('no generation request');
    return (request.payload as { sourceChunks: string[] }).sourceChunks[0] as string;
  };
  return { draftDeps, draftForConcept, draftedFrom };
}

/** The persisted queue: what a restart reloads. */
class MemoryQueueStore implements QueueStore {
  state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((job) => ({ ...job })) };
  }
}

/** What outlives a restart (the vault, plugin data, the persisted queue), and what the test reads. */
interface World {
  readonly vault: MemoryVault;
  readonly pluginData: FakeDataHost;
  readonly queueStore: MemoryQueueStore;
  readonly clock: { t: number };
  /** Bytes hash to version, as the fake extractor reads the file it was handed. */
  readonly versions: Map<string, string>;
  /** Whether the fake extractor delivers the page's text. */
  deliver: boolean;
  /** Whether a Worker is configured. */
  worker: boolean;
  readonly drafter: ReturnType<typeof recordingDrafter>;
  /** Every catch-up request that reached the host, by run of Olea. */
  readonly requests: { readonly run: number; readonly path: string }[];
  /** Every extraction job the fake extractor ran, by run of Olea. */
  readonly extracted: { readonly run: number; readonly contentHash: string }[];
}

async function newWorld(): Promise<World> {
  const versions = new Map<string, string>();
  for (const version of VERSIONS) versions.set(await hashOf(version), version);
  return {
    vault: new MemoryVault(),
    pluginData: new FakeDataHost(),
    queueStore: new MemoryQueueStore(),
    clock: { t: 1_000_000 },
    versions,
    deliver: true,
    worker: true,
    drafter: recordingDrafter(),
    requests: [],
    extracted: [],
  };
}

/** One run of Olea: everything built at load, memory included, over the world's persisted state. */
interface OleaRun {
  readonly world: World;
  readonly store: ObsidianCitationHashStore;
  readonly trigger: CitationRevisionTrigger;
  readonly engine: IngestionQueueEngine;
  readonly cache: DraftCacheStore;
  readonly port: CitedSourceNow & { requestText: ReturnType<typeof vi.fn> };
  pass(): ReturnType<CitationRevisionTrigger['tick']>;
}

/**
 * Starts Olea as `main.ts` composes these pieces: the citation pass whose catch-up request enqueues
 * `requestSourceCatchUpExtraction` into the ingestion queue under this run's stamp, and the queue
 * draining the revision-aware runner over the fake extractor. `failRequest` makes the runner's
 * request throw (a broken host).
 */
async function startOlea(
  world: World,
  run: number,
  options: { readonly failRequest?: boolean } = {},
): Promise<OleaRun> {
  const store = new ObsidianCitationHashStore(world.pluginData);
  const judge: RevisionJudgePort = {
    judge: vi.fn(async () => ({ material: true, reason: 'scripted' })),
  };
  let engine: IngestionQueueEngine | undefined;
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => 1_000 },
    transcriptPartGrain: true,
    requestSourceReextraction: async (sourcePath) => {
      world.requests.push({ run, path: sourcePath });
      const queue = engine;
      if (queue === undefined) return;
      await requestSourceCatchUpExtraction({
        vault: world.vault,
        engine: { list: () => queue.list(), enqueue: (input) => queue.enqueue(input) },
        sourcePath,
        sessionStamp: run,
      });
    },
  });
  const actions = {
    enqueue: vi.fn(async (input: EnqueueInput) => engine?.enqueue(input)),
    suspend: vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
      await appendSuspendRecord(
        world.vault,
        {
          kind: 'suspend',
          timestamp: '2026-10-01T09:00:00Z',
          instrumentId,
          conceptIds: conceptIds.length > 0 ? [...conceptIds] : ['invented-concept'],
        },
        { deviceId: 'device-synthetic' },
      );
    }),
    onRelocationProposed: vi.fn(),
  };
  const cache = createVaultDraftCacheStore(world.vault);
  const base = citedSourceNowFrom(() => trigger);
  const port = {
    ...base,
    requestText: vi.fn(async (path: string, bytesHash: string) => {
      if (options.failRequest === true) throw new TypeError('host unavailable');
      await base.requestText(path, bytesHash);
    }),
  };
  const extractor: JobRunner = async (job) => {
    const payload = job.payload as { kind?: unknown; sourcePath?: unknown };
    if (payload.kind !== 'source' || typeof payload.sourcePath !== 'string') {
      return { ok: false, retryable: false, reason: 'not an extraction job' };
    }
    world.extracted.push({ run, contentHash: job.contentHash });
    const version = world.versions.get(job.contentHash);
    if (world.deliver && version !== undefined) {
      const unit: ExtractedUnit = {
        text: pageText(version, 2),
        provenance: { sourcePath: payload.sourcePath, location: { page: 2 } },
      };
      await trigger.onSourceUnitsLanded(
        world.vault,
        actions,
        [unit],
        new Map([[payload.sourcePath, job.contentHash]]),
      );
    }
    return { ok: true };
  };
  engine = await IngestionQueueEngine.create({
    store: world.queueStore,
    capability: { canDrain: true },
    runner: createRevisionAwareJobRunner({
      vault: world.vault,
      cache,
      draftDeps: () => (world.worker ? world.drafter.draftDeps : null),
      draftForConcept: world.drafter.draftForConcept,
      citedSourceNow: port,
      fallback: extractor,
    }),
    clock: { now: () => world.clock.t },
    random: { next: () => 0.5 },
  });
  return {
    world,
    store,
    trigger,
    engine,
    cache,
    port,
    pass: () => trigger.tick(world.vault, actions),
  };
}

function revisionJob(run: OleaRun): PersistedJob {
  const job = run.engine
    .list()
    .find((candidate) => isInstrumentRevisionJobPayload(candidate.payload));
  if (job === undefined) throw new Error('no revision job');
  return job;
}

/** A queued job as the engine keeps it: the extraction version it was enqueued under, if any. */
type VersionedJob = PersistedJob & { readonly workflowVersion?: string };

/** The catch-up extraction jobs on record for the bytes `contentHash`, in queue order. */
function catchUpJobs(run: OleaRun, contentHash: string): readonly VersionedJob[] {
  return (run.engine.list() as readonly VersionedJob[]).filter(
    (job) =>
      job.contentHash === contentHash &&
      job.workflowVersion?.startsWith(`${EXTRACTION_WORKFLOW_VERSION}:catch-up:`) === true,
  );
}

/** Lets the queue run what is eligible now (a queued extraction), never a job still backing off. */
async function runEligible(run: OleaRun): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if ((await run.engine.tick()).kind !== 'ran') return;
  }
  throw new Error('the queue never went idle');
}

/** Moves the queue's clock past any backoff (the longest is 45 minutes, jittered). */
function pastBackoff(run: OleaRun): void {
  run.world.clock.t += 3 * 60 * 60 * 1000;
}

/**
 * Moves past any backoff and lets the queue run the revision job's next attempt, then (unless
 * `drain` is false) whatever that attempt queued. Returns the job as the attempt left it.
 */
async function nextAttempt(
  run: OleaRun,
  options: { readonly drain?: boolean } = {},
): Promise<PersistedJob> {
  pastBackoff(run);
  const before = revisionJob(run);
  expect(await run.engine.tick()).toMatchObject({ kind: 'ran', contentHash: before.contentHash });
  const after = revisionJob(run);
  if (options.drain !== false) await runEligible(run);
  return after;
}

/**
 * Page 2 of an invented PDF holds `q-slide` (and any `others`, on page 3). The file changes to v1,
 * the pass holds the questions and asks for the catch-up extraction of v1 (the held-question route,
 * `ol-egov.141.89.5.84`), the queue runs it, its page-2 text lands, and `q-slide` is rewritten: the
 * old question suspended and one successor job queued with the page's text and v1's hash. The
 * counters are cleared there: what follows is this bead's.
 */
async function rewritten(world: World, others: readonly string[] = []) {
  world.vault.files.set(PDF_HOME, homeNote('Invented slide topic', ['q-slide', ...others]));
  world.vault.binaries.set(PDF, bytesOf('v0'));
  const v0 = await hashOf('v0');
  world.vault.files.set(
    citationStorePath('q-slide'),
    sidecar({ instrumentId: 'q-slide', sourcePath: PDF, page: 2, sourceRevision: v0 }),
  );
  for (const id of others) {
    world.vault.files.set(
      citationStorePath(id),
      sidecar({ instrumentId: id, sourcePath: PDF, page: 3, sourceRevision: v0 }),
    );
  }
  const run = await startOlea(world, 1);
  await run.pass();
  world.vault.binaries.set(PDF, bytesOf('v1'));
  await run.pass();
  expect(world.requests).toEqual([{ run: 1, path: PDF }]);
  expect((await run.engine.tick()).kind).toBe('ran');
  const job = revisionJob(run);
  expect(job.status).toBe('queued');
  const payload = job.payload as InstrumentRevisionJobPayload;
  expect(payload.predecessorInstrumentId).toBe('q-slide');
  expect(payload.newPassageText).toBe(pageText('v1', 2));
  expect(payload.sourceRevision).toBe(await hashOf('v1'));
  expect(await suspended(world)).toEqual(new Set(['q-slide']));
  world.requests.length = 0;
  world.extracted.length = 0;
  return run;
}

async function suspended(world: World): Promise<ReadonlySet<string>> {
  return suspendedInstrumentIds((await readReviewLogHistory(world.vault)).entries);
}

/** The old question stays suspended and withheld. */
async function oldQuestionStaysOut(world: World, run: OleaRun): Promise<void> {
  expect((await suspended(world)).has('q-slide')).toBe(true);
  expect(await resolveCitationPendingRevalidation(run.store, ['q-slide'])).toEqual(
    new Set(['q-slide']),
  );
}

/** She sees it: presented, accepted, seeded by the next pass with no hold, and presented again. */
async function reachesHer(world: World, run: OleaRun, record: DraftRecord): Promise<void> {
  expect(await draftSourceCheckAtPresentation(world.vault, [record])(record.draftId)).toBe('clear');
  if (record.question === undefined) throw new Error('not a question draft');
  const { instrumentId } = await materializeAcceptedDraft(world.vault, {
    sourcePath: PDF_HOME,
    question: record.question,
    draftId: record.draftId,
    ...(record.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
  });
  await run.pass();
  expect((await run.store.loadAll()).get(instrumentId)?.pendingRevalidation).toBeUndefined();
  expect(await resolveCitationPendingRevalidation(run.store, [instrumentId])).toEqual(new Set());
  const { records } = await enumerateVaultInstruments(world.vault, {
    concepts: { stampConceptKeys: true },
  });
  const presented = await sourceCheckAtPresentation(run.store, async () => suspended(world), {
    vault: world.vault,
    recordOf: (id) => records.find((r) => r.instrumentId === id),
  })(instrumentId);
  expect(presented).toBe('clear');
}

describe('a successor waiting for a changed PDF-type source asks once per run of Olea for its catch-up extraction (ol-egov.141.89.5.109)', () => {
  it("the changed page's text has not landed: the job asks once per run of Olea for the catch-up extraction, and drafts once the text lands", async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));
    const v2 = await hashOf('v2');

    // First attempt: it waits, drafting nothing, and asks once.
    expect(await nextAttempt(run, { drain: false })).toMatchObject({
      status: 'deferred',
      attempts: 1,
    });
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    // Queued as the held-question route queues it: a source job for the bytes now, this run's stamp.
    expect(catchUpJobs(run, v2)).toEqual([
      expect.objectContaining({
        status: 'queued',
        label: PDF,
        payload: { kind: 'source', sourcePath: PDF, format: 'pdf' },
        workflowVersion: `${EXTRACTION_WORKFLOW_VERSION}:catch-up:1`,
      }),
    ]);

    // The queue runs the extraction and its text lands; the next attempt drafts from it.
    await runEligible(run);
    expect(world.extracted).toEqual([{ run: 1, contentHash: v2 }]);
    expect(await nextAttempt(run)).toMatchObject({ status: 'done', attempts: 2 });
    expect(world.drafter.draftedFrom()).toBe(pageText('v2', 2));
    const [record] = await run.cache.listPending();
    expect(record?.sourceCitation).toEqual({ sourcePath: PDF, page: 2, sourceRevision: v2 });
    expect(world.requests).toHaveLength(1);
    expect(run.port.requestText).toHaveBeenCalledTimes(1);

    if (record === undefined) throw new Error('no successor');
    await reachesHer(world, run, record);
    await oldQuestionStaysOut(world, run);
  });

  it('the text never lands: one request across every attempt, then the job ends as before with its reason', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.deliver = false;
    world.vault.binaries.set(PDF, bytesOf('v2'));

    const attempts: PersistedJob[] = [];
    for (let attempt = 1; attempt <= REVISION_SOURCE_TEXT_MAX_ATTEMPTS; attempt += 1) {
      attempts.push(await nextAttempt(run));
    }
    expect(REVISION_SOURCE_TEXT_MAX_ATTEMPTS).toBe(MAX_ATTEMPTS);
    expect(attempts.map((job) => [job.status, job.attempts])).toEqual([
      ['deferred', 1],
      ['deferred', 2],
      ['deferred', 3],
      ['deferred', 4],
      ['deferred', 5],
      ['deferred', 6],
      ['deferred', 7],
      ['failed', 8],
    ]);
    expect(attempts.at(-1)?.failedReason).toBe(UNCHANGED_REASON);
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    expect(run.port.requestText).toHaveBeenCalledTimes(1);
    expect(catchUpJobs(run, await hashOf('v2'))).toHaveLength(1);
    expect(world.extracted).toHaveLength(1);
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
    expect(await run.cache.listPending()).toEqual([]);
    await oldQuestionStaysOut(world, run);
  });

  it('a restart in between: the job asks once more after the restart, and drafts from the text that lands then', async () => {
    const world = await newWorld();
    const first = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));
    const v2 = await hashOf('v2');

    // Asked, and its text landed, in the first run; Olea restarts before the next attempt.
    expect(await nextAttempt(first)).toMatchObject({ status: 'deferred', attempts: 1 });
    expect(first.trigger.landedSourceText(PDF, v2, 2)).toBe(pageText('v2', 2));
    const second = await startOlea(world, 2);
    expect(second.trigger.landedSourceText(PDF, v2, 2)).toBeUndefined();

    // The restart forgot the text: the job asks once more, then waits without asking again.
    expect(await nextAttempt(second, { drain: false })).toMatchObject({
      status: 'deferred',
      attempts: 2,
    });
    expect(await nextAttempt(second, { drain: false })).toMatchObject({
      status: 'deferred',
      attempts: 3,
    });
    expect(world.requests).toEqual([
      { run: 1, path: PDF },
      { run: 2, path: PDF },
    ]);
    expect(second.port.requestText).toHaveBeenCalledTimes(1);
    expect(catchUpJobs(second, v2).map((job) => [job.workflowVersion, job.status])).toEqual([
      [`${EXTRACTION_WORKFLOW_VERSION}:catch-up:1`, 'done'],
      [`${EXTRACTION_WORKFLOW_VERSION}:catch-up:2`, 'queued'],
    ]);

    // This run's extraction lands the text; the next attempt drafts from it.
    await runEligible(second);
    expect(await nextAttempt(second)).toMatchObject({ status: 'done', attempts: 4 });
    expect(world.drafter.draftedFrom()).toBe(pageText('v2', 2));
    expect(world.extracted).toEqual([
      { run: 1, contentHash: v2 },
      { run: 2, contentHash: v2 },
    ]);
    const [record] = await second.cache.listPending();
    expect(record?.sourceCitation).toEqual({ sourcePath: PDF, page: 2, sourceRevision: v2 });
    if (record === undefined) throw new Error('no successor');
    await reachesHer(world, second, record);
    await oldQuestionStaysOut(world, second);
  });

  it('the text never lands across a restart: at most one request each time Olea starts, and the job still ends at its eighth attempt', async () => {
    const world = await newWorld();
    const first = await rewritten(world);
    world.deliver = false;
    world.vault.binaries.set(PDF, bytesOf('v2'));

    const attempts: PersistedJob[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) attempts.push(await nextAttempt(first));
    const second = await startOlea(world, 2);
    for (let attempt = 5; attempt <= REVISION_SOURCE_TEXT_MAX_ATTEMPTS; attempt += 1) {
      attempts.push(await nextAttempt(second));
    }
    expect(attempts.map((job) => job.attempts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(attempts.at(-1)).toMatchObject({ status: 'failed', failedReason: UNCHANGED_REASON });
    expect(world.requests).toEqual([
      { run: 1, path: PDF },
      { run: 2, path: PDF },
    ]);
    expect(first.port.requestText).toHaveBeenCalledTimes(1);
    expect(second.port.requestText).toHaveBeenCalledTimes(1);
    expect(world.extracted.map((entry) => entry.run)).toEqual([1, 2]);
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
    await oldQuestionStaysOut(world, second);
  });

  it('a file that keeps changing ahead of its text: still one request each time Olea starts', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.deliver = false;

    const attempts: PersistedJob[] = [];
    for (let attempt = 1; attempt <= REVISION_SOURCE_TEXT_MAX_ATTEMPTS; attempt += 1) {
      world.vault.binaries.set(PDF, bytesOf(`v${attempt + 1}`));
      attempts.push(await nextAttempt(run));
    }
    expect(attempts.at(-1)).toMatchObject({
      status: 'failed',
      attempts: 8,
      failedReason: UNCHANGED_REASON,
    });
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    expect(run.port.requestText).toHaveBeenCalledTimes(1);
    expect(world.extracted).toHaveLength(1);
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
  });

  it('the last attempt asks for nothing: no extraction is asked for when no attempt is left to use it', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));
    const payload = revisionJob(run).payload as InstrumentRevisionJobPayload;

    const outcome = await runInstrumentRevisionJob(
      {
        vault: world.vault,
        cache: run.cache,
        draftDeps: () => world.drafter.draftDeps,
        draftForConcept: world.drafter.draftForConcept,
        citedSourceNow: run.port,
      },
      payload,
      REVISION_SOURCE_TEXT_MAX_ATTEMPTS,
    );
    expect(outcome).toEqual({ ok: false, retryable: false, reason: UNCHANGED_REASON });
    expect(run.port.requestText).not.toHaveBeenCalled();
    expect(world.requests).toEqual([]);
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
  });

  it("the citation pass already asked for these bytes since Olea started: the job's request reaches the host no second time", async () => {
    const world = await newWorld();
    const run = await rewritten(world, ['q-other']);
    // `q-other` cites page 3, which v1's extraction left without text: it stays held, not rewritten.
    expect(await suspended(world)).toEqual(new Set(['q-slide']));
    world.deliver = false;
    world.vault.binaries.set(PDF, bytesOf('v2'));
    const v2 = await hashOf('v2');
    await run.pass();
    // The pass held `q-other` for v2 and asked for v2's catch-up extraction itself.
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    expect(catchUpJobs(run, v2)).toHaveLength(1);

    // The successor job waits for v2's page text and asks: the shared rule stops it at the trigger.
    expect(await nextAttempt(run, { drain: false })).toMatchObject({
      status: 'deferred',
      attempts: 1,
    });
    expect(run.port.requestText).toHaveBeenCalledTimes(1);
    expect(run.port.requestText).toHaveBeenCalledWith(PDF, v2);
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    expect(catchUpJobs(run, v2)).toHaveLength(1);
  });

  it('no Worker configured, or a request that fails: the job waits as before, drafting nothing', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));

    // No Worker: the job waits uncounted and asks for nothing.
    world.worker = false;
    expect(await nextAttempt(run)).toMatchObject({ status: 'deferred', attempts: 0 });
    expect(run.port.requestText).not.toHaveBeenCalled();
    expect(world.requests).toEqual([]);

    // A host whose request throws: logged by error name only; the job waits, drafting nothing.
    world.worker = true;
    const broken = await startOlea(world, 2, { failRequest: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await nextAttempt(broken)).toMatchObject({ status: 'deferred', attempts: 1 });
      expect(broken.port.requestText).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(
        'Olea: instrument-revision catch-up extraction request failed',
        'TypeError',
      );
      for (const call of errors.mock.calls) expect(JSON.stringify(call)).not.toContain('slides');
    } finally {
      errors.mockRestore();
    }
    expect(world.requests).toEqual([]);
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
    expect(await broken.cache.listPending()).toEqual([]);
  });

  it('only the current version feeds the rewrite: text for the bytes it asked for lands after the file changed again, and the job drafts nothing from it and keeps waiting', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));
    const v2 = await hashOf('v2');

    // It asks for v2's text; before the queue runs that extraction the file changes to v3.
    expect(await nextAttempt(run, { drain: false })).toMatchObject({
      status: 'deferred',
      attempts: 1,
    });
    world.vault.binaries.set(PDF, bytesOf('v3'));
    await runEligible(run);
    // The text for v2 did land, but it is no longer the file's text.
    expect(world.extracted).toEqual([{ run: 1, contentHash: v2 }]);
    expect(run.trigger.landedSourceText(PDF, v2, 2)).toBe(pageText('v2', 2));

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      expect(await nextAttempt(run)).toMatchObject({ status: 'deferred', attempts: attempt });
    }
    expect(world.drafter.draftForConcept).not.toHaveBeenCalled();
    expect(await run.cache.listPending()).toEqual([]);
    // The one request per run is spent: v3 is not asked for again, so the job simply keeps waiting.
    expect(world.requests).toEqual([{ run: 1, path: PDF }]);
    await oldQuestionStaysOut(world, run);
  });

  it('withholding is preserved: the old question stays suspended and withheld while the successor waits, after it asks, and until the successor is drafted', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));

    // Before any attempt, then waiting and asking (the extraction queued but not yet run).
    await oldQuestionStaysOut(world, run);
    expect(await nextAttempt(run, { drain: false })).toMatchObject({ status: 'deferred' });
    expect(world.requests).toHaveLength(1);
    await oldQuestionStaysOut(world, run);
    expect(await run.cache.listPending()).toEqual([]);

    // The extraction runs and lands; the old question is still out until the successor is drafted.
    await runEligible(run);
    await oldQuestionStaysOut(world, run);
    expect(await nextAttempt(run)).toMatchObject({ status: 'done' });
    expect(await run.cache.listPending()).toHaveLength(1);
    await oldQuestionStaysOut(world, run);
  });

  it('rewrite confirmation is preserved: the successor drafted after the text lands is a pending draft, not an accepted question, until she confirms it', async () => {
    const world = await newWorld();
    const run = await rewritten(world);
    world.vault.binaries.set(PDF, bytesOf('v2'));

    expect(await nextAttempt(run, { drain: false })).toMatchObject({ status: 'deferred' });
    await runEligible(run);
    expect(await nextAttempt(run)).toMatchObject({ status: 'done' });

    const [record, ...rest] = await run.cache.listPending();
    expect(rest).toEqual([]);
    expect(record?.status).toBe('pending');
    // Nothing is an instrument yet: the draft is not served, and the old question is still out.
    const { records } = await enumerateVaultInstruments(world.vault, {
      concepts: { stampConceptKeys: true },
    });
    expect(records.map((r) => r.instrumentId)).not.toContain(record?.draftId);
    expect(records.map((r) => r.instrumentId)).toEqual(
      records.map((r) => r.instrumentId).filter((id) => id === 'q-slide'),
    );
    await oldQuestionStaysOut(world, run);
    // Her confirmation (acceptance) is the only way it becomes an instrument.
    if (record === undefined) throw new Error('no successor');
    await reachesHer(world, run, record);
  });
});
