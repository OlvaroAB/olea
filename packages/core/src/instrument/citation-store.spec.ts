import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  CITATION_STORE_FOLDER,
  citationStorePath,
  isCitationRecord,
  readInstrumentCitation,
  writeInstrumentCitation,
} from './citation-store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "Instrument passage-citation
// sidecar: mint once at draft time, read back into sourceProvenance ([D-181 / CITE-2],
// ol-2zfj.52)", tagged `@auto:core/instrument/citation-store.spec`.

describe('citation-store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-citation-store-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lives under the D-181 folder', () => {
    expect(CITATION_STORE_FOLDER).toBe('.olea/citations');
  });

  it('writes a citation and reads it back exactly (round trip)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'mcq-1', {
      sourcePath: 'Sources/Lecture 3.pdf',
      page: 4,
      section: 'Bedform stratification',
    });

    const found = await readInstrumentCitation(vault, 'mcq-1');
    expect(found).toEqual({
      sourcePath: 'Sources/Lecture 3.pdf',
      page: 4,
      section: 'Bedform stratification',
    });
  });

  it('omits page/section independently when the citation did not have them (omit-never-fabricate)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'mcq-page-only', {
      sourcePath: 'Sources/Deck.pptx',
      page: 2,
    });
    const pageOnly = await readInstrumentCitation(vault, 'mcq-page-only');
    expect(pageOnly).toEqual({ sourcePath: 'Sources/Deck.pptx', page: 2 });
    expect(pageOnly && 'section' in pageOnly).toBe(false);

    await writeInstrumentCitation(vault, 'mcq-source-only', {
      sourcePath: 'Sources/Notes.docx',
    });
    const sourceOnly = await readInstrumentCitation(vault, 'mcq-source-only');
    expect(sourceOnly).toEqual({ sourcePath: 'Sources/Notes.docx' });
    expect(sourceOnly && 'page' in sourceOnly).toBe(false);
    expect(sourceOnly && 'section' in sourceOnly).toBe(false);
  });

  it('reading a missing sidecar returns undefined', async () => {
    const vault = new FolderSource(tempRoot);
    expect(await readInstrumentCitation(vault, 'never-written')).toBeUndefined();
  });

  it('reading a corrupt or malformed sidecar returns undefined, never throws', async () => {
    const vault = new FolderSource(tempRoot);
    await vault.write(citationStorePath('corrupt'), 'not json{{{');
    expect(await readInstrumentCitation(vault, 'corrupt')).toBeUndefined();

    await vault.write(citationStorePath('malformed'), JSON.stringify({ sourcePath: '' }));
    expect(await readInstrumentCitation(vault, 'malformed')).toBeUndefined();
  });

  it('never overwrites an existing citation (immutable, write-once)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'dup', { sourcePath: 'Sources/A.pdf', page: 1 });

    await expect(
      writeInstrumentCitation(vault, 'dup', { sourcePath: 'Sources/B.pdf', page: 9 }),
    ).rejects.toThrow(/refusing to overwrite an immutable record/);

    const result = await readInstrumentCitation(vault, 'dup');
    expect(result).toEqual({ sourcePath: 'Sources/A.pdf', page: 1 });
  });

  it('encodes the instrument id into the file name, injectively', () => {
    expect(citationStorePath('mcq/with slashes')).toBe('.olea/citations/mcq%2Fwith%20slashes.json');
    expect(citationStorePath('a')).not.toBe(citationStorePath('b'));
  });

  it('carries only sourcePath/page/section — never a PDF document-metadata field', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'no-metadata', {
      sourcePath: 'Sources/Lecture.pdf',
      page: 1,
    });
    const raw = JSON.parse(await vault.read(citationStorePath('no-metadata'))) as Record<
      string,
      unknown
    >;
    const allowedKeys = new Set(['instrumentId', 'sourcePath', 'page', 'section', 'schemaVersion']);
    for (const key of Object.keys(raw)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('isCitationRecord rejects a record with a non-string sourcePath or wrong-typed page/section', () => {
    expect(isCitationRecord({ instrumentId: 'x', sourcePath: 'a.pdf', schemaVersion: 1 })).toBe(
      true,
    );
    expect(isCitationRecord({ instrumentId: 'x', sourcePath: '', schemaVersion: 1 })).toBe(false);
    expect(
      isCitationRecord({ instrumentId: 'x', sourcePath: 'a.pdf', page: '4', schemaVersion: 1 }),
    ).toBe(false);
    expect(
      isCitationRecord({
        instrumentId: 'x',
        sourcePath: 'a.pdf',
        section: 7,
        schemaVersion: 1,
      }),
    ).toBe(false);
    expect(isCitationRecord(null)).toBe(false);
    expect(isCitationRecord('nope')).toBe(false);
  });
});
