// Scenarios: features/F2-review.md, "F2.14 — Instruments are enumerated from
// her vault, not fabricated" — @auto:core/session/enumerate.spec
//
// The `[D-181]` citation-sidecar suite below is `@auto:core/session/enumerate.spec` too, pending
// a scenario in features/F8-concepts-scope.md ("Instrument passage-citation sidecar: mint once at
// draft time, read back into sourceProvenance ([D-181 / CITE-2], ol-2zfj.52)") — that file is
// owned by another lane; see ol-2zfj.52's close notes for the exact text.
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import { provisionalConceptKey } from '../concept/concept-key.js';
import { extractConcepts } from '../concept/extract.js';
import { parseCards, stampQaCardBlockId } from '../instrument/card-format.js';
import { writeInstrumentCitation } from '../instrument/citation-store.js';
import { enumerateVaultInstruments } from './enumerate.js';
import type { InstrumentIdSource } from './instrument-id.js';

/**
 * `ol-63e1`: `VaultInstrumentRecord.conceptIds` now carries the opaque key
 * (`ConceptRecord.key`), never the display name — computed the same way
 * production does (`provisionalConceptKey`), rather than a hardcoded string,
 * so this suite does not silently drift from the real derivation. Every
 * concept below is unbound (tier 2 — no matching Zettelkasten note in these
 * fixture vaults) unless noted otherwise.
 */
function unboundKey(name: string): string {
  return provisionalConceptKey({ name, boundNotePath: null });
}

const FRONTMATTER = (topic: string, course = 'TEST101') =>
  ['---', `topic: ${topic}`, `course: ${course}`, '---', ''].join('\n');

const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'feedback: Because of the thing.',
  '```',
].join('\n');

