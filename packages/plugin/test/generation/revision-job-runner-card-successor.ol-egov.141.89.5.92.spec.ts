/**
 * A withheld generated card gets a card successor in production (`ol-egov.141.89.5.92`,
 * `[D-508]`, `[D-541]`). The runner used to draft a card successor only when a caller injected
 * `draftCardForConcept`; no production composition did, so the job ended `ok` with nothing
 * drafted. The runner now defaults to the real `draftCardsForConcept` (as the quiz branch does),
 * which drafts under the drafting scope of `[D-544]` inside `draft-cards.ts`.
 *
 * `draftCardsForConcept` is replaced by a fake: no model is called.
 */
import { readFileSync } from 'node:fs';
import { enumerateVaultInstruments } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftCardsResult } from '../../src/generation/draft-cards.js';
import {
  REVISION_EMPTY_DRAFT_MAX_ATTEMPTS,
  runInstrumentRevisionJob,
} from '../../src/generation/revision-job-runner.js';
import { MemoryVaultSource } from './fakes.js';

// A plain delegating function, not the spy itself: vitest reports a spy's rejected promise as an
// unhandled error even when the caller handles it.
const realCardDrafter = vi.hoisted(() => {
  const spy = vi.fn();
  let failure: Error | undefined;
  return {
    spy,
    failWith: (e: Error | undefined) => {
      failure = e;
    },
    call: async (...args: unknown[]) => {
      if (failure !== undefined) throw failure;
      return spy(...args);
    },
  };
});
vi.mock('../../src/generation/draft-cards.js', () => ({
  draftCardsForConcept: realCardDrafter.call,
}));

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

const drafted = (front: string): DraftCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'GEO101', conceptName: front, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: { cards: [{ front, back: 'Chunking', subject: 'Sediment layering' }] },
  },
});

async function setup() {
  const vault = new MemoryVaultSource({ [QA_NOTE_PATH]: QA_NOTE });
  const { records } = await enumerateVaultInstruments(vault);
  const predecessorInstrumentId = records[0]?.instrumentId ?? '';
  const cache = createVaultDraftCacheStore(vault);
  const deps = { vault, cache, draftDeps: () => ({}) as never, generateDraftId: () => 'd-1' };
  const payload = {
    kind: 'instrument-revision' as const,
    predecessorInstrumentId,
    newPassageText: 'the updated passage text',
  };
  return { cache, deps, payload, predecessorInstrumentId };
}

describe('a withheld generated card gets a card successor with no injected drafter', () => {
  beforeEach(() => {
    realCardDrafter.spy.mockReset();
    realCardDrafter.failWith(undefined);
  });

  it('drafts through the real card drafter and caches a qa-kind successor naming the predecessor', async () => {
    realCardDrafter.spy.mockResolvedValue(drafted('Sediment layering'));
    const { cache, deps, payload, predecessorInstrumentId } = await setup();
    const outcome = await runInstrumentRevisionJob(deps, payload);
    expect(outcome).toEqual({ ok: true });
    expect(realCardDrafter.spy).toHaveBeenCalledTimes(1);
    expect(realCardDrafter.spy).toHaveBeenCalledWith(expect.anything(), {
      courseCode: 'GEO101',
      conceptName: 'Sediment layering',
    });
    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      instrumentType: 'qa',
      card: { front: 'Sediment layering', back: 'Chunking' },
      predecessorInstrumentId,
    });
  });

  it('a refusal leaves it withheld: nothing cached, a recorded non-retryable failure', async () => {
    realCardDrafter.spy.mockResolvedValue({ status: 'refused', reason: 'no-hits' });
    const { cache, deps, payload } = await setup();
    const outcome = await runInstrumentRevisionJob(deps, payload);
    expect(outcome).toMatchObject({ ok: false, retryable: false });
    expect(await cache.listPending()).toEqual([]);
  });

  it('a thrown failure leaves it withheld and retryable', async () => {
    realCardDrafter.failWith(new Error('worker down'));
    const { cache, deps, payload } = await setup();
    expect(await runInstrumentRevisionJob(deps, payload)).toEqual({ ok: false, retryable: true });
    expect(await cache.listPending()).toEqual([]);
  });

  it('an empty draft is retried, then fails at the bound, as for a quiz successor', async () => {
    realCardDrafter.spy.mockResolvedValue({
      ...drafted('x'),
      response: {
        ok: true,
        stamp: { contractVersion: 1, promptVersion: '1', modelId: 'm' },
        result: { cards: [] },
      },
    });
    const { deps, payload } = await setup();
    expect(await runInstrumentRevisionJob(deps, payload, 1)).toEqual({
      ok: false,
      retryable: true,
    });
    expect(
      await runInstrumentRevisionJob(deps, payload, REVISION_EMPTY_DRAFT_MAX_ATTEMPTS),
    ).toMatchObject({ ok: false, retryable: false });
  });

  it('main.ts needs no card seam: its revision literal supplies draftDeps and the runner defaults the card drafter', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(
      /revision:\s*\{[\s\S]{0,200}?draftDeps:\s*\(\)\s*=>\s*this\.draftQuizCardsDeps\(\)/,
    );
    const runner = readFileSync(
      new URL('../../src/generation/revision-job-runner.ts', import.meta.url),
      'utf8',
    );
    expect(runner).toMatch(/deps\.draftCardForConcept \?\? draftCardsForConcept/);
  });
});
