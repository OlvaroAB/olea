/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit) —
 * `findByKey`'s optional `expected` version comparison. Kept separate from
 * `cache-store.spec.ts` so that suite's version-blind assertions (still
 * exercised there, unchanged) stay a clean signal that omitting `expected`
 * is byte-identical to before this bead.
 */
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['Working memory'],
    sourcePath: '01 Courses/COGS214/Week 2.md',
    sourceContentHash: 'h1',
    createdAt: '2026-08-25T10:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking limits',
      distractors: ['Distractor A', 'Distractor B', 'Distractor C'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: 'v1', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  } as DraftRecord;
}

describe('findByKey — D-381 version expectation', () => {
  it('omitting expected is byte-identical to today: any prior draft blocks, regardless of digest/version', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));

    const found = await cache.findByKey('COGS214', 'Working memory');
    expect(found?.draftId).toBe('a');
  });

  it('an unchanged version reuses the cache: matching sourceContentHash and promptVersion still blocks', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));

    const found = await cache.findByKey('COGS214', 'Working memory', {
      sourceContentHash: 'h1',
      promptVersion: 'v1',
    });
    expect(found?.draftId).toBe('a');
  });

  it('a bumped promptVersion marks the older result stale — findByKey reports no blocking record, without touching the stale one', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const original = record({ draftId: 'a' });
    await cache.put(original);

    const found = await cache.findByKey('COGS214', 'Working memory', {
      sourceContentHash: 'h1',
      promptVersion: 'v2',
    });
    expect(found).toBeNull();

    // The stale record itself is untouched — INV-2 / D-381's clarification.
    const stillThere = await cache.get('a');
    expect(stillThere).toEqual(original);
  });

  it('a changed sourceContentHash also marks the older result stale, for an unchanged promptVersion', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));

    const found = await cache.findByKey('COGS214', 'Working memory', {
      sourceContentHash: 'h2',
      promptVersion: 'v1',
    });
    expect(found).toBeNull();
  });

  it('an accepted record that is version-stale is still reported as no blocking record, but its own status/content is never rewritten', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const accepted = record({ draftId: 'a', status: 'accepted' });
    await cache.put(accepted);

    const found = await cache.findByKey('COGS214', 'Working memory', {
      sourceContentHash: 'h1',
      promptVersion: 'v2',
    });
    expect(found).toBeNull();

    const stillAccepted = await cache.get('a');
    expect(stillAccepted?.status).toBe('accepted');
    expect(stillAccepted).toEqual(accepted);
  });

  it('a partial expectation (promptVersion only) ignores sourceContentHash entirely', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const { sourceContentHash: _omit, ...withoutSourceContentHash } = record({ draftId: 'a' });
    await cache.put(withoutSourceContentHash as DraftRecord);

    const found = await cache.findByKey('COGS214', 'Working memory', { promptVersion: 'v1' });
    expect(found?.draftId).toBe('a');
  });
});