describe('every instrument in a note becomes a candidate, whatever its format', () => {
  it('finds a Q&A card, a cloze deletion and an MCQ block in one note', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        FRONTMATTER('[Alpha]'),
        '## A question?',
        '',
        'The front::The back',
        '',
        'Grains are ==sorted== by flow.',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });

    const found = await enumerateVaultInstruments(vault);
    expect(found.records.map((r) => r.instrumentType)).toEqual(['qa', 'cloze', 'mcq']);
    expect(found.invalidMcqBlocks).toEqual([]);
    expect(found.unbound).toEqual([]);
  });

  it('carries what a renderer needs — the parsed instrument, the note title, the path and the block id', async () => {
    const vault = memoryVault({
      'Courses/TEST101/Week one.md': [
        FRONTMATTER('[Alpha]'),
        '## A question?',
        '',
        'The front::The back ^blk1',
        '',
        'Grains are ==sorted== by flow.',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });

    const [qa, cloze, mcq] = await enumerateVaultInstruments(vault).then((f) => f.records);
    if (qa?.instrumentType !== 'qa' || cloze?.instrumentType !== 'cloze') {
      throw new Error('expected a qa and a cloze record');
    }
    if (mcq?.instrumentType !== 'mcq') throw new Error('expected an mcq record');

    expect(qa.card.front).toBe('The front');
    expect(qa.card.back).toBe('The back');
    expect(qa.blockId).toBe('blk1');
    expect(qa.noteTitle).toBe('Week one');
    expect(qa.notePath).toBe('Courses/TEST101/Week one.md');
    expect(qa.heading).toBe('A question?');

    expect(cloze.card.clozeText).toBe('sorted');
    expect(cloze.card.before).toBe('Grains are ');
    expect(cloze.card.after).toBe(' by flow.');

    expect(mcq.mcq.stem).toBe('Which structure is it?');
    expect(mcq.mcq.answer).toBe('The right one');
    expect(mcq.mcq.distractors).toHaveLength(4);
    expect(mcq.mcq.feedback).toBe('Because of the thing.');
  });

  it('orders by vault path, then by position in the note', async () => {
    const vault = memoryVault({
      'B.md': [FRONTMATTER('[Alpha]'), 'B one::x', '', 'B two::y', ''].join('\n'),
      'A.md': [FRONTMATTER('[Alpha]'), 'A one::x', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    expect(found.records.map((r) => r.notePath)).toEqual(['A.md', 'B.md', 'B.md']);
  });
});

describe('notes the walk has nothing to say about, and notes it has to complain about', () => {
  it('a note with no instruments contributes no records and no diagnostic', async () => {
    const vault = memoryVault({
      'Notes/prose.md': [FRONTMATTER('[Alpha]'), '# A note', '', 'Just some prose.', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    expect(found.records).toEqual([]);
    expect(found.invalidMcqBlocks).toEqual([]);
    expect(found.unbound).toEqual([]);
  });

  it('a note with cards but no `topic:` reports them as unbound rather than dropping them', async () => {
    const vault = memoryVault({
      'Notes/untagged.md': ['---', 'course: TEST101', '---', '', 'Front::Back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    expect(found.records).toEqual([]);
    expect(found.unbound).toEqual([
      { notePath: 'Notes/untagged.md', instrumentType: 'qa', span: expect.anything() },
    ]);
  });

  it('a note with no frontmatter at all is unbound too, not silently skipped', async () => {
    const vault = memoryVault({ 'Notes/bare.md': 'Front::Back\n' });
    const found = await enumerateVaultInstruments(vault);
    expect(found.records).toEqual([]);
    expect(found.unbound).toHaveLength(1);
  });

  it('an invalid MCQ block is reported with its note and its reason, and produces no candidate', async () => {
    const vault = memoryVault({
      'Notes/broken.md': [
        FRONTMATTER('[Alpha]'),
        '```olea-mcq',
        'stem: Too few options?',
        'answer: yes',
        'distractor: d1',
        'distractor: d2',
        'distractor: d3',
        '```',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });

    const found = await enumerateVaultInstruments(vault);
    expect(found.records.map((r) => r.instrumentType)).toEqual(['mcq']);
    expect(found.invalidMcqBlocks).toHaveLength(1);
    expect(found.invalidMcqBlocks[0]?.notePath).toBe('Notes/broken.md');
    expect(found.invalidMcqBlocks[0]?.block.reason).toBe('insufficient-distractors');
  });

  it('an excluded path is walked past entirely — format documentation is not a corpus', async () => {
    const vault = memoryVault({
      'README.md': [FRONTMATTER('[Alpha]'), 'A separator looks like front::back', ''].join('\n'),
      'Notes/real.md': [FRONTMATTER('[Alpha]'), 'Front::Back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault, { excludePaths: ['README.md'] });
    expect(found.records.map((r) => r.notePath)).toEqual(['Notes/real.md']);
  });
});

describe('the concept binding follows her `topic:` property', () => {
  it('binds a bare topic and a wikilink-shaped topic to the same concept', async () => {
    const vault = memoryVault({
      '05 Zettelkasten/Alpha.md': '# Alpha\n',
      'Notes/bare.md': [FRONTMATTER('[Alpha]'), 'Bare front::back', ''].join('\n'),
      'Notes/linked.md': [FRONTMATTER('[[[Alpha]]]'), 'Linked front::back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    // Tier 1 — bound to the real Zettelkasten note — so the key derives from
    // its path, not from the bare name.
    const alphaKey = provisionalConceptKey({
      name: 'Alpha',
      boundNotePath: '05 Zettelkasten/Alpha.md',
    });
    expect(found.records.map((r) => r.conceptIds)).toEqual([[alphaKey], [alphaKey]]);
  });

  it('carries the concept course list verbatim, and it is the concept’s, not the note’s', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]', 'geol204'), 'Front::Back', ''].join('\n'),
      'Notes/two.md': [FRONTMATTER('[Alpha]', 'MUSTH104'), 'Other::Back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    // R1/R2: never case-folded, and both courses reach both instruments because
    // course membership is an attribute of the concept, not of the note.
    expect(found.records[0]?.courses).toEqual(['MUSTH104', 'geol204']);
    expect(found.records[1]?.courses).toEqual(['MUSTH104', 'geol204']);
  });

  it('a note naming two topics binds its instruments to BOTH, in her order', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Beta, Alpha]'), 'Front::Back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    // Her order, not ours: alphabetical would have put Alpha first. The order
    // no longer *selects* anything — every value is bound — but it is still
    // hers and is carried through as the opaque key derived from each name
    // (R1/R2 governs the display name, not this join key — `ol-63e1`).
    expect(found.records[0]?.conceptIds).toEqual([unboundKey('Beta'), unboundKey('Alpha')]);
  });

  // D-031 (`ol-4ekt`), superseded by `ol-t3sd`. D-031 bound an instrument to
  // her first `topic:` value because the review-log record persisted one
  // `conceptId`, and recorded the loss on the concepts that missed out so that
  // "this concept has no instruments" and "this concept lost its instruments to
  // a co-listed one" stopped looking identical. v3 of the record persists a
  // list, so there is no loss to record: an instrument is evidence for every
  // concept its note names, and both the narrowing and its diagnostic are gone.
  it('no concept loses a note’s instruments, so nothing is recorded as an ambiguity', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Beta, Alpha]'), 'Front::Back', ''].join('\n'),
    });

    const found = await enumerateVaultInstruments(vault);
    expect(found.records).toHaveLength(1);
    // One instrument, one record — never one record per (instrument, concept)
    // pair, which would offer the same instrument to her twice in a session.
    expect(found.records[0]?.conceptIds).toEqual([unboundKey('Beta'), unboundKey('Alpha')]);

    const concepts = await extractConcepts(vault);
    const beta = concepts.find((c) => c.name === 'Beta');
    const alpha = concepts.find((c) => c.name === 'Alpha');

    // Alpha has a note that produced an instrument, and now has the instrument
    // to show for it: the record names Alpha as well as Beta.
    expect(alpha?.sourcePaths).toEqual(['Notes/one.md']);
    expect(found.records[0]?.conceptIds).toContain(unboundKey('Alpha'));
    // And the field that existed only to report the loss is gone from both.
    expect(alpha).not.toHaveProperty('ambiguousTopicPaths');
    expect(beta).not.toHaveProperty('ambiguousTopicPaths');
  });

  it('a single-topic note produces a one-element list — the common case is unchanged', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Beta]'), 'Front::Back', ''].join('\n'),
    });

    const found = await enumerateVaultInstruments(vault);
    expect(found.records[0]?.conceptIds).toEqual([unboundKey('Beta')]);
    const concepts = await extractConcepts(vault);
    expect(concepts.every((c) => !('ambiguousTopicPaths' in c))).toBe(true);
  });

  it('courses span every concept the instrument names, deduplicated and sorted', async () => {
    // F2.5 course membership follows concept membership. Beta is only in one
    // course, Alpha in another; the instrument belongs to both sessions.
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Beta, Alpha]', 'geol204'), 'Front::Back', ''].join('\n'),
      'Notes/two.md': [FRONTMATTER('[Alpha]', 'MUSTH104'), 'Other::Back', ''].join('\n'),
    });
    const found = await enumerateVaultInstruments(vault);
    const multi = found.records.find((r) => r.notePath === 'Notes/one.md');
    expect(multi?.conceptIds).toEqual([unboundKey('Beta'), unboundKey('Alpha')]);
    expect(multi?.courses).toEqual(['MUSTH104', 'geol204']);
  });
});

describe("the walk's own extractConcepts pass is returned, not just used internally", () => {
  it('returns exactly what a direct extractConcepts call over the same vault produces', async () => {
    // Two concepts: one with an instrument bound to it, one with only a
    // topic-tagged note and no instrument at all — `extractConcepts` finds
    // both (tier 1 needs no instrument), and this is the field `gap/
    // build.ts`'s `buildMaterialPresence` needs to tell "no notes" (F4.10)
    // apart from "notes, no cards" (F4.5).
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]'), 'Front::Back', ''].join('\n'),
      'Notes/two.md': [FRONTMATTER('[Beta]'), '# No instruments here', ''].join('\n'),
    });

    const found = await enumerateVaultInstruments(vault);
    const direct = await extractConcepts(vault);

    expect(found.concepts).toEqual(direct);
    expect(found.concepts.map((c) => c.name).sort()).toEqual(['Alpha', 'Beta']);
  });
});

