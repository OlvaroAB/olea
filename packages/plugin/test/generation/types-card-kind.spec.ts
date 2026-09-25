/**
 * `isDraftRecord`'s generalized guard for `instrumentType`/`card`
 * (`ol-0r92.88`) — see `generation/types.ts`'s doc on `DraftRecord`.
 *
 * The `'mcq'`/`undefined` branch is already exercised indirectly by every
 * other `generation/` spec round-tripping a real `DraftRecord` through
 * `cache-store.ts`; this file covers the new `'qa'` branch and the
 * mutual-exclusion rule directly, since nothing else does.
 */
import { describe, expect, it } from 'vitest';
import { isDraftRecord } from '../../src/generation/types.js';

function baseFields() {
  return {
    draftId: 'draft-1',
    status: 'pending' as const,
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: '01 Courses/COGS214/Week 2.md',
    createdAt: '2026-08-25T09:00:00-07:00',
    firstServedAt: null,
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
  };
}

describe('isDraftRecord — ol-0r92.88 instrumentType/card generalization', () => {
  it('accepts a well-formed qa-kind record carrying card, no question', () => {
    const value = {
      ...baseFields(),
      instrumentType: 'qa',
      card: { front: 'What limits capacity?', back: 'Chunking' },
    };
    expect(isDraftRecord(value)).toBe(true);
  });

  it('rejects a qa-kind record missing card', () => {
    const value = { ...baseFields(), instrumentType: 'qa' };
    expect(isDraftRecord(value)).toBe(false);
  });

  it('rejects a qa-kind record whose card is missing a field', () => {
    const value = { ...baseFields(), instrumentType: 'qa', card: { front: 'only front' } };
    expect(isDraftRecord(value)).toBe(false);
  });

  it('rejects a qa-kind record that also carries question — mutually exclusive', () => {
    const value = {
      ...baseFields(),
      instrumentType: 'qa',
      card: { front: 'a', back: 'b' },
      question: { stem: 's', correctAnswer: 'a', distractors: ['a', 'b'], feedback: 'f' },
    };
    expect(isDraftRecord(value)).toBe(false);
  });

  it('rejects an mcq-kind record that also carries card — mutually exclusive', () => {
    const value = {
      ...baseFields(),
      instrumentType: 'mcq',
      question: { stem: 's', correctAnswer: 'a', distractors: ['a', 'b'], feedback: 'f' },
      card: { front: 'a', back: 'b' },
    };
    expect(isDraftRecord(value)).toBe(false);
  });

  it('rejects an unrecognised instrumentType value', () => {
    const value = { ...baseFields(), instrumentType: 'not-a-real-type' };
    expect(isDraftRecord(value)).toBe(false);
  });

  it('still accepts an ordinary mcq record with instrumentType omitted — unchanged pre-ol-0r92.88 behaviour', () => {
    const value = {
      ...baseFields(),
      question: { stem: 's', correctAnswer: 'a', distractors: ['a', 'b'], feedback: 'f' },
    };
    expect(isDraftRecord(value)).toBe(true);
  });
});
