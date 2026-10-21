/**
 * Scenario: `features/F3-learn-from-anything.md`, "a pending card draft reaches the review queue as a
 * new-badge item, not a failure" — @auto:plugin/generation/review-adapter.card-draft.ol-egov.141.89.105.6.spec
 * (F3.3, `[D-097]`, `[D-541]`). Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { toDraftReviewQueueItem } from '../../src/generation/review-adapter.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { ReviewSession } from '../../src/review/session.js';
import {
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
} from '../review/fixtures.js';

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

  // `[D-517]` (a), `ol-egov.141.89.9.102`.
  it('carries the cold-start chooser decision, so its first answer records the support shown', () => {
    const item = toDraftReviewQueueItem(cardRecord());
    expect(item.instrument.supportLevel).toEqual({
      level: 'prompted',
      provenance: 'evidence-thin',
    });
  });

  // The record is what core's readiness and need readers credit: `supportLevelShown: independent`
  // is measured recall (`[D-517]` (a)); the reader itself is core's, covered in core.
  it('a Good answer at its first presentation records independent, as an accepted recall card does', async () => {
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession({
      queue: [toDraftReviewQueueItem(cardRecord())],
      scheduler: fakeScheduler(),
      reviewLog,
      suspendPort: fakeSuspendPort(),
      editPort: fakeEditPort(),
      noteExists: fakeNoteExists(),
      clock: fixedClock('2026-08-10T09:00:00Z'),
      draftAcceptPort: fakeDraftAcceptPort(),
    });
    await session.start();
    session.reveal();
    await session.rate('good');
    expect(reviewLog.calls).toHaveLength(1);
    expect(reviewLog.calls[0]?.supportLevel).toEqual({
      level: 'independent',
      provenance: 'not-offered',
    });
  });

  it('leaves a quiz draft carrying no chooser decision, unchanged', () => {
    const { instrumentType: _t, card: _c, ...rest } = cardRecord();
    const item = toDraftReviewQueueItem({
      ...rest,
      question: { stem: 'S?', correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'F' },
    });
    expect(item.instrument.supportLevel).toBeUndefined();
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
