/**
 * `copy.ts` tests — the practice-paper student-facing strings (F4.11, `[D-262]` ruling 4).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice-paper command and view
 * surface [PAPER-8]", tagged `@auto:plugin/paper/copy.spec`.
 */
import type { PaperStructuredShape } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildLockedCopy,
  buildNoAssessmentAheadCopy,
  buildPaperFaceOutline,
  buildPartialPaperStatement,
  PAPER_FACE_WORDING,
  paperMarksText,
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
  const input = {
    course: 'COURSEA',
    daysUntilNearest: 12,
    nearestAssessmentDue: '2026-10-01',
    coverage: { outcomeCount: 10, attachedOutcomeCount: 1, outcomeCoverageKnown: true },
    topicsNeeded: 3,
    windowDays: 7,
  };

  it('states a date and a day count, never a percentage or ratio', () => {
    const copy = buildLockedCopy(input);
    expect(copy).toContain('COURSEA');
    expect(copy).toContain('2026-10-01');
    expect(copy).toContain('12 days');
    expect(copy).not.toMatch(/%|\bpercent\b/i);
  });

  it('singularises "day" for exactly one day', () => {
    const copy = buildLockedCopy({ ...input, daysUntilNearest: 1 });
    expect(copy).toContain('(1 day away)');
  });
});

describe('buildNoAssessmentAheadCopy', () => {
  it('never implies a reason is being withheld — F4.11: the affordance is simply absent', () => {
    const copy = buildNoAssessmentAheadCopy('COURSEA');
    expect(copy).toContain('COURSEA');
    expect(copy.toLowerCase()).not.toContain('locked');
  });
});

// ---- `[D-586]` (F4.11): the face prints the stored paper's structure. Synthetic, coined content only.

const stated = (value: number) => ({ status: 'stated', value }) as const;
const UNKNOWN = { status: 'unknown' } as const;
const NO_STIMULUS = { status: 'not-needed' } as const;

function group(
  groupId: string,
  kind: 'parent-question' | 'section' | 'choice' | 'shared-stimulus',
  sectionId: string | null,
  slotIds: string[],
  parentGroupId?: string,
) {
  return {
    groupId,
    kind,
    sectionId,
    ...(parentGroupId === undefined ? {} : { parentGroupId }),
    label: `${groupId} heading`,
    slotIds,
    stimulusNeed: NO_STIMULUS,
    heldStimulus: null,
  } as const;
}

function part(
  slotId: string,
  groupId: string,
  label: string,
  marks: PaperStructuredShape['totalMarks'],
) {
  return {
    slotId,
    groupId,
    label,
    questionForm: 'short answer',
    marks,
    dependsOn: { status: 'unknown' },
    demand: { status: 'not-read' },
  } as const;
}

/** Two sections: A holds question 1 (parts 1(a), 1(b)) and a standalone question; B holds question 2 with an unknown-marks part. */
const SECTIONED: PaperStructuredShape = {
  formatVersion: 'paper-structure-v1',
  structureBasis: 'current-or-transitional',
  structureSlotCount: 5,
  sections: [
    { sectionId: 'sA', label: 'Section Glorb', marks: stated(20), groupIds: ['g1', 'g3'] },
    { sectionId: 'sB', label: 'Section Quill', marks: UNKNOWN, groupIds: ['g2'] },
  ],
  groups: [
    group('g1', 'parent-question', 'sA', ['p1', 'p2']),
    group('g3', 'parent-question', 'sA', ['p3']),
    group('g2', 'parent-question', 'sB', ['p4', 'p5']),
  ],
  parts: [
    part('p1', 'g1', '1(a)', stated(4)),
    part('p2', 'g1', '1(b)', stated(0)),
    part('p3', 'g3', '2', stated(6)),
    part('p4', 'g2', '3(a)', UNKNOWN),
    part('p5', 'g2', '3(b)', stated(10)),
  ],
  totalMarks: stated(40),
  timeAllowance: { status: 'unknown' },
} as PaperStructuredShape;

const ALL_SLOTS = ['p1', 'p2', 'p3', 'p4', 'p5'];

