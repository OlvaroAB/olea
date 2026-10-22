// `ol-egov.141.89.5.111`: two findings from code reading (discovered by ol-egov.141.89.5.107), shown
// here through the production construction (client f653ec04), and the fix.
//
// 1. A renamed PDF or other binary source was never followed: its questions stayed withheld, while a
//    renamed lecture transcript was followed through `onSourceRenamed` (`main.ts`'s vault rename
//    handler calls it, as these tests do). Now ([D-576]) a rename Olea saw updates the path on that
//    source's citation records through the citation store's own path-only call; every other field
//    stays as written, and an unseen move (a delete and a create) withholds as before.
// 2. A missing Worker or a transport failure counted against the queue's attempts on a revision job,
//    and an unreachable Worker read as a refusal, so an outage failed the job and left the old
//    question suspended with nothing replacing it. Now an outage leaves the job waiting, uncounted,
//    and it completes once the Worker is back; a genuine refusal still fails the job. The job is put
//    on the queue by the citation pass itself and drained by `buildIngestionRunner`, the runner chain
//    `main.ts` drains.
//
// Every course, lecture, file and sentence
// here is invented.
import {
  citationStorePath,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  hashContent,
  MAX_ATTEMPTS,
  type PersistedEmbeddingCache,
  type PersistedJob,
  type PersistedKeywordIndex,
  type RevisionJudgePort,
  readInstrumentCitation,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type WorkerTaskRequest,
} from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../../src/generation/cache-store.js';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  type CitationRevisionActions,
  CitationRevisionTrigger,
} from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { ObsidianQueueStore } from '../../../src/ingestion/queue-store.js';
import { buildIngestionRunner } from '../../../src/ingestion/wiring.js';
import type { DraftQuizCardsDeps } from '../../../src/retrieval/draft-quiz-cards.js';
import { sourceCheckAtPresentation } from '../../../src/review/open-session.js';
import { createVaultSuspendPort } from '../../../src/review/ports.js';
import {
  citeTranscriptPart,
  FakeDataHost,
  type Harness,
  harness,
  homeNote,
  LECTURE,
  MemoryVault,
  sidecar,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

/** The session's presentation-time check, as `open-session.ts` composes it over this store. */
async function presentedAs(
  h: Harness,
  vault: MemoryVault,
  instrumentId: string,
): Promise<'clear' | 'check-failed' | 'suspended'> {
  const { records } = await enumerateVaultInstruments(vault);
  return sourceCheckAtPresentation(h.store, undefined, {
    vault,
    recordOf: (id) => records.find((record) => record.instrumentId === id),
  })(instrumentId);
}

// ---------------------------------------------------------------------------------------------
// Claim 1: a rename Olea saw
// ---------------------------------------------------------------------------------------------

const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides.md';
const PDF_RENAMED = 'Course A/Lecture 3/lecture three slides.pdf';
const PDF_BYTES = new TextEncoder().encode('invented slide deck bytes, one version only');

/** A question drafted from page 2 of a PDF, recorded at the PDF's bytes, after one citation pass. */
async function pdfSeeded(): Promise<{ vault: MemoryVault; h: Harness }> {
  const vault = new MemoryVault();
  vault.binaries.set(PDF, PDF_BYTES);
  vault.files.set(PDF_HOME, homeNote('Invented slide topic', ['q-pdf']));
  vault.files.set(
    '.olea/citations/q-pdf.json',
    sidecar({
      instrumentId: 'q-pdf',
      sourcePath: PDF,
      page: 2,
      sourceRevision: await hashContent(PDF_BYTES),
    }),
  );
  // `transcriptPartGrain: true` is what `main.ts` passes.
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  return { vault, h };
}

/** The PDF moved to a new name with its bytes unchanged, and the rename event `main.ts` handles. */
async function renamePdfAsSeen(vault: MemoryVault, h: Harness): Promise<number> {
  vault.binaries.delete(PDF);
  vault.binaries.set(PDF_RENAMED, PDF_BYTES);
  return h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);
}

/** What the renamed file's extraction hands the sink: its page texts and its bytes hash. */
async function pdfUnitsLandAtNewPath(vault: MemoryVault, h: Harness): Promise<void> {
  const units: ExtractedUnit[] = [1, 2, 3].map((page) => ({
    text: `Invented slide text for page ${page} of the deck.`,
    provenance: { sourcePath: PDF_RENAMED, location: { page } },
  }));
  const actions: CitationRevisionActions = {
    enqueue: async () => undefined,
    suspend: async () => undefined,
  };
  await h.trigger.onSourceUnitsLanded(
    vault,
    actions,
    units,
    new Map([[PDF_RENAMED, await hashContent(PDF_BYTES)]]),
  );
}

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const TRANSCRIPT_HOME = 'Course A/Lecture 3/transcript (Olea).md';
const TRANSCRIPT_RENAMED = 'Course A/Lecture 3/lecture three transcript.txt';

