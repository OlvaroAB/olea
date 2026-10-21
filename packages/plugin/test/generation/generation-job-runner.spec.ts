/**
 * `runGenerationDraftJob` / `createGenerationDraftRunner` /
 * `hasBuiltAnyKindForConcept` / `createHasAnyBuiltKind` tests (`ol-2zfj.135`
 * [GEN-3.4], `[D-238]`).
 *
 * Proves: an `'mcq'` payload drafts and caches a pending record naming the
 * concept's own note; a `'qa'` payload drafts through the card drafter and
 * caches a pending `'qa'` card record (`ol-egov.141.89.105.10`, including
 * the recall trigger a recall-style course asks for); `'cloze'` fails
 * honestly and non-retryably (component register row 2.1); the Worker-unconfigured (F7.8), refused,
 * unparseable/empty and transport-throw outcomes mirror
 * `revision-job-runner.spec.ts`'s own coverage of the identical shapes; an
 * unresolvable concept key fails non-retryably rather than guessing;
 * `createGenerationDraftRunner` dispatches only a recognised generation
 * payload; `hasBuiltAnyKindForConcept` reads any cached status, scoped to
 * the right (course, concept) pair.
 */

import type { ConceptRecord, GenerationJobPayload } from 'olea-core';
import { hashText } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import {
  createVaultDraftCacheStore,
  type DraftCacheStore,
  deriveDraftId,
} from '../../src/generation/cache-store.js';
import type { DraftCardsResult } from '../../src/generation/draft-cards.js';
import {
  createGenerationDraftRunner,
  createHasAnyBuiltKind,
  createHasDraftOfKind,
  hasBuiltAnyKindForConcept,
  runGenerationDraftJob,
} from '../../src/generation/generation-job-runner.js';
import { isOleaHomeNote } from '../../src/generation/home-note.js';
import type { DraftRecord } from '../../src/generation/types.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_NOTE_PATH = '01 Courses/COGS214/Week 2.md';
// `[D-214]`: a `.md` source gets a sibling home note, never itself (`homeNotePathForSource`).
const HOME_NOTE_PATH = '01 Courses/COGS214/Week 2 (Olea).md';
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

const groundedCards = (front: string): DraftCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'COGS214', conceptName: front, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: { cards: [{ front, back: 'the answer', subject: front }] },
  },
});

const refusedResponse: DraftQuizCardsResult = { status: 'refused', reason: 'no-hits' };

describe('runGenerationDraftJob', () => {
  it('drafts an mcq job and caches a pending record naming Olea’s home note beside the concept’s note', async () => {
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
      sourcePath: HOME_NOTE_PATH,
    } satisfies Partial<DraftRecord>);
  });

  it('a qa payload drafts through the card drafter and caches a pending qa card record', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn(async () => groundedResponse('Working memory'));
    const draftCardForConcept = vi.fn(async () => groundedCards('What is working memory?'));

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftForConcept,
        draftCardForConcept,
        generateDraftId: () => 'draft-qa-1',
      },
      payload({ instrumentKind: 'qa' }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(draftForConcept).not.toHaveBeenCalled();
    expect(draftCardForConcept).toHaveBeenCalledWith(expect.anything(), {
      courseCode: 'COGS214',
      conceptName: 'Working memory',
    });
    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      draftId: 'draft-qa-1',
      status: 'pending',
      instrumentType: 'qa',
      conceptIds: ['key-Working memory'],
      sourcePath: HOME_NOTE_PATH,
      card: { front: 'What is working memory?', back: 'the answer' },
    } satisfies Partial<DraftRecord>);
    expect(pending[0]?.provenance.taskId).toBe('cards.generate.v1');
    expect(pending[0]?.question).toBeUndefined();
  });

  it('a recall trigger for a recall-style course produces a card', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);

    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [concept('Working memory')],
        draftCardForConcept: async () => groundedCards('What is working memory?'),
      },
      payload({ instrumentKind: 'qa', trigger: 'format-ask' }),
    );

    expect(outcome).toEqual({ ok: true });
    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.instrumentType).toBe('qa');
  });

  it('a qa job follows the same refused, unparseable and transport-throw outcomes as mcq', async () => {
    const run = async (draftCardForConcept: () => Promise<DraftCardsResult>) => {
      const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
      const cache = createVaultDraftCacheStore(vault);
      const outcome = await runGenerationDraftJob(
        {
          vault,
          cache,
          draftDeps: () => ({}) as never,
          listConceptsForCourse: async () => [concept('Working memory')],
          draftCardForConcept,
        },
        payload({ instrumentKind: 'qa' }),
      );
      return { outcome, cached: (await cache.list()).length };
    };

    expect(await run(async () => ({ status: 'refused', reason: 'no-hits' }))).toEqual({
      outcome: { ok: true },
      cached: 0,
    });
    expect(
      await run(async () => ({
        status: 'drafted',
        request: { courseCode: 'COGS214', conceptName: 'x', sourceChunks: [] },
        response: { ok: true, result: { cards: [] } },
      })),
    ).toEqual({ outcome: { ok: true }, cached: 0 });
    expect(
      await run(async () => {
        throw new Error('network');
      }),
    ).toEqual({ outcome: { ok: false, retryable: true }, cached: 0 });
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

  it('never sends a transport call for a cloze payload — the honest failure is returned before either drafter could be called', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const draftForConcept = vi.fn(async () => groundedResponse('x'));
    const draftCardForConcept = vi.fn(async () => groundedCards('x'));

    await runGenerationDraftJob(
      { vault, cache, draftDeps: () => ({}) as never, draftForConcept, draftCardForConcept },
      payload({ instrumentKind: 'cloze' }),
    );

    expect(draftForConcept).not.toHaveBeenCalled();
    expect(draftCardForConcept).not.toHaveBeenCalled();
  });
});

