/**
 * Scenario: `features/F3-learn-from-anything.md`, "a pending card draft reaches the review queue as a
 * new-badge item, not a failure" — @auto:plugin/generation/review-adapter.card-draft.ol-egov.141.89.105.6.spec
 * (F3.3, `[D-097]`, `[D-541]`). Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { toDraftReviewQueueItem } from '../../src/generation/review-adapter.js';
import type { DraftRecord } from '../../src/generation/types.js';

function cardRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'card-draft-1',
    status: 'pending',
    courseCode: 'TEST101',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: 'Courses/TEST101/Week 2.md',
    createdAt: '2026-08-25T09:00:00-07:00',
    instrumentType: 'qa',
    card: { front: 'What limits working memory?', back: 'Chunking.' },
    provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

describe('toDraftReviewQueueItem — a pending question-and-answer card draft', () => {
  it('does not throw, and is a QaCard carrying its draft id (the new-badge condition)', () => {
    const item = toDraftReviewQueueItem(cardRecord());
    expect(item.instrument.type).toBe('qa');
    if (item.instrument.type !== 'qa') throw new Error('expected qa');
    expect(item.instrument.draftId).toBe('card-draft-1');
    expect(item.instrument.instrumentId).toBe('card-draft-1');
    expect(item.instrument.question).toBe('What limits working memory?');
    expect(item.instrument.answer).toBe('Chunking.');
  });

  it('carries the same meta as a quiz draft: course code, note title, source path, concept ids', () => {
    const item = toDraftReviewQueueItem(cardRecord());
    expect(item.instrument.courseCode).toBe('TEST101');
    expect(item.instrument.noteTitle).toBe('Week 2');
    expect(item.instrument.sourcePath).toBe('Courses/TEST101/Week 2.md');
    expect(item.instrument.conceptIds).toEqual(['concept-key-1']);
    expect(item.instrument.blockId).toBeNull();
  });

  it('is new and unscheduled, and logs the offered type as qa, not multiple choice', () => {
    const item = toDraftReviewQueueItem(cardRecord());
    expect(item.priorState).toBeNull();
    expect(item.selectionContext.dueState).toBe('new');
    expect(item.selectionContext.instrumentTypesOffered).toEqual(['qa']);
  });

  it('leaves a quiz draft logging mcq, unchanged', () => {
    const { instrumentType: _t, card: _c, ...rest } = cardRecord();
    const item = toDraftReviewQueueItem(
      {
        ...rest,
        question: {
          stem: 'S?',
          correctAnswer: 'A',
          distractors: ['B', 'C', 'D', 'E'],
          feedback: 'f',
        },
      },
      { next: () => 0.5 },
    );
    expect(item.instrument.type).toBe('mcq');
    expect(item.selectionContext.instrumentTypesOffered).toEqual(['mcq']);
  });
});
