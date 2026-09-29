import { describe, expect, it } from 'vitest';
import type { ExtractedUnit, ExtractionResult, PageExtraction } from '../extract/types.js';
import { segmentPastPaper } from '../source/segment-past-paper.js';
import { segmentPlainTextPastPaper } from '../source/segment-past-paper-plaintext.js';
import type { VaultPath } from '../vault/types.js';
import {
  groupMarkdownPastPaper,
  groupPaperQuestions,
  groupPlainTextPastPaper,
  plainTextPaperText,
  type TextPaperQuestionGrouping,
} from './paper-question-groups.js';

/**
 * `ol-egov.141.89.7.12` — question groups and shared stimuli for text papers.
 * Every fixture here is synthetic (INV-3): invented subjects, invented wording, no course code.
 */

const MD_PATH: VaultPath = 'Synthetic/Practice Paper.md';
const PDF_PATH: VaultPath = 'Synthetic/Practice Paper.pdf';

function textPage(page: number, text: string): PageExtraction {
  const unit: ExtractedUnit = {
    text,
    provenance: {
      sourcePath: PDF_PATH,
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

function extraction(pages: readonly string[]): ExtractionResult {
  return {
    sourcePath: PDF_PATH,
    format: 'pdf',
    outcome: 'extracted',
    pages: pages.map((text, i) => textPage(i + 1, text)),
  };
}

function groupOf(grouping: TextPaperQuestionGrouping, id: string) {
  const group = grouping.groups.find((g) => g.id === id);
  if (group === undefined) throw new Error(`no group ${id}`);
  return group;
}

function pathOf(grouping: TextPaperQuestionGrouping, label: string): readonly string[] {
  const placement = grouping.placements.find((p) => p.label === label);
  if (placement === undefined) throw new Error(`no placement ${label}`);
  return placement.groupPath;
}

const MARKDOWN_SECTIONS_PAPER = [
  '# Synthetic Practice Paper',
  '',
  'Instructions: Answer ALL questions in Section A. Answer ONE of the questions in Section B.',
  '',
  '## Section A — Short Answer Questions',
  '',
  '## Question 1 (10 marks)',
  '',
  'Explain how a thermostat keeps a room near a set temperature.',
  '',
  '## Question 2 (15 marks)',
  '',
  'The table below shows the mean daily output of three solar panels over one week.',
  '',
  '| Panel | Mon | Tue | Wed |',
  '| --- | --- | --- | --- |',
  '| P1 | 4.1 | 3.9 | 4.4 |',
  '| P2 | 3.2 | 3.0 | 3.5 |',
  '',
  '(a) Identify the panel with the highest output. [2 marks]',
  '',
  '(b) Suggest one reason for the difference between panels. [3 marks]',
  '',
  '## Section B — Essays',
  '',
  '## Question 3 (25 marks)',
  '',
  'Discuss the causes of coastal erosion.',
  '',
  '## Question 4 (25 marks)',
  '',
  'Evaluate two methods of flood defence.',
  '',
].join('\n');

const MARKDOWN_STIMULUS_PAPER = [
  '# Synthetic Paper Two',
  '',
  '## Case study',
  '',
  'A small bakery sells bread and cakes. Last year it opened a second shop in a nearby town,',
  'and sales of cakes rose while bread sales stayed flat.',
  '',
  '## Question 1',
  '',
  'Identify one fixed cost for the bakery.',
  '',
  '## Question 2',
  '',
  'Explain one reason cake sales might have risen.',
  '',
  '## Section B',
  '',
  '## Question 3 (12 marks)',
  '',
  'Figure 1 shows monthly rainfall at two weather stations.',
  '',
  '![[synthetic-rainfall-chart.png]]',
  '',
  '(a) Describe the pattern shown. [4 marks]',
  '',
  '(b) Compare the two stations.',
  '',
  '(i) State which station is wetter.',
  '',
  '(ii) Explain one factor behind the difference. [4 marks]',
  '',
  '## Question 4',
  '',
  '(a) Using the table above, calculate the mean.',
  '',
  '(b) Comment on the spread.',
  '',
].join('\n');

const PLAIN_SECTIONS_PAGES = [
  [
    'SECTION A',
    'Answer ALL questions in this section.',
    '',
    '1. Define kinetic energy. (2 marks)',
    '',
    '2. State the first law of motion. (2 marks)',
    '',
    'Questions 3 to 4 refer to the scenario below.',
    '',
    'A cyclist rides up a steep hill at constant speed and then coasts down the far side',
    'without pedalling, reaching the bottom in half the time the climb took.',
    '',
    '3. Describe the energy changes on the way up. (4 marks)',
    // A page that ends in a blank line: the splitter joins pages with one newline and never splits
    // a paragraph at a page join, so the next page's first question needs the blank line.
    '',
  ].join('\n'),
  [
    '4. Explain why the descent is faster. (4 marks)',
    '',
    'SECTION B',
    'Answer ONE question from this section.',
    '',
    '5. Discuss the conservation of momentum. (20 marks)',
    '',
    '6. Discuss the conservation of energy. (20 marks)',
    '',
  ].join('\n'),
  [
    'SECTION B (continued)',
    '',
    '7. Discuss rotational motion in everyday machines. (20 marks)',
  ].join('\n'),
];

const PLAIN_CHOICE_PAGES = [
  [
    'Answer TWO of the following three questions.',
    '',
    '1. Describe the water cycle.',
    '',
    '2. Explain why deserts form.',
    '',
    '3. Answer either (a) or (b).',
    '',
    '(a) Discuss the formation of river deltas.',
    '',
    '(b) Discuss the formation of glaciers.',
  ].join('\n'),
];

describe('groupPaperQuestions — parent questions (ol-egov.141.89.7.12)', () => {
  it('makes each parent a parent-question group over its direct sub-parts, stem = its own text, nested parents inside', () => {
    const segmentation = segmentPastPaper(MD_PATH, MARKDOWN_STIMULUS_PAPER);
    const grouping = groupMarkdownPastPaper(segmentation, MARKDOWN_STIMULUS_PAPER);

    const q3 = groupOf(grouping, 'question:3');
    expect(q3.kind).toBe('parent-question');
    expect(q3.memberLabels).toEqual(['3(a)', '3(b)']);
    const q3Block = segmentation.questions.find((q) => q.label === '3');
    expect(q3.anchor).toEqual(q3Block?.provenance.location.charRange);

    const q3b = groupOf(grouping, 'question:3(b)');
    expect(q3b.memberLabels).toEqual(['3(b)(i)', '3(b)(ii)']);
    expect(q3b.parentGroupId).toBe('question:3');

    expect(pathOf(grouping, '3(b)(ii)')).toEqual(['section:1', 'question:3', 'question:3(b)']);
    expect(grouping.placements.find((p) => p.label === '3')?.isStem).toBe(true);
    expect(grouping.placements.find((p) => p.label === '3(a)')?.isStem).toBe(false);
  });
});

describe('groupPaperQuestions — sections, from either splitter', () => {
  it('markdown: a section heading groups the questions under it, stem = heading to first question', () => {
    const segmentation = segmentPastPaper(MD_PATH, MARKDOWN_SECTIONS_PAPER);
    const grouping = groupMarkdownPastPaper(segmentation, MARKDOWN_SECTIONS_PAPER);

    const a = groupOf(grouping, 'section:1');
    expect(a.kind).toBe('section');
    expect(a.memberLabels).toEqual(['1', '2']);
    expect(MARKDOWN_SECTIONS_PAPER.slice(a.anchor.start, a.anchor.end)).toBe(
      '## Section A — Short Answer Questions',
    );
    expect(a.parentGroupId).toBeUndefined();

    const b = groupOf(grouping, 'section:2');
    expect(b.memberLabels).toEqual(['3', '4']);
    expect(pathOf(grouping, '2(b)')).toEqual(['section:1', 'question:2']);
    expect(pathOf(grouping, '4')[0]).toBe('section:2');
  });

  it('extracted text: section lines group the questions after them; a repeated section line opens nothing new', () => {
    const ex = extraction(PLAIN_SECTIONS_PAGES);
    const segmentation = segmentPlainTextPastPaper(ex);
    expect(segmentation.status).toBe('segmented');
    const grouping = groupPlainTextPastPaper(ex, segmentation);

    const sections = grouping.groups.filter((g) => g.kind === 'section');
    expect(sections.map((s) => s.memberLabels)).toEqual([
      ['1', '2', '3', '4'],
      ['5', '6', '7'],
    ]);
    const text = plainTextPaperText(ex);
    const a = groupOf(grouping, 'section:1');
    expect(text.slice(a.anchor.start, a.anchor.end)).toBe(
      'SECTION A\nAnswer ALL questions in this section.',
    );
    expect(pathOf(grouping, '6')).toEqual(['section:2', 'choice:section:2']);
  });

  it('a prose line that merely begins "Part B of ..." is not a section', () => {
    const ex = extraction([
      [
        '1. Describe the apparatus.',
        'Part B of the experiment used a second beaker.',
        '',
        '2. Explain the result.',
      ].join('\n'),
    ]);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    expect(grouping.groups.filter((g) => g.kind === 'section')).toEqual([]);
  });
});

describe('groupPaperQuestions — choices, at the level they were stated', () => {
  it('a section instruction, a preamble instruction naming a section, and a stem "either" each make a choice group with its count', () => {
    const md = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_SECTIONS_PAPER),
      MARKDOWN_SECTIONS_PAPER,
    );
    const mdChoice = groupOf(md, 'choice:section:2');
    expect(mdChoice.kind).toBe('choice');
    expect(mdChoice.memberLabels).toEqual(['3', '4']);
    expect(mdChoice.choose).toBe(1);
    expect(mdChoice.parentGroupId).toBe('section:2');
    // Anchored on the preamble's own instruction sentence, which names the section.
    expect(MARKDOWN_SECTIONS_PAPER.slice(mdChoice.anchor.start, mdChoice.anchor.end)).toBe(
      'Answer ONE of the questions in Section B.',
    );
    // "Answer ALL questions in Section A" is not a choice.
    expect(md.groups.some((g) => g.id === 'choice:section:1')).toBe(false);

    const ex = extraction(PLAIN_SECTIONS_PAGES);
    const plain = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    const sectionChoice = groupOf(plain, 'choice:section:2');
    expect(sectionChoice.memberLabels).toEqual(['5', '6', '7']);
    expect(sectionChoice.choose).toBe(1);
  });

  it('a preamble instruction with no section groups the whole paper; a stem "either" groups that question\'s parts', () => {
    const ex = extraction(PLAIN_CHOICE_PAGES);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));

    const paper = groupOf(grouping, 'choice:paper');
    expect(paper.memberLabels).toEqual(['1', '2', '3']);
    expect(paper.choose).toBe(2);
    expect(paper.parentGroupId).toBeUndefined();

    const either = groupOf(grouping, 'choice:question:3');
    expect(either.memberLabels).toEqual(['3(a)', '3(b)']);
    expect(either.choose).toBe(1);
    expect(either.parentGroupId).toBe('question:3');
    expect(pathOf(grouping, '3(b)')).toEqual(['choice:paper', 'question:3', 'choice:question:3']);
  });

  it('a stated count at or above the number of members is not a choice', () => {
    const ex = extraction([
      [
        'Answer THREE questions.',
        '',
        '1. Define mass.',
        '',
        '2. Define weight.',
        '',
        '3. Define density.',
      ].join('\n'),
    ]);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    expect(grouping.groups.filter((g) => g.kind === 'choice')).toEqual([]);
  });
});

