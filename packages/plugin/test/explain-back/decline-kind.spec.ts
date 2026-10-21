/**
 * `[D-564]` (c) condition 2 (`ol-egov.141.89.6.113`): the judge's unable-to-assess reason prefix
 * tells a genuine attempt it cannot assess from a non-attempt. Scenarios:
 * `features/F5-explain-it-back.md` (olea-service), "a judge that cannot assess a genuine attempt".
 * Structural placeholders throughout (INV-3).
 */

import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
  EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
  EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
} from '../../src/explain-back/copy.js';
import { declineKindOf, declineMessageFor } from '../../src/explain-back/decline-kind.js';

describe('declineKindOf', () => {
  it('reads the insufficient-material prefix', () => {
    expect(declineKindOf('insufficient-material: the notes do not cover the term')).toBe(
      'insufficient-material',
    );
    expect(declineKindOf('insufficient-material:')).toBe('insufficient-material');
  });

  it('reads the defective-question prefix', () => {
    expect(declineKindOf('defective-question: it contradicts itself')).toBe('defective-question');
  });

  it('treats an absent, empty, free-text or unknown-prefix reason as a non-attempt', () => {
    for (const reason of [
      undefined,
      null,
      '',
      'blank answer',
      'off-topic',
      'contradictory-request: asks for two incompatible things',
      'unknown-prefix: something',
    ]) {
      expect(declineKindOf(reason)).toBe('non-attempt');
    }
  });

  it('reads the prefix only: not mid-string, not another case, not without its colon', () => {
    expect(declineKindOf('see insufficient-material: here')).toBe('non-attempt');
    expect(declineKindOf('Insufficient-Material: x')).toBe('non-attempt');
    expect(declineKindOf('insufficient-material')).toBe('non-attempt');
    expect(declineKindOf(' defective-question: x')).toBe('non-attempt');
  });
});

describe('declineMessageFor', () => {
  it('keeps today’s message for a non-attempt, unchanged', () => {
    expect(declineMessageFor('non-attempt')).toBe(EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE);
  });

  it("shows David's exact string for each genuine-attempt kind", () => {
    expect(declineMessageFor('insufficient-material')).toBe(
      "Olea couldn't find enough in your notes to check this answer, so nothing was graded.",
    );
    expect(declineMessageFor('defective-question')).toBe(
      "This question couldn't be answered as asked, so nothing was graded. That's down to the question, not your answer.",
    );
    expect(declineMessageFor('insufficient-material')).toBe(
      EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
    );
    expect(declineMessageFor('defective-question')).toBe(
      EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
    );
    const all = [
      EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
      EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
      EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
    ];
    expect(new Set(all).size).toBe(3);
  });

  it('an unknown kind at runtime still shows the non-attempt message', () => {
    expect(declineMessageFor('something-else' as never)).toBe(
      EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
    );
    expect(declineMessageFor(declineKindOf('unrecognised: x'))).toBe(
      EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
    );
    expect(declineMessageFor(declineKindOf(undefined))).toBe(EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE);
  });

  it('says nothing was graded and never implies she did not really try', () => {
    for (const m of [
      EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
      EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
    ]) {
      expect(m).toMatch(/nothing was graded/i);
      expect(m).not.toMatch(/real attempt|really try|didn't try|did not try|non-attempt/i);
    }
  });

  it('the material message never says her notes lack it', () => {
    expect(EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE).not.toMatch(
      /don't (have|cover|contain)|lack|missing|not in your notes/i,
    );
  });
});