describe('[D-181] citation sidecar: sourceProvenance is read from .olea/citations, never fabricated', () => {
  const fixedId: InstrumentIdSource = () => 'fixed-instrument-id';

  it('populates sourceProvenance from an existing citation record', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]'), MCQ_BLOCK, ''].join('\n'),
    });
    await writeInstrumentCitation(vault, 'fixed-instrument-id', {
      sourcePath: 'Sources/Lecture 3.pdf',
      page: 4,
      section: 'Bedform stratification',
    });

    const [mcq] = await enumerateVaultInstruments(vault, { instrumentId: fixedId }).then(
      (f) => f.records,
    );
    expect(mcq?.sourceProvenance).toEqual({
      sourcePath: 'Sources/Lecture 3.pdf',
      location: {
        page: 4,
        section: 'Bedform stratification',
      },
    });
    // `charRange` is honestly absent, never a fabricated `{ start: 0, end: 0 }` — the sidecar
    // never had one to carry over (`../extract/types.js`'s `SourceLocation.charRange` is
    // optional for exactly this case, `ol-2zfj.54`).
    expect(mcq?.sourceProvenance && 'charRange' in mcq.sourceProvenance.location).toBe(false);
  });

  it('leaves sourceProvenance absent when no sidecar exists for the instrument', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]'), MCQ_BLOCK, ''].join('\n'),
    });

    const [mcq] = await enumerateVaultInstruments(vault, { instrumentId: fixedId }).then(
      (f) => f.records,
    );
    expect(mcq?.sourceProvenance).toBeUndefined();
    expect(mcq && 'sourceProvenance' in mcq).toBe(false);
  });

  it('leaves sourceProvenance absent when the sidecar carries no page (cannot honestly build a SourceLocation)', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]'), MCQ_BLOCK, ''].join('\n'),
    });
    await writeInstrumentCitation(vault, 'fixed-instrument-id', {
      sourcePath: 'Sources/Lecture 3.pdf',
    });

    const [mcq] = await enumerateVaultInstruments(vault, { instrumentId: fixedId }).then(
      (f) => f.records,
    );
    expect(mcq?.sourceProvenance).toBeUndefined();
  });

  it('omits section when the citation did not have one', async () => {
    const vault = memoryVault({
      'Notes/one.md': [FRONTMATTER('[Alpha]'), MCQ_BLOCK, ''].join('\n'),
    });
    await writeInstrumentCitation(vault, 'fixed-instrument-id', {
      sourcePath: 'Sources/Deck.pptx',
      page: 2,
    });

    const [mcq] = await enumerateVaultInstruments(vault, { instrumentId: fixedId }).then(
      (f) => f.records,
    );
    expect(mcq?.sourceProvenance).toEqual({
      sourcePath: 'Sources/Deck.pptx',
      location: { page: 2 },
    });
    expect(mcq?.sourceProvenance && 'section' in mcq.sourceProvenance.location).toBe(false);
    expect(mcq?.sourceProvenance && 'charRange' in mcq.sourceProvenance.location).toBe(false);
  });
});

