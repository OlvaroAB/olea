/**
 * `createRevisionAwareJobRunner` / `runInstrumentRevisionJob` tests
 * (`[D-133]`, `ol-2zfj.39`; `[D-366]`, `ol-v7r5.68`).
 *
 * Proves: a recognised `'instrument-revision'` payload resolves the
 * predecessor's concept/course binding from a real vault walk (never a
 * fixture standing in for `enumerateVaultInstruments`), drafts through the
 * injected `draftForConcept` seam, and caches a `DraftRecord` carrying
 * `predecessorInstrumentId` — the field `accept.ts` forwards on to
 * `materializeAcceptedDraft`. Also proves the three "nothing to cache, but
 * not a failure" outcomes (refused, unparseable/empty, Worker not
 * configured) and that an unrecognised payload falls through to the
 * supplied fallback runner untouched.
 *
 * The `[D-366]` describe block below proves the same-kind-successor dispatch
 * this bead adds: a `'qa'` predecessor drafts through `draftCardForConcept`
 * (`cards.generate.v1`) and caches a `'qa'`-kind `DraftRecord` (never the
 * `'mcq'` path), and a `'cloze'` predecessor produces no draft at all —
 * there is no `cloze.generate.v1` task to draft through — without that being
 * treated as a job failure.
 */

import {
  DemandRoutingCounter,
  enumerateVaultInstruments,
  INSTRUMENT_TARGET_STORE_FOLDER,
  instrumentTargetStorePath,
  type NewInstrumentTarget,
  type PaperDemand,
  parseCards,
  parseMcqBlocks,
  questionBindingOf,
  readInstrumentDemand,
  writeInstrumentTarget,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftCardsResult } from '../../src/generation/draft-cards.js';
import {
  demandRoutingCounterFor,
  draftDemandRefusalCounterFor,
} from '../../src/generation/pipeline.js';
import {
  createRevisionAwareJobRunner,
  isInstrumentRevisionJobPayload,
  runInstrumentRevisionJob,
} from '../../src/generation/revision-job-runner.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_NOTE_PATH = 'Courses/GEO101/Week 3.md';
const PREDECESSOR_ID = 'mcq-old-1';

const COURSE_NOTE = [
  '---',
  'topic: [Sediment layering]',
  'course: GEO101',
  '---',
  '',
  '## What preserves the storm record?',
  '',
  '```olea-mcq',
  `id: ${PREDECESSOR_ID}`,
  'stem: Which structure preserves the storm record?',
  'answer: Hummocky stratification',
  'distractor: a',
  'distractor: b',
  'distractor: c',
  'distractor: d',
  '```',
  '',
].join('\n');

function payload(
  overrides: Partial<{ predecessorInstrumentId: string; newPassageText: string }> = {},
) {
  return {
    kind: 'instrument-revision' as const,
    predecessorInstrumentId: PREDECESSOR_ID,
    newPassageText: 'the updated passage text',
    ...overrides,
  };
}

const groundedResponse = (stem: string): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'GEO101', conceptName: stem, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'because' }],
    },
  },
});

const refusedResponse: DraftQuizCardsResult = { status: 'refused', reason: 'no-hits' };

describe('isInstrumentRevisionJobPayload', () => {
  it('recognises a well-formed payload', () => {
    expect(isInstrumentRevisionJobPayload(payload())).toBe(true);
  });

  it('rejects a payload of a different kind', () => {
    expect(isInstrumentRevisionJobPayload({ kind: 'note', notePath: 'x.md' })).toBe(false);
  });

  it('rejects a malformed instrument-revision payload', () => {
    expect(isInstrumentRevisionJobPayload({ kind: 'instrument-revision' })).toBe(false);
  });
});

