// `ol-egov.141.89.5.108` ([D-508]): a rewritten question's successor draft that the session sets
// aside because the transcript or file it cites changed, or was renamed, after it was drafted and
// before she answered it, goes back to the revision job and is drafted again against the source as
// it stands, so the question does not vanish. Through the production pieces: the citation pass
// queues the rewrite into a real work queue, the revision job runner drains it, the session's
// presentation check sets the draft aside and hands it to `redraftSetAsideSuccessor`, the queue
// drains the job again, and the new draft is presented, accepted and seeded. The loop bound is
// shown. Every transcript, file, course and sentence is invented ("course A"); nothing comes from
// a real vault. No Worker is called: drafting is injected and goes through the runner's own
// transport only to show what it sent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  appendSuspendRecord,
  citationStorePath,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  IngestionQueueEngine,
  type InstrumentRevisionJobPayload,
  MAX_ATTEMPTS,
  type PersistedQueue,
  type QueueStore,
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
  REVISION_JOBS_PER_PREDECESSOR_MAX,
  redraftSetAsideSuccessor,
  type SetAsideRedraft,
} from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import {
  type CitationRevisionActions,
  citedSourceNowFrom,
} from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../src/review/open-session.js';
import {
  bytesHashOf,
  citeTranscriptPart,
  cue,
  type Harness,
  harness,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  sidecar,
  spoken,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const MOVED = 'Course A/Lecture 3/renamed transcript.txt';
const MARKDOWN = 'Course A/Lecture 3/transcript.md';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';
const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides (Olea).md';

/** A Markdown file that declares itself a lecture transcript. */
function declared(cues: readonly string[]): string {
  return `---\nrole: lecture transcript\n---\n\n${transcriptOf(cues)}`;
}

/** `cues` with one invented word of cue `k` replaced, so the change stays inside that cue's part. */
function correctedAt(cues: readonly string[], k: number, word: number, replacement: number) {
  const next = [...cues];
  next[k] = (next[k] as string).replace(
    inventedWord(k * 40 + word + 17),
    inventedWord(replacement),
  );
  return next;
}

function question(n: number) {
  return {
    stem: `Which invented statement holds after the correction (${n})?`,
    correctAnswer: 'Alpha',
    distractors: ['Beta', 'Gamma', 'Delta'],
    feedback: 'Invented feedback.',
  };
}

/**
 * Drafting injected as the production function shapes it: one generation request through the
 * runner's transport (where the runner puts its passage first) with two retrieved chunks, answered
 * with `questions` invented questions. Records every request the transport carried.
 */
function recordingDrafter(questions = 1) {
  const sent: WorkerTaskRequest[] = [];
  const response = {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: { questions: Array.from({ length: questions }, (_, n) => question(n)) },
  };
  const draftDeps = {
    transport: {
      send: async (request: WorkerTaskRequest) => {
        sent.push(request);
        return response;
      },
    },
  } as unknown as DraftQuizCardsDeps;
  const draftForConcept = vi.fn(
    async (
      deps: DraftQuizCardsDeps,
      request: DraftQuizCardsRequest,
    ): Promise<DraftQuizCardsResult> => {
      const sourceChunks = ['retrieved one', 'retrieved two'];
      const reply = await deps.transport.send({
        taskId: 'quiz.generate.v1',
        payload: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
      } as unknown as WorkerTaskRequest);
      return {
        status: 'drafted',
        // `ol-egov.141.89.2.39` ([D-628]): the retrieved chunks here are fabricated text from no note.
        inputNotes: [],
        request: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
        response: reply,
      };
    },
  );
  /** The first chunk of each generation request, in order: the passage each draft was drafted from. */
  const draftedFrom = (): string[] =>
    sent
      .filter((request) => request.taskId === 'quiz.generate.v1')
      .map((request) => (request.payload as { sourceChunks: string[] }).sourceChunks[0] as string);
  return { draftDeps, draftForConcept, draftedFrom };
}

class MemoryQueueStore implements QueueStore {
  constructor(private state: PersistedQueue | null = null) {}
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

interface World {
  readonly vault: MemoryVault;
  readonly h: Harness;
  readonly cache: DraftCacheStore;
  readonly engine: IngestionQueueEngine;
  readonly drafter: ReturnType<typeof recordingDrafter>;
  readonly port: CitedSourceNow;
  /** What the re-arm answered, in order, for every draft the session set aside. */
  readonly redrafts: SetAsideRedraft[];
  /** Presents every pending draft once, as an opened session does; returns each outcome by draft id. */
  present(): Promise<ReadonlyMap<string, 'clear' | 'check-failed'>>;
  /** Runs every job that can run now, as the plugin's queue tick does. */
  drain(): Promise<void>;
  /** The revision jobs the queue holds for the question. */
  jobsFor(instrumentId: string): readonly InstrumentRevisionJobPayload[];
}

/**
 * A real work queue whose runner is the production revision runner, fed by the citation pass's own
 * enqueue, and a presentation check wired to the re-arm as `open-session.ts` wires it.
 */
async function worldOver(vault: MemoryVault, h: Harness, questions = 1): Promise<World> {
  const cache = createVaultDraftCacheStore(vault);
  const drafter = recordingDrafter(questions);
  const port = citedSourceNowFrom(() => h.trigger);
  let instant = Date.parse('2026-10-05T09:00:00Z');
  const engine = await IngestionQueueEngine.create({
    store: new MemoryQueueStore(),
    capability: { canDrain: true },
    clock: {
      now: () => {
        instant += 60_000;
        return instant;
      },
    },
    runner: createRevisionAwareJobRunner({
      vault,
      cache,
      draftDeps: () => drafter.draftDeps,
      draftForConcept: drafter.draftForConcept,
      citedSourceNow: port,
      fallback: async () => ({ ok: false, retryable: false, reason: 'not a revision job' }),
    }),
  });
  h.actions.enqueue.mockImplementation((input: EnqueueInput) => engine.enqueue(input));
  const redrafts: SetAsideRedraft[] = [];
  const redraft = async (draft: DraftRecord): Promise<void> => {
    redrafts.push(
      await redraftSetAsideSuccessor(
        {
          vault,
          cache,
          jobs: () => engine.list(),
          enqueue: (input) => engine.enqueue(input),
          citedSourceNow: port,
        },
        draft,
      ),
    );
  };
  return {
    vault,
    h,
    cache,
    engine,
    drafter,
    port,
    redrafts,
    present: async () => {
      const pending = await cache.listPending();
      const check = draftSourceCheckAtPresentation(vault, pending, redraft);
      const outcomes = new Map<string, 'clear' | 'check-failed'>();
      for (const draft of pending) outcomes.set(draft.draftId, await check(draft.draftId));
      return outcomes;
    },
    drain: async () => {
      for (let tick = 0; tick < 50; tick += 1) {
        if ((await engine.tick()).kind !== 'ran') return;
      }
      throw new Error('the queue did not settle');
    },
    jobsFor: (instrumentId) =>
      engine
        .list()
        .map((job) => job.payload as InstrumentRevisionJobPayload)
        .filter((payload) => payload.predecessorInstrumentId === instrumentId),
  };
}

/**
 * A question drafted from part 4 of a transcript at `path`, rewritten after a correction inside
 * that part, and its first successor drafted by the queue. Returns the world, the cues as of the
 * rewrite and that first successor.
 */
async function draftedSuccessor(
  path: string,
  render: (cues: readonly string[]) => string,
  questions = 1,
) {
  const vault = new MemoryVault();
  vault.files.set(path, render(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', ['q-four']));
  await citeTranscriptPart(vault, 'q-four', path, 4);
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  const w = await worldOver(vault, h, questions);
  const cues = correctedAt(LECTURE, 10, 3, 4010);
  vault.files.set(path, render(cues));
  await h.pass(vault);
  expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
  await w.drain();
  const drafted = await w.cache.listPending();
  expect(drafted).toHaveLength(questions);
  const [first] = drafted;
  if (first === undefined) throw new Error('no successor');
  expect(first.sourceCitation?.sourceRevision).toBe(await bytesHashOf(render(cues)));
  // Presented as it stands: nothing set aside, nothing queued.
  expect([...(await w.present()).values()]).toEqual(drafted.map(() => 'clear'));
  expect(w.redrafts).toEqual([]);
  return { w, cues, first };
}

/** The session's presentation-time check for a written instrument, as `open-session.ts` builds it. */
async function presented(vault: MemoryVault, h: Harness, instrumentId: string) {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  return sourceCheckAtPresentation(
    h.store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
  )(instrumentId);
}

/**
 * She sees it: the draft is presented (not set aside), accepting it writes it, the next pass seeds
 * it with no hold, the session presents it, and the old question stays withheld.
 */
async function reachesHer(w: World, record: DraftRecord, home = HOME): Promise<string> {
  expect((await w.present()).get(record.draftId)).toBe('clear');
  if (record.question === undefined) throw new Error('not a question draft');
  const { instrumentId } = await materializeAcceptedDraft(w.vault, {
    sourcePath: home,
    question: record.question,
    draftId: record.draftId,
    ...(record.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
  });
  await w.h.pass(w.vault);
  expect((await w.h.store.loadAll()).get(instrumentId)?.pendingRevalidation).toBeUndefined();
  expect(await w.h.withheld([instrumentId])).toEqual(new Set());
  expect(await presented(w.vault, w.h, instrumentId)).toBe('clear');
  const predecessor = record.predecessorInstrumentId as string;
  expect(await w.h.withheld([predecessor])).toEqual(new Set([predecessor]));
  return instrumentId;
}

/** The pending draft other than those named. */
async function newest(w: World, ...not: readonly DraftRecord[]): Promise<DraftRecord> {
  const ids = new Set(not.map((record) => record.draftId));
  const found = (await w.cache.listPending()).filter((record) => !ids.has(record.draftId));
  expect(found).toHaveLength(1);
  const [record] = found;
  if (record === undefined) throw new Error('no new successor');
  return record;
}

describe('a transcript changed or renamed after the successor was drafted (ol-egov.141.89.5.108)', () => {
  it('plain text, changed inside the passage: set aside, drafted again from the passage as it reads now, and it reaches her', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    const now = correctedAt(cues, 10, 5, 4011);
    w.vault.files.set(TRANSCRIPT, transcriptOf(now));

    expect(await w.present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['queued']);
    await w.drain();

    const second = await newest(w, first);
    expect(w.drafter.draftForConcept).toHaveBeenCalledTimes(2);
    expect(w.drafter.draftedFrom().at(-1)).toBe(spoken(now.slice(9, 12)));
    expect(second.predecessorInstrumentId).toBe('q-four');
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(second.sourceCitation).toEqual({
      sourcePath: TRANSCRIPT,
      page: 4,
      sourceRevision: await bytesHashOf(transcriptOf(now)),
    });
    await reachesHer(w, second);
  });

  it('plain text, changed elsewhere: drafted again citing the version that stands now', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    const now = [...cues, cue(93)];
    w.vault.files.set(TRANSCRIPT, transcriptOf(now));

    await w.present();
    await w.drain();
    const second = await newest(w, first);
    expect(w.drafter.draftedFrom().at(-1)).toBe(spoken(cues.slice(9, 12)));
    expect(second.sourceCitation?.sourceRevision).toBe(await bytesHashOf(transcriptOf(now)));
    await reachesHer(w, second);
  });

  it('declared Markdown, changed: drafted again against the version that stands now, and it reaches her', async () => {
    const { w, cues, first } = await draftedSuccessor(MARKDOWN, declared);
    const now = correctedAt(cues, 10, 5, 4011);
    w.vault.files.set(MARKDOWN, declared(now));

    expect(await w.present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['queued']);
    await w.drain();
    const second = await newest(w, first);
    expect(w.drafter.draftedFrom().at(-1)).toBe(spoken(now.slice(9, 12)));
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(second.sourceCitation).toEqual({
      sourcePath: MARKDOWN,
      page: 4,
      sourceRevision: await bytesHashOf(declared(now)),
    });
    await reachesHer(w, second);
  });

  it('plain text, renamed (a rename Olea saw): the pending successor follows the rename and reaches her, nothing drafted again', async () => {
    // `ol-egov.141.89.2.39` ([D-626], [D-628], [D-576]): the transcript is one of the successor's
    // input notes, so a rename Olea saw moves the draft's input note and the citation naming it; the
    // rename alone no longer sets it aside, and nothing is queued.
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    w.vault.move(TRANSCRIPT, MOVED);
    expect(await w.h.trigger.onSourceRenamed(w.vault, TRANSCRIPT, MOVED)).toBeGreaterThan(0);

    expect(await w.present()).toEqual(new Map([[first.draftId, 'clear']]));
    expect(w.redrafts).toEqual([]);
    const moved = await w.cache.get(first.draftId);
    expect(moved?.sourceCitation).toEqual({
      sourcePath: MOVED,
      page: 4,
      sourceRevision: await bytesHashOf(transcriptOf(cues)),
    });
    expect(moved?.inputNotes?.map((note) => note.path)).toEqual([MOVED]);
    if (moved === null) throw new Error('the successor went missing');
    const successor = await reachesHer(w, moved);
    expect((await w.h.store.loadAll()).get(successor)?.sourcePath).toBe(MOVED);
  });
});

const bytes = (version: string): Uint8Array =>
  new TextEncoder().encode(`invented slide bytes, ${version}`);

function slideUnit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

/** The page text of the bytes `version` lands, as the changed file's extraction delivers it. */
async function landSlide(w: World, version: string): Promise<void> {
  await w.h.trigger.onSourceUnitsLanded(
    w.vault,
    w.h.actions as unknown as CitationRevisionActions,
    [slideUnit(2, `Invented page two text, ${version}.`)],
    new Map([[PDF, await bytesHashOf(`invented slide bytes, ${version}`)]]),
  );
}

/**
 * A question on page 2 of an invented PDF, held when the file changed to `v1`, rewritten when that
 * version's text landed, and its first successor drafted by the queue from that text.
 */
async function draftedSlideSuccessor() {
  const vault = new MemoryVault();
  vault.files.set(PDF_HOME, homeNote('Invented slide topic', ['q-slide']));
  vault.binaries.set(PDF, bytes('v0'));
  vault.files.set(
    citationStorePath('q-slide'),
    sidecar({
      instrumentId: 'q-slide',
      sourcePath: PDF,
      page: 2,
      sourceRevision: await bytesHashOf('invented slide bytes, v0'),
    }),
  );
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  const w = await worldOver(vault, h);
  vault.binaries.set(PDF, bytes('v1'));
  await h.pass(vault);
  await landSlide(w, 'v1');
  expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-slide']);
  await w.drain();
  const [first] = await w.cache.listPending();
  if (first === undefined) throw new Error('no successor');
  expect(first.sourceCitation).toEqual({
    sourcePath: PDF,
    page: 2,
    sourceRevision: await bytesHashOf('invented slide bytes, v1'),
  });
  return { w, first };
}

describe('a binary source changed after the successor was drafted (ol-egov.141.89.5.108)', () => {
  it('its new text has landed: set aside, drafted again from the page as it reads now, and it reaches her', async () => {
    const { w, first } = await draftedSlideSuccessor();
    w.vault.binaries.set(PDF, bytes('v2'));
    await landSlide(w, 'v2');

    expect(await w.present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['queued']);
    await w.drain();
    const second = await newest(w, first);
    expect(w.drafter.draftedFrom().at(-1)).toBe('Invented page two text, v2.');
    expect(second.sourceCitation).toEqual({
      sourcePath: PDF,
      page: 2,
      sourceRevision: await bytesHashOf('invented slide bytes, v2'),
    });
    await reachesHer(w, second, PDF_HOME);
  });

  it('its new text has not landed: the job waits without drafting, and presenting again queues nothing more', async () => {
    const { w, first } = await draftedSlideSuccessor();
    w.vault.binaries.set(PDF, bytes('v2'));

    await w.present();
    expect(w.redrafts).toEqual(['queued']);
    expect((await w.engine.tick()).kind).toBe('ran');
    expect(w.drafter.draftForConcept).toHaveBeenCalledTimes(1);
    expect(await w.cache.listPending()).toEqual([first]);

    await w.present();
    await w.present();
    expect(w.redrafts).toEqual(['queued', 'job-waiting', 'job-waiting']);
    expect(w.jobsFor('q-slide')).toHaveLength(2);
  });
});

describe('no loop (ol-egov.141.89.5.108)', () => {
  it('presented again and again at one version: one job, one more drafting call', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));

    for (let sitting = 0; sitting < 4; sitting += 1) await w.present();
    expect(w.redrafts).toEqual(['queued', 'job-waiting', 'job-waiting', 'job-waiting']);
    await w.drain();
    const second = await newest(w, first);
    for (let sitting = 0; sitting < 4; sitting += 1) {
      expect(await w.present()).toEqual(
        new Map([
          [first.draftId, 'check-failed'],
          [second.draftId, 'clear'],
        ]),
      );
    }
    await w.drain();
    expect(w.redrafts.slice(4)).toEqual(Array.from({ length: 4 }, () => 'drafted-for-source-now'));
    expect(w.jobsFor('q-four')).toHaveLength(2);
    expect(w.drafter.draftForConcept).toHaveBeenCalledTimes(2);
  });

  it('a transcript that keeps changing after every draft: at most the bound of jobs and drafting calls, then nothing more is queued', async () => {
    const { w, cues } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    expect(REVISION_JOBS_PER_PREDECESSOR_MAX).toBeLessThanOrEqual(MAX_ATTEMPTS);
    const rounds = REVISION_JOBS_PER_PREDECESSOR_MAX + 3;
    for (let round = 1; round <= rounds; round += 1) {
      w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(100 + round)]));
      await w.present();
      await w.drain();
    }
    expect(w.jobsFor('q-four')).toHaveLength(REVISION_JOBS_PER_PREDECESSOR_MAX);
    expect(w.drafter.draftForConcept).toHaveBeenCalledTimes(REVISION_JOBS_PER_PREDECESSOR_MAX);
    expect(w.redrafts.filter((outcome) => outcome === 'queued')).toHaveLength(
      REVISION_JOBS_PER_PREDECESSOR_MAX - 1,
    );
    expect(w.redrafts.at(-1)).toBe('bound-reached');
    // At the bound every draft stays set aside, as before this change.
    expect(new Set((await w.present()).values())).toEqual(new Set(['check-failed']));
    await w.drain();
    expect(w.drafter.draftForConcept).toHaveBeenCalledTimes(REVISION_JOBS_PER_PREDECESSOR_MAX);
  });
});

