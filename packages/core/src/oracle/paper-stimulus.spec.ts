import { AUTHORING_SHARED_PASSAGE_MAX_CHARS } from 'olea-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkHoldsNonTextContent,
  chunkHoldsProsePassage,
  chunkHoldsTable,
  heldStimulusText,
  lookUpPaperGroupStimulus,
  PAPER_STIMULUS_DELIMITED_MIN_ROWS,
  PAPER_STIMULUS_MAX_CHARS,
  PAPER_STIMULUS_NOT_LOOKED_REASONS,
  PAPER_STIMULUS_PROSE_MIN_WORDS,
  type PaperStimulusLookup,
  type PaperStimulusSource,
} from './paper-stimulus.js';
import type { PaperGroupStimulusNeed, PaperStimulusForm } from './paper-types.js';

// Scenario: olea-service/features/F4-oracle.md, "a group that shares material is requested with one
// passage from her held material" (@auto:core/oracle/paper-stimulus.spec, [D-562]), and its sibling
// "a group whose stimulus Olea has not looked for is never given that reason". Course A is
// synthetic; every chunk below is invented.

const TABLE = ['| Year | Units |', '| --- | ---: |', '| 2020 | 10 |', '| 2021 | 12 |'].join('\n');

/** `n` words of synthetic running text. */
function prose(n: number): string {
  const vocab = ['the', 'firm', 'sells', 'units', 'to', 'a', 'market', 'each', 'week'];
  return Array.from({ length: n }, (_, i) => vocab[i % vocab.length]).join(' ');
}

function needed(form: PaperStimulusForm | null): PaperGroupStimulusNeed {
  return { status: 'needed', form };
}

function notes(sourceId: string, chunks: readonly string[]): PaperStimulusSource {
  return { sourceId, kind: 'notes', chunks, isAssessmentPaper: false };
}

function look(
  need: PaperGroupStimulusNeed,
  sources: readonly PaperStimulusSource[],
): PaperStimulusLookup {
  return lookUpPaperGroupStimulus({ need, sources });
}

describe('lookUpPaperGroupStimulus: the ruled scenario', () => {
  it('gives a group that shares a table one passage from her held, non-sealed material, with its source', () => {
    const sources = [
      {
        sourceId: 'papers/course-a-2023',
        kind: 'past-paper',
        chunks: [TABLE],
        isAssessmentPaper: true,
      },
      notes('notes/concept-one', ['An opening line with no table.', `Some notes.\n\n${TABLE}`]),
    ] as const satisfies readonly PaperStimulusSource[];
    const result = look(needed('table'), sources);
    expect(result).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'notes/concept-one', chunkIndex: 1 },
    });
    if (result.status !== 'held') throw new Error('expected held');
    // The text passed on is her chunk exactly as written: the same string, never rebuilt.
    expect(heldStimulusText(sources, result.stimulus)).toBe(sources[1].chunks[1]);
  });

  it('never takes a passage from an assessment paper, by kind or by registration', () => {
    const byKind: PaperStimulusSource = {
      sourceId: 'papers/a',
      kind: 'past-paper',
      chunks: [TABLE],
      isAssessmentPaper: false,
    };
    const byRegistration: PaperStimulusSource = {
      sourceId: 'notes/registered-as-assessment',
      kind: 'notes',
      chunks: [TABLE],
      isAssessmentPaper: true,
    };
    const result = look(needed('table'), [
      byKind,
      byRegistration,
      notes('notes/plain', [prose(40)]),
    ]);
    expect(result).toEqual({ status: 'none-held' });
    expect(heldStimulusText([byKind], { form: 'table', sourceId: 'papers/a', chunkIndex: 0 })).toBe(
      null,
    );
    expect(
      heldStimulusText([byRegistration], {
        form: 'table',
        sourceId: 'notes/registered-as-assessment',
        chunkIndex: 0,
      }),
    ).toBe(null);
  });

  it('carries the needed form on the stimulus, for a data set and for a scenario', () => {
    expect(look(needed('data-set'), [notes('n', [TABLE])])).toEqual({
      status: 'held',
      stimulus: { form: 'data-set', sourceId: 'n', chunkIndex: 0 },
    });
    expect(look(needed('scenario'), [notes('n', [prose(40)])])).toEqual({
      status: 'held',
      stimulus: { form: 'scenario', sourceId: 'n', chunkIndex: 0 },
    });
    expect(look(needed('extract'), [notes('n', [prose(40)])])).toMatchObject({ status: 'held' });
  });
});