describe('runInstrumentRevisionJob', () => {
  it('resolves the predecessor binding from a real vault walk and caches a pending draft naming it', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => groundedResponse('Sediment layering'),
        generateDraftId: () => 'draft-successor-1',
        now: () => new Date('2026-08-29T10:00:00-04:00'),
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: true });

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      draftId: 'draft-successor-1',
      status: 'pending',
      courseCode: 'GEO101',
      conceptName: 'Sediment layering',
      sourcePath: COURSE_NOTE_PATH,
      predecessorInstrumentId: PREDECESSOR_ID,
    });
  });

  it('leaves the drafting request itself unchanged (the passage travels on the generation call, see revision-job-runner-passage-and-retry.spec.ts)', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn(async () => groundedResponse('Sediment layering'));

    await runInstrumentRevisionJob(
      { vault, cache, draftDeps: () => ({}) as never, draftForConcept },
      payload({ newPassageText: 'text nobody reads here' }),
    );

    expect(draftForConcept).toHaveBeenCalledWith(expect.anything(), {
      courseCode: 'GEO101',
      conceptName: 'Sediment layering',
    });
  });

  it('an unknown predecessor id is a non-retryable failure, not a crash', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => refusedResponse,
      },
      payload({ predecessorInstrumentId: 'does-not-exist' }),
    );

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('does-not-exist'),
    });
    expect(await cache.listPending()).toEqual([]);
  });

  it('the Worker not configured (F7.8) defers rather than fails outright', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      { vault, cache, draftDeps: () => null },
      payload(),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
  });

  it('a grounded refusal caches nothing and is a recorded non-retryable failure', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => refusedResponse,
      },
      payload(),
    );

    expect(outcome).toMatchObject({ ok: false, retryable: false }); // ol-egov.141.89.5.79: recorded, not silent
    expect(await cache.listPending()).toEqual([]);
  });

  it("a transport throw is retryable, matching createExtractionJobRunner's own posture", async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => {
          throw new Error('network blew up');
        },
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
  });
});

describe('createRevisionAwareJobRunner', () => {
  it('dispatches an instrument-revision payload itself, never touching the fallback', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const fallback = vi.fn(async () => ({ ok: true }) as const);

    const runner = createRevisionAwareJobRunner({
      vault,
      cache,
      draftDeps: () => ({}) as never,
      draftForConcept: async () => groundedResponse('Sediment layering'),
      fallback,
    });

    const outcome = await runner({
      contentHash: 'h1',
      label: 'instrument-revision:mcq-old-1',
      payload: payload(),
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(fallback).not.toHaveBeenCalled();
    expect(await cache.listPending()).toHaveLength(1);
  });

  it('falls through to the fallback runner for every other payload kind, unmodified', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const fallbackOutcome = { ok: false, retryable: false, reason: 'fallback saw it' } as const;
    const fallback = vi.fn(async () => fallbackOutcome);

    const runner = createRevisionAwareJobRunner({
      vault,
      cache,
      draftDeps: () => ({}) as never,
      fallback,
    });

    const job = {
      contentHash: 'h2',
      label: 'source:some.pdf',
      payload: { kind: 'source', sourcePath: 'some.pdf', format: 'pdf' },
      attempts: 0,
    };
    const outcome = await runner(job);

    expect(outcome).toBe(fallbackOutcome);
    expect(fallback).toHaveBeenCalledWith(job);
  });
});