describe('the job runner never targets her authored note (INV-6, ol-egov.141.89.105.20)', () => {
  const deps = (vault: MemoryVaultSource, cache: DraftCacheStore) => ({
    vault,
    cache,
    draftDeps: () => ({}) as never,
    listConceptsForCourse: async () => [concept('Working memory')],
    draftForConcept: async () => groundedResponse('Working memory'),
    draftCardForConcept: async () => groundedCards('What is working memory?'),
    generateDraftId: () => 'draft-h',
    now: () => new Date('2026-09-25T10:00:00-04:00'),
  });

  for (const kind of ['mcq', 'qa'] as const) {
    it(`a drained ${kind} job caches a draft targeting the home note, created with the concept in its topics`, async () => {
      const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
      const cache = createVaultDraftCacheStore(vault);

      expect(
        await runGenerationDraftJob(deps(vault, cache), payload({ instrumentKind: kind })),
      ).toEqual({
        ok: true,
      });

      const pending = await cache.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.sourcePath).toBe(HOME_NOTE_PATH);
      expect(pending[0]?.sourcePath).not.toBe(COURSE_NOTE_PATH);
      expect(pending[0]?.conceptIds[0]).toBe('key-Working memory');
      const home = await vault.read(HOME_NOTE_PATH);
      expect(isOleaHomeNote(home)).toBe(true);
      expect(home).toContain('Working memory');
      expect(await vault.read(COURSE_NOTE_PATH)).toBe(COURSE_NOTE);
    });

    it(`an accepted ${kind} job draft lands in the home note and leaves her note byte-identical`, async () => {
      const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
      const cache = createVaultDraftCacheStore(vault);
      await runGenerationDraftJob(deps(vault, cache), payload({ instrumentKind: kind }));
      const homeBefore = await vault.read(HOME_NOTE_PATH);

      const port = createDraftAcceptPort({
        vault,
        cache,
        deviceId: 'device-a',
        now: () => new Date('2026-09-25T11:00:00-04:00'),
        generateEventId: () => 'event-1',
      });
      await port.accept('draft-h', 'accepted');

      expect(await vault.read(COURSE_NOTE_PATH)).toBe(COURSE_NOTE);
      const homeAfter = await vault.read(HOME_NOTE_PATH);
      expect(homeAfter).not.toBe(homeBefore);
      expect(homeAfter).toContain(kind === 'qa' ? 'What is working memory?' : 'Working memory');
    });

    it(`a ${kind} job caches nothing when her own file already sits at the home note path`, async () => {
      const hers = '---\ntopic: [Other]\n---\n\nMine.\n';
      const vault = new MemoryVaultSource({
        [COURSE_NOTE_PATH]: COURSE_NOTE,
        [HOME_NOTE_PATH]: hers,
      });
      const cache = createVaultDraftCacheStore(vault);

      const outcome = await runGenerationDraftJob(
        deps(vault, cache),
        payload({ instrumentKind: kind }),
      );

      expect(outcome).toMatchObject({ ok: false, retryable: false });
      expect(await cache.listPending()).toHaveLength(0);
      expect(await vault.read(HOME_NOTE_PATH)).toBe(hers);
      expect(await vault.read(COURSE_NOTE_PATH)).toBe(COURSE_NOTE);
    });
  }
});

