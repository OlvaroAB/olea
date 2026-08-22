// Scenarios: features/F2-review.md, "F2.14 — Instrument identity is stamped,
// once (D-030, ruled)" — @auto:core/session/instrument-id.spec
//
// These assert the PROPERTIES D-030's ruling requires, not the string the
// derivation happens to produce for an unstamped instrument. The one
// exception is the shape test below, which pins the transient format only so
// that a change to it is a visible diff rather than a silent
// re-identification of every unstamped instrument in her vault.
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import { parseDocument } from '../block/parse.js';
import { parseCards, stampQaCardBlockId } from '../instrument/card-format.js';
import { parseMcqBlocks, stampMcqId } from '../instrument/mcq-format.js';
import { FolderSource } from '../vault/folder-source.js';
import { enumerateVaultInstruments } from './enumerate.js';
import type { InstrumentIdInput } from './instrument-id.js';
import { PROVISIONAL_ID_PREFIX, provisionalInstrumentId } from './instrument-id.js';

function input(overrides: Partial<InstrumentIdInput> = {}): InstrumentIdInput {
  return {
    noteUid: null,
    notePath: 'Notes/one.md',
    blockId: null,
    heading: null,
    ordinal: 1,
    explicitId: null,
    instrumentType: 'qa',
    ...overrides,
  };
}

describe('the provisional derivation', () => {
  it('marks every id it mints, so "which ids came from the unruled rule" is answerable from a log line', () => {
    expect(provisionalInstrumentId(input())).toMatch(new RegExp(`^${PROVISIONAL_ID_PREFIX}:`));
  });

  it('prefers the note uid over the path as the stable root', () => {
    const withUid = provisionalInstrumentId(input({ noteUid: 'u-123' }));
    const withoutUid = provisionalInstrumentId(input());
    expect(withUid).toContain('u-123');
    expect(withUid).not.toContain('Notes/one.md');
    expect(withoutUid).toContain('Notes/one.md');
  });

  it('an explicit id wins outright, and nothing about position contributes', () => {
    const a = provisionalInstrumentId(input({ explicitId: 'mcq-one', ordinal: 1 }));
    const b = provisionalInstrumentId(
      input({ explicitId: 'mcq-one', ordinal: 9, heading: 'elsewhere', notePath: 'Other.md' }),
    );
    expect(a).toBe('mcq-one');
    expect(b).toBe('mcq-one');
  });

  it('a block id anchors in preference to the heading above it', () => {
    const anchored = provisionalInstrumentId(input({ blockId: 'abc123', heading: 'A heading' }));
    expect(anchored).toContain('^abc123');
    expect(anchored).not.toContain('A heading');
  });

  it('escapes the characters the format uses as structure, so two anchors cannot collide', () => {
    const colon = provisionalInstrumentId(input({ heading: 'a:1' }));
    const hash = provisionalInstrumentId(input({ heading: 'a#1' }));
    // Without escaping both of these would read as "anchor a, ordinal 1".
    expect(colon).not.toBe(hash);
    expect(colon.endsWith(':1')).toBe(true);
    expect(colon.slice(0, -2)).not.toContain('a:1');
  });

  it('is a pure function: same input, same id, no clock and no I/O', () => {
    expect(provisionalInstrumentId(input({ heading: 'h' }))).toBe(
      provisionalInstrumentId(input({ heading: 'h' })),
    );
  });
});

describe('the ordinal counts within the anchor, never across the note', () => {
  const note = [
    '---',
    'topic: [Alpha]',
    'course: TEST101',
    '---',
    '',
    '## First question?',
    '',
    'Front one::Back one',
    '',
    '## Second question?',
    '',
    'Front two::Back two',
    '',
  ].join('\n');

  // The same note with an extra card inserted UNDER THE FIRST HEADING, above
  // everything else. A note-wide ordinal would shift the second heading's card
  // from 2 to 3 and hand it the first card's scheduling history.
  const withInsertion = note.replace(
    'Front one::Back one',
    'Brand new card::Its answer\n\nFront one::Back one',
  );

  async function idsOf(source: string): Promise<readonly string[]> {
    const vault = memoryVault({ 'Notes/one.md': source });
    const found = await enumerateVaultInstruments(vault);
    return found.records.map((record) => record.instrumentId);
  }

  it('inserting a card under one heading leaves the card under the next heading untouched', async () => {
    const before = await idsOf(note);
    const after = await idsOf(withInsertion);
    const lastBefore = before[before.length - 1];
    const lastAfter = after[after.length - 1];

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
    expect(lastAfter).toBe(lastBefore);
  });

  it('the inserted card takes the ordinal of the anchor it landed under, not a note-wide one', async () => {
    const after = await idsOf(withInsertion);
    // Two cards now sit under the first heading; the third is under the second.
    // A note-wide ordinal would produce 1, 2, 3 with no anchor distinction.
    const underFirst = after.filter((id) => id.includes('First question'));
    expect(underFirst).toHaveLength(2);
    expect(underFirst[0]?.endsWith(':1')).toBe(true);
    expect(underFirst[1]?.endsWith(':2')).toBe(true);
    expect(after[2]?.endsWith(':1')).toBe(true);
  });

  it('a card carrying a block id keeps its id when a sibling is inserted beside it', async () => {
    const withBlockId = note.replace('Front two::Back two', 'Front two::Back two ^keepme');
    const inserted = withBlockId.replace(
      'Front one::Back one',
      'Brand new card::Its answer\n\nFront one::Back one',
    );
    const before = await idsOf(withBlockId);
    const after = await idsOf(inserted);
    const anchored = before.find((id) => id.includes('^keepme'));
    expect(anchored).toBeDefined();
    expect(after).toContain(anchored);
  });
});