// `[D-366]` (`ol-v7r5.68`) — see this file's module doc.
describe('runInstrumentRevisionJob: same-kind successor', () => {
  const QA_NOTE_PATH = 'Courses/GEO101/Week 4.md';
  const QA_NOTE = [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'What preserves the storm record?',
    '?',
    'Hummocky stratification',
    '',
  ].join('\n');

  const CLOZE_NOTE_PATH = 'Courses/GEO101/Week 5.md';
  const CLOZE_NOTE = [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'The ==hummocky stratification== preserves the storm record.',
    '',
  ].join('\n');

  async function predecessorIdIn(vault: MemoryVaultSource, notePath: string): Promise<string> {
    const { records } = await enumerateVaultInstruments(vault);
    const record = records.find((r) => r.notePath === notePath);
    if (record === undefined) {
      throw new Error(`test fixture error: no instrument enumerated in ${notePath}`);
    }
    return record.instrumentId;
  }

  const draftedCardsResponse = (front: string): DraftCardsResult => ({
    status: 'drafted',
    request: { courseCode: 'GEO101', conceptName: front, sourceChunks: ['chunk'] },
    response: {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
      result: { cards: [{ front, back: 'Chunking', subject: 'Sediment layering' }] },
    },
  });

  it("a 'qa' predecessor drafts through draftCardForConcept and caches a 'qa'-kind DraftRecord naming it", async () => {
    const vault = new MemoryVaultSource({ [QA_NOTE_PATH]: QA_NOTE });
    const predecessorId = await predecessorIdIn(vault, QA_NOTE_PATH);
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn(async () => {
      throw new Error('the mcq drafting seam must never be called for a qa predecessor');
    });
    const draftCardForConcept = vi.fn(async () => draftedCardsResponse('Sediment layering'));

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept,
        draftCardForConcept,
        generateDraftId: () => 'draft-qa-successor-1',
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: predecessorId,
        newPassageText: 'the updated passage text',
      },
    );

    expect(outcome).toEqual({ ok: true });
    expect(draftForConcept).not.toHaveBeenCalled();
    expect(draftCardForConcept).toHaveBeenCalledWith(expect.anything(), {
      courseCode: 'GEO101',
      conceptName: 'Sediment layering',
    });

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      draftId: 'draft-qa-successor-1',
      status: 'pending',
      instrumentType: 'qa',
      card: { front: 'Sediment layering', back: 'Chunking' },
      predecessorInstrumentId: predecessorId,
    });
    expect(pending[0]?.question).toBeUndefined();
  });

  it("a 'qa' predecessor: a grounded refusal caches nothing and is a recorded non-retryable failure", async () => {
    const vault = new MemoryVaultSource({ [QA_NOTE_PATH]: QA_NOTE });
    const predecessorId = await predecessorIdIn(vault, QA_NOTE_PATH);
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftCardForConcept: async () => ({ status: 'refused', reason: 'no-hits' }) as const,
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: predecessorId,
        newPassageText: 'text',
      },
    );

    expect(outcome).toMatchObject({ ok: false, retryable: false }); // ol-egov.141.89.5.79: recorded, not silent
    expect(await cache.listPending()).toEqual([]);
  });

  it("a 'cloze' predecessor produces no draft at all — no cloze.generate.v1 task exists — but the job still succeeds", async () => {
    const vault = new MemoryVaultSource({ [CLOZE_NOTE_PATH]: CLOZE_NOTE });
    const predecessorId = await predecessorIdIn(vault, CLOZE_NOTE_PATH);
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn();
    const draftCardForConcept = vi.fn();

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept,
        draftCardForConcept,
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: predecessorId,
        newPassageText: 'text',
      },
    );

    expect(outcome).toEqual({ ok: true });
    expect(draftForConcept).not.toHaveBeenCalled();
    expect(draftCardForConcept).not.toHaveBeenCalled();
    expect(await cache.listPending()).toEqual([]);
  });
});

/**
 * `[D-437]` (`ol-egov.141.89.2.20`), design `demand-carriage.md` §4.1's revision row and §3.2's
 * revision-request row: the predecessor's declared demand is restated as the successor's ask
 * (origin `revision`), routed like any other ask, and an unspecified, stale or unreadable
 * predecessor restates nothing, so its successor is authored exactly as today. History is never
 * upgraded: the successor is a new instrument, and the predecessor never gains a record here.
 */
