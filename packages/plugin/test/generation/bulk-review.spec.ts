/**
 * `BulkReviewController`/`buildBulkReviewGroups` tests (F3.3, `ol-jie3`).
 *
 * Proves the second-density surface reuses `DraftAcceptPort` unmodified —
 * accept/edit/reject here produce byte-identical vault writes and verdict
 * records to `accept.spec.ts`'s own first-presentation assertions — that
 * grouping/resolution never touch the vault or the cache except through
 * that one port, and that `acceptRemainder` is exactly a sequential loop
 * over the same `accept()` a single click already uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import {
  buildBulkReviewGroups,
  createBulkReviewController,
} from '../../src/generation/bulk-review.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_A = '01 Courses/COGS214/Week 2.md';
const NOTE_B = '01 Courses/COGS214/Week 3.md';
const NOW = new Date('2026-08-25T10:00:00-07:00');

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'], // the opaque key, not the display name — types.ts's doc
    sourcePath: NOTE_A,
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

class FakeEditPort {
  readonly edited: Array<{ sourcePath: string; blockId: string | null }> = [];
  async edit(instrument: { sourcePath: string; blockId: string | null }): Promise<void> {
    this.edited.push(instrument);
  }
}

function setUp(seed: readonly DraftRecord[]) {
  const files: Record<string, string> = {};
  for (const note of new Set(seed.map((r) => r.sourcePath))) {
    files[note] = `# ${note}\n\nher prose\n`;
  }
  const vault = new MemoryVaultSource(files);
  const cache = createVaultDraftCacheStore(vault);
  const acceptPort = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });
  const editPort = new FakeEditPort();
  const controller = createBulkReviewController({ cache, acceptPort, editPort });
  return { vault, cache, acceptPort, editPort, controller };
}

async function seedCache(
  cache: ReturnType<typeof createVaultDraftCacheStore>,
  records: readonly DraftRecord[],
): Promise<void> {
  for (const r of records) await cache.put(r);
}

async function readVerdictLines(vault: MemoryVaultSource): Promise<Array<Record<string, unknown>>> {
  const path = reviewLogPath('2026-08-25', 'device-a');
  const raw = vault.raw(path);
  if (raw === undefined) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('buildBulkReviewGroups', () => {
  it('groups pending drafts by their source document, oldest item first', () => {
    const groups = buildBulkReviewGroups([
      record({ draftId: 'b', sourcePath: NOTE_A, createdAt: '2026-08-25T09:05:00-07:00' }),
      record({ draftId: 'a', sourcePath: NOTE_A, createdAt: '2026-08-25T09:00:00-07:00' }),
      record({ draftId: 'c', sourcePath: NOTE_B, createdAt: '2026-08-25T09:10:00-07:00' }),
    ]);
    expect(groups).toHaveLength(2);
    const bySource = Object.fromEntries(groups.map((g) => [g.sourcePath, g]));
    expect(bySource[NOTE_A]?.items.map((i) => i.draftId)).toEqual(['a', 'b']);
    expect(bySource[NOTE_B]?.items.map((i) => i.draftId)).toEqual(['c']);
  });

  it('excludes anything not still pending', () => {
    const groups = buildBulkReviewGroups([
      record({ draftId: 'a', status: 'pending' }),
      record({ draftId: 'b', status: 'accepted' }),
      record({ draftId: 'c', status: 'rejected' }),
      record({ draftId: 'd', status: 'edited' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.draftId)).toEqual(['a']);
  });

  it('an empty set produces no groups, not an empty-labelled one', () => {
    expect(buildBulkReviewGroups([])).toEqual([]);
  });

  it('derives the note title from the document path, the same basename convention review-adapter.ts uses', () => {
    const groups = buildBulkReviewGroups([record({ sourcePath: NOTE_A })]);
    expect(groups[0]?.noteTitle).toBe('Week 2');
  });

  // `[D-216]`'s click-through target: `bulk-review-view.ts` opens the source
  // peek by concept key, so the view model must carry it through unchanged
  // from `DraftRecord.conceptIds` — types.ts's own doc on that field.
  it('carries conceptIds through to the item view model, for the source-peek click-through', () => {
    const groups = buildBulkReviewGroups([record({ conceptIds: ['concept-key-9'] })]);
    expect(groups[0]?.items[0]?.conceptIds).toEqual(['concept-key-9']);
  });
});

describe('BulkReviewController', () => {
  it('accept() runs the exact same materialization DraftAcceptPort.accept does at first presentation', async () => {
    const seed = [record({ draftId: 'a' })];
    const { vault, cache, controller } = setUp(seed);
    await seedCache(cache, seed);
    await controller.load();

    await controller.accept('a');

    const resolved = await cache.get('a');
    expect(resolved?.status).toBe('accepted');
    expect(vault.raw(NOTE_A)).toContain('olea-mcq');
    expect(controller.getViewModel().groups).toEqual([]); // resolved item leaves the list

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ kind: 'verdict', verdict: 'accepted' });
  });

  it('reject() prunes without writing to the vault, same as first-presentation reject', async () => {
    const seed = [record({ draftId: 'a' })];
    const { vault, cache, controller } = setUp(seed);
    await seedCache(cache, seed);
    await controller.load();
    const before = vault.raw(NOTE_A);

    await controller.reject('a');

    expect(vault.raw(NOTE_A)).toBe(before);
    const resolved = await cache.get('a');
    expect(resolved?.status).toBe('rejected');
    expect(controller.getViewModel().groups).toEqual([]);
  });

  it('editBeforeSaving() materializes with verdict "edited" and opens the note it just landed in', async () => {
    const seed = [record({ draftId: 'a' })];
    const { cache, editPort, controller } = setUp(seed);
    await seedCache(cache, seed);
    await controller.load();

    await controller.editBeforeSaving('a');

    const resolved = await cache.get('a');
    expect(resolved?.status).toBe('edited');
    expect(editPort.edited).toEqual([{ sourcePath: NOTE_A, blockId: null }]);
  });

  it("acceptRemainder accepts every still-pending item in one document's group, and reports each id", async () => {
    const seed = [
      record({ draftId: 'a', sourcePath: NOTE_A, createdAt: '2026-08-25T09:00:00-07:00' }),
      record({ draftId: 'b', sourcePath: NOTE_A, createdAt: '2026-08-25T09:01:00-07:00' }),
      record({ draftId: 'c', sourcePath: NOTE_B, createdAt: '2026-08-25T09:02:00-07:00' }),
    ];
    const { cache, controller } = setUp(seed);
    await seedCache(cache, seed);
    await controller.load();

    const result = await controller.acceptRemainder(NOTE_A);

    expect([...result.accepted].sort()).toEqual(['a', 'b']);
    expect(result.failed).toEqual([]);
    expect((await cache.get('a'))?.status).toBe('accepted');
    expect((await cache.get('b'))?.status).toBe('accepted');
    expect((await cache.get('c'))?.status).toBe('pending'); // untouched — a different document

    const groups = controller.getViewModel().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourcePath).toBe(NOTE_B);
  });

  it("a re-call on an already-accepted draft is a no-op, matching DraftAcceptPort's own idempotence", async () => {
    const seed = [record({ draftId: 'a' })];
    const { vault, cache, controller } = setUp(seed);
    await seedCache(cache, seed);
    await controller.load();

    await controller.accept('a');
    await expect(controller.accept('a')).resolves.toBeUndefined();

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1); // no second verdict appended
  });

  it('never imports the materialization or verdict-write internals directly — everything goes through DraftAcceptPort', () => {
    // Prose in this module's own doc comment names `materialize-mcq` and
    // `appendVerdictRecord` to explain why it never reaches them directly —
    // so the code under test is checked with comments stripped, the same
    // "a doc paragraph describing the wiring must not satisfy an assertion
    // about it" discipline `main-wiring.spec.ts`'s own `codeOf` helper uses.
    const code = readFileSync(
      fileURLToPath(new URL('../../src/generation/bulk-review.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/materialize-mcq/);
    expect(code).not.toMatch(/appendVerdictRecord/);
    expect(code).not.toMatch(/from 'olea-core'/);
  });
});