describe('the job runner never replaces another kind’s draft and never drafts beside a home note (ol-egov.141.89.105.26)', () => {
  const base = (vault: MemoryVaultSource, cache: DraftCacheStore) => ({
    vault,
    cache,
    draftDeps: () => ({}) as never,
    listConceptsForCourse: async () => [concept('Working memory')],
    draftForConcept: async () => groundedResponse('Working memory'),
    draftCardForConcept: async () => groundedCards('What is working memory?'),
    now: () => new Date('2026-09-25T10:00:00-04:00'),
  });

  it('a second-kind draft is cached beside the sweep’s first, and a retried job keeps one id', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const sweepId = await deriveDraftId('COGS214', 'Working memory', 0);
    // The sweep's cached draft: the same drafter, under the sweep's own kind-blind id.
    await runGenerationDraftJob(
      { ...base(vault, cache), generateDraftId: (c, n, q) => deriveDraftId(c, n, q) },
      payload({ instrumentKind: 'mcq' }),
    );
    expect((await cache.listPending()).map((r) => r.draftId)).toEqual([sweepId]);

    const run = () => runGenerationDraftJob(base(vault, cache), payload({ instrumentKind: 'qa' }));
    expect(await run()).toEqual({ ok: true });
    const afterFirst = await cache.listPending();
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.map((r) => r.draftId)).toContain(sweepId);
    expect(afterFirst.find((r) => r.draftId === sweepId)?.instrumentType).toBeUndefined();
    const qaIds = afterFirst.filter((r) => r.instrumentType === 'qa').map((r) => r.draftId);
    expect(qaIds).toHaveLength(1);

    expect(await run()).toEqual({ ok: true });
    const afterRetry = await cache.listPending();
    expect(afterRetry).toHaveLength(2);
    expect(afterRetry.filter((r) => r.instrumentType === 'qa').map((r) => r.draftId)).toEqual(
      qaIds,
    );
    expect(await vault.read(COURSE_NOTE_PATH)).toBe(COURSE_NOTE);
  });

  it('the sweep’s id for a first draft is unchanged', async () => {
    expect(await deriveDraftId('COGS214', 'Working memory', 0)).toBe(
      await hashText(JSON.stringify(['COGS214', 'Working memory', 0])),
    );
  });

  it('a concept whose first source path is a home note drafts into that home note, no doubled name', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    await runGenerationDraftJob(base(vault, cache), payload());
    const home = await vault.read(HOME_NOTE_PATH);
    expect(isOleaHomeNote(home)).toBe(true);

    // Her note listed after the home note: her note is chosen, so the same home note is reused.
    const both = {
      ...base(vault, cache),
      listConceptsForCourse: async () => [
        { ...concept('Working memory'), sourcePaths: [HOME_NOTE_PATH, COURSE_NOTE_PATH] },
      ],
    };
    expect(await runGenerationDraftJob(both, payload({ instrumentKind: 'qa' }))).toEqual({
      ok: true,
    });
    // Only home notes remain: the home note itself is the target.
    const only = {
      ...base(vault, cache),
      listConceptsForCourse: async () => [
        { ...concept('Working memory'), sourcePaths: [HOME_NOTE_PATH] },
      ],
    };
    expect(await runGenerationDraftJob(only, payload({ instrumentKind: 'qa' }))).toEqual({
      ok: true,
    });
    const targets = new Set((await cache.listPending()).map((r) => r.sourcePath));
    expect([...targets]).toEqual([HOME_NOTE_PATH]);
    expect(vault.exists('01 Courses/COGS214/Week 2 (Olea) (Olea).md')).resolves.toBe(false);
    expect(await vault.read(COURSE_NOTE_PATH)).toBe(COURSE_NOTE);
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

describe('createHasDraftOfKind', () => {
  async function cacheWith(instrumentType?: 'qa'): Promise<DraftCacheStore> {
    const cache = createVaultDraftCacheStore(new MemoryVaultSource());
    await cache.put({
      draftId: 'd1',
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['key-Working memory'],
      sourcePath: COURSE_NOTE_PATH,
      createdAt: '2026-09-25T10:00:00.000Z',
      ...(instrumentType
        ? { instrumentType, card: { front: 'f', back: 'b' } }
        : { question: { stem: 's', correctAnswer: 'a', distractors: ['b'], feedback: 'f' } }),
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
    } as DraftRecord);
    return cache;
  }

  it('reads an absent instrumentType as multiple choice, scoped to the pair', async () => {
    const has = createHasDraftOfKind(await cacheWith());
    expect(await has('COGS214', 'key-Working memory', 'mcq')).toBe(true);
    expect(await has('COGS214', 'key-Working memory', 'qa')).toBe(false);
    expect(await has('COGS214', 'key-Other', 'mcq')).toBe(false);
    expect(await has('OTHER', 'key-Working memory', 'mcq')).toBe(false);
  });

  it('matches a question-and-answer record only for qa', async () => {
    const has = createHasDraftOfKind(await cacheWith('qa'));
    expect(await has('COGS214', 'key-Working memory', 'qa')).toBe(true);
    expect(await has('COGS214', 'key-Working memory', 'mcq')).toBe(false);
  });
});