describe('runInstrumentRevisionJob: the predecessor demand is restated as the successor ask (`[D-437]`)', () => {
  const QA_NOTE_PATH = 'Courses/GEO101/Week 4.md';
  const QA_NOTE = [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'What preserves the storm record?',
    '?',
    'Hummocky stratification',
    '',
  ].join('\n');

  async function recordFor(
    vault: MemoryVaultSource,
    instrumentId: string,
    overrides: Partial<NewInstrumentTarget> = {},
  ): Promise<void> {
    const { records } = await enumerateVaultInstruments(vault);
    const record = records.find((r) => r.instrumentId === instrumentId);
    if (record === undefined) throw new Error('test fixture error: predecessor not enumerated');
    const block = record.instrumentType === 'mcq' ? record.mcq : record.card;
    if (block.type === 'cloze') throw new Error('test fixture error: no cloze predecessor here');
    await writeInstrumentTarget(vault, {
      instrumentId,
      declaredDemand: 'recall-a-fact',
      origin: 'sweep',
      questionBinding: await questionBindingOf(block),
      authoredAt: '2026-09-01T10:00:00Z',
      generator: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0' },
      ...overrides,
    });
  }

  async function qaPredecessorId(vault: MemoryVaultSource): Promise<string> {
    const { records } = await enumerateVaultInstruments(vault);
    const id = records.find((r) => r.notePath === QA_NOTE_PATH)?.instrumentId;
    if (id === undefined) throw new Error('test fixture error: no qa instrument enumerated');
    return id;
  }

  async function reviseMcq(
    vault: MemoryVaultSource,
    counter = new DemandRoutingCounter(),
  ): Promise<{
    readonly requests: Record<string, unknown>[];
    readonly counter: DemandRoutingCounter;
  }> {
    const requests: Record<string, unknown>[] = [];
    await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({}) as never,
        draftForConcept: async (_deps, request) => {
          requests.push({ ...request });
          return groundedResponse('Sediment layering');
        },
        demandCounter: counter,
      },
      payload(),
    );
    return { requests, counter };
  }

  it('a declared predecessor demand is sent on the successor request, with no heading', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    await recordFor(vault, PREDECESSOR_ID);

    const { requests, counter } = await reviseMcq(vault);

    expect(requests).toEqual([
      { courseCode: 'GEO101', conceptName: 'Sediment layering', intendedDemand: 'recall-a-fact' },
    ]);
    expect(counter.counts()).toEqual([
      { conceptKey: expect.any(String), reason: 'served', count: 1 },
    ]);
  });

  it('an unspecified predecessor (no record) restates nothing: the request is exactly today, counted as none asked', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });

    const { requests, counter } = await reviseMcq(vault);

    expect(requests).toEqual([{ courseCode: 'GEO101', conceptName: 'Sediment layering' }]);
    expect(counter.counts()).toEqual([
      { conceptKey: expect.any(String), reason: 'none-asked', count: 1 },
    ]);
  });

  it('a stale record (the block was edited after it was written) restates nothing', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    await recordFor(vault, PREDECESSOR_ID, { questionBinding: 'a-binding-of-another-question' });

    const { requests, counter } = await reviseMcq(vault);

    expect(requests).toEqual([{ courseCode: 'GEO101', conceptName: 'Sediment layering' }]);
    expect(counter.total('served')).toBe(0);
    expect(counter.total('none-asked')).toBe(1);
  });

  it('an unreadable record restates nothing, and is left exactly as it is', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const path = instrumentTargetStorePath(PREDECESSOR_ID);
    await vault.write(path, '{ this is not a record');
    const before = await vault.read(path);

    const { requests } = await reviseMcq(vault);

    expect(requests).toEqual([{ courseCode: 'GEO101', conceptName: 'Sediment layering' }]);
    expect(await vault.read(path)).toBe(before);
  });

  it('a declared demand no generator serves is recorded as unmet and is not sent (deferred, never served)', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    await recordFor(vault, PREDECESSOR_ID, { declaredDemand: 'calculate' });

    const { requests, counter } = await reviseMcq(vault);

    expect(requests).toEqual([{ courseCode: 'GEO101', conceptName: 'Sediment layering' }]);
    expect(counter.total('no-generator-serves')).toBe(1);
    expect(counter.total('served')).toBe(0);
  });

  it('writes no target record: the revision restates the demand and never records one (history is not upgraded)', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    await recordFor(vault, PREDECESSOR_ID);
    const before = (await vault.list()).filter((path) =>
      path.startsWith('.olea/instrument-targets'),
    );

    await reviseMcq(vault);

    const after = (await vault.list()).filter((path) =>
      path.startsWith('.olea/instrument-targets'),
    );
    expect(after).toEqual(before);
    expect(after).toEqual([instrumentTargetStorePath(PREDECESSOR_ID)]);
  });

  it("a 'qa' predecessor's declared demand goes to the cards request", async () => {
    const vault = new MemoryVaultSource({ [QA_NOTE_PATH]: QA_NOTE });
    const predecessorId = await qaPredecessorId(vault);
    await recordFor(vault, predecessorId, {
      generator: { taskId: 'cards.generate.v1', promptVersion: '1.8.0' },
    });
    const requests: Record<string, unknown>[] = [];

    await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({}) as never,
        draftForConcept: async () => {
          throw new Error('the mcq seam must not be called for a qa predecessor');
        },
        draftCardForConcept: async (_deps, request) => {
          requests.push({ ...request });
          return {
            status: 'drafted',
            request: { courseCode: 'GEO101', conceptName: 'x', sourceChunks: ['chunk'] },
            response: {
              ok: true,
              stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
              result: { cards: [{ front: 'f', back: 'b', subject: 's' }] },
            },
          };
        },
        demandCounter: new DemandRoutingCounter(),
      },
      { kind: 'instrument-revision', predecessorInstrumentId: predecessorId, newPassageText: 't' },
    );

    expect(requests).toEqual([
      { courseCode: 'GEO101', conceptName: 'Sediment layering', intendedDemand: 'recall-a-fact' },
    ]);
  });

  it('a cloze predecessor makes no ask and counts nothing', async () => {
    const CLOZE_PATH = 'Courses/GEO101/Week 5.md';
    const vault = new MemoryVaultSource({
      [CLOZE_PATH]: [
        '---',
        'topic: [Sediment layering]',
        'course: GEO101',
        '---',
        '',
        'The ==hummocky stratification== preserves the storm record.',
        '',
      ].join('\n'),
    });
    const { records } = await enumerateVaultInstruments(vault);
    const counter = new DemandRoutingCounter();

    await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({}) as never,
        demandCounter: counter,
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: records[0]?.instrumentId ?? 'missing',
        newPassageText: 't',
      },
    );

    expect(counter.counts()).toEqual([]);
  });

  it('the Worker not configured makes no ask and counts nothing', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const counter = new DemandRoutingCounter();

    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => null,
        demandCounter: counter,
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(counter.counts()).toEqual([]);
  });

  it('with no counter supplied, counts into the session counter the draft cache stands for', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    await recordFor(vault, PREDECESSOR_ID);

    await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => groundedResponse('Sediment layering'),
      },
      payload(),
    );

    expect(demandRoutingCounterFor(cache).total('served')).toBe(1);
  });
});