// Scenarios: features/F2-review.md, "F2.14b — Stamping one heading-sharing Q&A
// sibling does not reassign the other's ordinal" — @auto:core/session/enumerate.spec
describe('ol-8ae9: stamping one heading-sharing Q&A sibling must not reassign the other', () => {
  const twoUnstamped = [
    '---',
    'topic: [Alpha]',
    'course: TEST101',
    '---',
    '',
    '## Shared heading',
    '',
    'First front::First back',
    '',
    'Second front::Second back',
    '',
  ].join('\n');

  function stampByPrefix(source: string, prefix: string, blockId: string): string {
    const span = parseCards(source).find((c) => c.raw.startsWith(prefix))?.span;
    if (!span) throw new Error(`fixture has no card starting with ${prefix}`);
    return stampQaCardBlockId(source, span, { generateBlockId: () => blockId }).content;
  }

  function bySecond(records: Awaited<ReturnType<typeof enumerateVaultInstruments>>['records']) {
    const record = records.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('Second'),
    );
    if (!record) throw new Error('fixture has no Second qa record');
    return record;
  }

  it("stamping the first sibling leaves the second's provisional id unchanged", async () => {
    const vault = memoryVault({ 'Notes/one.md': twoUnstamped });
    const before = await enumerateVaultInstruments(vault);
    const secondBefore = bySecond(before.records);
    expect(secondBefore.instrumentId.endsWith(':2')).toBe(true);

    await vault.write('Notes/one.md', stampByPrefix(twoUnstamped, 'First', 'firststamp'));

    const after = await enumerateVaultInstruments(vault);
    const secondAfter = bySecond(after.records);
    expect(secondAfter.instrumentId).toBe(secondBefore.instrumentId);
  });

  it('stamping both siblings leaves both stable across further enumerations', async () => {
    const vault = memoryVault({ 'Notes/one.md': twoUnstamped });

    const firstStamp = stampByPrefix(twoUnstamped, 'First', 'firststamp');
    await vault.write('Notes/one.md', firstStamp);
    const secondStamp = stampByPrefix(firstStamp, 'Second', 'secondstamp');
    await vault.write('Notes/one.md', secondStamp);

    const found = await enumerateVaultInstruments(vault);
    const first = found.records.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('First'),
    );
    const second = bySecond(found.records);
    expect(first?.instrumentId).toContain('^firststamp');
    expect(second.instrumentId).toContain('^secondstamp');

    // A second, independent walk over the same (unchanged) content derives
    // the identical ids — both are durable now, not just coincidentally equal.
    const foundAgain = await enumerateVaultInstruments(vault);
    expect(bySecond(foundAgain.records).instrumentId).toBe(second.instrumentId);
    expect(
      foundAgain.records.find((r) => r.instrumentType === 'qa' && r.card.raw.startsWith('First'))
        ?.instrumentId,
    ).toBe(first?.instrumentId);
  });

  it('inserting a third card between two already-stamped siblings only mints an id for the new card', async () => {
    const vault = memoryVault({ 'Notes/one.md': twoUnstamped });
    const firstStamp = stampByPrefix(twoUnstamped, 'First', 'firststamp');
    const bothStamped = stampByPrefix(firstStamp, 'Second', 'secondstamp');
    await vault.write('Notes/one.md', bothStamped);

    const before = await enumerateVaultInstruments(vault);
    const firstBefore = before.records.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('First'),
    );
    const secondBefore = bySecond(before.records);

    const withThird = bothStamped.replace(
      'First front::First back ^firststamp',
      'First front::First back ^firststamp\n\nThird front::Third back',
    );
    await vault.write('Notes/one.md', withThird);

    const after = await enumerateVaultInstruments(vault);
    const firstAfter = after.records.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('First'),
    );
    const secondAfter = bySecond(after.records);
    const third = after.records.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('Third'),
    );

    expect(firstAfter?.instrumentId).toBe(firstBefore?.instrumentId);
    expect(secondAfter.instrumentId).toBe(secondBefore.instrumentId);
    expect(third?.instrumentId).toBeDefined();
    expect(third?.instrumentId).not.toBe(firstBefore?.instrumentId);
    expect(third?.instrumentId).not.toBe(secondBefore.instrumentId);
  });

  it('by contrast, inserting a card between two UNSTAMPED siblings still shifts the second — the accepted, position-based tradeoff `instrument-id.ts` rule 5 already names, unrelated to this fix', async () => {
    const vault = memoryVault({ 'Notes/one.md': twoUnstamped });
    const before = await enumerateVaultInstruments(vault);
    const secondBefore = bySecond(before.records);

    const withThird = twoUnstamped.replace(
      'First front::First back',
      'First front::First back\n\nThird front::Third back',
    );
    await vault.write('Notes/one.md', withThird);

    const after = await enumerateVaultInstruments(vault);
    const secondAfter = bySecond(after.records);
    // 'Second' was ordinal 2, is now ordinal 3 — a real, named, pre-existing gap
    // in the position-based fallback (only stamping closes it), not the bug
    // ol-8ae9 fixes.
    expect(secondAfter.instrumentId).not.toBe(secondBefore.instrumentId);
    expect(secondAfter.instrumentId.endsWith(':3')).toBe(true);
  });
});
