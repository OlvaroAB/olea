/**
 * `[D-564]` (c) condition 2 (`ol-egov.141.89.6.113`): the judge's unable-to-assess reason prefix
 * tells a genuine attempt it cannot assess from a non-attempt. Scenarios:
 * `features/F5-explain-it-back.md` (olea-service), "a judge that cannot assess a genuine attempt".
 * Structural placeholders throughout (INV-3).
 */

import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE,
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

  it('shows the one genuine-attempt message for both genuine-attempt kinds', () => {
    expect(declineMessageFor('insufficient-material')).toBe(
      EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE,
    );
    expect(declineMessageFor('defective-question')).toBe(
      EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE,
    );
    expect(EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE).not.toBe(
      EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
    );
  });

  it('says nothing was graded and never implies she did not really try', () => {
    expect(EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE).toMatch(/nothing was graded/i);
    expect(EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE).not.toMatch(
      /real attempt|really try|didn't try|did not try|non-attempt/i,
    );
  });
});
