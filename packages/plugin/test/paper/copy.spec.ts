/**
 * `copy.ts` tests — the practice-paper student-facing strings (F4.11, `[D-262]` ruling 4).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice-paper command and view
 * surface [PAPER-8]", tagged `@auto:plugin/paper/copy.spec`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLockedCopy,
  buildNoAssessmentAheadCopy,
  buildPartialPaperStatement,
} from '../../src/paper/copy.js';

const INTERIM_DISCLOSURE_SENTENCE =
  'This practice paper is partial: it does not include questions that ask you to read a printed ' +
  'result — a table or a chart — and reason from it, because Olea cannot yet reliably build ' +
  'that kind of question for this course. To practise that part, use the real past papers held ' +
  'for this course instead.';

describe('buildPartialPaperStatement', () => {
  it('reuses the interim disclosure sentence verbatim for interpret-printed-result', () => {
    const statement = buildPartialPaperStatement('interpret-printed-result', ['path/a.pdf']);
    expect(statement.sentence).toBe(INTERIM_DISCLOSURE_SENTENCE);
  });

  it('carries the pointer paths through unchanged', () => {
    const statement = buildPartialPaperStatement('interpret-printed-result', [
      'path/a.pdf',
      'path/b.pdf',
    ]);
    expect(statement.pointerPaths).toEqual(['path/a.pdf', 'path/b.pdf']);
  });

  it.each([
    ['recall-a-fact', 'recall a fact'],
    ['calculate', 'work through a calculation'],
    ['compare-or-choose', 'compare or choose between options'],
    ['apply-to-unfamiliar-case', 'apply what you know to an unfamiliar case'],
  ] as const)(
    'names %s in plain words, still shape-conforming (partial · demand · where to look)',
    (demand, phrase) => {
      const statement = buildPartialPaperStatement(demand, ['path/a.pdf']);
      expect(statement.sentence).toContain('partial');
      expect(statement.sentence).toContain(phrase);
      expect(statement.sentence).toMatch(/real past papers held for this course/);
    },
  );

  it('never emits the withdrawn "exam oracle" name or an unqualified completeness claim', () => {
    for (const demand of [
      'recall-a-fact',
      'calculate',
      'compare-or-choose',
      'apply-to-unfamiliar-case',
      'interpret-printed-result',
    ] as const) {
      const statement = buildPartialPaperStatement(demand, ['path/a.pdf']);
      expect(statement.sentence.toLowerCase()).not.toContain('exam oracle');
      expect(statement.sentence.toLowerCase()).not.toContain('mock exam');
    }
  });
});

describe('buildLockedCopy', () => {
  it('states a date and a day count, never a percentage or ratio', () => {
    const copy = buildLockedCopy('COURSEA', 12, '2026-10-01');
    expect(copy).toContain('COURSEA');
    expect(copy).toContain('2026-10-01');
    expect(copy).toContain('12 days');
    expect(copy).not.toMatch(/%|\bpercent\b/i);
  });

  it('singularises "day" for exactly one day', () => {
    const copy = buildLockedCopy('COURSEA', 1, '2026-10-01');
    expect(copy).toContain('1 day ');
  });
});

describe('buildNoAssessmentAheadCopy', () => {
  it('never implies a reason is being withheld — F4.11: the affordance is simply absent', () => {
    const copy = buildNoAssessmentAheadCopy('COURSEA');
    expect(copy).toContain('COURSEA');
    expect(copy.toLowerCase()).not.toContain('locked');
  });
});
