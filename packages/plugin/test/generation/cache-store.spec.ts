/**
 * `createVaultDraftCacheStore` tests (`[CACHE-1]`/C6.2, `ol-p3t07a`).
 *
 * Proves: per-record files (not one shared blob), a byte-for-byte round
 * trip, dedupe lookup by (course, concept), and F3.3's "reject prunes …
 * retained in full, never deleted" as a property of the STORE, not just a
 * caller's discipline.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultDraftCacheStore,
  DRAFT_CACHE_FOLDER,
} from '../../src/generation/cache-store.js';
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
    createdAt: '2026-08-25T10:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking limits',
      distractors: ['Distractor A', 'Distractor B', 'Distractor C'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

describe('createVaultDraftCacheStore', () => {
  it('writes one file per draft, under the dot-prefixed vault folder', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));
    await cache.put(record({ draftId: 'b', conceptName: 'Attention' }));

    expect(vault.raw(`${DRAFT_CACHE_FOLDER}/a.json`)).toBeDefined();
    expect(vault.raw(`${DRAFT_CACHE_FOLDER}/b.json`)).toBeDefined();
    // Two devices drafting different concepts touch different files — the
    // records themselves never share a byte.
    expect(vault.raw(`${DRAFT_CACHE_FOLDER}/a.json`)).not.toEqual(
      vault.raw(`${DRAFT_CACHE_FOLDER}/b.json`),
    );
  });

  it('round-trips a record exactly, field for field', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const original = record();
    await cache.put(original);

    const readBack = await cache.get('draft-1');
    expect(readBack).toEqual(original);
  });

  it('list() and listPending() discover records through the index, not vault.list()', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));
    await cache.put(record({ draftId: 'b', status: 'rejected' }));

    const all = await cache.list();
    expect(all.map((r) => r.draftId).sort()).toEqual(['a', 'b']);

    const pending = await cache.listPending();
    expect(pending.map((r) => r.draftId)).toEqual(['a']);
  });

  it('findByKey dedupes on (courseCode, conceptName), any status', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a', status: 'rejected' }));

    const found = await cache.findByKey('COGS214', 'Working memory');
    expect(found?.draftId).toBe('a');

    const notFound = await cache.findByKey('COGS214', 'Some other concept');
    expect(notFound).toBeNull();
  });

  it('reject (a status flip via put) never removes the file — retained in full, never deleted (F3.3)', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));
    const before = await vault.exists(`${DRAFT_CACHE_FOLDER}/a.json`);
    expect(before).toBe(true);

    const pending = await cache.get('a');
    expect(pending).not.toBeNull();
    await cache.put({ ...pending!, status: 'rejected', resolvedAt: '2026-08-25T11:00:00-07:00' });

    const after = await vault.exists(`${DRAFT_CACHE_FOLDER}/a.json`);
    expect(after).toBe(true);
    const record2 = await cache.get('a');
    expect(record2?.status).toBe('rejected');
    // The question text — the substantive content of the draft — is
    // untouched by the status flip.
    expect(record2?.question).toEqual(pending!.question);
  });

  it('a corrupt per-record file is skipped, not thrown on', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(record({ draftId: 'a' }));
    await vault.write(`${DRAFT_CACHE_FOLDER}/a.json`, 'not json{{{');

    await expect(cache.list()).resolves.toEqual([]);
    await expect(cache.get('a')).resolves.toBeNull();
  });

  describe('the bounded index race (ol-y6ty)', () => {
    // `index.json` is the one non-per-record file `put()` maintains (see the
    // module doc). Two devices drafting different concepts in the same sync
    // window can each read the index before the other's write lands, then
    // both write their own upsert on top of that stale snapshot — the
    // second write to actually reach this vault wins the whole file, and the
    // other device's entry is silently gone from it. This block constructs
    // that end state directly (rather than racing real promises, which
    // `MemoryVaultSource`'s synchronous map can't meaningfully interleave)
    // to pin down exactly what survives and what doesn't.

    async function loseAnIndexUpdate(vault: MemoryVaultSource) {
      const cache = createVaultDraftCacheStore(vault);
      // Device 1 drafts "a" first — its write of a.json and its index write
      // both land.
      await cache.put(record({ draftId: 'a' }));

      // Device 2 drafts "b" from a snapshot that never saw device 1's index
      // write (it read the index before "a" was in it). Its own per-record
      // file write is real and independent; its index write is the one that
      // reaches the vault LAST in this window, so it wins outright and
      // device 1's entry is dropped — exactly what an `upsertEntry` computed
      // from a stale (pre-"a") snapshot would produce.
      const bRecord = record({ draftId: 'b', conceptName: 'Attention' });
      await vault.write(`${DRAFT_CACHE_FOLDER}/b.json`, `${JSON.stringify(bRecord, null, 2)}\n`);
      await vault.write(
        `${DRAFT_CACHE_FOLDER}/index.json`,
        `${JSON.stringify(
          {
            version: 1,
            entries: [
              {
                draftId: 'b',
                courseCode: bRecord.courseCode,
                conceptName: bRecord.conceptName,
                status: bRecord.status,
              },
            ],
          },
          null,
          2,
        )}\n`,
      );
      return cache;
    }

    it('never loses the per-record file — "a" is readable by id straight through the race', async () => {
      const vault = new MemoryVaultSource();
      const cache = await loseAnIndexUpdate(vault);

      const a = await cache.get('a');
      expect(a?.draftId).toBe('a');
      expect(a?.conceptName).toBe('Working memory');
    });

    it('drops "a" from discovery until it is touched again — list(), listPending() and findByKey all miss it', async () => {
      const vault = new MemoryVaultSource();
      const cache = await loseAnIndexUpdate(vault);

      const all = await cache.list();
      expect(all.map((r) => r.draftId)).toEqual(['b']);

      const pending = await cache.listPending();
      expect(pending.map((r) => r.draftId)).toEqual(['b']);

      // This is the concrete cost the module doc names: a concept sweep
      // re-checking "a" via findByKey sees no existing draft and would
      // generate a duplicate, not because "a" is gone but because the
      // index — the only thing findByKey consults — no longer points at it.
      const found = await cache.findByKey('COGS214', 'Working memory');
      expect(found).toBeNull();
    });

    it('self-heals "a" the next time IT is touched, without re-losing "b"', async () => {
      const vault = new MemoryVaultSource();
      const cache = await loseAnIndexUpdate(vault);

      const a = await cache.get('a');
      await cache.put({ ...a!, status: 'accepted' });

      const all = await cache.list();
      expect(all.map((r) => r.draftId).sort()).toEqual(['a', 'b']);
      const healedA = await cache.findByKey('COGS214', 'Working memory');
      expect(healedA?.status).toBe('accepted');
      // "b" was never touched again and was never lost — only "a" needed
      // repairing.
      const stillB = await cache.findByKey('COGS214', 'Attention');
      expect(stillB?.draftId).toBe('b');
    });
  });
});
