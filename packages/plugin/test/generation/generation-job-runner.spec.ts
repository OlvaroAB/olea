/**
 * `runGenerationDraftJob` / `createGenerationDraftRunner` /
 * `hasBuiltAnyKindForConcept` / `createHasAnyBuiltKind` tests (`ol-2zfj.135`
 * [GEN-3.4], `[D-238]`).
 *
 * Proves: an `'mcq'` payload drafts and caches a pending record naming the
 * concept's own note; `'qa'`/`'cloze'` fail honestly and non-retryably
 * (component register row 2.1); the Worker-unconfigured (F7.8), refused,
 * unparseable/empty and transport-throw outcomes mirror
 * `revision-job-runner.spec.ts`'s own coverage of the identical shapes; an
 * unresolvable concept key fails non-retryably rather than guessing;
 * `createGenerationDraftRunner` dispatches only a recognised generation
 * payload; `hasBuiltAnyKindForConcept` reads any cached status, scoped to
 * the right (course, concept) pair.
 */

import type { ConceptRecord, GenerationJobPayload } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createVaultDraftCacheStore,
  type DraftCacheStore,
} from '../../src/generation/cache-store.js';
import {
  createGenerationDraftRunner,
  createHasAnyBuiltKind,
  hasBuiltAnyKindForConcept,
  runGenerationDraftJob,
} from '../../src/generation/generation-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const COURSE_NOTE = '---\ntopic: [Working memory]\ncourse: COGS214\n---\n\nSome notes.\n';

function concept(name: string, key = `key-${name}`): ConceptRecord {
  return { key, name, tier: 2, courses: ['COGS214'], sourcePaths: [COURSE_NOTE_PATH] };
}

function payload(overrides: Partial<GenerationJobPayload> = {}): GenerationJobPayload {
  return {
    kind: 'generation',
    courseCode: 'COGS214',
    conceptKey: 'key-Working memory',
    conceptName: 'Working memory',
    instrumentKind: 'mcq',
    trigger: 'arrival',
    ...overrides,
  };
}

const groundedResponse = (stem: string): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'COGS214', conceptName: stem, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'because' }],
    },
  },
});

const refusedResponse: DraftQuizCardsResult = { status: 'refused', reason: 'no-hits' };

describe('runGenerationDraftJob', () => {
  it('drafts an mcq job and caches a pending record naming the concept’s own note', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftForConcept: async () => groundedResponse('Working memory'),
        generateDraftId: () => 'draft-1',
        now: () => new Date('2026-09-25T10:00:00-04:00'),
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: true });

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      draftId: 'draft-1',
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['key-Working memory'],
      sourcePath: COURSE_NOTE_PATH,
    } satisfies Partial<DraftRecord>);
  });

  it('a qa payload fails honestly and non-retryably (component register row 2.1)', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      { vault, cache, draftDeps: () => ({}) as never },
      payload({ instrumentKind: 'qa' }),
    );

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('qa'),
    });
  });

  it('a cloze payload fails the same honest, non-retryable way', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      { vault, cache, draftDeps: () => ({}) as never },
      payload({ instrumentKind: 'cloze' }),
    );

    expect(outcome.ok).toBe(false);
    expect((outcome as { retryable: boolean }).retryable).toBe(false);
  });

  it('the Worker not configured (F7.8) defers rather than fails outright', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob({ vault, cache, draftDeps: () => null }, payload());

    expect(outcome).toEqual({ ok: false, retryable: true });
  });

  it('a grounded refusal caches nothing and is not a job failure (the primary call is still spent)', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftForConcept: async () => refusedResponse,
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: true });
    expect(await cache.listPending()).toEqual([]);
  });

  it('an unparseable response caches nothing and is not a job failure', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftForConcept: async () => ({
          status: 'drafted',
          request: {} as never,
          response: { ok: false },
        }),
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: true });
    expect(await cache.listPending()).toEqual([]);
  });

  it('a transport throw is retryable', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftForConcept: async () => {
          throw new Error('network blew up');
        },
      },
      payload(),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
  });

  it('an unresolvable conceptKey fails non-retryably rather than guessing', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('A different concept', 'key-different')],
      },
      payload({ conceptKey: 'key-Working memory' }),
    );

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('key-Working memory'),
    });
  });

  it('never sends a transport call for a qa/cloze payload — the honest failure is returned before draftForConcept could be called', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn(async () => groundedResponse('x'));

    await runGenerationDraftJob(
      { vault, cache, draftDeps: () => ({}) as never, draftForConcept },
      payload({ instrumentKind: 'cloze' }),
    );

    expect(draftForConcept).not.toHaveBeenCalled();
  });
});

describe('createGenerationDraftRunner', () => {
  it('dispatches a recognised generation payload through runGenerationDraftJob', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const draft = createGenerationDraftRunner({
      vault,
      cache,
      draftDeps: () => ({}) as never,
      listConceptsForCourse: async () => [concept('Working memory')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });

    const outcome = await draft({
      contentHash: 'h1',
      label: 'generation:COGS214:key-Working memory:mcq',
      payload: payload(),
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(await cache.listPending()).toHaveLength(1);
  });

  it('an unrecognised payload fails honestly rather than being drafted', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const draft = createGenerationDraftRunner({ vault, cache, draftDeps: () => ({}) as never });

    const outcome = await draft({
      contentHash: 'h2',
      label: 'source:some.pdf',
      payload: { kind: 'source', sourcePath: 'some.pdf', format: 'pdf' },
      attempts: 0,
    });

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('GenerationJobPayload'),
    });
  });
});

describe('hasBuiltAnyKindForConcept / createHasAnyBuiltKind', () => {
  async function cacheWithRecord(status: DraftRecord['status']): Promise<DraftCacheStore> {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const record: DraftRecord = {
      draftId: 'd1',
      status,
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['key-Working memory'],
      sourcePath: COURSE_NOTE_PATH,
      createdAt: '2026-09-25T10:00:00.000Z',
      question: { stem: 's', correctAnswer: 'a', distractors: ['b'], feedback: 'f' },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
    };
    await cache.put(record);
    return cache;
  }

  it('is false when nothing has been cached for the pair', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    expect(await hasBuiltAnyKindForConcept(cache, 'COGS214', 'key-Working memory')).toBe(false);
  });

  it.each(['pending', 'accepted', 'edited', 'rejected'] as const)(
    'is true for a %s record — a call was made, whatever its outcome',
    async (status) => {
      const cache = await cacheWithRecord(status);
      expect(await hasBuiltAnyKindForConcept(cache, 'COGS214', 'key-Working memory')).toBe(true);
    },
  );

  it('is scoped to the exact (courseCode, conceptKey) pair, never a loose match', async () => {
    const cache = await cacheWithRecord('pending');
    expect(await hasBuiltAnyKindForConcept(cache, 'COGS214', 'key-Other concept')).toBe(false);
    expect(await hasBuiltAnyKindForConcept(cache, 'OTHERCOURSE', 'key-Working memory')).toBe(false);
  });

  it('createHasAnyBuiltKind exposes the exact GenerationArrivalDeps.hasAnyBuiltKind shape', async () => {
    const cache = await cacheWithRecord('pending');
    const hasAnyBuiltKind = createHasAnyBuiltKind(cache);
    expect(await hasAnyBuiltKind('COGS214', 'key-Working memory')).toBe(true);
    expect(await hasAnyBuiltKind('COGS214', 'key-Unbuilt')).toBe(false);
  });
});
