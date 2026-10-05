/**
 * `ol-egov.141.89.5.75` ([D-508]): the rewrite path drafts from the changed passage and an empty or
 * unparseable draft is retried under a bound, never dropped silently. Synthetic text only.
 */

import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  createRevisionAwareJobRunner,
  REVISION_EMPTY_DRAFT_MAX_ATTEMPTS,
  runInstrumentRevisionJob,
} from '../../src/generation/revision-job-runner.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = 'Courses/GEO101/Week 3.md';
const PREDECESSOR_ID = 'mcq-old-1';
const NOTE = [
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

const PASSAGE = 'Synthetic changed passage: layers thicken toward the basin centre.';

function job(attempts?: number) {
  return {
    payload: {
      kind: 'instrument-revision' as const,
      predecessorInstrumentId: PREDECESSOR_ID,
      newPassageText: PASSAGE,
    },
    attempts,
  };
}

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
  result: {
    questions: [{ stem: 'S', correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'f' }],
  },
};

const drafted = (response: unknown): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'GEO101', conceptName: 'Sediment layering', sourceChunks: ['c'] },
  response,
});

describe('the successor is drafted from the changed passage (ol-egov.141.89.5.75, D-508)', () => {
  it('a mcq successor generate call carries the job passage in sourceChunks, first, with origins kept aligned', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const sent: { taskId: string; payload: Record<string, unknown> }[] = [];
    const base = {
      send: vi.fn(async (req: { taskId: string; payload: unknown }) => {
        sent.push({ taskId: req.taskId, payload: req.payload as Record<string, unknown> });
        return goodResponse;
      }),
    };
    await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({ transport: base }) as unknown as DraftQuizCardsDeps,
        // Stands in for draftQuizCardsForConcept: retrieval grounded on a stale chunk only.
        draftForConcept: async (deps) => {
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'quiz.generate.v1',
            payload: {
              courseCode: 'GEO101',
              conceptName: 'Sediment layering',
              sourceChunks: ['stale retrieved chunk'],
              sourceChunkOrigins: [null],
            },
          });
          return drafted(goodResponse);
        },
      },
      job().payload,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.sourceChunks).toEqual([PASSAGE, 'stale retrieved chunk']);
    expect(sent[0]?.payload.sourceChunkOrigins).toEqual([null, null]);
  });

  it('leaves non-generation calls (the grounding judge) and an already-present passage untouched', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const sent: { taskId: string; payload: Record<string, unknown> }[] = [];
    const base = {
      send: async (req: { taskId: string; payload: unknown }) => {
        sent.push({ taskId: req.taskId, payload: req.payload as Record<string, unknown> });
        return goodResponse;
      },
    };
    await runInstrumentRevisionJob(
      {
        vault,
        cache,
        draftDeps: () => ({ transport: base }) as unknown as DraftQuizCardsDeps,
        draftForConcept: async (deps) => {
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'grounding.judge.v1',
            payload: { sourceChunks: ['x'] },
          });
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'quiz.generate.v1',
            payload: { sourceChunks: [PASSAGE, 'other'] },
          });
          return drafted(goodResponse);
        },
      },
      job().payload,
    );
    expect(sent[0]?.payload.sourceChunks).toEqual(['x']);
    expect(sent[1]?.payload.sourceChunks).toEqual([PASSAGE, 'other']);
  });

  it('a qa successor generate call carries the passage too, and a qa empty draft is bounded the same way', async () => {
    const qaNote = [
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
    const vault = new MemoryVaultSource({ 'Courses/GEO101/Week 4.md': qaNote });
    const { records } = await enumerateVaultInstruments(vault);
    const predecessorInstrumentId = records[0]?.instrumentId ?? '';
    const cache = createVaultDraftCacheStore(vault);
    const sent: Record<string, unknown>[] = [];
    const base = {
      send: async (req: { payload: unknown }) => {
        sent.push(req.payload as Record<string, unknown>);
        return { ok: true, result: { cards: [] } };
      },
    };
    const deps = {
      vault,
      cache,
      draftDeps: () => ({ transport: base }) as unknown as DraftQuizCardsDeps,
      draftCardForConcept: async (d: { transport: typeof base }) => {
        await d.transport.send({
          contractVersion: 1,
          taskId: 'cards.generate.v1',
          payload: { sourceChunks: ['stale'] },
        } as never);
        return {
          status: 'drafted' as const,
          request: { courseCode: 'GEO101', conceptName: 'c', sourceChunks: ['stale'] },
          response: { ok: true, result: { cards: [] } },
        };
      },
    };
    const payload = {
      kind: 'instrument-revision' as const,
      predecessorInstrumentId,
      newPassageText: PASSAGE,
    };
    const first = await runInstrumentRevisionJob(deps as never, payload, 1);
    expect(sent[0]?.sourceChunks).toEqual([PASSAGE, 'stale']);
    expect(first).toEqual({ ok: false, retryable: true });
    const last = await runInstrumentRevisionJob(
      deps as never,
      payload,
      REVISION_EMPTY_DRAFT_MAX_ATTEMPTS,
    );
    expect(last).toMatchObject({ ok: false, retryable: false });
  });
});

describe('an empty or unparseable draft is retried under a bound, then fails loudly', () => {
  const emptyResponse = {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: { questions: [] },
  };
  const cases: [string, unknown][] = [
    ['empty', emptyResponse],
    ['unparseable', { ok: true, result: 'not an object' }],
  ];

  for (const [label, response] of cases) {
    it(`${label}: an early attempt is retryable, so the queue backs off and asks again`, async () => {
      const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
      const cache = createVaultDraftCacheStore(vault);
      const run = createRevisionAwareJobRunner({
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => drafted(response),
        fallback: async () => ({ ok: true }),
      });
      const outcome = await run({
        contentHash: 'h',
        label: 'l',
        payload: job().payload,
        attempts: 1,
      });
      expect(outcome).toEqual({ ok: false, retryable: true });
      expect(await cache.listPending()).toEqual([]);
    });

    it(`${label}: at the bound the job fails non-retryably with a reason (a recorded failure)`, async () => {
      const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
      const cache = createVaultDraftCacheStore(vault);
      const run = createRevisionAwareJobRunner({
        vault,
        cache,
        draftDeps: () => ({}) as never,
        draftForConcept: async () => drafted(response),
        fallback: async () => ({ ok: true }),
      });
      const outcome = await run({
        contentHash: 'h',
        label: 'l',
        payload: job().payload,
        attempts: REVISION_EMPTY_DRAFT_MAX_ATTEMPTS,
      });
      expect(outcome).toEqual({
        ok: false,
        retryable: false,
        reason: expect.stringContaining(PREDECESSOR_ID),
      });
    });
  }

  it('a good draft on a later attempt still caches and completes', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const run = createRevisionAwareJobRunner({
      vault,
      cache,
      draftDeps: () => ({}) as never,
      draftForConcept: async () => drafted(goodResponse),
      fallback: async () => ({ ok: true }),
    });
    const outcome = await run({
      contentHash: 'h',
      label: 'l',
      payload: job().payload,
      attempts: 2,
    });
    expect(outcome).toEqual({ ok: true });
    expect(await cache.listPending()).toHaveLength(1);
  });
});
