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
  EXPLAIN_BACK_SESSION_ENTRY_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_TOPIC_PROMPT,
  explainBackOutcomeHeading,
} from '../../src/explain-back/copy.js';

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
];

const OUTCOME_HEADINGS: readonly string[] = [
  explainBackOutcomeHeading('correct'),
  explainBackOutcomeHeading('partial'),
  explainBackOutcomeHeading('incorrect'),
];

const ALL_STRINGS = [...STATIC_STRINGS, ...OUTCOME_HEADINGS];

describe('explainBackOutcomeHeading', () => {
  it('never prints the raw verdict word (V6, GLOSSARY "never exposed by name")', () => {
    for (const text of OUTCOME_HEADINGS) {
      for (const word of ['correct', 'partial', 'incorrect']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('returns a distinct heading for each of the three verdicts', () => {
    expect(new Set(OUTCOME_HEADINGS).size).toBe(3);
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