describe('the seam has one implementation site, and using it writes nothing', () => {
  it('every id in an enumeration comes from the injected source', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        '---',
        'topic: [Alpha]',
        'course: TEST101',
        '---',
        '',
        '## Q?',
        '',
        'Front::Back',
        '',
        'A ==blank== in a sentence.',
        '',
        '```olea-mcq',
        'stem: Which one?',
        'answer: This one',
        'distractor: d1',
        'distractor: d2',
        'distractor: d3',
        'distractor: d4',
        '```',
        '',
      ].join('\n'),
    });
    let calls = 0;
    const found = await enumerateVaultInstruments(vault, {
      instrumentId: (i) => {
        calls += 1;
        return `injected-${String(calls)}-${i.instrumentType}`;
      },
    });
    expect(found.records.map((r) => r.instrumentId)).toEqual([
      'injected-1-qa',
      'injected-2-cloze',
      'injected-3-mcq',
    ]);
    expect(calls).toBe(3);
  });

  it('enumerating a vault with no olea-uid anywhere writes nothing and still derives ids', async () => {
    const source = [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '',
      '## Q?',
      '',
      'Front::Back',
      '',
    ].join('\n');
    const vault = memoryVault({ 'Notes/one.md': source });
    const found = await enumerateVaultInstruments(vault);

    expect(found.records[0]?.noteUid).toBeNull();
    expect(found.records[0]?.instrumentId).toContain(PROVISIONAL_ID_PREFIX);
    expect(vault.writes).toEqual([]);
    expect(await vault.read('Notes/one.md')).toBe(source);
  });

  it('the fixture vault is walked without a single write, and no note gains frontmatter', async () => {
    const root = new URL('../../fixtures/vault/', import.meta.url);
    const vault = new FolderSource(root.pathname);
    const before = await vault.read(
      '01 Courses/GEOL204/WEEK 1/Lecture - Introduction to Clastic Sediment.md',
    );
    await enumerateVaultInstruments(vault, { excludePaths: ['README.md'] });
    const after = await vault.read(
      '01 Courses/GEOL204/WEEK 1/Lecture - Introduction to Clastic Sediment.md',
    );
    expect(after).toBe(before);
    const first = parseDocument(after).blocks[0];
    expect(first?.kind === 'frontmatter' ? first.inner : '').not.toContain('olea-uid');
  });
});

describe('D-030, end to end: a stamped instrument survives what an unstamped one would not', () => {
  // This is the failure D-030's ruling exists to rule out: option (c) (note
  // uid + anchor + within-anchor ordinal) "still breaks if she renames a
  // heading, and heading renames are not rare." An MCQ or Q&A instrument
  // stamped once (`stampMcqId` / `stampQaCardBlockId`) must survive exactly
  // the edit that would silently re-identify it under the position-based
  // fallback — a renamed heading above it.

  it('a stamped MCQ block keeps its instrument id when the heading above it is renamed', async () => {
    const before = [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '',
      '## Original heading',
      '',
      '```olea-mcq',
      'stem: which one?',
      'answer: this one',
      'distractor: d1',
      'distractor: d2',
      'distractor: d3',
      'distractor: d4',
      '```',
      '',
    ].join('\n');

    const { instruments } = parseMcqBlocks(before);
    const span = instruments[0]?.span;
    if (!span) throw new Error('fixture has no MCQ block');
    const stamped = stampMcqId(before, span, { generateId: () => 'mcq-durable' }).content;

    const vault = memoryVault({ 'Notes/one.md': stamped });
    const beforeRename = await enumerateVaultInstruments(vault);
    const idBefore = beforeRename.records[0]?.instrumentId;
    expect(idBefore).toBe('mcq-durable');

    // The exact edit D-030's ruling names: a heading rename, with nothing
    // else about the note touched.
    await vault.write('Notes/one.md', stamped.replace('Original heading', 'A totally new title'));
    const afterRename = await enumerateVaultInstruments(vault);
    expect(afterRename.records[0]?.instrumentId).toBe(idBefore);
  });

  it('a stamped Q&A card keeps its instrument id when the heading above it is renamed', async () => {
    const before = [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '',
      '## Original heading',
      '',
      'Front::Back',
      '',
    ].join('\n');

    const span = parseCards(before).find((c) => c.type === 'qa')?.span;
    if (!span) throw new Error('fixture has no Q&A card');
    const stamped = stampQaCardBlockId(before, span, { generateBlockId: () => 'durable1' }).content;

    const vault = memoryVault({ 'Notes/one.md': stamped });
    const beforeRename = await enumerateVaultInstruments(vault);
    const idBefore = beforeRename.records[0]?.instrumentId;
    expect(idBefore).toContain('^durable1');

    await vault.write('Notes/one.md', stamped.replace('Original heading', 'A totally new title'));
    const afterRename = await enumerateVaultInstruments(vault);
    expect(afterRename.records[0]?.instrumentId).toBe(idBefore);
  });

  it('an UNSTAMPED instrument, by contrast, is re-identified by the same heading rename — which is exactly why stamping exists', async () => {
    const before = [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '',
      '## Original heading',
      '',
      'Front::Back',
      '',
    ].join('\n');

    const vault = memoryVault({ 'Notes/one.md': before });
    const beforeRename = await enumerateVaultInstruments(vault);
    const idBefore = beforeRename.records[0]?.instrumentId;

    await vault.write('Notes/one.md', before.replace('Original heading', 'A totally new title'));
    const afterRename = await enumerateVaultInstruments(vault);
    expect(afterRename.records[0]?.instrumentId).not.toBe(idBefore);
  });
});
