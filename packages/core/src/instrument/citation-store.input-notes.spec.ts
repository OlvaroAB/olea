/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): the citation record carries a drafted item's input notes.
 *
 * Scenario (service repo, `features/F3-learn-from-anything.md`, "Feature: F3.3 / C5.3 — a drafted
 * item records every note it was drawn from, and each protects it"): "the citation record carries
 * the input notes" — written at schema version 3 with the same input notes, and a record written at
 * version 2 still reads, with no input notes. The keep path that hands the draft's list to this
 * store is pinned on the plugin side (`packages/plugin/test/review/open-session-input-notes.spec.ts`,
 * "kept while every note holds");
 * this file pins the store: the shape, its guard, its two reads, and the rename exception's one
 * extension (input-note paths, nothing else).
 *
 * Synthetic paths and fingerprints only.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  CITATION_RECORD_SCHEMA_VERSION,
  citationStorePath,
  isCitationInputNoteList,
  isCitationRecord,
  readInstrumentCitation,
  readInstrumentCitationRecord,
  renameCitationSourcePath,
  writeInstrumentCitation,
} from './citation-store.js';

const NOTE_A = 'Courses/Course A/Week 2.md';
const NOTE_B = 'Courses/Course A/Week 3.md';
const SLIDES = 'Courses/Course A/Slides 4.pdf';
const NOTES = [
  { path: NOTE_A, contentHash: 'a'.repeat(64) },
  { path: NOTE_B, contentHash: 'b'.repeat(64) },
] as const;

describe('the citation record carries the input notes ([D-628])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-citation-input-notes-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('the schema version is 3', () => {
    expect(CITATION_RECORD_SCHEMA_VERSION).toBe(3);
  });

  it('a kept item is written at version 3 with the same input notes, read back whole', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'mcq-kept', { sourcePath: NOTE_A }, NOTES);

    const raw = JSON.parse(await vault.read(citationStorePath('mcq-kept')));
    expect(raw.schemaVersion).toBe(3);
    expect(raw.inputNotes).toEqual(NOTES);

    const record = await readInstrumentCitationRecord(vault, 'mcq-kept');
    expect(record?.inputNotes).toEqual(NOTES);
    expect(record?.schemaVersion).toBe(3);
    // The citation read keeps its shape: no input notes leak into a citation a caller re-uses.
    expect(await readInstrumentCitation(vault, 'mcq-kept')).toEqual({ sourcePath: NOTE_A });
  });

  it('an item with no draft behind it is written at version 3 with no input notes', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'paper-item', { sourcePath: NOTE_A });
    await writeInstrumentCitation(vault, 'empty-list', { sourcePath: NOTE_A }, []);
    for (const id of ['paper-item', 'empty-list']) {
      const raw = JSON.parse(await vault.read(citationStorePath(id)));
      expect(raw.schemaVersion).toBe(3);
      expect('inputNotes' in raw).toBe(false);
    }
  });

  it('a record written at version 2 still reads, with no input notes', async () => {
    const vault = new FolderSource(tempRoot);
    const v2 = {
      sourcePath: SLIDES,
      page: 4,
      sourceRevision: 'c'.repeat(64),
      instrumentId: 'mcq-old',
      schemaVersion: 2,
    };
    await vault.write(citationStorePath('mcq-old'), `${JSON.stringify(v2, null, 2)}\n`);

    expect(await readInstrumentCitation(vault, 'mcq-old')).toEqual({
      sourcePath: SLIDES,
      page: 4,
      sourceRevision: 'c'.repeat(64),
    });
    const record = await readInstrumentCitationRecord(vault, 'mcq-old');
    expect(record?.schemaVersion).toBe(2);
    expect(record?.inputNotes).toBeUndefined();
  });

  it('the guard accepts an absent list and rejects a malformed one', () => {
    const base = { instrumentId: 'x', sourcePath: NOTE_A, schemaVersion: 3 };
    expect(isCitationRecord(base)).toBe(true);
    expect(isCitationRecord({ ...base, inputNotes: NOTES })).toBe(true);
    for (const bad of [
      [],
      'not-a-list',
      [{ path: NOTE_A }],
      [{ contentHash: 'a' }],
      [{ path: '', contentHash: 'a' }],
      [{ path: NOTE_A, contentHash: '' }],
      [null],
      [{ path: NOTE_A, contentHash: 7 }],
    ]) {
      expect(isCitationRecord({ ...base, inputNotes: bad })).toBe(false);
      expect(isCitationInputNoteList(bad)).toBe(false);
    }
  });

  it('a malformed list is refused before anything is written', async () => {
    const vault = new FolderSource(tempRoot);
    await expect(
      writeInstrumentCitation(vault, 'bad', { sourcePath: NOTE_A }, [
        { path: NOTE_A, contentHash: '' },
      ]),
    ).rejects.toThrow(/malformed input notes/);
    expect(await vault.exists(citationStorePath('bad'))).toBe(false);
  });

  it('a corrupt or mismatched file reads as no record, never a throw', async () => {
    const vault = new FolderSource(tempRoot);
    await vault.write(citationStorePath('corrupt'), '{ not json');
    expect(await readInstrumentCitationRecord(vault, 'corrupt')).toBeUndefined();
    await writeInstrumentCitation(vault, 'other', { sourcePath: NOTE_A }, NOTES);
    await vault.write(citationStorePath('moved'), await vault.read(citationStorePath('other')));
    expect(await readInstrumentCitationRecord(vault, 'moved')).toBeUndefined();
    expect(await readInstrumentCitationRecord(vault, 'never-written')).toBeUndefined();
  });
});

describe('[D-576] the rename exception reaches input-note paths, and nothing else', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-citation-input-rename-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('renaming a note the item was drawn from moves that entry, its fingerprint kept', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'ren-in', { sourcePath: NOTE_A, page: 1 }, NOTES);

    expect(
      await renameCitationSourcePath(vault, 'ren-in', NOTE_B, 'Courses/Course A/Moved.md'),
    ).toBe(true);
    const record = await readInstrumentCitationRecord(vault, 'ren-in');
    expect(record).toEqual({
      sourcePath: NOTE_A,
      page: 1,
      instrumentId: 'ren-in',
      schemaVersion: 3,
      inputNotes: [NOTES[0], { path: 'Courses/Course A/Moved.md', contentHash: 'b'.repeat(64) }],
    });
  });

  it('renaming the cited note that is also an input note moves both', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'ren-both', { sourcePath: NOTE_A }, [NOTES[0]]);
    expect(await renameCitationSourcePath(vault, 'ren-both', NOTE_A, NOTE_B)).toBe(true);
    const record = await readInstrumentCitationRecord(vault, 'ren-both');
    expect(record?.sourcePath).toBe(NOTE_B);
    expect(record?.inputNotes).toEqual([{ path: NOTE_B, contentHash: 'a'.repeat(64) }]);
  });

  it('a path the record names nowhere leaves the file byte-identical', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'ren-none', { sourcePath: NOTE_A }, NOTES);
    const before = await vault.read(citationStorePath('ren-none'));
    expect(await renameCitationSourcePath(vault, 'ren-none', SLIDES, 'Elsewhere.pdf')).toBe(false);
    expect(await vault.read(citationStorePath('ren-none'))).toBe(before);
  });
});
