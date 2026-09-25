/**
 * `ol-0r92.104` [DOS-I9]: `./skip.ts`'s own pure logic, run for real —
 * `canRecordNonAttempt` is the gate `modal.ts`'s
 * `recordNonAttemptIfPossible` checks before ever calling
 * `deps.recordNonAttempt`, and `EXPLAIN_BACK_SKIP_LABEL` is the one new
 * student-facing string this bead adds. Unlike anything that lives inside
 * `ExplainBackModal` itself, `./skip.ts` imports nothing from `obsidian`, so
 * this file imports it directly rather than scanning source text.
 */

import { describe, expect, it } from 'vitest';
import { canRecordNonAttempt, EXPLAIN_BACK_SKIP_LABEL } from '../../src/explain-back/skip.js';

describe('canRecordNonAttempt — the non-attempt write gate (D7.1 non-empty conceptIds)', () => {
  it('false for an empty concept list — a free-form topic prompt has nothing to name the record against', () => {
    expect(canRecordNonAttempt([])).toBe(false);
  });

  it('true for one concept', () => {
    expect(canRecordNonAttempt(['concept-1'])).toBe(true);
  });

  it('true for several concepts', () => {
    expect(canRecordNonAttempt(['concept-1', 'concept-2', 'concept-3'])).toBe(true);
  });

  it('reads the array it is given, never a fixed list', () => {
    expect(canRecordNonAttempt(['only-this-one'])).toBe(true);
    expect(canRecordNonAttempt([])).toBe(false);
  });
});

describe('EXPLAIN_BACK_SKIP_LABEL — vocabulary registry §19, [D-096] voice charter', () => {
  it('is literally "Skip" — the plain-language word the registry names, no olive coinage', () => {
    expect(EXPLAIN_BACK_SKIP_LABEL).toBe('Skip');
  });

  it('never frames the action as giving up, quitting or failing (registry §19)', () => {
    const lowered = EXPLAIN_BACK_SKIP_LABEL.toLowerCase();
    for (const word of ['give up', 'quit', 'fail', 'abandon']) {
      expect(lowered).not.toContain(word);
    }
  });

  it('carries no warning or consequence wording (registry §19: "costs her nothing")', () => {
    const lowered = EXPLAIN_BACK_SKIP_LABEL.toLowerCase();
    for (const word of ['warning', 'caution', 'lose', 'miss out']) {
      expect(lowered).not.toContain(word);
    }
  });

  it('V4/V5 voice charter: no apology, no celebration in this one string', () => {
    const lowered = EXPLAIN_BACK_SKIP_LABEL.toLowerCase();
    expect(lowered).not.toContain('sorry');
    expect(EXPLAIN_BACK_SKIP_LABEL).not.toMatch(/great|nice|well done|congrat/i);
  });
});
