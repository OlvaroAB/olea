/**
 * `createDraftAcceptPort` tests (F3.3, `[D-097]`, INV-6, `ol-mfn0`).
 *
 * Proves the three outcomes each do the vault write (if any) and the
 * `verdictLogRecordV4` append as one unit: accept/edit materialize and
 * record a verdict naming the REAL instrument id; reject writes nothing to
 * the vault and records a verdict naming the draft's own id; a re-call on
 * an already-resolved draft is a no-op rather than a double write.
 */
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const NOW = new Date('2026-08-25T10:00:00-07:00');

function baseRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'], // the opaque key (`ol-63e1`'s flip), not the display name
    sourcePath: NOTE_PATH,
    createdAt: '2026-08-25T09:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking',
      distractors: ['A', 'B', 'C', 'D'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

function setUp() {
  const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
  const cache = createVaultDraftCacheStore(vault);
  let eventId = 0;
  const port = createDraftAcceptPort({
    vault,
    cache,
    deviceId: 'device-a',
    now: () => NOW,
    generateEventId: () => `event-${++eventId}`,
  });
  return { vault, cache, port };
}

async function readVerdictLines(vault: MemoryVaultSource): Promise<unknown[]> {
  const path = reviewLogPath('2026-08-25', 'device-a');
  const raw = vault.raw(path);
  if (raw === undefined) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('createDraftAcceptPort', () => {
  it('accept materializes into the vault, updates the cache, and appends an accepted verdict naming the real instrument', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());

    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect(instrumentId).toMatch(/^mcq-/);

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.instrumentId).toBe(instrumentId);
    expect(resolved?.resolvedAt).toBeDefined();

    expect(vault.raw(NOTE_PATH)).toContain('her prose');
    expect(vault.raw(NOTE_PATH)).toContain('olea-mcq');

    const verdicts = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId,
      verdict: 'accepted',
      conceptIds: ['concept-key-1'], // the OPAQUE key, not the display name — types.ts's doc
      artifactProvenance: {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.0.0',
        modelId: 'test-model',
      },
    });
  });

  it('reject writes nothing to the vault and records a verdict naming the draft id', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    const noteBefore = vault.raw(NOTE_PATH);

    await port.reject('draft-1');

    expect(vault.raw(NOTE_PATH)).toBe(noteBefore); // untouched

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.instrumentId).toBeUndefined();

    const verdicts = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'draft-1',
      verdict: 'rejected',
      conceptIds: ['concept-key-1'],
    });
  });

  it('a second accept call on an already-accepted draft is a no-op, not a second write', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    const first = await port.accept('draft-1', 'accepted');
    const noteAfterFirst = vault.raw(NOTE_PATH);

    const second = await port.accept('draft-1', 'accepted');
    expect(second.instrumentId).toBe(first.instrumentId);
    expect(vault.raw(NOTE_PATH)).toBe(noteAfterFirst); // no second MCQ block inserted

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1); // no second verdict appended
  });

  it('a reject call on an already-rejected draft is a no-op', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    await port.reject('draft-1');
    await port.reject('draft-1');

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
  });

  it('accept throws for an unknown draft id (programmer error, not a recoverable condition)', async () => {
    const { port } = setUp();
    await expect(port.accept('does-not-exist', 'accepted')).rejects.toThrow();
  });
});