describe('not drafted again (ol-egov.141.89.5.108)', () => {
  it('she unsuspended the old question: set aside, nothing queued ([D-536])', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    await appendSuspendRecord(
      w.vault,
      {
        kind: 'unsuspend',
        timestamp: '2026-10-02T09:00:00Z',
        instrumentId: 'q-four',
        conceptIds: ['invented-concept'],
      },
      { deviceId: 'device-synthetic' },
    );
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));
    expect(await w.present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['settled']);
    expect(w.jobsFor('q-four')).toHaveLength(1);
  });

  it('she has already resolved one of its successors: the other is set aside, nothing queued', async () => {
    const { w, cues } = await draftedSuccessor(TRANSCRIPT, transcriptOf, 2);
    const [answered, other] = await w.cache.listPending();
    if (answered === undefined || other === undefined) throw new Error('two successors expected');
    await w.cache.put({ ...answered, status: 'accepted' });
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));
    expect(await w.present()).toEqual(new Map([[other.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['settled']);
    expect(w.jobsFor('q-four')).toHaveLength(1);
  });

  it('renamed where Olea did not see it: nothing to draft against, so nothing queued', async () => {
    const { w, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    w.vault.move(TRANSCRIPT, MOVED);
    expect(await w.present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(w.redrafts).toEqual(['source-unread']);
    expect(w.jobsFor('q-four')).toHaveLength(1);
  });

  it('the source stands as cited, or no job is on record: nothing queued', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    const deps = {
      vault: w.vault,
      cache: w.cache,
      jobs: () => w.engine.list(),
      enqueue: (input: EnqueueInput) => w.engine.enqueue(input),
      citedSourceNow: w.port,
    };
    expect(await redraftSetAsideSuccessor(deps, first)).toBe('source-unchanged');
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));
    expect(await redraftSetAsideSuccessor({ ...deps, jobs: () => [] }, first)).toBe('no-job');
    const { predecessorInstrumentId: _, ...sweepDraft } = first;
    expect(await redraftSetAsideSuccessor(deps, sweepDraft)).toBe('not-a-successor');
    expect(w.jobsFor('q-four')).toHaveLength(1);
  });

  it('the presentation check hands over only a successor, and a failing hand-over leaves the draft set aside', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));
    const { predecessorInstrumentId: _, ...sweepDraft } = first;
    const handOver = vi.fn(async () => undefined);
    expect(
      await draftSourceCheckAtPresentation(w.vault, [sweepDraft], handOver)(first.draftId),
    ).toBe('check-failed');
    expect(handOver).not.toHaveBeenCalled();
    const failing = vi.fn(async () => {
      throw new Error('invented failure');
    });
    expect(await draftSourceCheckAtPresentation(w.vault, [first], failing)(first.draftId)).toBe(
      'check-failed',
    );
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe('production composition (ol-egov.141.89.5.108)', () => {
  it('the ingestion wiring composes the hand-over over its own queue, with the runner it composes', async () => {
    const { w, cues, first } = await draftedSuccessor(TRANSCRIPT, transcriptOf);
    const wiring = await buildIngestionRunner({
      vault: w.vault,
      queueStore: new MemoryQueueStore({ version: 1, jobs: w.engine.list(), headroom: null }),
      capability: { canDrain: false },
      revision: { cache: w.cache, draftDeps: () => null, citedSourceNow: w.port },
    });
    w.vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));
    if (wiring.redraftSetAsideSuccessor === undefined) throw new Error('not composed');
    await wiring.redraftSetAsideSuccessor(first);
    const jobs = wiring.engine
      .list()
      .filter(
        (job) => (job.payload as InstrumentRevisionJobPayload).predecessorInstrumentId === 'q-four',
      );
    expect(jobs.map((job) => job.status)).toEqual(['done', 'queued']);
    expect(jobs[1]?.payload).toEqual(jobs[0]?.payload);
  });

  // `main.ts` cannot be imported under Vitest (see `transcript-wiring.ol-egov.141.89.8.55.spec.ts`),
  // so its wiring is read from its source with prose removed, as `ol-egov.141.89.5.107`'s spec does.
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it("main.ts hands the review session the ingestion wiring's hand-over", () => {
    const main = source('../../src/main.ts');
    const start = main.indexOf('private async buildReviewSessionInput()');
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n  }\n', start));
    expect(body).toContain('redraftSetAsideSuccessor: async (draft) => {');
    expect(body).toContain('await this.ingestion?.redraftSetAsideSuccessor?.(draft);');
  });

  it("open-session.ts passes it to the drafts' presentation check", () => {
    const session = source('../../src/review/open-session.ts');
    expect(session.replace(/\s+/g, ' ')).toContain(
      // `ol-egov.141.89.2.39` (finding F): `ol-zjke.2`'s citation store (a draft held for a correction is set aside
      // too), then what it reads each draft afresh through.
      'checkDraftSourceAtPresentation: draftSourceCheckAtPresentation( input.vault, pendingDrafts, input.redraftSetAsideSuccessor, input.citationHashStore, { ...(input.draftCache ? { cache: input.draftCache } : {}), pathNow }, )',
    );
  });
});