describe('claim 1: a rename Olea saw (ol-egov.141.89.5.111)', () => {
  it('before any rename, the PDF question is served: nothing withheld, the presentation check clear', async () => {
    const { vault, h } = await pdfSeeded();
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
  });

  it('a renamed lecture transcript is followed: onSourceRenamed moves its anchor, and the question is served at the new path', async () => {
    const vault = new MemoryVault();
    vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
    vault.files.set(TRANSCRIPT_HOME, homeNote('Invented lecture topic', ['q-four']));
    await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);

    vault.move(TRANSCRIPT, TRANSCRIPT_RENAMED);
    expect(await h.trigger.onSourceRenamed(vault, TRANSCRIPT, TRANSCRIPT_RENAMED)).toBe(1);
    await h.pass(vault);

    expect((await h.store.loadAll()).get('q-four')?.sourcePath).toBe(TRANSCRIPT_RENAMED);
    expect(await h.withheld(['q-four'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-four')).toBe('clear');
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it("a renamed PDF: onSourceRenamed changes the citation record's path and nothing else", async () => {
    const { vault, h } = await pdfSeeded();
    const before = vault.files.get(citationStorePath('q-pdf'));
    expect(before).toBeDefined();
    expect(await renamePdfAsSeen(vault, h)).toBe(1);
    const after = vault.files.get(citationStorePath('q-pdf'));
    // The same record field for field, in the same order, with the one path swapped (the page, the
    // bytes hash and the schema version kept); the store serializes it in its own layout.
    const parse = (text: string | undefined): Record<string, unknown> =>
      JSON.parse(text ?? '{}') as Record<string, unknown>;
    expect(parse(after)).toEqual({ ...parse(before), sourcePath: PDF_RENAMED });
    expect(Object.keys(parse(after))).toEqual(Object.keys(parse(before)));
    expect(await readInstrumentCitation(vault, 'q-pdf')).toMatchObject({
      sourcePath: PDF_RENAMED,
      page: 2,
      sourceRevision: await hashContent(PDF_BYTES),
    });
  });

  it('a PDF renamed while Olea runs, bytes unchanged, is still served at the new path after the next pass', async () => {
    const { vault, h } = await pdfSeeded();
    await renamePdfAsSeen(vault, h);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it('once the renamed file is extracted at its new path, its question is served again', async () => {
    const { vault, h } = await pdfSeeded();
    await renamePdfAsSeen(vault, h);
    await h.pass(vault);
    await pdfUnitsLandAtNewPath(vault, h);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
  });

  it('a hold raised before the rename was seen (the pass read the old path first) lifts once the citation follows', async () => {
    const { vault, h } = await pdfSeeded();
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set(['q-pdf']));
    await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
  });

  it('an unseen move (a delete and a create, no rename event) still withholds', async () => {
    const { vault, h } = await pdfSeeded();
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);
    await h.pass(vault);
    await pdfUnitsLandAtNewPath(vault, h);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set(['q-pdf']));
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('check-failed');
    expect(await readInstrumentCitation(vault, 'q-pdf')).toMatchObject({ sourcePath: PDF });
  });

  it('a file renamed into a note is not the same kind of source: nothing moves and the question is withheld', async () => {
    const { vault, h } = await pdfSeeded();
    const asNote = 'Course A/Lecture 3/slides as a note.md';
    vault.binaries.delete(PDF);
    vault.files.set(asNote, 'Invented note text, no longer slides.\n');
    expect(await h.trigger.onSourceRenamed(vault, PDF, asNote)).toBe(0);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set(['q-pdf']));
    expect(await readInstrumentCitation(vault, 'q-pdf')).toMatchObject({ sourcePath: PDF });
  });

  it('a rename event naming a path where no file stands moves nothing', async () => {
    const { vault, h } = await pdfSeeded();
    const before = vault.files.get(citationStorePath('q-pdf'));
    expect(await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED)).toBe(0);
    expect(vault.files.get(citationStorePath('q-pdf'))).toBe(before);
  });

  it('a rename of a file no tracked question cites moves nothing', async () => {
    const { vault, h } = await pdfSeeded();
    const other = 'Course A/Lecture 4/other slides.pdf';
    vault.binaries.set(other, PDF_BYTES);
    const snapshot = vault.snapshot();
    vault.binaries.delete(other);
    vault.binaries.set(`${other}.renamed.pdf`, PDF_BYTES);
    expect(await h.trigger.onSourceRenamed(vault, other, `${other}.renamed.pdf`)).toBe(0);
    expect(vault.files.get(citationStorePath('q-pdf'))).toBe(
      snapshot.get(citationStorePath('q-pdf')),
    );
  });

  it("the file's extracted text moves with it, so a successor waiting for that text finds it at the new path", async () => {
    const { vault, h } = await pdfSeeded();
    const units: ExtractedUnit[] = [
      {
        text: 'Invented slide text for page 2.',
        provenance: { sourcePath: PDF, location: { page: 2 } },
      },
    ];
    const hash = await hashContent(PDF_BYTES);
    await h.trigger.onSourceUnitsLanded(
      vault,
      { enqueue: async () => undefined, suspend: async () => undefined },
      units,
      new Map([[PDF, hash]]),
    );
    expect(h.trigger.landedSourceText(PDF, hash, 2)).toBe('Invented slide text for page 2.');
    await renamePdfAsSeen(vault, h);
    expect(h.trigger.landedSourceText(PDF_RENAMED, hash, 2)).toBe(
      'Invented slide text for page 2.',
    );
    expect(h.trigger.landedSourceText(PDF, hash, 2)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Claim 2: an outage while a revision job waits
// ---------------------------------------------------------------------------------------------

const NOTE = 'Course A/Week 3.md';
const TOPIC = 'Invented lecture topic';
const NOTE_PROSE_BEFORE =
  'The invented kalomi rule holds when the sarute pressure stays below the venido line.';
const NOTE_PROSE_AFTER =
  'The invented kalomi rule fails once the sarute pressure rises above the venido line.';
const DEVICE = 'olea-devicea0001';

function noteWith(prose: string): string {
  return [
    '---',
    `topic: [${TOPIC}]`,
    'course: COURSEA',
    '---',
    '',
    prose,
    '',
    '```olea-mcq',
    'id: q-note',
    'stem: Which invented statement about the kalomi rule holds?',
    'answer: Alpha',
    'distractor: Beta',
    'distractor: Gamma',
    'distractor: Delta',
    'distractor: Epsilon',
    '```',
    '',
  ].join('\n');
}

interface OutageSetup {
  readonly vault: MemoryVault;
  readonly engine: Awaited<ReturnType<typeof buildIngestionRunner>>['engine'];
  readonly cache: ReturnType<typeof createVaultDraftCacheStore>;
}

/**
 * A generated question citing its own note (whole-note grain), baselined by one citation pass; the
 * note is then edited and the next pass's judge confirms the change, so the pass suspends the
 * question and puts its successor job on the production queue, as `main.ts`'s
 * `citationRevisionActions` do (the engine's own `enqueue`, the vault suspend port).
 */
async function suspendedWithJobQueued(
  draftDeps: () => DraftQuizCardsDeps | null,
): Promise<OutageSetup> {
  const vault = new MemoryVault();
  vault.files.set(NOTE, noteWith(NOTE_PROSE_BEFORE));
  vault.files.set(
    '.olea/citations/q-note.json',
    `${JSON.stringify({ instrumentId: 'q-note', sourcePath: NOTE, page: 1, schemaVersion: 2 })}\n`,
  );
  const host = new FakeDataHost();
  const cache = createVaultDraftCacheStore(vault);
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new ObsidianQueueStore(host),
    capability: { canDrain: true },
    revision: { cache, draftDeps },
  });
  const judge: RevisionJudgePort = {
    judge: vi.fn(async () => ({ material: true, reason: 'scripted' })),
  };
  const trigger = new CitationRevisionTrigger({
    store: new ObsidianCitationHashStore(host),
    judge,
    clock: { now: () => Date.now() },
    transcriptPartGrain: true,
  });
  const suspendPort = createVaultSuspendPort(vault, DEVICE);
  const actions: CitationRevisionActions = {
    enqueue: (input: EnqueueInput) => engine.enqueue(input),
    suspend: (instrumentId, conceptIds) => suspendPort.suspend(instrumentId, conceptIds),
  };
  await trigger.tick(vault, actions);
  vault.files.set(NOTE, noteWith(NOTE_PROSE_AFTER));
  await trigger.tick(vault, actions);
  return { vault, engine, cache };
}

function revisionJob(setup: OutageSetup): PersistedJob | undefined {
  return setup.engine
    .list()
    .find((job) => (job.payload as { kind?: unknown } | null)?.kind === 'instrument-revision');
}

/** Drains the queue as the plugin's interval does, two hours apart each time, past every backoff. */
async function drainThroughOutage(setup: OutageSetup, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await setup.engine.tick();
  }
}

async function predecessorSuspended(vault: MemoryVault): Promise<boolean> {
  const { entries } = await readReviewLogHistory(vault);
  return suspendedInstrumentIds(entries).has('q-note');
}

// The real drafting call (`draftQuizCardsForConcept`, which the revision runner calls when no
// drafting function is injected, as in production) over a course-scoped index holding the note's
// prose, an embedding provider and a Worker transport. Every vector is the same unit vector, so the
// note's block is the best match at cosine 1 whenever the embeddings arrive.

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

const keywordIndex: PersistedKeywordIndex = {
  version: 1,
  documents: [
    {
      path: NOTE,
      courses: ['COURSEA'],
      contentHash: 'invented',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: `${TOPIC}. ${NOTE_PROSE_AFTER}` }],
    },
  ],
} as unknown as PersistedKeywordIndex;

async function realDraftDeps(
  transport: { send(request: WorkerTaskRequest): Promise<unknown> },
  embeddingsReachable: () => boolean,
): Promise<DraftQuizCardsDeps> {
  const provider: EmbeddingProvider = {
    embed: async (request) => {
      if (!embeddingsReachable()) throw new TypeError('Failed to fetch');
      return { vectors: request.texts.map(() => [1, 0, 0]) };
    },
  };
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'invented-embedding-model',
  });
  return {
    retrieve: { keywordIndex, embeddingCache, embeddingProvider: provider },
    transport,
  } as DraftQuizCardsDeps;
}

