/**
 * `createDraftAcceptPort`'s generalized-past-MCQ dispatch (`ol-0r92.88`).
 *
 * `accept.spec.ts` proves the port's protections against the one production
 * materializer that exists (`'mcq'` → `materializeAcceptedDraft`). This file
 * proves the SAME protections generalize to a second, non-`'mcq'` draft
 * kind — idempotency on the draft id, and the stale-input guard's defined
 * refusal — using an injected `DraftMaterializeFn` test double for `'qa'`,
 * since no production `'qa'` materializer exists yet (see `accept.ts`'s
 * module doc, "generalized past a hard-coded MCQ instrument type", for
 * exactly why: no client card-drafting pipeline produces a `'qa'`-kind
 * `DraftRecord`, and `olea-core`'s only Q&A vault-writer requires C1.4
 * anchoring, a hand-authoring concept a generated, unanchored item has no
 * value for). The double stands in for a future real materializer; the
 * dispatch, idempotency and stale-input logic under test is the port's own,
 * unchanged from the `'mcq'` path.
 *
 * Also covers the port's new defined refusal for a kind nothing has
 * registered a materializer for at all — never a silent mis-write.
 */
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort, type DraftMaterializeFn } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { StaleSourceRevisionError } from '../../src/generation/materialize-mcq.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const NOW = new Date('2026-08-25T10:00:00-07:00');

function baseCardRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-card-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: NOTE_PATH,
    createdAt: '2026-08-25T09:00:00-07:00',
    instrumentType: 'qa',
    card: { front: 'What limits working memory capacity?', back: 'Chunking' },
    provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

async function readVerdictLines(vault: MemoryVaultSource): Promise<Array<Record<string, unknown>>> {
  const path = reviewLogPath('2026-08-25', 'device-a');
  const raw = vault.raw(path);
  if (raw === undefined) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A fake `'qa'` materializer — records every call, returns a fixed synthetic id, never touches the vault (there is nothing real to write yet — see this file's module doc). */
function fakeQaMaterializer(instrumentId: string): {
  readonly fn: DraftMaterializeFn;
  readonly calls: DraftRecord[];
} {
  const calls: DraftRecord[] = [];
  const fn: DraftMaterializeFn = async (_vault, record) => {
    calls.push(record);
    return { instrumentId };
  };
  return { fn, calls };
}

function setUp(materializers: Parameters<typeof createDraftAcceptPort>[0]['materializers']) {
  const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
  const cache = createVaultDraftCacheStore(vault);
  let eventId = 0;
  const port = createDraftAcceptPort({
    vault,
    cache,
    deviceId: 'device-a',
    now: () => NOW,
    generateEventId: () => `event-${++eventId}`,
    ...(materializers !== undefined ? { materializers } : {}),
  });
  return { vault, cache, port };
}

describe('createDraftAcceptPort — generalized dispatch (ol-0r92.88)', () => {
  it('accept dispatches a non-mcq draft to its registered materializer and appends a verdict naming that instrument type', async () => {
    const { fn, calls } = fakeQaMaterializer('qa-fake-1');
    const { vault, cache, port } = setUp({ qa: fn });
    await cache.put(baseCardRecord());

    const { instrumentId } = await port.accept('draft-card-1', 'accepted');
    expect(instrumentId).toBe('qa-fake-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.draftId).toBe('draft-card-1');

    const resolved = await cache.get('draft-card-1');
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.instrumentId).toBe('qa-fake-1');

    // Nothing real to write for a card yet, so the vault stays untouched —
    // the fake never calls `vault.write`, exactly like a real materializer
    // that has nothing to do would not either.
    expect(vault.raw(NOTE_PATH)).toBe('# Week 2\n\nher prose\n');

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'qa-fake-1',
      instrumentType: 'qa',
      verdict: 'accepted',
      conceptIds: ['concept-key-1'],
    });
  });

  it('is idempotent on the draft id: a second accept call is a no-op, the materializer runs exactly once', async () => {
    const { fn, calls } = fakeQaMaterializer('qa-fake-1');
    const { vault, cache, port } = setUp({ qa: fn });
    await cache.put(baseCardRecord());

    const first = await port.accept('draft-card-1', 'accepted');
    const second = await port.accept('draft-card-1', 'accepted');

    expect(second.instrumentId).toBe(first.instrumentId);
    expect(calls).toHaveLength(1); // not called twice

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1); // no second verdict appended
  });

  it('a materializer throwing StaleSourceRevisionError leaves the record rejected, appends a rejected verdict naming the draft id and the draft\'s own instrument type, and a retry still refuses', async () => {
    const staleMaterializer: DraftMaterializeFn = async () => {
      throw new StaleSourceRevisionError('the source note changed since this draft was cached');
    };
    const { vault, cache, port } = setUp({ qa: staleMaterializer });
    await cache.put(baseCardRecord());

    await expect(port.accept('draft-card-1', 'accepted')).rejects.toThrow(StaleSourceRevisionError);

    const resolved = await cache.get('draft-card-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.instrumentId).toBeUndefined();

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'draft-card-1',
      instrumentType: 'qa',
      verdict: 'rejected',
    });

    // Retry: the record is now 'rejected' with no instrumentId, so this hits
    // the ordinary already-resolved branch and throws too — never a silent
    // re-accept, same posture the mcq stale-input guard already has
    // (`accept.spec.ts`).
    await expect(port.accept('draft-card-1', 'accepted')).rejects.toThrow(
      /already 'rejected' with no instrumentId/,
    );
    expect(await readVerdictLines(vault)).toHaveLength(1); // still no second verdict
  });

  it('reject works for a card-shaped draft with no materializer registered at all — reject never needs to materialize', async () => {
    const { vault, cache, port } = setUp(undefined);
    await cache.put(baseCardRecord());

    await port.reject('draft-card-1');

    const resolved = await cache.get('draft-card-1');
    expect(resolved?.status).toBe('rejected');

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'draft-card-1',
      instrumentType: 'qa',
      verdict: 'rejected',
    });
  });

  it('accept throws a named, defined error for a draft kind with no registered materializer — never a silent mis-write', async () => {
    const { cache, port } = setUp(undefined); // no 'qa' entry, and no override of the 'mcq' default
    await cache.put(baseCardRecord());

    await expect(port.accept('draft-card-1', 'accepted')).rejects.toThrow(
      /no materializer registered for draft draft-card-1's instrumentType 'qa'/,
    );

    // Refused before any bookkeeping — the record is untouched, still pending,
    // exactly like a materializer never having been called at all.
    const resolved = await cache.get('draft-card-1');
    expect(resolved?.status).toBe('pending');
  });

  it('an mcq-kind draft (instrumentType explicit, not defaulted) still accepts through the built-in default materializer with no injected materializers map', async () => {
    const { port, cache } = setUp(undefined);
    await cache.put({
      draftId: 'draft-mcq-explicit',
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['concept-key-1'],
      sourcePath: NOTE_PATH,
      createdAt: '2026-08-25T09:00:00-07:00',
      instrumentType: 'mcq',
      question: {
        stem: 'What limits working memory capacity?',
        correctAnswer: 'Chunking',
        distractors: ['A', 'B', 'C', 'D'],
        feedback: 'See the lecture notes.',
      },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
    });

    const { instrumentId } = await port.accept('draft-mcq-explicit', 'accepted');
    expect(instrumentId).toMatch(/^mcq-/);
  });
});