describe('groupPaperQuestions — shared stimuli, located where the text prints them', () => {
  it('a question-range cue makes a shared-stimulus group with the scenario it prints identified', () => {
    const ex = extraction(PLAIN_SECTIONS_PAGES);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    const text = plainTextPaperText(ex);

    const stimulus = groupOf(grouping, 'stimulus:1');
    expect(stimulus.kind).toBe('shared-stimulus');
    expect(stimulus.memberLabels).toEqual(['3', '4']);
    expect(stimulus.parentGroupId).toBe('section:1');
    expect(stimulus.stimulus.status).toBe('identified');
    if (stimulus.stimulus.status !== 'identified') return;
    expect(stimulus.stimulus.form).toBe('scenario');
    const printed = text.slice(stimulus.stimulus.anchor.start, stimulus.stimulus.anchor.end);
    expect(printed.startsWith('Questions 3 to 4 refer to the scenario below.')).toBe(true);
    expect(printed.endsWith('half the time the climb took.')).toBe(true);
    expect(pathOf(grouping, '4')).toEqual(['section:1', 'stimulus:1']);
  });

  it('a markdown stimulus heading groups the questions under it; a parent stem that prints a table carries it', () => {
    const stimulusPaper = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_STIMULUS_PAPER),
      MARKDOWN_STIMULUS_PAPER,
    );
    const caseStudy = groupOf(stimulusPaper, 'stimulus:1');
    expect(caseStudy.label).toBe('Case study');
    expect(caseStudy.memberLabels).toEqual(['1', '2']);
    expect(caseStudy.stimulus).toMatchObject({ status: 'identified', form: 'scenario' });

    const sectionsPaper = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_SECTIONS_PAPER),
      MARKDOWN_SECTIONS_PAPER,
    );
    const q2 = groupOf(sectionsPaper, 'question:2');
    expect(q2.stimulus.status).toBe('identified');
    if (q2.stimulus.status !== 'identified') return;
    expect(q2.stimulus.form).toBe('table');
    expect(
      MARKDOWN_SECTIONS_PAPER.slice(q2.stimulus.anchor.start, q2.stimulus.anchor.end),
    ).toContain('| P2 | 3.2 | 3.0 | 3.5 |');
  });

  it('a figure is not identified (figure-not-in-text); a table a part points back at but no stem prints is not located; the rest read no-cue, never none', () => {
    const grouping = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_STIMULUS_PAPER),
      MARKDOWN_STIMULUS_PAPER,
    );
    expect(groupOf(grouping, 'question:3').stimulus).toEqual({
      status: 'not-identified',
      form: 'figure',
      reason: 'figure-not-in-text',
    });
    expect(groupOf(grouping, 'question:4').stimulus).toEqual({
      status: 'not-identified',
      form: 'table',
      reason: 'referenced-not-located',
    });
    expect(groupOf(grouping, 'question:3(b)').stimulus).toEqual({
      status: 'not-identified',
      reason: 'no-cue',
    });
    expect(groupOf(grouping, 'section:1').stimulus).toEqual({
      status: 'not-identified',
      reason: 'no-cue',
    });
    const everyStatus = [MARKDOWN_SECTIONS_PAPER, MARKDOWN_STIMULUS_PAPER].flatMap((source) =>
      groupMarkdownPastPaper(segmentPastPaper(MD_PATH, source), source).groups.map(
        (g) => g.stimulus.status,
      ),
    );
    expect(everyStatus).not.toContain('none');
  });

  it('a stem that names a stimulus but does not print it is not located, never identified', () => {
    const ex = extraction([
      [
        '1. Refer to the scenario on the separate insert.',
        '',
        '(a) Name the main character.',
        '',
        '(b) Describe the setting.',
      ].join('\n'),
    ]);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    expect(groupOf(grouping, 'question:1').stimulus).toEqual({
      status: 'not-identified',
      form: 'scenario',
      reason: 'referenced-not-located',
    });
  });
});

