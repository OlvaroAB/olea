// `ol-egov.141.89.5.111`: two findings from code reading (discovered by ol-egov.141.89.5.107), each
// shown or disproved here through the production construction.
//
// 1. A renamed PDF or other binary source is never followed: its questions stay withheld, while a
//    renamed lecture transcript is followed through `onSourceRenamed` (`main.ts`'s vault rename
//    handler calls it, as these tests do).
// 2. A missing Worker or a transport failure counts against the queue's attempts on a revision job,
//    so an outage can fail the job and leave the old question suspended with nothing replacing it.
//    The job is put on the queue by the citation pass itself and drained by `buildIngestionRunner`,
//    the runner chain `main.ts` drains.
//
// A finding that holds is pinned with `it.fails`, its name saying what is wrong, so it turns red
// once the behaviour is fixed and is then flipped to a plain `it`. Each was run once as a plain test
// and failed on its own assertion. Every course, lecture, file and sentence here is invented.
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  hashContent,
  type PersistedEmbeddingCache,
  type PersistedJob,
  type PersistedKeywordIndex,
  type RevisionJudgePort,
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

  it('a renamed PDF: onSourceRenamed moves nothing (it follows transcripts only)', async () => {
    const { vault, h } = await pdfSeeded();
    expect(await renamePdfAsSeen(vault, h)).toBe(0);
  });

  it.fails('[defect ol-egov.141.89.5.111: a renamed PDF is never followed] a PDF renamed while Olea runs, bytes unchanged, is still served at the new path after the next pass', async () => {
    const { vault, h } = await pdfSeeded();
    await renamePdfAsSeen(vault, h);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
  });

  it.fails('[defect ol-egov.141.89.5.111: a renamed PDF is never followed] once the renamed file is extracted at its new path, its question is served again', async () => {
    const { vault, h } = await pdfSeeded();
    await renamePdfAsSeen(vault, h);
    await h.pass(vault);
    await pdfUnitsLandAtNewPath(vault, h);
    await h.pass(vault);
    expect(await h.withheld(['q-pdf'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-pdf')).toBe('clear');
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
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new ObsidianQueueStore(host),
    capability: { canDrain: true },
    revision: { cache: createVaultDraftCacheStore(vault), draftDeps },
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
  return { vault, engine };
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
  embeddingsReachable: boolean,
): Promise<DraftQuizCardsDeps> {
  const provider: EmbeddingProvider = {
    embed: async (request) => {
      if (!embeddingsReachable) throw new TypeError('Failed to fetch');
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

const SUPPORTED = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'invented-model' },
  result: { supported: true, reason: 'scripted' },
};

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

  it.fails('[defect ol-egov.141.89.5.111: with no Worker configured, every drain spends one of the queue attempts, and the job fails at the attempt cap] the job waits through the outage instead of failing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const setup = await suspendedWithJobQueued(() => null);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).not.toBe('failed');
  });

  it.fails('[defect ol-egov.141.89.5.111: a transport failure on the drafting call spends one of the queue attempts, and the job fails at the attempt cap] the job waits through the outage instead of failing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    // The Worker answers the grounding judge and the embeddings; the generation call never arrives.
    const transport = {
      send: vi.fn(async (request: WorkerTaskRequest): Promise<unknown> => {
        if (request.taskId === 'grounding.judge.v1') return SUPPORTED;
        throw new TypeError('Failed to fetch');
      }),
    };
    const deps = await realDraftDeps(transport, true);
    const setup = await suspendedWithJobQueued(() => deps);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).not.toBe('failed');
  });

  it.fails('[defect ol-egov.141.89.5.111: an unreachable Worker reads as a grounded refusal in the real drafting call, and the job fails on its first attempt, not retried] the job waits through the outage instead of failing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    // The Worker is configured and unreachable: the embeddings and every task call fail.
    const transport = {
      send: vi.fn(async (_request: WorkerTaskRequest): Promise<unknown> => {
        throw new TypeError('Failed to fetch');
      }),
    };
    const deps = await realDraftDeps(transport, false);
    const setup = await suspendedWithJobQueued(() => deps);
    await drainThroughOutage(setup, 12);
    expect(revisionJob(setup)?.status).not.toBe('failed');
  });
});
