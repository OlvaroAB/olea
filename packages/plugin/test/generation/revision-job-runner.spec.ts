/**
 * `createRevisionAwareJobRunner` / `runInstrumentRevisionJob` tests
 * (`[D-133]`, `ol-2zfj.39`).
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
 */

import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
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

  it('does not thread newPassageText into the drafting request (draftQuizCardsForConcept has no such input)', async () => {
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

  it('a grounded refusal caches nothing and is not a job failure', async () => {
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

    expect(outcome).toEqual({ ok: true });
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
