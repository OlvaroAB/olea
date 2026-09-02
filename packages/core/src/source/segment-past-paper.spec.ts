import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { segmentPastPaper } from './segment-past-paper.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
const PAST_PAPER_PATH = '03 Research/GEOL204 Past Paper 2024.md';

describe('segmentPastPaper — against the fixture past paper (P5-T01, F1.5)', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  async function segmentFixture() {
    const text = await source.read(PAST_PAPER_PATH);
    return segmentPastPaper(PAST_PAPER_PATH, text);
  }

  it('produces one addressable block per question and per sub-part, in document order', async () => {
    const result = await segmentFixture();
    expect(result.questions.map((q) => q.label)).toEqual([
      '1',
      '2',
      '3',
      '3(a)',
      '3(b)',
      '3(b)(i)',
      '3(b)(ii)',
      '4',
    ]);
  });

  it('multi-part questions: 3(a) and 3(b)(ii) both survive as their own addressable units with the right parent chain', async () => {
    const result = await segmentFixture();
    const byLabel = new Map(result.questions.map((q) => [q.label, q]));

    const partA = byLabel.get('3(a)');
    expect(partA?.parentLabel).toBe('3');
    expect(partA?.text).toContain('Define clast alignment');

    const partBii = byLabel.get('3(b)(ii)');
    expect(partBii?.parentLabel).toBe('3(b)');
    expect(partBii?.text).toContain('grainsize alone');

    const partBi = byLabel.get('3(b)(i)');
    expect(partBi?.parentLabel).toBe('3(b)');
  });

  it('a question spanning a page break: 3(b)(i) and 3(b)(ii) are both filed under 3(b) despite the thematic-break line between them', async () => {
    const result = await segmentFixture();
    const byLabel = new Map(result.questions.map((q) => [q.label, q]));

    // The page-break artifact (HTML comment + `***`) sits between (i) and
    // (ii) in the source; neither part's own text should have been merged
    // with the other's, and (ii) must still exist as a distinct part of the
    // *same* question, not a new top-level question "4.5" or similar.
    expect(byLabel.get('3(b)(i)')?.text).not.toContain('second cohort');
    expect(byLabel.get('3(b)(ii)')?.text).toContain('second cohort');
    expect(byLabel.get('3(b)(ii)')?.parentLabel).toBe('3(b)');
  });

  it('mark allocations in varying formats: parenthetical, bracketed, bare, and honestly undefined when absent', async () => {
    const result = await segmentFixture();
    const byLabel = new Map(result.questions.map((q) => [q.label, q]));

    expect(byLabel.get('1')?.marks).toBe(10); // "(10 marks)" on the heading
    expect(byLabel.get('2')?.marks).toBe(5); // "[5 marks]" on the heading
    expect(byLabel.get('3')?.marks).toBe(15); // "(15 marks)" on the heading
    expect(byLabel.get('3(a)')?.marks).toBe(4); // "[4 marks]" trailing the part text
    expect(byLabel.get('3(b)(ii)')?.marks).toBe(6); // bare "6 marks", no brackets

    // Never guessed: parts and questions that never state a mark allocation.
    expect(byLabel.get('3(b)')?.marks).toBeUndefined();
    expect(byLabel.get('3(b)(i)')?.marks).toBeUndefined();
    expect(byLabel.get('4')?.marks).toBeUndefined();
  });

  it('a section header that is not a question contributes no QuestionBlock and is reported separately', async () => {
    const result = await segmentFixture();
    expect(result.questions.some((q) => q.label.includes('Section'))).toBe(false);
    const headingTexts = result.nonQuestionHeadings.map((h) => h.text);
    expect(headingTexts).toEqual(
      expect.arrayContaining(['Section A — Multiple Choice', 'Section B — Short Answer Questions']),
    );
  });

  it('a question containing a list (Q1 MCQ options) is not split by it', async () => {
    const result = await segmentFixture();
    const q1 = result.questions.find((q) => q.label === '1');
    expect(q1?.text).toContain('burrow homogenisation');
    // Only one block for question 1 — the list did not spawn a spurious part.
    expect(
      result.questions.filter((q) => q.parentLabel === undefined && q.label === '1'),
    ).toHaveLength(1);
  });

  it('a question containing a code block (Q2 pseudocode) is not split by it, and the block does not get parsed as a part marker', async () => {
    const result = await segmentFixture();
    const q2 = result.questions.find((q) => q.label === '2');
    expect(q2?.text).toContain('storm_cycle');
    expect(result.questions.some((q) => q.parentLabel === '2')).toBe(false);
  });

  it('every question block carries provenance back to the past-paper source with an exact char range', async () => {
    const text = await source.read(PAST_PAPER_PATH);
    const result = await segmentFixture();
    for (const q of result.questions) {
      expect(q.provenance.sourcePath).toBe(PAST_PAPER_PATH);
      expect(q.provenance.location.page).toBe(1);
      // biome-ignore lint/style/noNonNullAssertion: the segmenter always sets charRange.
      const { start, end } = q.provenance.location.charRange!;
      expect(end).toBeGreaterThan(start);
      // The char range actually addresses real source text.
      expect(text.slice(start, end).length).toBe(end - start);
    }
  });

  it('is deterministic across repeated calls', async () => {
    const first = await segmentFixture();
    const second = await segmentFixture();
    expect(second).toEqual(first);
  });
});

describe('segmentPastPaper — synthetic edge cases', () => {
  it('a question with no sub-parts at all is still one addressable block', () => {
    const text = '## Question 1\nJust a stem, no parts.\n';
    const result = segmentPastPaper('paper.md', text);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.label).toBe('1');
    expect(result.questions[0]?.parentLabel).toBeUndefined();
  });

  it('does not misfire on ordinary body text that happens to start with a parenthesis', () => {
    const text = [
      '## Question 1',
      '(This whole question is about the following scenario.)',
      '',
      '(a) A real part.',
      '',
    ].join('\n');
    const result = segmentPastPaper('paper.md', text);
    const labels = result.questions.map((q) => q.label);
    // The intro parenthetical does not open a spurious part: `PART_MARKER_RE`
    // requires the closing `)` immediately after the letters with no space,
    // and "(This whole question..." has a space before its `)` ever arrives
    // — so the whole paragraph is absorbed as content of "1" directly.
    expect(labels).toEqual(['1', '1(a)']);
  });
});