describe('lookUpPaperGroupStimulus: a group it does not look for is never refused', () => {
  const rich = [notes('n', [TABLE, prose(60), '![[chart.png]]'])];

  it.each([
    [{ status: 'not-needed' } as const, 'not-needed'],
    [{ status: 'not-identified' } as const, 'not-identified'],
    [needed(null), 'form-not-named'],
    [needed('figure'), 'figure-not-text'],
  ])('need %j is not looked for (%s), even with material that holds every form', (need, reason) => {
    expect(look(need, rich)).toEqual({ status: 'not-looked', reason });
  });

  it('declares exactly the reasons it can return', () => {
    expect(PAPER_STIMULUS_NOT_LOOKED_REASONS).toEqual([
      'not-needed',
      'not-identified',
      'form-not-named',
      'figure-not-text',
      'no-searchable-material',
      'qualifying-over-cap',
      'non-text-content',
      'assessment-status-unknown',
      'extracted-text-unverified',
    ]);
  });
});

describe('lookUpPaperGroupStimulus: adversarial material', () => {
  it('reads a line with pipes that is not a table as no table', () => {
    const chunks = [
      'Either option A | option B would do here.',
      [
        'See [[Note one|one]] first.',
        'Also [[Note two|two]] here.',
        'Then [[Note three|3]] last.',
      ].join('\n'),
      ['a | b', 'plain text line', 'c | d'].join('\n'),
    ];
    for (const chunk of chunks) expect(chunkHoldsTable(chunk)).toBe(false);
    expect(look(needed('table'), [notes('n', chunks)])).toEqual({ status: 'none-held' });
  });

  it('reads a table header with no rows as no table, also when its only row is empty', () => {
    const headerOnly = '| Year | Units |\n| --- | --- |';
    const blankAfter = '| Year | Units |\n| --- | --- |\n\nThen prose follows.';
    const emptyRow = '| Year | Units |\n| --- | --- |\n|  |  |';
    for (const chunk of [headerOnly, blankAfter, emptyRow])
      expect(chunkHoldsTable(chunk)).toBe(false);
    expect(look(needed('data-set'), [notes('n', [headerOnly, blankAfter, emptyRow])])).toEqual({
      status: 'none-held',
    });
  });

  it('never claims none when the only material is an image embed with no text', () => {
    for (const chunk of ['![[chart.png]]', '![a plot](plot.png)', '<img src="x.png">']) {
      expect(chunkHoldsNonTextContent(chunk)).toBe(true);
      for (const form of ['table', 'data-set', 'scenario', 'extract'] as const) {
        expect(look(needed(form), [notes('n', [chunk])])).toEqual({
          status: 'not-looked',
          reason: 'non-text-content',
        });
      }
    }
  });

  it('never claims none past an embedded note, an HTML table or a rendered block', () => {
    for (const chunk of [
      'See ![[Other note#Section]] for it.',
      '<table><tr><td>1</td></tr></table>',
      '```dataview\nTABLE file.name FROM "x"\n```',
      '```mermaid\ngraph TD; A-->B\n```',
    ]) {
      expect(look(needed('table'), [notes('n', [chunk])])).toEqual({
        status: 'not-looked',
        reason: 'non-text-content',
      });
    }
  });

  it('still chooses a qualifying chunk when an earlier one holds an embed', () => {
    expect(look(needed('table'), [notes('n', ['![[chart.png]]', TABLE])])).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'n', chunkIndex: 1 },
    });
  });

  it('never claims none over an empty package', () => {
    const noSearch = { status: 'not-looked', reason: 'no-searchable-material' };
    expect(look(needed('table'), [])).toEqual(noSearch);
    expect(look(needed('scenario'), [notes('n', [])])).toEqual(noSearch);
    expect(look(needed('scenario'), [notes('n', ['', '   \n\t'])])).toEqual(noSearch);
  });

  it('never claims none when every source is an assessment paper: the paper itself holds one', () => {
    const papers: PaperStimulusSource[] = [
      { sourceId: 'p1', kind: 'past-paper', chunks: [TABLE], isAssessmentPaper: true },
      { sourceId: 'p2', kind: 'notes', chunks: [prose(80)], isAssessmentPaper: true },
    ];
    for (const form of ['table', 'scenario'] as const) {
      expect(look(needed(form), papers)).toEqual({
        status: 'not-looked',
        reason: 'no-searchable-material',
      });
    }
  });

  it('claims none when assessment papers hold one but her searched notes do not', () => {
    const sources: PaperStimulusSource[] = [
      { sourceId: 'p1', kind: 'past-paper', chunks: [TABLE], isAssessmentPaper: true },
      notes('n', ['A short line.', prose(20)]),
    ];
    expect(look(needed('table'), sources)).toEqual({ status: 'none-held' });
    expect(look(needed('scenario'), sources)).toEqual({ status: 'none-held' });
  });

  it('picks deterministically between two qualifying chunks: first by source, then by chunk', () => {
    const one = notes('one', ['no table here', TABLE, TABLE]);
    const two = notes('two', [TABLE]);
    const first = look(needed('table'), [one, two]);
    expect(first).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'one', chunkIndex: 1 },
    });
    expect(look(needed('table'), [one, two])).toEqual(first);
    expect(look(needed('table'), [two, one])).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'two', chunkIndex: 0 },
    });
  });

  it('reads a source id handed twice once, at its first occurrence', () => {
    const sources = [notes('n', ['no table']), notes('n', [TABLE])];
    expect(look(needed('table'), sources)).toEqual({ status: 'none-held' });
    expect(heldStimulusText(sources, { form: 'table', sourceId: 'n', chunkIndex: 0 })).toBe(null);
  });
});

