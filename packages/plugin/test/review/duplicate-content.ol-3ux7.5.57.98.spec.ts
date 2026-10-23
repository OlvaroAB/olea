/**
 * `[D-627]` (`ol-3ux7.5.57.98`): the pure half of "a session never serves the same content twice".
 * Scenarios: "only exact content of the same type is a duplicate", "a queue with no duplicates is
 * unchanged" and "the guard is stable as the queue grows" —
 * @auto:plugin/review/duplicate-content.ol-3ux7.5.57.98.spec (F2). Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { reviewContentKey, setAsideDuplicateContent } from '../../src/review/duplicate-content.js';
import type {
  ClozeCard,
  McqItem,
  McqOption,
  QaCard,
  ReviewInstrument,
  ReviewQueueItem,
} from '../../src/review/types.js';

const COMMON = {
  courseCode: 'TEST101',
  noteTitle: 'Week one',
  sourcePath: 'Courses/TEST101/Week one.md',
  blockId: null,
} as const;

function qa(id: string, question: string, answer: string, conceptIds = [`c-${id}`]): QaCard {
  return { ...COMMON, instrumentId: id, draftId: null, conceptIds, type: 'qa', question, answer };
}

function cloze(id: string, before: string, clozeText: string, after: string): ClozeCard {
  return {
    ...COMMON,
    instrumentId: id,
    draftId: null,
    conceptIds: [`c-${id}`],
    type: 'cloze',
    before,
    clozeText,
    after,
    noteContext: null,
  };
}

function mcq(id: string, options: readonly McqOption[]): McqItem {
  return {
    ...COMMON,
    instrumentId: id,
    draftId: id,
    conceptIds: [`c-${id}`],
    type: 'mcq',
    stem: 'Which synthetic option?',
    options,
    feedback: 'Synthetic feedback.',
  };
}

function item(instrument: ReviewInstrument): ReviewQueueItem {
  return {
    instrument,
    priorState: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrument.type],
      planVersion: null,
    },
  };
}

const OPTIONS: readonly McqOption[] = [
  { id: 'o1', label: 'Alpha', correct: true },
  { id: 'o2', label: 'Beta', correct: false },
  { id: 'o3', label: 'Gamma', correct: false },
];

function ids(queue: readonly ReviewQueueItem[]): string[] {
  return queue.map((entry) => entry.instrument.instrumentId);
}

describe('only exact content of the same type is a duplicate', () => {
  it('sets aside a byte-identical Q&A card on another concept, naming both copies', () => {
    const outcome = setAsideDuplicateContent([
      item(qa('a', 'Synthetic front?', 'Synthetic back.')),
      item(qa('b', 'Synthetic front?', 'Synthetic back.')),
    ]);
    expect(ids(outcome.queue)).toEqual(['a']);
    expect(outcome.setAside).toEqual([
      {
        reason: 'duplicate-content',
        instrumentId: 'b',
        draftId: null,
        conceptIds: ['c-b'],
        duplicateOf: { instrumentId: 'a', draftId: null, conceptIds: ['c-a'] },
      },
    ]);
  });

  it('keeps pairs that differ by one character, by whitespace, or by type', () => {
    const outcome = setAsideDuplicateContent([
      item(qa('a', 'Synthetic front?', 'Synthetic back.')),
      item(qa('b', 'Synthetic front!', 'Synthetic back.')),
      item(qa('c', 'Synthetic front? ', 'Synthetic back.')),
      item(qa('d', 'Synthetic front?', 'Synthetic  back.')),
      item(cloze('e', 'Synthetic front?', 'Synthetic back.', '')),
    ]);
    expect(ids(outcome.queue)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(outcome.setAside).toEqual([]);
  });

  it('treats an MCQ whose options differ only in order or ids as the same content', () => {
    const shuffled = [OPTIONS[2], OPTIONS[0], OPTIONS[1]].map((option, index) => ({
      ...(option as McqOption),
      id: `x${index}`,
    }));
    expect(reviewContentKey(mcq('m1', OPTIONS))).toBe(reviewContentKey(mcq('m2', shuffled)));
    const outcome = setAsideDuplicateContent([item(mcq('m1', OPTIONS)), item(mcq('m2', shuffled))]);
    expect(ids(outcome.queue)).toEqual(['m1']);
    expect(outcome.setAside.map((entry) => entry.instrumentId)).toEqual(['m2']);
  });

  it('keeps MCQs that differ in which option is correct, or in an option label', () => {
    const otherCorrect = OPTIONS.map((option) => ({ ...option, correct: option.id === 'o2' }));
    const otherLabel = OPTIONS.map((option) =>
      option.id === 'o3' ? { ...option, label: 'Delta' } : option,
    );
    const outcome = setAsideDuplicateContent([
      item(mcq('m1', OPTIONS)),
      item(mcq('m2', otherCorrect)),
      item(mcq('m3', otherLabel)),
    ]);
    expect(ids(outcome.queue)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('a queue with no duplicates is unchanged', () => {
  it('keeps every item in its order, two on one concept included, and records nothing', () => {
    const queue = [
      item(qa('a', 'First?', 'One.', ['shared'])),
      item(qa('b', 'Second?', 'Two.', ['shared'])),
      item(cloze('c', 'A ', 'blank', ' here.')),
      item(mcq('m', OPTIONS)),
    ];
    const outcome = setAsideDuplicateContent(queue);
    expect(outcome.queue).toEqual(queue);
    expect(outcome.setAside).toEqual([]);
  });

  it('returns each kept item unchanged, carrying only its own concept ids', () => {
    const first = item(qa('a', 'Same?', 'Same.', ['concept-one']));
    const outcome = setAsideDuplicateContent([
      first,
      item(qa('b', 'Same?', 'Same.', ['concept-two'])),
    ]);
    expect(outcome.queue[0]).toBe(first);
    expect(outcome.queue[0]?.instrument.conceptIds).toEqual(['concept-one']);
  });
});

describe('the guard is stable as the queue grows', () => {
  it("begins the longer queue's kept items with exactly the shorter queue's kept items", () => {
    const shorter = [
      item(qa('a', 'Same?', 'Same.')),
      item(qa('b', 'Other?', 'Other.')),
      item(qa('c', 'Same?', 'Same.')),
    ];
    const longer = [
      ...shorter,
      item(qa('d', 'Other?', 'Other.')),
      item(qa('e', 'New?', 'New.')),
      item(qa('f', 'Same?', 'Same.')),
    ];
    const short = setAsideDuplicateContent(shorter);
    const long = setAsideDuplicateContent(longer);
    expect(ids(long.queue).slice(0, short.queue.length)).toEqual(ids(short.queue));
    expect(ids(long.queue)).toEqual(['a', 'b', 'e']);
    expect(
      long.setAside.map((entry) => [entry.instrumentId, entry.duplicateOf.instrumentId]),
    ).toEqual([
      ['c', 'a'],
      ['d', 'b'],
      ['f', 'a'],
    ]);
  });
});
