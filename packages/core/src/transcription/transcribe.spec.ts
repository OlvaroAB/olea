import { describe, expect, it } from 'vitest';
import type { GradeExplainBackInput } from '../grading/gradingPipeline.js';
import { buildGradeExplainBackInputFromTranscript } from './transcribe.js';

const context = {
  question: 'What is a heap?',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [{ blockId: 'b1', text: 'Heaps are complete binary trees.' }],
  misconceptionDigest: [],
};

describe('buildGradeExplainBackInputFromTranscript — voice is an input method, not a new grading path', () => {
  it('produces the exact GradeExplainBackInput shape a typed answer would', () => {
    const input = buildGradeExplainBackInputFromTranscript(
      { transcript: 'A heap is a tree-shaped structure.', durationSeconds: 4.2 },
      context,
    );

    const expected: GradeExplainBackInput = {
      question: context.question,
      studentAnswer: 'A heap is a tree-shaped structure.',
      referenceAnswer: context.referenceAnswer,
      sourceBlocks: context.sourceBlocks,
      misconceptionDigest: context.misconceptionDigest,
    };
    expect(input).toEqual(expected);
  });

  it('carries an honest empty transcript straight through as an empty studentAnswer, no special case', () => {
    // The Worker's own anti-hallucination refusal (`groundTranscription`) on
    // silent/noise audio: `transcript: ""`. This must NOT be treated as an
    // error here — `gradeExplainBack` already handles an empty
    // `studentAnswer` as "she gave no answer" (see that function's module
    // doc), so this composer adds no special case of its own.
    const input = buildGradeExplainBackInputFromTranscript(
      { transcript: '', durationSeconds: 3.0 },
      context,
    );
    expect(input.studentAnswer).toBe('');
  });

  it('never invents or drops a field from the context', () => {
    const input = buildGradeExplainBackInputFromTranscript(
      { transcript: 'anything', durationSeconds: 1 },
      context,
    );
    expect(Object.keys(input).sort()).toEqual(
      [
        'question',
        'studentAnswer',
        'referenceAnswer',
        'sourceBlocks',
        'misconceptionDigest',
      ].sort(),
    );
  });
});