describe('lookUpPaperGroupStimulus: the size cap', () => {
  const padded = (length: number): string => `${TABLE}\n\n${'x'.repeat(length - TABLE.length - 2)}`;

  it('declares the cap of the request field, and the two declared floors', () => {
    expect(PAPER_STIMULUS_MAX_CHARS).toBe(6000);
    // ol-egov.141.89.7.93: the cap is the contract field's own limit, so a chosen passage is never
    // refused on the wire (the Worker parses with the same constant).
    expect(PAPER_STIMULUS_MAX_CHARS).toBe(AUTHORING_SHARED_PASSAGE_MAX_CHARS);
    expect(PAPER_STIMULUS_PROSE_MIN_WORDS).toBe(30);
    expect(PAPER_STIMULUS_DELIMITED_MIN_ROWS).toBe(3);
  });

  it('chooses a qualifying chunk at the cap, never one over it, and never claims none over it', () => {
    expect(padded(6000)).toHaveLength(6000);
    expect(look(needed('table'), [notes('n', [padded(6000)])])).toMatchObject({ status: 'held' });
    expect(look(needed('table'), [notes('n', [padded(6001)])])).toEqual({
      status: 'not-looked',
      reason: 'qualifying-over-cap',
    });
    const longProse = prose(1500);
    expect(longProse.length).toBeGreaterThan(PAPER_STIMULUS_MAX_CHARS);
    expect(look(needed('scenario'), [notes('n', [longProse])])).toEqual({
      status: 'not-looked',
      reason: 'qualifying-over-cap',
    });
  });

  it('passes over an over-cap chunk to a later one at or under the cap', () => {
    expect(look(needed('table'), [notes('a', [padded(6001)]), notes('b', [TABLE])])).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'b', chunkIndex: 0 },
    });
  });

  it('counts the cap on the chunk as written, so a chosen passage is never refused on the wire', () => {
    expect(
      heldStimulusText([notes('n', [padded(6001)])], {
        form: 'table',
        sourceId: 'n',
        chunkIndex: 0,
      }),
    ).toBe(null);
  });
});

describe('lookUpPaperGroupStimulus: what it cannot read blocks a claim of none', () => {
  it('never searches a source whose assessment status is not told, and never claims none past it', () => {
    const unknown: PaperStimulusSource = {
      sourceId: 'u',
      kind: 'notes',
      chunks: [TABLE],
      isAssessmentPaper: null,
    };
    expect(look(needed('table'), [unknown, notes('n', ['no table'])])).toEqual({
      status: 'not-looked',
      reason: 'assessment-status-unknown',
    });
    expect(look(needed('table'), [unknown, notes('n', [TABLE])])).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'n', chunkIndex: 0 },
    });
    expect(heldStimulusText([unknown], { form: 'table', sourceId: 'u', chunkIndex: 0 })).toBe(null);
  });

  it('never claims no table over text extracted from a document, but reads its prose', () => {
    const textbook: PaperStimulusSource = {
      sourceId: 't',
      kind: 'textbook',
      chunks: [prose(40)],
      isAssessmentPaper: false,
    };
    expect(look(needed('table'), [textbook])).toEqual({
      status: 'not-looked',
      reason: 'extracted-text-unverified',
    });
    expect(look(needed('scenario'), [textbook])).toMatchObject({ status: 'held' });
    expect(look(needed('table'), [{ ...textbook, chunks: [TABLE] }])).toMatchObject({
      status: 'held',
    });
  });
});

