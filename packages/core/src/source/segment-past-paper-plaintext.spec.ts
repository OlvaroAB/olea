import { describe, expect, it } from 'vitest';
import type { ExtractedUnit, ExtractionResult, PageExtraction } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import { segmentPlainTextPastPaper } from './segment-past-paper-plaintext.js';

const SOURCE_PATH: VaultPath = '03 Research/Synthetic Past Paper.pdf';

/** Builds one text-layer `PageExtraction` the way `../extract/pdf.ts` does: one unit, `charRange` the whole page. */
function textPage(page: number, text: string): PageExtraction {
  const unit: ExtractedUnit = {
    text,
    provenance: {
      sourcePath: SOURCE_PATH,
      location: { page, charRange: { start: 0, end: text.length } },
    },
  };
  return {
    page,
    charCount: text.length,
    textLayer: 'readable',
    route: 'text-layer',
    units: [unit],
    furniture: false,
  };
}

/** A page that reached the text layer and found nothing usable — the vision route, no units. */
function visionPage(page: number): PageExtraction {
  return { page, charCount: 0, textLayer: 'absent', route: 'vision', units: [], furniture: false };
}

function extraction(pages: readonly PageExtraction[]): ExtractionResult {
  return { sourcePath: SOURCE_PATH, format: 'pdf', outcome: 'extracted', pages };
}

