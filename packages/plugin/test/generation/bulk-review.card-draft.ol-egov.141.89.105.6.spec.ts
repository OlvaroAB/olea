/**
 * Scenarios: "the clearing list shows a card draft's front and back with its named origin" and
 * "'Accept the rest' accepts exactly the drafts the list shows" —
 * @auto:plugin/generation/bulk-review.card-draft.ol-egov.141.89.105.6.spec
 * (F3.3, `[D-541]`, `[D-555]`, `[D-216]`). Synthetic fixtures only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import {
  buildBulkReviewGroups,
  createBulkReviewController,
} from '../../src/generation/bulk-review.js';
import * as copy from '../../src/generation/bulk-review-copy.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTE = '01 Courses/TEST101/Week 2.md';
const NOW = new Date('2026-08-25T10:00:00-07:00');
const PROV = { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' };

function quiz(draftId: string, createdAt: string): DraftRecord {
  return {
    draftId,
    status: 'pending',
    courseCode: 'TEST101',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: NOTE,
    createdAt,
    question: {
      stem: 'Quiz stem?',
      correctAnswer: 'Chunking',
      distractors: ['A', 'B', 'C', 'D'],
      feedback: 'f',
    },
    provenance: PROV,
    firstServedAt: null,
  };
}
function card(draftId: string, createdAt: string): DraftRecord {
  const { question: _q, ...rest } = quiz(draftId, createdAt);
  return {
    ...rest,
    instrumentType: 'qa',
    card: { front: 'Card front?', back: 'Card back.' },
    provenance: { ...PROV, taskId: 'cards.generate.v1' },
  };
}

describe('bulk review lists a card draft', () => {
  it('has a card row beside the quiz rows, with front, back, and no distractor pool', () => {
    const groups = buildBulkReviewGroups([
      quiz('q1', '2026-08-25T09:00:00-07:00'),
      card('c1', '2026-08-25T09:01:00-07:00'),
    ]);
    expect(groups).toHaveLength(1);
    const items = groups[0]?.items ?? [];
    expect(items.map((i) => i.draftId)).toEqual(['q1', 'c1']);
    const c = items[1];
    expect(c?.stem).toBe('Card front?');
    expect(c?.correctAnswer).toBe('Card back.');
    expect(c?.distractors).toEqual([]);
    expect(c?.conceptIds).toEqual(['concept-key-1']);
    // the quiz row is unchanged
    expect(items[0]?.stem).toBe('Quiz stem?');
    expect(items[0]?.distractors).toHaveLength(4);
  });

  it('marks a card row "Q&A" where a quiz row is marked "MCQ" ([D-555])', () => {
    const groups = buildBulkReviewGroups([
      quiz('q1', '2026-08-25T09:00:00-07:00'),
      card('c1', '2026-08-25T09:01:00-07:00'),
    ]);
    const [q, c] = groups[0]?.items ?? [];
    expect(q?.itemType).toBe('mcq');
    expect(c?.itemType).toBe('qa');
    expect(copy.BULK_REVIEW_ITEM_TYPE_LABEL).toBe('MCQ');
    expect(copy.BULK_REVIEW_CARD_ITEM_TYPE_LABEL).toBe('Q&A');
    expect(copy.bulkReviewItemTypeLabel('mcq')).toBe('MCQ');
    expect(copy.bulkReviewItemTypeLabel('qa')).toBe('Q&A');
  });

  it('the view draws the type mark from the item, and the back with no "correct" mark', () => {
    const view = readFileSync(
      join(__dirname, '..', '..', 'src/generation/bulk-review-view.ts'),
      'utf8',
    );
    expect(view).toMatch(/bulkReviewItemTypeLabel\(item\.itemType\)/);
    expect(view).toMatch(/item\.itemType === 'qa'/);
    expect(view).toMatch(/olea-bulk-review-item-back/);
  });
});

describe('"Accept the rest" accepts exactly the drafts the list shows', () => {
  it('accepts the listed card draft and quiz drafts, and nothing the list did not show', async () => {
    const seed = [
      quiz('q1', '2026-08-25T09:00:00-07:00'),
      card('c1', '2026-08-25T09:01:00-07:00'),
      // a malformed draft with neither question nor card: the list cannot show it
      { ...card('x1', '2026-08-25T09:02:00-07:00'), card: undefined } as unknown as DraftRecord,
    ];
    const vault = new MemoryVaultSource({ [NOTE]: '# n\n\nher prose\n' });
    const cache = createVaultDraftCacheStore(vault);
    for (const r of seed) await cache.put(r);
    const acceptPort = createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => NOW,
    });
    const controller = createBulkReviewController({
      cache,
      acceptPort,
      editPort: { async edit() {} },
    });
    await controller.load();
    const listed = controller.getViewModel().groups.flatMap((g) => g.items.map((i) => i.draftId));
    expect(listed).toEqual(['q1', 'c1']);
    const result = await controller.acceptRemainder(NOTE);
    expect([...result.accepted].sort()).toEqual([...listed].sort());
    expect(result.failed).toEqual([]);
  });
});