const STAMP = { contractVersion: 1, promptVersion: '1.0.0', modelId: 'invented-model' };
const SUPPORTED = { ok: true, stamp: STAMP, result: { supported: true, reason: 'scripted' } };
const NOT_SUPPORTED = { ok: true, stamp: STAMP, result: { supported: false, reason: 'scripted' } };
const JUDGE_ERROR = { ok: false, code: 'upstream-error', message: 'invented upstream failure' };
const DRAFTED = {
  ok: true,
  stamp: STAMP,
  result: {
    questions: [
      {
        stem: 'Which invented statement about the kalomi rule holds now?',
        correctAnswer: 'It fails above the venido line',
        distractors: ['It holds above the line', 'It never holds', 'It always holds'],
        feedback: 'Invented feedback.',
      },
    ],
  },
};

/**
 * What the Worker does, switchable mid-test:
 *  - `none`: no Worker configured (`draftDeps()` answers `null`);
 *  - `unreachable`: configured, and nothing reaches it (embeddings and every task call fail);
 *  - `generation-unreachable`: the embeddings and the judge are answered, the generation call fails;
 *  - `up`, `rejects`, `judge-errors`: reachable, and the judge supports, rejects or answers an error.
 */
type WorkerState =
  | 'none'
  | 'unreachable'
  | 'generation-unreachable'
  | 'up'
  | 'rejects'
  | 'judge-errors';