describe("groupPaperQuestions — never changes the splitter's questions", () => {
  it('places every segmented question exactly once, in document order, and a range naming no segmented question forms no group', () => {
    const pages = [
      ...PLAIN_SECTIONS_PAGES.slice(0, 2),
      `${PLAIN_SECTIONS_PAGES[2]}\n\nQuestions 8 to 9 refer to the table below.`,
    ];
    const ex = extraction(pages);
    const segmentation = segmentPlainTextPastPaper(ex);
    const grouping = groupPlainTextPastPaper(ex, segmentation);
    expect(grouping.placements.map((p) => p.label)).toEqual(
      segmentation.questions.map((q) => q.label),
    );
    expect(grouping.groups.filter((g) => g.kind === 'shared-stimulus')).toHaveLength(1);
    for (const group of grouping.groups) {
      for (const member of group.memberLabels) {
        expect(segmentation.questions.some((q) => q.label === member)).toBe(true);
      }
    }
  });

  it("plainTextPaperText is the text the plain-text splitter's ranges index into (drift guard)", () => {
    for (const pages of [PLAIN_SECTIONS_PAGES, PLAIN_CHOICE_PAGES]) {
      const ex = extraction(pages);
      const segmentation = segmentPlainTextPastPaper(ex);
      const text = plainTextPaperText(ex);
      expect(segmentation.questions.length).toBeGreaterThan(0);
      for (const question of segmentation.questions) {
        const range = question.provenance.location.charRange;
        expect(range).toBeDefined();
        if (range === undefined) continue;
        expect(text.slice(range.start, range.end)).toBe(question.text);
      }
    }
  });

  it('an unsegmented paper yields no groups and no placements', () => {
    const ex = extraction(['No numbered questions appear anywhere in this text.']);
    const segmentation = segmentPlainTextPastPaper(ex);
    expect(segmentation.status).toBe('unsegmented');
    expect(groupPlainTextPastPaper(ex, segmentation)).toEqual({ groups: [], placements: [] });
  });

  it('a paper with no groups at all returns each question with an empty path', () => {
    const grouping = groupPaperQuestions({
      questions: segmentPastPaper(MD_PATH, '## Question 1\n\nDefine speed.\n').questions,
      text: '## Question 1\n\nDefine speed.\n',
    });
    expect(grouping).toEqual({
      groups: [],
      placements: [{ label: '1', groupPath: [], isStem: false }],
    });
  });
});