describe('buildPaperFaceOutline — a sectioned paper', () => {
  const outline = buildPaperFaceOutline(SECTIONED, ALL_SLOTS);

  it('prints each stored section heading in stored order, with the stored question and part numbering', () => {
    expect(outline.kind).toBe('structured');
    if (outline.kind !== 'structured') return;
    expect(outline.sections.map((s) => s.heading)).toEqual(['Section Glorb', 'Section Quill']);
    const [a, b] = outline.sections;
    expect(a?.questions.map((q) => q.number)).toEqual(['1', null]);
    expect(a?.questions[0]?.parts.map((p) => p.number)).toEqual(['1(a)', '1(b)']);
    // A standalone question is its own part: its stored label, and no invented question number.
    expect(a?.questions[1]?.parts.map((p) => p.number)).toEqual(['2']);
    expect(b?.questions[0]?.number).toBe('3');
    expect(b?.questions[0]?.parts.map((p) => p.number)).toEqual(['3(a)', '3(b)']);
    expect(outline.unplacedSlotIds).toEqual([]);
  });

  it('prints every stated allocation: parts, a section, the whole paper, and a stated zero as zero', () => {
    if (outline.kind !== 'structured') throw new Error('expected structured');
    expect(outline.wholePaperMarks).toBe('[40]');
    expect(outline.sections[0]?.marks).toBe('[20]');
    expect(outline.sections[0]?.questions[0]?.parts.map((p) => p.marks)).toEqual(['[4]', '[0]']);
  });
});

describe('buildPaperFaceOutline — an allocation read as unknown', () => {
  it('is omitted: never zero, never estimated from the other parts or the item count', () => {
    const outline = buildPaperFaceOutline(
      { ...SECTIONED, totalMarks: UNKNOWN } as PaperStructuredShape,
      ALL_SLOTS,
    );
    if (outline.kind !== 'structured') throw new Error('expected structured');
    const b = outline.sections[1];
    expect(b?.marks).toBeNull(); // section Quill's marks are unknown
    expect(b?.questions[0]?.parts.map((p) => p.marks)).toEqual([null, '[10]']);
    expect(outline.wholePaperMarks).toBeNull();
  });

  it('paperMarksText: unknown and unusable numbers read null, a stated number reads as a bracketed allocation', () => {
    expect(paperMarksText(UNKNOWN)).toBeNull();
    expect(paperMarksText(stated(Number.NaN))).toBeNull();
    expect(paperMarksText(stated(-1))).toBeNull();
    expect(paperMarksText(stated(7))).toBe('[7]');
    expect(PAPER_FACE_WORDING.marksAllocation(7)).toBe('[7]');
  });
});

describe('buildPaperFaceOutline — a paper with no recovered sections', () => {
  it('is flat (today’s face) with no structure at all', () => {
    expect(buildPaperFaceOutline(undefined, ALL_SLOTS)).toEqual({ kind: 'flat' });
  });

  it('is flat when the stored structure holds no sections, even with groups and parts', () => {
    expect(buildPaperFaceOutline({ ...SECTIONED, sections: [] }, ALL_SLOTS)).toEqual({
      kind: 'flat',
    });
  });

  it('is flat when none of the paper’s items match a stored part', () => {
    expect(buildPaperFaceOutline(SECTIONED, ['zz1', 'zz2'])).toEqual({ kind: 'flat' });
  });
});

describe('buildPaperFaceOutline — items without a stored part, and omitted parts', () => {
  it('lists an unmatched item after the sections, unnumbered; prints nothing for a part with no item', () => {
    const outline = buildPaperFaceOutline(SECTIONED, ['p1', 'p5', 'zz1']);
    if (outline.kind !== 'structured') throw new Error('expected structured');
    expect(outline.unplacedSlotIds).toEqual(['zz1']);
    expect(outline.sections[0]?.questions[0]?.number).toBe('1'); // the present part’s own label supports it
    expect(outline.sections[0]?.questions[0]?.parts.map((p) => p.number)).toEqual(['1(a)']);
  });

  it('prints no question number when the parts’ labels share no leading token', () => {
    const mixed = {
      ...SECTIONED,
      parts: SECTIONED.parts.map((p) => (p.slotId === 'p2' ? { ...p, label: 'B' } : p)),
    } as PaperStructuredShape;
    const outline = buildPaperFaceOutline(mixed, ALL_SLOTS);
    if (outline.kind !== 'structured') throw new Error('expected structured');
    expect(outline.sections[0]?.questions[0]?.number).toBeNull();
    expect(outline.sections[0]?.questions[0]?.parts.map((p) => p.number)).toEqual(['1(a)', 'B']);
  });
});
