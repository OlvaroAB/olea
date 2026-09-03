import type { SoloLevel } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_BACK_ACCEPT_LABEL,
  EXPLAIN_BACK_ANSWER_PLACEHOLDER,
  EXPLAIN_BACK_CITED_HEADING,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_GRADING_LABEL,
  EXPLAIN_BACK_MISCONCEPTION_HEADING,
  EXPLAIN_BACK_MISSED_HEADING,
  EXPLAIN_BACK_MODAL_TITLE,
  EXPLAIN_BACK_QUESTION_LABEL,
  EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
  EXPLAIN_BACK_SESSION_ENTRY_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_TOPIC_PROMPT,
  explainBackDepthHeading,
} from '../../src/explain-back/copy.js';
import { explainBackDepthPhrase } from '../../src/registry/copy.js';

const STATIC_STRINGS: readonly string[] = [
  EXPLAIN_BACK_MODAL_TITLE,
  EXPLAIN_BACK_TOPIC_PROMPT,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_QUESTION_LABEL,
  EXPLAIN_BACK_ANSWER_PLACEHOLDER,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_GRADING_LABEL,
  EXPLAIN_BACK_MISSED_HEADING,
  EXPLAIN_BACK_CITED_HEADING,
  EXPLAIN_BACK_MISCONCEPTION_HEADING,
  EXPLAIN_BACK_ACCEPT_LABEL,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_SESSION_ENTRY_LABEL,
  EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
];

/** The five SOLO levels, in R9/registry order (`[D-117]`, `../../src/registry/copy.ts`). */
const ALL_SOLO_LEVELS: readonly SoloLevel[] = [
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
];

const DEPTH_HEADINGS: readonly string[] = ALL_SOLO_LEVELS.map((level) =>
  explainBackDepthHeading(level),
);

const ALL_STRINGS = [...STATIC_STRINGS, ...DEPTH_HEADINGS];

describe('explainBackDepthHeading ([D-217], F5.3)', () => {
  it('reuses ../registry/copy.ts explainBackDepthPhrase verbatim, for every level, never a second copy of the wording', () => {
    for (const level of ALL_SOLO_LEVELS) {
      expect(explainBackDepthHeading(level)).toBe(
        `You explained this ${explainBackDepthPhrase(level)}.`,
      );
    }
  });

  it('returns a distinct heading for each of the five depth levels', () => {
    expect(new Set(DEPTH_HEADINGS).size).toBe(5);
  });

  it('the ice worked example (`[D-217]`\'s own): multistructural reads "with several points, not yet connected"', () => {
    expect(explainBackDepthHeading('multistructural')).toBe(
      'You explained this with several points, not yet connected.',
    );
  });

  it('never prints the rejected holds up / hold up wording anywhere (vocabulary registry §9, `[D-217]`)', () => {
    for (const text of DEPTH_HEADINGS) {
      expect(text.toLowerCase()).not.toContain('holds up');
      expect(text.toLowerCase()).not.toContain('hold up');
    }
  });

  it('never prints the raw correctness verdict word either (V6, GLOSSARY "never exposed by name")', () => {
    for (const text of DEPTH_HEADINGS) {
      for (const word of ['correct', 'partial', 'incorrect']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('takes no confidence/closeness argument — fixed wording per level, per `[D-217]` clause 3', () => {
    expect(explainBackDepthHeading).toHaveLength(1);
  });
});

describe('[D-096] V1-V6 — the voice charter over the explain-back view’s static strings', () => {
  it('V2 - names Olea, or names no actor at all, never "the system" or "I"', () => {
    for (const text of ALL_STRINGS) {
      expect(text).not.toMatch(/\bthe system\b/i);
      expect(text).not.toMatch(/\bI\b/);
      const oleaCount = (text.match(/\bOlea\b/g) ?? []).length;
      expect(oleaCount).toBeLessThanOrEqual(1);
    }
  });

  it('V4 - no apology anywhere in this set', () => {
    for (const text of ALL_STRINGS) {
      expect(text.toLowerCase()).not.toContain('sorry');
      expect(text.toLowerCase()).not.toMatch(/something went wrong/);
    }
  });

  it('V5 - no string in this set is a celebration', () => {
    for (const text of ALL_STRINGS) {
      expect(text).not.toMatch(/great|nice|well done|congrat/i);
    }
  });

  it('V6 - no effort/discipline language and no bare quotient anywhere in this set', () => {
    for (const text of ALL_STRINGS) {
      for (const word of ['effort', 'discipline', 'lazy', 'behind schedule']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      expect(text).not.toMatch(/\d+%/);
    }
  });
});