/**
 * `[D-437]` (`ol-egov.141.89.2.30`), design `demand-carriage.md` sections 4.3, 4.4 and 6: the revision
 * runner stamps `DraftRecord.demand` (origin `revision`) on the successor it caches, for the quiz
 * successor and the cards successor, from the request it sent and the response it got. The
 * predecessor's demand is the ask; the successor is a new instrument and gains its record only at
 * accept, from the materialiser. A successor for an unspecified predecessor carries no demand.
 */
describe('runInstrumentRevisionJob: the successor carries its demand on the cached draft (`[D-437]`)', () => {
  const QA_NOTE_PATH = 'Courses/GEO101/Week 4.md';
  const QA_NOTE = [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'What preserves the storm record?',
    '?',
    'Hummocky stratification',
    '',
  ].join('\n');

  async function declareDemandFor(
    vault: MemoryVaultSource,
    instrumentId: string,
    taskId: 'quiz.generate.v1' | 'cards.generate.v1',
  ): Promise<void> {
    const { records } = await enumerateVaultInstruments(vault);
    const record = records.find((r) => r.instrumentId === instrumentId);
    if (record === undefined) throw new Error('test fixture error: predecessor not enumerated');
    const block = record.instrumentType === 'mcq' ? record.mcq : record.card;
    if (block.type === 'cloze') throw new Error('test fixture error: no cloze predecessor here');
    const target: NewInstrumentTarget = {
      instrumentId,
      declaredDemand: 'recall-a-fact',
      origin: 'sweep',
      questionBinding: await questionBindingOf(block),
      authoredAt: '2026-09-01T10:00:00Z',
      generator: { taskId, promptVersion: '2.4.0' },
    };
    await writeInstrumentTarget(vault, target);
  }

  /** What a new Worker returns for a quiz request: echoes the payload, acknowledges, declares per question. */
  function quizResult(
    request: { readonly intendedDemand?: PaperDemand },
    declared: readonly (string | undefined)[],
    acknowledged = true,
  ): DraftQuizCardsResult {
    return {
      status: 'drafted',
      request: {
        courseCode: 'GEO101',
        conceptName: 'Sediment layering',
        sourceChunks: ['chunk'],
        ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
      },
      response: {
        ok: true,
        stamp: { contractVersion: 1, promptVersion: '2.4.0', modelId: 'test-model' },
        result: {
          ...(acknowledged && request.intendedDemand !== undefined
            ? { demandAcknowledgement: { intendedDemand: request.intendedDemand } }
            : {}),
          questions: declared.map((word, i) => ({
            stem: `Question ${i}`,
            correctAnswer: 'A',
            distractors: ['B', 'C', 'D'],
            feedback: 'because',
            ...(word === undefined ? {} : { declaredDemand: word }),
          })),
        },
      },
    };
  }

  /** The same for a cards request: the declaration sits on each CARD, not on a question. */
  function cardsResult(
    request: { readonly intendedDemand?: PaperDemand },
    declared: readonly (string | undefined)[],
    acknowledged = true,
  ): DraftCardsResult {
    return {
      status: 'drafted',
      request: {
        courseCode: 'GEO101',
        conceptName: 'Sediment layering',
        sourceChunks: ['chunk'],
        personalization: { voiceExemplars: { phrasing: [], terminology: [] } },
        ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
      },
      response: {
        ok: true,
        stamp: { contractVersion: 1, promptVersion: '1.8.0', modelId: 'test-model' },
        result: {
          ...(acknowledged && request.intendedDemand !== undefined
            ? { demandAcknowledgement: { intendedDemand: request.intendedDemand } }
            : {}),
          cards: declared.map((word, i) => ({
            front: `Front ${i}`,
            back: `Back ${i}`,
            subject: 'Sediment layering',
            ...(word === undefined ? {} : { declaredDemand: word }),
          })),
        },
      },
    };
  }

  async function reviseMcq(
    declared: readonly (string | undefined)[],
    options: { readonly declaredPredecessor?: boolean; readonly acknowledged?: boolean } = {},
  ) {
    const { declaredPredecessor = true, acknowledged = true } = options;
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    if (declaredPredecessor) await declareDemandFor(vault, PREDECESSOR_ID, 'quiz.generate.v1');
    const cache = createVaultDraftCacheStore(vault);
    let ids = 0;
    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async (_deps, request) => quizResult(request, declared, acknowledged),
        generateDraftId: () => `successor-${++ids}`,
      },
      payload(),
    );
    return { vault, cache, outcome };
  }

  async function reviseCard(
    declared: readonly (string | undefined)[],
    options: { readonly declaredPredecessor?: boolean; readonly acknowledged?: boolean } = {},
  ) {
    const { declaredPredecessor = true, acknowledged = true } = options;
    const vault = new MemoryVaultSource({ [QA_NOTE_PATH]: QA_NOTE });
    const { records } = await enumerateVaultInstruments(vault);
    const predecessorId = records.find((r) => r.notePath === QA_NOTE_PATH)?.instrumentId;
    if (predecessorId === undefined) throw new Error('test fixture error: no qa instrument');
    if (declaredPredecessor) await declareDemandFor(vault, predecessorId, 'cards.generate.v1');
    const cache = createVaultDraftCacheStore(vault);
    let ids = 0;
    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => {
          throw new Error('the mcq seam must not be called for a qa predecessor');
        },
        draftCardForConcept: async (_deps, request) => cardsResult(request, declared, acknowledged),
        generateDraftId: () => `card-successor-${++ids}`,
      },
      { kind: 'instrument-revision', predecessorInstrumentId: predecessorId, newPassageText: 't' },
    );
    return { vault, cache, outcome, predecessorId };
  }

  it('a quiz successor for a declared predecessor is cached with the revision origin, the acknowledgement and its own declaration, and no heading', async () => {
    const { cache } = await reviseMcq(['recall-a-fact']);

    const [record] = await cache.listPending();
    expect(record?.demand).toEqual({
      origin: 'revision',
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
    });
    expect(record?.predecessorInstrumentId).toBe(PREDECESSOR_ID);
  });

  it('each quiz successor question carries its own declaration by position, and a mismatching one is not cached, and is counted', async () => {
    const { cache } = await reviseMcq(['calculate', 'recall-a-fact']);

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.demand?.declaredDemand).toBe('recall-a-fact');
    expect(draftDemandRefusalCounterFor(cache).counts()).toEqual([
      { conceptKey: expect.any(String), count: 1 },
    ]);
  });

  it('when every quiz successor question is refused nothing is cached and the job is a recorded non-retryable failure (ol-egov.141.89.5.79)', async () => {
    const { cache, outcome } = await reviseMcq(['calculate']);

    expect(outcome).toMatchObject({ ok: false, retryable: false });
    expect((outcome as { reason?: string }).reason).toContain(PREDECESSOR_ID);
    expect((outcome as { reason?: string }).reason).toContain('stays suspended');
    expect(await cache.listPending()).toEqual([]);
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(1);
  });

  it('when every cards successor card is refused the job is a recorded non-retryable failure naming the predecessor (ol-egov.141.89.5.79)', async () => {
    const { cache, outcome, predecessorId } = await reviseCard(['calculate']);

    expect(await cache.listPending()).toEqual([]);
    expect(outcome).toMatchObject({ ok: false, retryable: false });
    expect((outcome as { reason?: string }).reason).toContain(predecessorId);
    expect((outcome as { reason?: string }).reason).toContain('stays suspended');
  });

  it('an unspecified predecessor sends no demand, so its successor is cached with no demand key', async () => {
    const { cache } = await reviseMcq(['recall-a-fact'], { declaredPredecessor: false });

    const [record] = await cache.listPending();
    expect(record).toBeDefined();
    expect('demand' in (record ?? {})).toBe(false);
  });

  it('an old Worker (no acknowledgement) leaves the successor cached carrying the demand it was asked, unacknowledged', async () => {
    const { cache } = await reviseMcq([undefined], { acknowledged: false });

    const [record] = await cache.listPending();
    expect(record?.demand).toEqual({ origin: 'revision', intendedDemand: 'recall-a-fact' });
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(0);
  });

  it('a cards successor reads its declaration off the CARD, and is cached with the revision origin', async () => {
    const { cache } = await reviseCard(['recall-a-fact']);

    const [record] = await cache.listPending();
    expect(record?.instrumentType).toBe('qa');
    expect(record?.demand).toEqual({
      origin: 'revision',
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
    });
  });

  it('a cards successor declaring a different demand than asked, or none, is not cached and is counted', async () => {
    const { cache } = await reviseCard(['calculate', undefined, 'recall-a-fact']);

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.demand?.declaredDemand).toBe('recall-a-fact');
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(2);
  });

  it('a cards successor for an unspecified predecessor, or an old Worker, is handled like the quiz one', async () => {
    const unspecified = await reviseCard(['recall-a-fact'], { declaredPredecessor: false });
    const [plain] = await unspecified.cache.listPending();
    expect('demand' in (plain ?? {})).toBe(false);

    const skew = await reviseCard([undefined], { acknowledged: false });
    const [record] = await skew.cache.listPending();
    expect(record?.demand).toEqual({ origin: 'revision', intendedDemand: 'recall-a-fact' });
  });

  it('the production path end to end for a quiz successor: revise, accept in review, one record under the successor id, declared recognition, origin revision', async () => {
    const { vault, cache } = await reviseMcq(['recall-a-fact']);
    const predecessorRecords = await vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER });
    const [draft] = await cache.listPending();
    if (draft === undefined) throw new Error('nothing was cached');
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a' });

    const { instrumentId } = await port.accept(draft.draftId, 'accepted');

    expect(instrumentId).not.toBe(PREDECESSOR_ID);
    expect(await vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER })).toEqual(
      [...predecessorRecords, instrumentTargetStorePath(instrumentId)].sort(),
    );
    const successor = parseMcqBlocks(vault.raw(COURSE_NOTE_PATH) ?? '').instruments.find(
      (b) => b.id === instrumentId,
    );
    if (successor === undefined) throw new Error('successor block was not written');
    expect(await readInstrumentDemand(vault, instrumentId, successor)).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'revision',
      responseForm: 'recognition',
    });
  });

  it('the production path end to end for a cards successor: the record reads declared free recall', async () => {
    const { vault, cache, predecessorId } = await reviseCard(['recall-a-fact']);
    const [draft] = await cache.listPending();
    if (draft === undefined) throw new Error('nothing was cached');
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a' });

    const { instrumentId } = await port.accept(draft.draftId, 'accepted');

    expect(instrumentId).not.toBe(predecessorId);
    const files = await vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER });
    expect(files).toContain(instrumentTargetStorePath(instrumentId));
    // The successor is the card the fake Worker authored (its own front), not the predecessor's.
    const written = parseCards(vault.raw(QA_NOTE_PATH) ?? '').find(
      (c) => c.type === 'qa' && c.front === 'Front 0',
    );
    if (written === undefined || written.type !== 'qa') throw new Error('no card was written');
    expect(await readInstrumentDemand(vault, instrumentId, written)).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'revision',
      responseForm: 'free-recall',
    });
  });
});