describe('segmentPlainTextPastPaper — synthetic fixtures modelled on findings/H4-past-paper-question-structure.md (F1.5, ol-pdfpastpaper)', () => {
  it('segments a well-formed single-family paper into top-level questions and single-letter sub-parts', () => {
    const page = [
      'Question 1. Describe the mechanism of tidal locking.',
      '',
      '(a) State the two bodies involved. [2 marks]',
      '',
      '(b) Explain the timescale over which locking occurs.',
      '',
      'Question 2. Outline glacial isostatic adjustment. (10 marks)',
    ].join('\n');

    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['1', '1(a)', '1(b)', '2']);
    expect(result.questions.find((q) => q.label === '1(a)')?.parentLabel).toBe('1');
    expect(result.questions.find((q) => q.label === '1(a)')?.marks).toBe(2);
    expect(result.questions.find((q) => q.label === '2')?.marks).toBe(10);
  });

  it('a part spanning a page break stays filed under the same parent, and the next part opens correctly on the far side', () => {
    const page1 = [
      'Question 3. Compare two sampling methods.',
      '',
      '(a) This part begins here and its answer runs long enough',
      'that it keeps going right up to the bottom of the page without',
      'a blank line ever appearing before the page boundary arrives',
    ].join('\n');
    const page2 = [
      'and the sentence simply continues here, on the next page, with',
      "no marker of its own — this is still part (a)'s own text.",
      '',
      '(b) A second part opens cleanly here, on the far side of the break.',
    ].join('\n');

    const result = segmentPlainTextPastPaper(extraction([textPage(1, page1), textPage(2, page2)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['3', '3(a)', '3(b)']);

    const partA = result.questions.find((q) => q.label === '3(a)');
    expect(partA?.parentLabel).toBe('3');
    expect(partA?.text).toContain('begins here');
    expect(partA?.text).toContain('simply continues here');
    // Own text starts on page 1, where the "(a)" marker itself sits.
    expect(partA?.provenance.location.page).toBe(1);

    const partB = result.questions.find((q) => q.label === '3(b)');
    expect(partB?.parentLabel).toBe('3');
    expect(partB?.provenance.location.page).toBe(2);
    expect(partB?.text).not.toContain('begins here');
  });

  it('marks: parenthetical, bracketed, "Maximum marks:", and bare forms are read where stated, undefined when absent', () => {
    const page = [
      'Question 1. First part. (10 marks)',
      '',
      'Question 2. Second part. [5 marks]',
      '',
      'Question 3. Third part has no stated marks at all.',
      '',
      'Question 4. Fourth part states its allocation as plain prose worth 6 marks total.',
    ].join('\n');

    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    const byLabel = new Map(result.questions.map((q) => [q.label, q]));
    expect(byLabel.get('1')?.marks).toBe(10);
    expect(byLabel.get('2')?.marks).toBe(5);
    expect(byLabel.get('3')?.marks).toBeUndefined();
    expect(byLabel.get('4')?.marks).toBe(6);
  });

  it('a decimal mark allocation extracts as its own value, never truncated to the digit after the decimal point (findings §5.8)', () => {
    const page = 'Question 1. Choose the correct option.               [1.5 marks]';
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions[0]?.marks).toBe(1.5);
  });

  it('"Maximum marks: N" is read even though none of the bracket/paren forms are present, and wins over an unrelated bare-marks sentence in the same span (findings §5.7)', () => {
    const page = [
      'Question 1. There is a total of 10 marks for these questions.',
      'Fill in your answer here.',
      'Maximum marks: 2',
    ].join('\n');
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions[0]?.marks).toBe(2);
  });

  it('a multi-letter parenthetical (R console output, "(Intercept)") is never mistaken for a part marker (findings §5.6)', () => {
    const page = [
      'Question 1. Interpret the regression output below.',
      '',
      '(Intercept)      0.4053    15.4873',
      '(cases)          -1.097    2.227e-01',
    ].join('\n');
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['1']);
    expect(result.questions[0]?.text).toContain('(Intercept)');
  });

  it('a running header/footer repeated across most pages is stripped from anchor detection and never spawns a phantom question (findings §5.3)', () => {
    // "1 Continuing Exam Session" is engineered to be syntactically exactly
    // what a top-level anchor looks like (digit, space, letter) — this
    // fixture exists to prove the furniture pass, not the anchor regex.
    const pages = [1, 2, 3, 4].map((n) =>
      textPage(
        n,
        ['1 Continuing Exam Session', '', `Question ${n}. Real content for page ${n}.`].join('\n'),
      ),
    );
    const result = segmentPlainTextPastPaper(extraction(pages));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['1', '2', '3', '4']);
  });

  it('a bare numeric line with no trailing prose (a footer fraction or an axis tick) is never treated as an anchor (findings §5.4, §5.5)', () => {
    const page = ['3/45', '', '25 / 20 / 15 / 10 / 5', '', 'Question 1. Real question text.'].join(
      '\n',
    );
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['1']);
  });

  it('an implausibly large anchor number (a session code or an axis value) is never treated as a question label (findings §3, §5.5)', () => {
    const page = [
      '1245 PSYCH 305 exam session header text.',
      '',
      'Question 1. Real question.',
    ].join('\n');
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('segmented');
    if (result.status !== 'segmented') return;
    expect(result.questions.map((q) => q.label)).toEqual(['1']);
  });

  it('a duplicate top-level label (a restarting section, or a concatenated question/answer booklet) degrades the whole document to unsegmented, with a reason (findings §3, §5.1)', () => {
    const page = [
      'Question 1. First occurrence.',
      '',
      'Question 2. Second question.',
      '',
      'Question 1. Second occurrence of label 1 — e.g. an answer booklet restating the question.',
    ].join('\n');
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('unsegmented');
    if (result.status !== 'unsegmented') return;
    expect(result.reason).toMatch(/duplicate/i);
    expect(result.questions).toEqual([]);
  });

  it('a document with no recognisable question-numbering pattern at all is reported with a reason, never crashes, never silently returns nothing unexplained', () => {
    const page = [
      'This document is entirely unstructured prose.',
      '',
      'It never numbers anything at all.',
    ].join('\n');
    const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
    expect(result.status).toBe('unsegmented');
    if (result.status !== 'unsegmented') return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('an extraction that never reached readable text (outcome other than extracted) degrades honestly instead of throwing', () => {
    const result = segmentPlainTextPastPaper({
      sourcePath: SOURCE_PATH,
      format: 'pdf',
      outcome: 'no-pages-found',
      pages: [],
    });
    expect(result.status).toBe('unsegmented');
    if (result.status !== 'unsegmented') return;
    expect(result.reason).toMatch(/no-pages-found/);
  });

  it('every page staying on the vision route degrades honestly rather than reporting a silent empty success', () => {
    const result = segmentPlainTextPastPaper(extraction([visionPage(1), visionPage(2)]));
    expect(result.status).toBe('unsegmented');
    if (result.status !== 'unsegmented') return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('never throws on an empty pages array with outcome "extracted"', () => {
    expect(() => segmentPlainTextPastPaper(extraction([]))).not.toThrow();
  });

  describe('anchor-convention coverage (ol-m0kx, diagnosed by ol-j4p4) — one synthetic fixture per convention from findings/H4-past-paper-question-structure.md §3, table-driven', () => {
    interface AnchorCase {
      readonly name: string;
      readonly page: string;
      readonly expectedLabels: readonly string[];
    }

    const cases: readonly AnchorCase[] = [
      {
        name: '"N." + text, indented at the paragraph start (H4 §3 row 1)',
        page: [
          '1. Describe the mechanism under study.',
          '',
          '2. Outline the alternative model.',
        ].join('\n'),
        expectedLabels: ['1', '2'],
      },
      {
        name: '"N. This question refers to Appendix X." — a booklet cross-reference stem (H4 §3 row 2)',
        page: [
          '3. This question refers to the dataset in Appendix A.',
          '',
          '4. This question refers to the dataset in Appendix B.',
        ].join('\n'),
        expectedLabels: ['3', '4'],
      },
      {
        name: 'bare gutter integer immediately followed by prose on the same line (H4 §3 row 4)',
        page: [
          '1 Briefly outline the proposed mechanism.',
          '',
          '2 Explain the observed effect.',
        ].join('\n'),
        expectedLabels: ['1', '2'],
      },
      {
        name: 'gutter integer plus a restated "QN." label on the same line (H4 §3 row 5)',
        page: [
          '1 Q1. Briefly describe the first phenomenon.',
          '',
          '2 Q2. Briefly describe the second phenomenon.',
        ].join('\n'),
        expectedLabels: ['1', '2'],
      },
      {
        name: 'capital-letter top-level items with no number at all (H4 §3 row 6 — previously invisible to every anchor)',
        page: [
          'A. Using examples, outline the first alternative approach.',
          '',
          'B. Using examples, outline the second alternative approach.',
        ].join('\n'),
        expectedLabels: ['A', 'B'],
      },
    ];

    it.each(cases)('$name', ({ page, expectedLabels }) => {
      const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
      expect(result.status).toBe('segmented');
      if (result.status !== 'segmented') return;
      expect(result.questions.map((q) => q.label)).toEqual(expectedLabels);
    });

    it('a restated "Question N." top-level heading (the sixth convention, H4 §3 row 3 — an F3 answer booklet restating its own question) is recognised as an anchor, which is exactly what makes it collide with the first occurrence and correctly degrade the whole document rather than double-count it (H4 §5.1)', () => {
      const page = [
        'Question 1. First occurrence of the stem.',
        '',
        'Question 2. A different question.',
        '',
        'Question 1. Restated in what would be an answer booklet.',
      ].join('\n');
      const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
      expect(result.status).toBe('unsegmented');
      if (result.status !== 'unsegmented') return;
      expect(result.reason).toMatch(/duplicate/i);
    });

    it('a lowercase letter-plus-delimiter line is never read as a top-level anchor — it stays reserved for sub-part markers, so it never collides with the widespread lowercase sub-part/MCQ-option conventions (H4 §4.1)', () => {
      const page = [
        'Question 1. A question with lettered sub-parts written without parentheses.',
        '',
        'a. First sub-part, in the unparenthesised form many real papers use.',
        '',
        'b. Second sub-part.',
      ].join('\n');
      const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
      expect(result.status).toBe('segmented');
      if (result.status !== 'segmented') return;
      // Neither "a." nor "b." opens a new top-level question — both are
      // absorbed as content of question 1, since this module recognises
      // sub-parts only in the `(x)` form (module doc, point 3).
      expect(result.questions.map((q) => q.label)).toEqual(['1']);
      expect(result.questions[0]?.text).toContain('a. First sub-part');
      expect(result.questions[0]?.text).toContain('b. Second sub-part');
    });

    it('a capital letter beyond MAX_TOP_LEVEL_LETTER is not treated as a top-level anchor, the same conservatism MAX_TOP_LEVEL_QUESTION_NUMBER applies to an implausible number', () => {
      const page = [
        'Question 1. A real question.',
        '',
        'Z. This looks like a lettered alternative but sits far past any real one.',
      ].join('\n');
      const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
      expect(result.status).toBe('segmented');
      if (result.status !== 'segmented') return;
      expect(result.questions.map((q) => q.label)).toEqual(['1']);
      expect(result.questions[0]?.text).toContain('Z. This looks like');
    });

    it('a duplicate capital-letter label degrades the document to unsegmented, the same conservative behaviour numeric duplicates already get', () => {
      const page = [
        'A. First alternative.',
        '',
        'B. Second alternative.',
        '',
        'A. Restated first alternative — e.g. a repeated section page.',
      ].join('\n');
      const result = segmentPlainTextPastPaper(extraction([textPage(1, page)]));
      expect(result.status).toBe('unsegmented');
      if (result.status !== 'unsegmented') return;
      expect(result.reason).toMatch(/duplicate/i);
    });
  });
});