// ---- Row 51 (decision sheet, 2026-09-29): the declared patterns and cutoffs are provisional
// development defaults, not validated by being declared. These are the development checks: short
// shared material, tables and long headings, plus the rule that structure a cue names but this pass
// cannot place is preserved, never silently dropped. Synthetic wording only (INV-3).

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');

const stemPaper = (bodyWords: number): string =>
  [
    '## Question 1',
    '',
    `Read the following scenario carefully. ${words(bodyWords)}`,
    '',
    '(a) Identify one cost.',
    '',
    '(b) Explain one benefit.',
    '',
  ].join('\n');

describe('development checks (row 51): short shared material', () => {
  it('keeps a shared stimulus a few words long as a located stimulus under its heading, not dropped for being short', () => {
    const source = [
      '## Extract A',
      '',
      'Short text here.',
      '',
      '## Question 1',
      '',
      'Identify the theme.',
      '',
    ].join('\n');
    const grouping = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, source), source);
    const group = grouping.groups.find((g) => g.kind === 'shared-stimulus');
    expect(group?.memberLabels).toEqual(['1']);
    expect(group?.stimulus).toMatchObject({ status: 'identified', form: 'extract' });
    expect(grouping.unresolved).toBeUndefined();
  });

  it('a stem stimulus needs the declared word cutoff: one word under it reads not located, at it reads identified', () => {
    const under = stemPaper(7);
    const at = stemPaper(8);
    const groupUnder = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, under), under);
    const groupAt = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, at), at);
    expect(groupOf(groupUnder, 'question:1').stimulus).toMatchObject({
      status: 'not-identified',
      reason: 'referenced-not-located',
    });
    expect(groupOf(groupAt, 'question:1').stimulus).toMatchObject({
      status: 'identified',
      form: 'scenario',
    });
  });
});

