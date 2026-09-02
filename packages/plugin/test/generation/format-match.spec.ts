/**
 * `format-match.ts` tests (`ol-v7r5.37`, F4.8/F3.8, `[D-188]`).
 *
 * Proves the pure derivation (`sentenceShapeOf`, `passagesFromMarkdown`,
 * `deriveRegisterHint`, `nearestUpcomingAssessment`) independently of any
 * vault, and proves `buildFormatMatch`'s vault-backed composition end to end:
 * a course whose nearest not-yet-passed assessment is a quiz gets a register
 * hint quoting her registered objectives/past-paper sources verbatim; a
 * course whose nearest assessment is not a quiz, or has none upcoming, gets
 * no format match at all.
 */
import type { AssessmentRecord, QuestionBlock } from 'olea-core';
import { segmentPastPaper } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildFormatMatch,
  deriveRegisterHint,
  nearestUpcomingAssessment,
  passagesFromMarkdown,
  sentenceShapeOf,
} from '../../src/generation/format-match.js';
import { MemoryVaultSource } from './fakes.js';

function assessment(overrides: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    path: 'Courses/COGS214/Midterm.md',
    course: 'COGS214',
    type: undefined,
    weight: undefined,
    weightRaw: undefined,
    due: '2026-09-10',
    status: undefined,
    ...overrides,
  };
}

const OBJECTIVES_NOTE = `---
role: objectives
course: COGS214
---

# COGS214 — Course Learning Objectives

By the end of this course, a student should be able to:

- Describe the phonological loop and its role in the multi-component model.
- Distinguish maintenance rehearsal from elaborative rehearsal.
`;

const PAST_PAPER_NOTE = `---
role: past-paper
course: COGS214
---

# COGS214 Past Paper — 2025

## Question 1 (10 marks)

Explain the role of the central executive in Baddeley's multi-component model. Give one
example of a task it coordinates.

## Question 2

(a) Define chunking in your own words.

(b) A student claims chunking only ever helps recall. Assess this claim with reference to
interference effects.
`;

describe('sentenceShapeOf', () => {
  it('strips a top-level question heading and returns the opening sentence', () => {
    expect(
      sentenceShapeOf(
        'Question 3 (15 marks)\n\nExplain the role of teratogens in fetal development. Give two examples.',
      ),
    ).toBe('Explain the role of teratogens in fetal development.');
  });

  it('strips a lettered sub-part marker', () => {
    expect(sentenceShapeOf('(a) Define clast alignment in your own words.')).toBe(
      'Define clast alignment in your own words.',
    );
  });

  it('strips a roman-numeral sub-part marker', () => {
    expect(sentenceShapeOf('(ii) State which factor dominates the difference and why.')).toBe(
      'State which factor dominates the difference and why.',
    );
  });

  it('truncates a sentence longer than the shape length with an ellipsis', () => {
    const long = `Explain, with reference to at least three named case studies drawn from the assigned reading and lecture material, ${'x'.repeat(80)} and why it matters.`;
    const shape = sentenceShapeOf(long);
    expect(shape).toBeDefined();
    expect(shape?.length).toBeLessThanOrEqual(161); // MAX_SHAPE_LENGTH + ellipsis char
    expect(shape?.endsWith('…')).toBe(true);
  });

  it('returns undefined when only heading/marker noise remains', () => {
    expect(sentenceShapeOf('Question 4')).toBeUndefined();
    expect(sentenceShapeOf('(a)   ')).toBeUndefined();
  });
});

describe('passagesFromMarkdown', () => {
  it('strips frontmatter and splits the body into blank-line-separated passages', () => {
    const passages = passagesFromMarkdown(OBJECTIVES_NOTE);
    expect(passages[0]).toBe('# COGS214 — Course Learning Objectives');
    expect(passages.some((p) => p.includes('phonological loop'))).toBe(true);
    // Frontmatter itself never leaks into a passage.
    expect(passages.some((p) => p.includes('role: objectives'))).toBe(false);
  });

  it('returns no passages for a body with no content after frontmatter', () => {
    expect(passagesFromMarkdown('---\nrole: objectives\n---\n\n')).toEqual([]);
  });
});

describe('nearestUpcomingAssessment', () => {
  it('picks the soonest not-yet-passed assessment for the named course', () => {
    const records = [
      assessment({ path: 'a.md', due: '2026-09-20' }),
      assessment({ path: 'b.md', due: '2026-09-10' }),
      assessment({ path: 'c.md', course: 'OTHER101', due: '2026-09-01' }),
    ];
    const nearest = nearestUpcomingAssessment('COGS214', records, '2026-09-02');
    expect(nearest?.path).toBe('b.md');
  });

  it('ignores an assessment whose due date has already passed', () => {
    const records = [assessment({ path: 'past.md', due: '2026-08-01' })];
    expect(nearestUpcomingAssessment('COGS214', records, '2026-09-02')).toBeUndefined();
  });

  it('counts an assessment due exactly today as not yet passed', () => {
    const records = [assessment({ path: 'today.md', due: '2026-09-02' })];
    expect(nearestUpcomingAssessment('COGS214', records, '2026-09-02')?.path).toBe('today.md');
  });

  it('breaks a same-day tie deterministically by path', () => {
    const records = [
      assessment({ path: 'z.md', due: '2026-09-10' }),
      assessment({ path: 'a.md', due: '2026-09-10' }),
    ];
    expect(nearestUpcomingAssessment('COGS214', records, '2026-09-02')?.path).toBe('a.md');
  });

  it('never guesses from an unreadable or absent due date', () => {
    const records = [
      assessment({ path: 'x.md', due: undefined }),
      assessment({ path: 'y.md', due: 'soon' }),
    ];
    expect(nearestUpcomingAssessment('COGS214', records, '2026-09-02')).toBeUndefined();
  });
});

