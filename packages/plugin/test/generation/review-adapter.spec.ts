/**
 * `toDraftReviewQueueItem` tests (F3.3, `[D-097]`, `ol-p3t07a`).
 *
 * Proves the "new" badge condition (`instrument.draftId !== null`) and the
 * shape the review view needs, built directly from a cached `DraftRecord`
 * rather than an enumerated vault instrument.
 */
import { describe, expect, it } from 'vitest';
import { toDraftReviewQueueItem } from '../../src/generation/review-adapter.js';
import type { DraftRecord } from '../../src/generation/types.js';

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['Working memory'],
    sourcePath: '01 Courses/COGS214/Week 2.md',
    createdAt: '2026-08-25T09:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking',
      distractors: [
        'Rehearsal only',
        'Serial position',
        'Long-term decay',
        'Chunking never applies',
      ],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

const fixedRandom = { next: () => 0.5 };

describe('toDraftReviewQueueItem', () => {
  it('carries a non-null draftId — the condition the view reads for the "new" badge', () => {
    const item = toDraftReviewQueueItem(record(), fixedRandom);
    expect(item.instrument.draftId).toBe('draft-1');
  });

  it('never carries scheduling state — a pending draft has never been reviewed', () => {
    const item = toDraftReviewQueueItem(record(), fixedRandom);
    expect(item.priorState).toBeNull();
    expect(item.selectionContext.dueState).toBe('new');
  });

  it('presents the MCQ with the correct answer among 4 sampled options', () => {
    const item = toDraftReviewQueueItem(record(), fixedRandom);
    expect(item.instrument.type).toBe('mcq');
    if (item.instrument.type !== 'mcq') throw new Error('expected mcq');
    expect(item.instrument.options).toHaveLength(4);
    expect(item.instrument.options.filter((o) => o.correct)).toHaveLength(1);
    expect(item.instrument.stem).toBe('What limits working memory capacity?');
  });

  it('derives noteTitle from the source path basename when no independent title source exists', () => {
    const item = toDraftReviewQueueItem(
      record({ sourcePath: '01 Courses/COGS214/Week 2.md' }),
      fixedRandom,
    );
    expect(item.instrument.noteTitle).toBe('Week 2');
  });

  it('uses the transient draft id as instrumentId until accept.ts mints the real one', () => {
    const item = toDraftReviewQueueItem(record(), fixedRandom);
    expect(item.instrument.instrumentId).toBe('draft-1');
  });
});