describe('development checks (row 51): tables', () => {
  it('a table under a table heading is a located stimulus whose anchor reaches into the table', () => {
    const source = [
      '## Table 1',
      '',
      '| Sample | Mass |',
      '| --- | --- |',
      '| S1 | 4.2 |',
      '',
      '## Question 1',
      '',
      'Which sample is heaviest?',
      '',
    ].join('\n');
    const grouping = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, source), source);
    const group = grouping.groups.find((g) => g.kind === 'shared-stimulus');
    expect(group?.stimulus.status).toBe('identified');
    if (group?.stimulus.status !== 'identified') return;
    expect(group.stimulus.form).toBe('table');
    expect(source.slice(group.stimulus.anchor.start, group.stimulus.anchor.end)).toContain(
      '| S1 | 4.2 |',
    );
  });

  it('a table in a stem is carried by its parent group, and a table a part points back at but no stem prints is not located', () => {
    const printed = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_SECTIONS_PAPER),
      MARKDOWN_SECTIONS_PAPER,
    );
    expect(groupOf(printed, 'question:2').stimulus).toMatchObject({
      status: 'identified',
      form: 'table',
    });
    const pointedAt = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_STIMULUS_PAPER),
      MARKDOWN_STIMULUS_PAPER,
    );
    expect(groupOf(pointedAt, 'question:4').stimulus).toMatchObject({
      status: 'not-identified',
      form: 'table',
      reason: 'referenced-not-located',
    });
  });
});