describe('deriveRegisterHint', () => {
  const questions: readonly QuestionBlock[] = segmentPastPaper(
    'fixture.md',
    PAST_PAPER_NOTE,
  ).questions;

  it('quotes objectives passages verbatim as terminology and past-paper sentences as sentence shapes', () => {
    const hint = deriveRegisterHint(passagesFromMarkdown(OBJECTIVES_NOTE), questions);
    expect(hint.terminology.some((t) => t.includes('phonological loop'))).toBe(true);
    expect(hint.sentenceShapes).toBeDefined();
    expect(hint.sentenceShapes).toContain(
      "Explain the role of the central executive in Baddeley's multi-component model.",
    );
    expect(hint.sentenceShapes).toContain('Define chunking in your own words.');
  });

  it('omits sentenceShapes entirely, never as an empty array, when no past paper is supplied', () => {
    const hint = deriveRegisterHint(passagesFromMarkdown(OBJECTIVES_NOTE), []);
    expect(hint.sentenceShapes).toBeUndefined();
    expect(hint.terminology.length).toBeGreaterThan(0);
  });

  it('caps and dedupes both halves', () => {
    const repeatedPassages = ['Same passage.', 'Same passage.', 'Different passage.'];
    const hint = deriveRegisterHint(repeatedPassages, questions, {
      maxTerminology: 1,
      maxSentenceShapes: 1,
    });
    expect(hint.terminology).toEqual(['Same passage.']);
    expect(hint.sentenceShapes).toHaveLength(1);
  });
});

describe('buildFormatMatch', () => {
  function vaultWith(files: Record<string, string>): MemoryVaultSource {
    return new MemoryVaultSource({
      '03 Research/COGS214 Course Objectives.md': OBJECTIVES_NOTE,
      '03 Research/COGS214 Past Paper.md': PAST_PAPER_NOTE,
      ...files,
    });
  }

  const NOW = () => new Date(2026, 8, 2); // 2026-09-02, local components — no TZ ambiguity.

  it('format-matches a course whose nearest upcoming assessment is a quiz, with a real register hint', async () => {
    const vault = vaultWith({});
    const assessments = [assessment({ type: 'Quiz', due: '2026-09-10' })];
    const formatMatch = await buildFormatMatch({ vault, assessments, now: NOW });

    const decision = formatMatch('COGS214');
    expect(decision).toBeDefined();
    expect(decision?.registerHint?.terminology.some((t) => t.includes('phonological loop'))).toBe(
      true,
    );
    expect(decision?.registerHint?.sentenceShapes).toContain('Define chunking in your own words.');
  });

  it('does not format-match a course whose nearest upcoming assessment is not a quiz', async () => {
    const vault = vaultWith({});
    const assessments = [assessment({ type: 'Assignment', due: '2026-09-10' })];
    const formatMatch = await buildFormatMatch({ vault, assessments, now: NOW });
    expect(formatMatch('COGS214')).toBeUndefined();
  });

  it('does not format-match a course with no assessment records at all', async () => {
    const vault = vaultWith({});
    const formatMatch = await buildFormatMatch({ vault, assessments: [], now: NOW });
    expect(formatMatch('COGS214')).toBeUndefined();
  });

  it('does not format-match a course whose only quiz has already passed', async () => {
    const vault = vaultWith({});
    const assessments = [assessment({ type: 'Quiz', due: '2026-08-01' })];
    const formatMatch = await buildFormatMatch({ vault, assessments, now: NOW });
    expect(formatMatch('COGS214')).toBeUndefined();
  });

  it('carries terminology alone, no sentenceShapes, when past-paper material is thin', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/COGS214 Course Objectives.md': OBJECTIVES_NOTE,
    });
    const assessments = [assessment({ type: 'Quiz', due: '2026-09-10' })];
    const formatMatch = await buildFormatMatch({ vault, assessments, now: NOW });

    const decision = formatMatch('COGS214');
    expect(decision?.registerHint?.terminology.length).toBeGreaterThan(0);
    expect(decision?.registerHint?.sentenceShapes).toBeUndefined();
  });

  it('never format-matches an unrelated course, and does not conflate two courses in one vault', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/COGS214 Course Objectives.md': OBJECTIVES_NOTE,
      '03 Research/COGS214 Past Paper.md': PAST_PAPER_NOTE,
    });
    const assessments = [
      assessment({ path: 'a.md', course: 'COGS214', type: 'Quiz', due: '2026-09-10' }),
      assessment({ path: 'b.md', course: 'OTHER101', type: 'Quiz', due: '2026-09-05' }),
    ];
    const formatMatch = await buildFormatMatch({ vault, assessments, now: NOW });
    expect(formatMatch('COGS214')).toBeDefined();
    // OTHER101 has no registered sources of its own in this vault — thin, but still format-matched.
    const other = formatMatch('OTHER101');
    expect(other).toBeDefined();
    expect(other?.registerHint?.terminology).toEqual([]);
    expect(other?.registerHint?.sentenceShapes).toBeUndefined();
  });
});
