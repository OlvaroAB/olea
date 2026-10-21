// `ol-egov.141.89.5.111`: the revision job runner tells an outage from a refusal, and a successor
// drafted from a PDF follows a rename Olea saw. Unit-level companions of the end-to-end cases in
// `test/ingestion/materiality/rename-and-outage.ol-egov.141.89.5.111.spec.ts`:
//  - every outcome of a drafting attempt that caches nothing, mapped to what the queue does with it;
//  - the judge's answer held while the generation call cannot be made, and only for that request;
//  - the demand ask counted only for an attempt that was made;
//  - a successor draft set aside after its PDF was renamed (as seen) is drafted again at the new
//    path and reaches her.
// No Worker is called. Every course, file and sentence is invented ("course A").
import {
  citationStorePath,
  DemandRoutingCounter,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  type GroundingRefusalReason,
  IngestionQueueEngine,
  type InstrumentRevisionJobPayload,
  type PersistedQueue,
  type QueueStore,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import {
  createRevisionAwareJobRunner,
  type RevisionJobRunnerDeps,
  redraftSetAsideSuccessor,
  runInstrumentRevisionJob,
  type SetAsideRedraft,
} from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import {
  type CitationRevisionActions,
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
import {
  bytesHashOf,
  harness,
  homeNote,
  MemoryVault,
  sidecar,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const NOTE = 'Course A/Week 3.md';
const PAYLOAD: InstrumentRevisionJobPayload = {
  kind: 'instrument-revision',
  predecessorInstrumentId: 'q-note',
  newPassageText: 'The invented kalomi rule fails once the sarute pressure rises.',
};
const STAMP = { contractVersion: 1, promptVersion: '1.0.0', modelId: 'invented-model' };
const SUPPORTED = { ok: true, stamp: STAMP, result: { supported: true, reason: 'scripted' } };
const DRAFTED = {
  ok: true,
  stamp: STAMP,
  result: {
    questions: [
      {
        stem: 'Which invented statement about the kalomi rule holds now?',
        correctAnswer: 'Alpha',
        distractors: ['Beta', 'Gamma', 'Delta'],
        feedback: 'Invented feedback.',
      },
    ],
  },
};
const NOT_ATTEMPTED = { ok: false, retryable: true, notAttempted: true };
const COUNTED = { ok: false, retryable: true };

/** A note holding one generated question `q-note`, citing its own note. */
function noteVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.files.set(NOTE, homeNote('Invented lecture topic', ['q-note']));
  vault.files.set(
    citationStorePath('q-note'),
    sidecar({ instrumentId: 'q-note', sourcePath: NOTE, page: 1 }),
  );
  return vault;
}

type Drafter = (
  deps: DraftQuizCardsDeps,
  request: DraftQuizCardsRequest,
) => Promise<DraftQuizCardsResult>;

/** The runner's deps over `vault`, a Worker transport that answers through `send`, and `drafter`. */
function depsFor(
  vault: MemoryVault,
  send: (request: WorkerTaskRequest) => Promise<unknown>,
  drafter: Drafter,
  extra: Partial<RevisionJobRunnerDeps> = {},
): RevisionJobRunnerDeps {
  return {
    vault,
    cache: createVaultDraftCacheStore(vault),
    draftDeps: () => ({ transport: { send } }) as unknown as DraftQuizCardsDeps,
    draftForConcept: drafter,
    ...extra,
  };
}

const refusedWith =
  (reason: GroundingRefusalReason): Drafter =>
  async () => ({ status: 'refused', reason });

/**
 * Drafting shaped as the production function is: the judge first, through the runner's transport,
 * with `context` as its passages; then, on a supported verdict, the generation call.
 */
function judgeThenGenerate(context: () => string): Drafter {
  return async (deps, request) => {
    const verdict = (await deps.transport.send({
      contractVersion: 2,
      taskId: 'grounding.judge.v1',
      payload: { query: request.conceptName, context: context() },
    })) as { result?: { supported?: boolean } };
    if (verdict.result?.supported !== true) return { status: 'refused', reason: 'judge-rejected' };
    const sourceChunks = [context()];
    const response = await deps.transport.send({
      contractVersion: 2,
      taskId: 'quiz.generate.v1',
      payload: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
    });
    return {
      status: 'drafted',
      request: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
      response,
    };
  };
}

const unreachable = async (): Promise<unknown> => {
  throw new TypeError('Failed to fetch');
};
const answering = async (request: WorkerTaskRequest): Promise<unknown> =>
  request.taskId === 'grounding.judge.v1' ? SUPPORTED : DRAFTED;

describe('what a drafting attempt that caches nothing tells the queue (ol-egov.141.89.5.111)', () => {
  it('no Worker configured: not attempted', async () => {
    const vault = noteVault();
    const outcome = await runInstrumentRevisionJob(
      { ...depsFor(vault, answering, refusedWith('no-hits')), draftDeps: () => null },
      PAYLOAD,
    );
    expect(outcome).toEqual(NOT_ATTEMPTED);
  });

  it.each([
    ['no-hits'],
    ['below-relevance-threshold'],
    ['below-composite-threshold'],
    ['below-band'],
    ['judge-rejected'],
  ] as const)('the gate refusing the successor (%s) fails the job, as before', async (reason) => {
    const outcome = await runInstrumentRevisionJob(
      depsFor(noteVault(), answering, refusedWith(reason)),
      PAYLOAD,
    );
    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('the grounded draft was refused'),
    });
  });

  it('the numeric check that could not run (composite-check-unavailable) is not attempted, whatever the transport did', async () => {
    const outcome = await runInstrumentRevisionJob(
      depsFor(noteVault(), answering, refusedWith('composite-check-unavailable')),
      PAYLOAD,
    );
    expect(outcome).toEqual(NOT_ATTEMPTED);
  });

  it('a judge that could not be read with every call answered (judge-unavailable) is a counted retry', async () => {
    const outcome = await runInstrumentRevisionJob(
      depsFor(noteVault(), answering, refusedWith('judge-unavailable')),
      PAYLOAD,
    );
    expect(outcome).toEqual(COUNTED);
  });

  it('a judge call that got no response (judge-unavailable after the transport threw) is not attempted', async () => {
    const drafter: Drafter = async (deps) => {
      await deps.transport
        .send({ contractVersion: 2, taskId: 'grounding.judge.v1', payload: {} })
        .catch(() => undefined);
      return { status: 'refused', reason: 'judge-unavailable' };
    };
    const outcome = await runInstrumentRevisionJob(
      depsFor(noteVault(), unreachable, drafter),
      PAYLOAD,
    );
    expect(outcome).toEqual(NOT_ATTEMPTED);
  });

  it('a throw with no Worker call failing is a counted retry; a throw after a call got no response is not attempted', async () => {
    const bug: Drafter = async () => {
      throw new Error('invented fault, not the Worker');
    };
    expect(await runInstrumentRevisionJob(depsFor(noteVault(), answering, bug), PAYLOAD)).toEqual(
      COUNTED,
    );
    const generationDown = judgeThenGenerate(() => 'Invented passage.');
    const send = async (request: WorkerTaskRequest) =>
      request.taskId === 'grounding.judge.v1' ? SUPPORTED : unreachable();
    expect(
      await runInstrumentRevisionJob(depsFor(noteVault(), send, generationDown), PAYLOAD),
    ).toEqual(NOT_ATTEMPTED);
  });
});