describe('development checks (row 51): long headings', () => {
  const LONG_WORDING =
    'Answer ONE of the following questions on any of the topics covered in the second half of the term and write in full sentences throughout';

  it('markdown has no length cutoff on a heading: a long section heading is read whole, with its choice count', () => {
    const heading = `## Section B — ${LONG_WORDING}`;
    expect(heading.length).toBeGreaterThan(120);
    const source = [
      heading,
      '',
      '## Question 1',
      '',
      'Discuss tides.',
      '',
      '## Question 2',
      '',
      'Discuss waves.',
      '',
    ].join('\n');
    const grouping = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, source), source);
    const section = grouping.groups.find((g) => g.kind === 'section');
    expect(section?.label).toBe(heading.replace(/^## /, ''));
    expect(grouping.groups.find((g) => g.kind === 'choice')?.choose).toBe(1);
    expect(grouping.unresolved).toBeUndefined();
  });

  it('extracted text has the declared length cutoff: a section line over it is not read as a heading, and is reported unresolved, not dropped', () => {
    const line = `SECTION B - ${LONG_WORDING}`;
    expect(line.length).toBeGreaterThan(120);
    const ex = extraction([
      [line, '', '1. Discuss tides.', '', '2. Discuss waves.', ''].join('\n'),
    ]);
    const segmentation = segmentPlainTextPastPaper(ex);
    const grouping = groupPlainTextPastPaper(ex, segmentation);
    expect(grouping.groups.filter((g) => g.kind === 'section')).toEqual([]);
    expect(grouping.unresolved).toHaveLength(1);
    const [note] = grouping.unresolved ?? [];
    expect(note?.kind).toBe('section-line-too-long');
    expect(plainTextPaperText(ex).slice(note?.anchor.start, note?.anchor.end)).toBe(line);
    expect(grouping.placements.map((p) => p.label)).toEqual(
      segmentation.questions.map((q) => q.label),
    );
  });

  it('a line at the cutoff still reads as a section, and a long prose line that only begins "Part B of" is neither a section nor unresolved', () => {
    const atCutoff = `SECTION B ${'X'.repeat(120 - 'SECTION B '.length)}`;
    expect(atCutoff.length).toBe(120);
    const exSection = extraction([
      [atCutoff, '', '1. Discuss tides.', '', '2. Discuss waves.', ''].join('\n'),
    ]);
    const sectionGrouping = groupPlainTextPastPaper(
      exSection,
      segmentPlainTextPastPaper(exSection),
    );
    expect(sectionGrouping.groups.filter((g) => g.kind === 'section')).toHaveLength(1);
    const prose = `Part B of the experiment used a second beaker and ${words(30)}`;
    expect(prose.length).toBeGreaterThan(120);
    const exProse = extraction([
      [prose, '', '1. Discuss tides.', '', '2. Discuss waves.', ''].join('\n'),
    ]);
    const proseGrouping = groupPlainTextPastPaper(exProse, segmentPlainTextPastPaper(exProse));
    expect(proseGrouping.groups.filter((g) => g.kind === 'section')).toEqual([]);
    expect(proseGrouping.unresolved).toBeUndefined();
  });
});

