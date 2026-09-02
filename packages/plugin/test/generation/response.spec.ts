// Scenarios: features/F2-review.md — "F2.15 / [D-195] — the client's draft
// pipeline accepts both distractor shapes", tagged
// `@auto:plugin/generation/response.spec`.
//
// `extractDraftedQuestions` used to delegate entirely to
// `retrieval/draft-cards-copy.ts`'s `parseDraftedResponse`, whose
// `distractors` check is bare-string-only. `[D-195]` (`ol-2zfj.57`) bumped
// `quiz.generate.v1` to emit `{ text, believes, source_says }` objects
// instead, so this suite proves the parser now accepts EITHER shape, never
// only the new one — a response drafted before this bead, or replayed from
// an older cache, must still parse.
import { describe, expect, it } from 'vitest';
import {
  extractDraftedProvenance,
  extractDraftedQuestions,
} from '../../src/generation/response.js';

const OLD_SHAPE_ENVELOPE = {
  ok: true,
  stamp: { promptVersion: '1.3.0', modelId: 'coined-model-1' },
  result: {
    questions: [
      {
        stem: 'which one is it?',
        correctAnswer: 'the right one',
        distractors: ['pool one', 'pool two', 'pool three'],
        feedback: 'because of the thing',
      },
    ],
  },
};

const NEW_SHAPE_ENVELOPE = {
  ok: true,
  stamp: { promptVersion: '2.0.0', modelId: 'coined-model-1' },
  result: {
    questions: [
      {
        stem: 'which one is it?',
        correctAnswer: 'the right one',
        distractors: [
          {
            text: 'pool one',
            believes: 'a wrong belief about pool one',
            source_says: 'what the source actually says about pool one',
          },
          {
            text: 'pool two',
            believes: 'a wrong belief about pool two',
            source_says: 'what the source actually says about pool two',
          },
        ],
        feedback: 'because of the thing',
      },
    ],
  },
};

describe('extractDraftedQuestions — the pre-`[D-195]` bare-string shape', () => {
  it('parses distractors as plain text with no grounding attached', () => {
    const questions = extractDraftedQuestions(OLD_SHAPE_ENVELOPE);
    expect(questions).toHaveLength(1);
    const [question] = questions ?? [];
    expect(question?.distractors).toEqual(['pool one', 'pool two', 'pool three']);
    expect(question?.distractorGrounding).toBeUndefined();
  });
});

describe('extractDraftedQuestions — the `[D-195]` object shape', () => {
  it('keeps `text` for the block and carries `believes`/`source_says` as grounding, aligned by index', () => {
    const questions = extractDraftedQuestions(NEW_SHAPE_ENVELOPE);
    expect(questions).toHaveLength(1);
    const [question] = questions ?? [];
    expect(question?.distractors).toEqual(['pool one', 'pool two']);
    expect(question?.distractorGrounding).toEqual([
      {
        believes: 'a wrong belief about pool one',
        source_says: 'what the source actually says about pool one',
      },
      {
        believes: 'a wrong belief about pool two',
        source_says: 'what the source actually says about pool two',
      },
    ]);
  });

  it('provenance still extracts from the envelope stamp exactly as before', () => {
    const provenance = extractDraftedProvenance(NEW_SHAPE_ENVELOPE);
    expect(provenance).toEqual({
      taskId: 'quiz.generate.v1',
      promptVersion: '2.0.0',
      modelId: 'coined-model-1',
    });
  });
});

describe('extractDraftedQuestions — malformed or unrecognised shapes', () => {
  it('returns null for a worker error envelope', () => {
    expect(extractDraftedQuestions({ ok: false, message: 'refused' })).toBeNull();
  });

  it('returns null when a distractor entry matches neither shape', () => {
    const malformed = {
      ok: true,
      result: {
        questions: [
          {
            stem: 'q',
            correctAnswer: 'a',
            distractors: [42],
            feedback: 'f',
          },
        ],
      },
    };
    expect(extractDraftedQuestions(malformed)).toBeNull();
  });

  it('returns null when a distractor object is missing a required field', () => {
    const malformed = {
      ok: true,
      result: {
        questions: [
          {
            stem: 'q',
            correctAnswer: 'a',
            distractors: [{ text: 'pool one', believes: 'a wrong belief' /* no source_says */ }],
            feedback: 'f',
          },
        ],
      },
    };
    expect(extractDraftedQuestions(malformed)).toBeNull();
  });

  it('returns null for a non-object response', () => {
    expect(extractDraftedQuestions(null)).toBeNull();
    expect(extractDraftedQuestions('a string')).toBeNull();
  });
});