async function scriptedWorker(initial: WorkerState) {
  let state: WorkerState = initial;
  const transport = {
    send: vi.fn(async (request: WorkerTaskRequest): Promise<unknown> => {
      if (state === 'none' || state === 'unreachable') throw new TypeError('Failed to fetch');
      if (request.taskId === 'grounding.judge.v1') {
        if (state === 'rejects') return NOT_SUPPORTED;
        if (state === 'judge-errors') return JUDGE_ERROR;
        return SUPPORTED;
      }
      if (state === 'generation-unreachable') throw new TypeError('Failed to fetch');
      return DRAFTED;
    }),
  };
  const deps = await realDraftDeps(transport, () => state !== 'unreachable' && state !== 'none');
  const sent = (taskId: string): number =>
    transport.send.mock.calls.filter(([request]) => request.taskId === taskId).length;
  return {
    draftDeps: (): DraftQuizCardsDeps | null => (state === 'none' ? null : deps),
    set: (next: WorkerState) => {
      state = next;
    },
    judgeCalls: () => sent('grounding.judge.v1'),
    generationCalls: () => sent('quiz.generate.v1'),
  };
}

/** More drains than the queue's attempt cap allows counted retries. */
const OUTLASTS_THE_CAP = MAX_ATTEMPTS + 4;