describe('unresolved structure is preserved, not silently dropped (row 51)', () => {
  it("a section heading and a stimulus heading with no question under them are reported, with the paper's own wording as the anchor", () => {
    const source = [
      '## Section A',
      '',
      '## Question 1',
      '',
      'Define density.',
      '',
      '## Section C',
      '',
      '## Case study',
      '',
    ].join('\n');
    const grouping = groupMarkdownPastPaper(segmentPastPaper(MD_PATH, source), source);
    const kinds = (grouping.unresolved ?? []).map((u) => u.kind).sort();
    expect(kinds).toEqual(['section-without-questions', 'stimulus-heading-without-questions']);
    for (const note of grouping.unresolved ?? []) {
      expect(source.slice(note.anchor.start, note.anchor.end)).toContain(note.label);
    }
    // Nothing that was placed changed: the one question is still placed exactly once.
    expect(grouping.placements.map((p) => p.label)).toEqual(['1']);
  });

  it('a question range naming no segmented question is reported unresolved as well as forming no group', () => {
    const pages = [
      ...PLAIN_SECTIONS_PAGES.slice(0, 2),
      `${PLAIN_SECTIONS_PAGES[2]}\n\nQuestions 8 to 9 refer to the table below.`,
    ];
    const ex = extraction(pages);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    expect((grouping.unresolved ?? []).map((u) => u.kind)).toEqual([
      'stimulus-range-without-questions',
    ]);
    expect(grouping.unresolved?.[0]?.label).toBe('Questions 8 to 9 refer to the table below.');
  });

  it('an instruction to choose within a section the paper does not have is reported, not dropped', () => {
    const ex = extraction([
      [
        'Answer ONE question from Section D.',
        '',
        'SECTION A',
        '1. Define speed.',
        '',
        '2. Define velocity.',
        '',
        'SECTION B',
        '3. Define mass.',
        '',
        '4. Define weight.',
        '',
      ].join('\n'),
    ]);
    const grouping = groupPlainTextPastPaper(ex, segmentPlainTextPastPaper(ex));
    expect((grouping.unresolved ?? []).map((u) => u.kind)).toEqual([
      'choice-instruction-without-group',
    ]);
  });

  it('reports nothing when nothing was left unresolved, so an absent field means a clean pass', () => {
    const grouping = groupMarkdownPastPaper(
      segmentPastPaper(MD_PATH, MARKDOWN_SECTIONS_PAPER),
      MARKDOWN_SECTIONS_PAPER,
    );
    expect('unresolved' in grouping).toBe(false);
  });
});
