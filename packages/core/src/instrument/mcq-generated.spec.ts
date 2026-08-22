// Scenarios: features/F3-learn-from-anything.md — "F3.4 — A generated quiz
// item carries corrective feedback", tagged `@auto:core/instrument/mcq-generated.spec`.
import { describe, expect, it } from 'vitest';
import { acceptGeneratedMcq, type GeneratedMcqCandidate } from './mcq-generated.js';

const POOL = ['distractor A', 'distractor B', 'distractor C', 'distractor D'];

function candidate(feedback: string): GeneratedMcqCandidate {
  return {
    stem: 'which one is it?',
    correctAnswer: 'the right one',
    distractors: POOL,
    feedback,
  };
}

describe('acceptGeneratedMcq — the boundary a generated candidate crosses into McqFields', () => {
  it('carries the feedback through, trimmed', () => {
    const fields = acceptGeneratedMcq(candidate('  because the source says so.  '));
    expect(fields.feedback).toBe('because the source says so.');
  });

  it('carries stem, answer, distractors and id through unchanged', () => {
    const fields = acceptGeneratedMcq(candidate('why it is right.'), 'abc123');
    expect(fields.stem).toBe('which one is it?');
    expect(fields.answer).toBe('the right one');
    expect(fields.distractors).toEqual(POOL);
    expect(fields.id).toBe('abc123');
  });

  it('defaults id to null when none is given', () => {
    const fields = acceptGeneratedMcq(candidate('why it is right.'));
    expect(fields.id).toBeNull();
  });

  it('throws on blank feedback — the mandatory boundary this function exists for', () => {
    expect(() => acceptGeneratedMcq(candidate(''))).toThrow(/feedback/i);
  });

  it('throws on whitespace-only feedback', () => {
    expect(() => acceptGeneratedMcq(candidate('   '))).toThrow(/feedback/i);
  });
});