describe('claim 2: an outage while a revision job waits (ol-egov.141.89.5.111)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the citation pass suspends the question and puts one revision job on the production queue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const setup = await suspendedWithJobQueued(() => null);
    expect(await predecessorSuspended(setup.vault)).toBe(true);
    const job = revisionJob(setup);
    expect(job?.status).toBe('queued');
    expect(job?.payload).toMatchObject({
      kind: 'instrument-revision',
      predecessorInstrumentId: 'q-note',
    });
  });

  it('with no Worker configured, the job waits through the outage, uncounted, instead of failing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const setup = await suspendedWithJobQueued(() => null);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).toBe('deferred');
    expect(revisionJob(setup)?.attempts).toBe(0);
  });

  it('a transport failure on the generation call: the job waits through the outage, uncounted, and the judge is asked once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    // The Worker answers the grounding judge and the embeddings; the generation call never arrives.
    const worker = await scriptedWorker('generation-unreachable');
    const setup = await suspendedWithJobQueued(worker.draftDeps);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).toBe('deferred');
    expect(revisionJob(setup)?.attempts).toBe(0);
    expect(worker.generationCalls()).toBe(12);
    expect(worker.judgeCalls()).toBe(1);
  });

  it('a Worker configured but unreachable through the real drafting call: the job waits, uncounted, and nothing reads it as a refusal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    // The Worker is configured and unreachable: the embeddings and every task call fail.
    const worker = await scriptedWorker('unreachable');
    const setup = await suspendedWithJobQueued(worker.draftDeps);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).toBe('deferred');
    expect(revisionJob(setup)?.attempts).toBe(0);
    expect(worker.judgeCalls()).toBe(0);
  });

  it.each([
    ['no Worker configured', 'none', 1],
    ['the generation call unreachable', 'generation-unreachable', 1],
    ['the Worker unreachable', 'unreachable', 1],
  ] as const)(
    'an outage outlasting the attempt cap (%s): once the Worker is back the job completes and its successor is drafted',
    async (_label, outage, judgeCalls) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
      const worker = await scriptedWorker(outage);
      const setup = await suspendedWithJobQueued(worker.draftDeps);
      await drainThroughOutage(setup, OUTLASTS_THE_CAP);
      expect(revisionJob(setup)).toMatchObject({ status: 'deferred', attempts: 0 });
      expect(await setup.cache.listPending()).toEqual([]);

      worker.set('up');
      await drainThroughOutage(setup, 1);
      expect(revisionJob(setup)?.status).toBe('done');
      const drafts = await setup.cache.listPending();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ predecessorInstrumentId: 'q-note', courseCode: 'COURSEA' });
      // The judge was asked once in all: a held answer covers every retry of the same request.
      expect(worker.judgeCalls()).toBe(judgeCalls);
      expect(await predecessorSuspended(setup.vault)).toBe(true);
    },
  );

  it('a genuine refusal still fails the job on its first attempt, as before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const worker = await scriptedWorker('rejects');
    const setup = await suspendedWithJobQueued(worker.draftDeps);
    await drainThroughOutage(setup, 1);
    const job = revisionJob(setup);
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(1);
    expect(job?.failedReason).toContain('the grounded draft was refused');
    expect(worker.generationCalls()).toBe(0);
  });

  it('an outage, then a genuine refusal once the Worker is back: the job fails then, with the refusal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const worker = await scriptedWorker('unreachable');
    const setup = await suspendedWithJobQueued(worker.draftDeps);
    await drainThroughOutage(setup, OUTLASTS_THE_CAP);
    worker.set('rejects');
    await drainThroughOutage(setup, 1);
    expect(revisionJob(setup)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(revisionJob(setup)?.failedReason).toContain('the grounded draft was refused');
  });

  it('a judge that answers with an error is neither an outage nor a refusal: a counted retry, bounded by the cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const worker = await scriptedWorker('judge-errors');
    const setup = await suspendedWithJobQueued(worker.draftDeps);
    await drainThroughOutage(setup, 1);
    expect(revisionJob(setup)).toMatchObject({ status: 'deferred', attempts: 1 });
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS + 1,
      failedReason: `attempt cap reached (${MAX_ATTEMPTS} attempts)`,
    });
    expect(worker.generationCalls()).toBe(0);
  });
});