describe('chunkHoldsTable: the declared table and data-set rule', () => {
  it('reads a Markdown table, also without outer pipes and inside a callout', () => {
    expect(chunkHoldsTable(TABLE)).toBe(true);
    expect(chunkHoldsTable('Year | Units\n--- | ---\n2020 | 10')).toBe(true);
    expect(chunkHoldsTable('> [!note]\n> | A | B |\n> |---|---|\n> | 1 | 2 |')).toBe(true);
    expect(chunkHoldsTable('| A | [[Note\\|alias]] |\n|---|---|\n| 1 | 2 |')).toBe(true);
  });

  it('refuses a delimiter line whose cell count differs from the header', () => {
    expect(chunkHoldsTable('| A | B | C |\n|---|---|\n| 1 | 2 | 3 |')).toBe(false);
  });

  it(`reads a delimited block of ${PAPER_STIMULUS_DELIMITED_MIN_ROWS} rows, never of fewer`, () => {
    expect(chunkHoldsTable('year,units\n2020,10\n2021,12')).toBe(true);
    expect(chunkHoldsTable('year,units\n2020,10')).toBe(false);
    expect(chunkHoldsTable('year\tunits\nalpha\tbeta\ngamma\tdelta')).toBe(true);
    expect(chunkHoldsTable('```\nyear    units\n2020    10\n2021    12\n```')).toBe(true);
    expect(chunkHoldsTable('- price; 10\n- cost; 6\n- margin; 4')).toBe(true);
    expect(chunkHoldsTable('Name | Role\nAda | lead\nBo | analyst')).toBe(true);
  });

  it('refuses prose that only looks delimited: commas or double spaces with no number in the rows', () => {
    expect(chunkHoldsTable('First, we read.\nThen, we wrote.\nLast, we slept.')).toBe(false);
    expect(chunkHoldsTable('One.  Two.\nThree.  Four.\nFive.  Six.')).toBe(false);
  });

  it('never splits on a heading line', () => {
    expect(chunkHoldsTable('# a, 1\n## b, 2\n### c, 3')).toBe(false);
  });
});

describe('chunkHoldsProsePassage: the declared scenario and extract rule', () => {
  it(`holds at ${PAPER_STIMULUS_PROSE_MIN_WORDS} words of running text, not one under`, () => {
    expect(chunkHoldsProsePassage(prose(PAPER_STIMULUS_PROSE_MIN_WORDS))).toBe(true);
    expect(chunkHoldsProsePassage(prose(PAPER_STIMULUS_PROSE_MIN_WORDS - 1))).toBe(false);
  });

  it('counts no heading, table, code, embed or front matter as running text', () => {
    const scaffold = [
      '---',
      `tags: ${prose(40)}`,
      '---',
      `# ${prose(40)}`,
      TABLE,
      '```',
      prose(40),
      '```',
      '![[chart.png]]',
      prose(PAPER_STIMULUS_PROSE_MIN_WORDS - 1),
    ].join('\n');
    expect(chunkHoldsProsePassage(scaffold)).toBe(false);
    expect(chunkHoldsProsePassage(`${scaffold} more`)).toBe(true);
  });

  it('counts quoted and listed text, so a case written as a list or a quote still counts', () => {
    expect(chunkHoldsProsePassage(`> ${prose(PAPER_STIMULUS_PROSE_MIN_WORDS)}`)).toBe(true);
    const listed = Array.from({ length: 6 }, () => `- ${prose(5)}`).join('\n');
    expect(chunkHoldsProsePassage(listed)).toBe(true);
  });
});

describe('lookUpPaperGroupStimulus: pure and silent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs nothing and changes nothing it is handed', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const sources = Object.freeze([
      Object.freeze(notes('n', Object.freeze(['![[x.png]]', TABLE]))),
    ]) as readonly PaperStimulusSource[];
    const before = JSON.stringify(sources);
    for (const form of ['table', 'data-set', 'scenario', 'extract', 'figure', null] as const) {
      look(needed(form), sources);
    }
    look(needed('table'), []);
    expect(JSON.stringify(sources)).toBe(before);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
