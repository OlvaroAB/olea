// `ol-egov.141.89.5.113` (C5.3 as amended by [D-543]): a question protected at whole-note grain
// compares the whole cited note minus its question blocks. The citation pass used to strip only the
// blocks bound to a course (the instruments the vault walk enumerates), while the session's
// presentation check strips every question block it parses, so a cited note holding a block bound to
// no course never read the same on both sides and the question was set aside as could-not-check at
// every presentation, changed or not. Both sides now strip every question block. Tested through the
// pass (the production withheld resolver) and the presentation check, with the production store.
// Every course, note and sentence is invented ("course A").
import { citationStorePath, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { stripQuestionBlocks } from '../../../src/ingestion/materiality/citation-material.js';
import { sourceCheckAtPresentation } from '../../../src/review/open-session.js';
import {
  type Harness,
  harness,
  homeNote,
  MemoryVault,
  sidecar,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

const HOME = 'Course A/Week 3 (Olea).md';
/** Her note: no course frontmatter, so the question block she wrote in it is bound to no course. */
const CITED = 'Course A/Notes/kalomi rule.md';
const PROSE =
  'The invented kalomi rule holds when the sarute pressure stays below the venido line.';
const PROSE_CHANGED =
  'The invented kalomi rule fails once the sarute pressure rises above the venido line.';
const HER_CARD = 'When does the invented kalomi rule hold?::Below the venido line';
const HER_CARD_EDITED = 'When does the invented kalomi rule hold?::Only below the venido line';
const HER_MCQ = [
  '```olea-mcq',
  'stem: Which invented line bounds the kalomi rule?',
  'answer: The venido line',
  'distractor: The sarute line',
  'distractor: The pavo line',
  'distractor: The lemi line',
  '```',
].join('\n');

function citedNote(prose: string, card = HER_CARD): string {
  return [
    '# Kalomi rule',
    '',
    prose,
    '',
    card,
    '',
    HER_MCQ,
    '',
    'An invented closing line.',
    '',
  ].join('\n');
}

/** A generated question in Olea's home note, citing her note with no passage digest: whole-note grain. */
async function seeded(): Promise<{ vault: MemoryVault; h: Harness }> {
  const vault = new MemoryVault();
  vault.files.set(HOME, homeNote('Invented kalomi topic', ['q-whole']));
  vault.files.set(CITED, citedNote(PROSE));
  vault.files.set(
    citationStorePath('q-whole'),
    sidecar({ instrumentId: 'q-whole', sourcePath: CITED, page: 1 }),
  );
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  return { vault, h };
}

async function presentedAs(
  h: Harness,
  vault: MemoryVault,
  instrumentId: string,
): Promise<'clear' | 'check-failed' | 'suspended'> {
  const { records } = await enumerateVaultInstruments(vault);
  return sourceCheckAtPresentation(h.store, undefined, {
    vault,
    recordOf: (id) => records.find((record) => record.instrumentId === id),
  })(instrumentId);
}

describe('a whole-note question whose cited note holds a question block bound to no course (ol-egov.141.89.5.113)', () => {
  it('the fixture: her blocks are bound to no course, so the vault walk does not list them', async () => {
    const vault = new MemoryVault();
    vault.files.set(CITED, citedNote(PROSE));
    const { records, unbound } = await enumerateVaultInstruments(vault);
    expect(records).toEqual([]);
    expect(unbound.map((entry) => entry.instrumentType).sort()).toEqual(['mcq', 'qa']);
  });

  it('the pass baselines the note minus every question block, as the presentation check reads it', async () => {
    const { h } = await seeded();
    const anchor = (await h.store.loadAll()).get('q-whole');
    expect(anchor?.sourcePath).toBe(CITED);
    expect(anchor?.passageDigest).toBeUndefined();
    expect(anchor?.text).toBe(stripQuestionBlocks(citedNote(PROSE)));
    expect(anchor?.text).toContain(PROSE);
    expect(anchor?.text).not.toContain('olea-mcq');
    expect(anchor?.text).not.toContain(HER_CARD);
  });

  it('unchanged: presented at every presentation, and nothing withheld or judged', async () => {
    const { vault, h } = await seeded();
    expect(await h.withheld(['q-whole'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
    await h.pass(vault);
    expect(await h.withheld(['q-whole'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it('a content change: withheld before the next presentation, and by the next pass', async () => {
    const { vault, h } = await seeded();
    vault.files.set(CITED, citedNote(PROSE_CHANGED));
    // The presentation side, before any pass has run.
    expect(await presentedAs(h, vault, 'q-whole')).toBe('check-failed');
    // The pass side: the change goes to the judge and the question is withheld.
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(await h.withheld(['q-whole'])).toEqual(new Set(['q-whole']));
    expect(await presentedAs(h, vault, 'q-whole')).not.toBe('clear');
  });

  it('an edit to her own question block only is not a change to the material, on either side', async () => {
    const { vault, h } = await seeded();
    vault.files.set(CITED, citedNote(PROSE, HER_CARD_EDITED));
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await h.withheld(['q-whole'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
  });

  it('an anchor baselined before every block was stripped is re-read with no judge call when the note is unchanged', async () => {
    const { vault, h } = await seeded();
    const anchor = (await h.store.loadAll()).get('q-whole');
    if (anchor === undefined) throw new Error('no anchor');
    // As an earlier build saved it: her note with her blocks left in (none of them bound).
    await h.store.save('q-whole', { ...anchor, text: citedNote(PROSE) });
    expect(await presentedAs(h, vault, 'q-whole')).toBe('check-failed');
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect((await h.store.loadAll()).get('q-whole')?.text).toBe(
      stripQuestionBlocks(citedNote(PROSE)),
    );
    expect(await h.withheld(['q-whole'])).toEqual(new Set());
    expect(await presentedAs(h, vault, 'q-whole')).toBe('clear');
  });

  it('an anchor baselined before every block was stripped, and the note then changed: the change still goes to the judge', async () => {
    const { vault, h } = await seeded();
    const anchor = (await h.store.loadAll()).get('q-whole');
    if (anchor === undefined) throw new Error('no anchor');
    await h.store.save('q-whole', { ...anchor, text: citedNote(PROSE) });
    vault.files.set(CITED, citedNote(PROSE_CHANGED));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(await h.withheld(['q-whole'])).toEqual(new Set(['q-whole']));
  });
});

describe('stripQuestionBlocks', () => {
  it('removes every card and multiple-choice block it parses, bound or not, and nothing else', () => {
    const stripped = stripQuestionBlocks(citedNote(PROSE));
    expect(stripped).toContain(PROSE);
    expect(stripped).toContain('An invented closing line.');
    expect(stripped).toContain('# Kalomi rule');
    expect(stripped).not.toContain('::');
    expect(stripped).not.toContain('olea-mcq');
  });

  it('a note with no question block is returned unchanged', () => {
    const note = `# Heading\n\n${PROSE}\n`;
    expect(stripQuestionBlocks(note)).toBe(note);
  });
});