describe('the judge is not asked again while the generation call cannot be made (ol-egov.141.89.5.111)', () => {
  it('the answer is held for the identical request only, and dropped once the attempt is made', async () => {
    const vault = noteVault();
    let generationUp = false;
    const send = vi.fn(async (request: WorkerTaskRequest): Promise<unknown> => {
      if (request.taskId === 'grounding.judge.v1') return SUPPORTED;
      return generationUp ? DRAFTED : unreachable();
    });
    let context = 'Invented passage, first reading.';
    const deps = depsFor(
      vault,
      send,
      judgeThenGenerate(() => context),
    );
    const judged = () =>
      send.mock.calls.filter(([request]) => request.taskId === 'grounding.judge.v1').length;

    for (let i = 0; i < 3; i += 1) {
      expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual(NOT_ATTEMPTED);
    }
    expect(judged()).toBe(1);

    // A different request is a new question for the judge.
    context = 'Invented passage, second reading.';
    expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual(NOT_ATTEMPTED);
    expect(judged()).toBe(2);
    expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual(NOT_ATTEMPTED);
    expect(judged()).toBe(2);

    // The generation call goes through on the held answer; after that nothing is held.
    generationUp = true;
    expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual({ ok: true });
    expect(judged()).toBe(2);
    expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual({ ok: true });
    expect(judged()).toBe(3);
  });

  it('a held answer is never reused for another predecessor', async () => {
    const vault = noteVault();
    vault.files.set('Course A/Week 4.md', homeNote('Invented lecture topic', ['q-other']));
    const send = vi.fn(
      async (request: WorkerTaskRequest): Promise<unknown> =>
        request.taskId === 'grounding.judge.v1' ? SUPPORTED : unreachable(),
    );
    const deps = depsFor(
      vault,
      send,
      judgeThenGenerate(() => 'Invented passage.'),
    );
    await runInstrumentRevisionJob(deps, PAYLOAD);
    await runInstrumentRevisionJob(deps, { ...PAYLOAD, predecessorInstrumentId: 'q-other' });
    expect(
      send.mock.calls.filter(([request]) => request.taskId === 'grounding.judge.v1'),
    ).toHaveLength(2);
  });

  it('the demand ask is counted only for an attempt that was made', async () => {
    const vault = noteVault();
    let up = false;
    const send = async (request: WorkerTaskRequest): Promise<unknown> =>
      up ? answering(request) : unreachable();
    const demandCounter = new DemandRoutingCounter();
    const deps = depsFor(
      vault,
      send,
      judgeThenGenerate(() => 'Invented passage.'),
      {
        demandCounter,
      },
    );
    await runInstrumentRevisionJob(deps, PAYLOAD);
    await runInstrumentRevisionJob(deps, PAYLOAD);
    expect(demandCounter.counts()).toEqual([]);
    up = true;
    expect(await runInstrumentRevisionJob(deps, PAYLOAD)).toEqual({ ok: true });
    expect(demandCounter.counts().reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// A successor drafted from a PDF, set aside after the PDF was renamed as Olea saw
// ---------------------------------------------------------------------------------------------

const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_RENAMED = 'Course A/Lecture 3/lecture three slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides (Olea).md';
const bytes = (version: string): Uint8Array =>
  new TextEncoder().encode(`invented slide bytes, ${version}`);

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

function slideUnit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

describe('a successor drafted from a PDF renamed after drafting, as Olea saw (ol-egov.141.89.5.111)', () => {
  it.fails('[defect ol-egov.141.89.5.111: held for David, a renamed PDF is not followed] is set aside, drafted again citing the new path, and reaches her', async () => {
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

    const cache = createVaultDraftCacheStore(vault);
    const sent: WorkerTaskRequest[] = [];
    const draftDeps = {
      transport: {
        send: async (request: WorkerTaskRequest) => {
          sent.push(request);
          return DRAFTED;
        },
      },
    } as unknown as DraftQuizCardsDeps;
    const draftForConcept: Drafter = async (deps, request) => {
      const sourceChunks = ['retrieved one'];
      const response = await deps.transport.send({
        contractVersion: 2,
        taskId: 'quiz.generate.v1',
        payload: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
      });
      return {
        status: 'drafted',
        request: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
        response,
      };
    };
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
        draftDeps: () => draftDeps,
        draftForConcept,
        citedSourceNow: port,
        fallback: async () => ({ ok: false, retryable: false, reason: 'not a revision job' }),
      }),
    });
    h.actions.enqueue.mockImplementation((input: EnqueueInput) => engine.enqueue(input));
    const drain = async () => {
      for (let tick = 0; tick < 20; tick += 1) {
        if ((await engine.tick()).kind !== 'ran') return;
      }
    };
    const redrafts: SetAsideRedraft[] = [];
    const present = async () => {
      const pending = await cache.listPending();
      const check = draftSourceCheckAtPresentation(vault, pending, async (draft: DraftRecord) => {
        redrafts.push(
          await redraftSetAsideSuccessor(
            {
              vault,
              cache,
              jobs: () => engine.list(),
              enqueue: (i) => engine.enqueue(i),
              citedSourceNow: port,
            },
            draft,
          ),
        );
      });
      return new Map(
        await Promise.all(pending.map(async (d) => [d.draftId, await check(d.draftId)] as const)),
      );
    };

    // The PDF changes to v1, its text lands, the question is rewritten and its successor drafted.
    vault.binaries.set(PDF, bytes('v1'));
    await h.pass(vault);
    await h.trigger.onSourceUnitsLanded(
      vault,
      h.actions as unknown as CitationRevisionActions,
      [slideUnit(2, 'Invented page two text, v1.')],
      new Map([[PDF, await bytesHashOf('invented slide bytes, v1')]]),
    );
    await drain();
    const [first] = await cache.listPending();
    if (first === undefined) throw new Error('no successor');
    expect(first.sourceCitation?.sourcePath).toBe(PDF);

    // Renamed as Olea saw, bytes unchanged: the draft cites the old path and is set aside once.
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, bytes('v1'));
    await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);
    expect(await present()).toEqual(new Map([[first.draftId, 'check-failed']]));
    expect(redrafts).toEqual(['queued']);
    await drain();

    const second = (await cache.listPending()).find((d) => d.draftId !== first.draftId);
    if (second?.question === undefined) throw new Error('no second successor');
    expect(second.sourceCitation).toEqual({
      sourcePath: PDF_RENAMED,
      page: 2,
      sourceRevision: await bytesHashOf('invented slide bytes, v1'),
    });
    expect((await present()).get(second.draftId)).toBe('clear');

    // Accepted, seeded with no hold, and presented; the old question stays withheld.
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: PDF_HOME,
      question: second.question,
      draftId: second.draftId,
      ...(second.sourceCitation === undefined ? {} : { sourceCitation: second.sourceCitation }),
    });
    await h.pass(vault);
    expect(await h.withheld([instrumentId])).toEqual(new Set());
    const { records } = await enumerateVaultInstruments(vault, {
      concepts: { stampConceptKeys: true },
    });
    const check = sourceCheckAtPresentation(
      h.store,
      async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
      { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
    );
    expect(await check(instrumentId)).toBe('clear');
    expect(await h.withheld(['q-slide'])).toEqual(new Set(['q-slide']));
  });
});
