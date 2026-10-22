import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  CITATION_STORE_FOLDER,
  citationStorePath,
  classifyCitationFreshness,
  isCitationRecord,
  readInstrumentCitation,
  renameCitationSourcePath,
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

  describe('[D-576] renameCitationSourcePath: a rename Olea saw moves the path, nothing else', () => {
    it('changes only sourcePath: every other byte of the record is as it was', async () => {
      const vault = new FolderSource(tempRoot);
      await writeInstrumentCitation(vault, 'ren-1', {
        sourcePath: 'Sources/Old name.pdf',
        page: 3,
        section: 'Invented section',
        passageDigest: 'digest-abc',
        sourceRevision: 'rev-123',
      });
      const before = await vault.read(citationStorePath('ren-1'));

      expect(
        await renameCitationSourcePath(
          vault,
          'ren-1',
          'Sources/Old name.pdf',
          'Sources/New name.pdf',
        ),
      ).toBe(true);

      const after = await vault.read(citationStorePath('ren-1'));
      expect(after).toBe(before.replace('Sources/Old name.pdf', 'Sources/New name.pdf'));
      expect(await readInstrumentCitation(vault, 'ren-1')).toEqual({
        sourcePath: 'Sources/New name.pdf',
        page: 3,
        section: 'Invented section',
        passageDigest: 'digest-abc',
        sourceRevision: 'rev-123',
      });
      expect(JSON.parse(after).schemaVersion).toBe(JSON.parse(before).schemaVersion);
    });

    it('refuses, leaving the file untouched, when the record does not name the path renamed from', async () => {
      const vault = new FolderSource(tempRoot);
      await writeInstrumentCitation(vault, 'ren-2', { sourcePath: 'Sources/A.pdf', page: 1 });
      const before = await vault.read(citationStorePath('ren-2'));

      expect(
        await renameCitationSourcePath(vault, 'ren-2', 'Sources/Other.pdf', 'Sources/B.pdf'),
      ).toBe(false);
      expect(await renameCitationSourcePath(vault, 'ren-2', 'Sources/A.pdf', 'Sources/A.pdf')).toBe(
        false,
      );
      expect(
        await renameCitationSourcePath(vault, 'no-such-id', 'Sources/A.pdf', 'Sources/B.pdf'),
      ).toBe(false);
      expect(await vault.read(citationStorePath('ren-2'))).toBe(before);
    });

    it('refuses a corrupt record without throwing', async () => {
      const vault = new FolderSource(tempRoot);
      await vault.write(citationStorePath('ren-bad'), '{ not json');
      expect(
        await renameCitationSourcePath(vault, 'ren-bad', 'Sources/A.pdf', 'Sources/B.pdf'),
      ).toBe(false);
      expect(await vault.read(citationStorePath('ren-bad'))).toBe('{ not json');
    });

    it('write-once still holds for everything else: a second write is refused, also after a rename', async () => {
      const vault = new FolderSource(tempRoot);
      await writeInstrumentCitation(vault, 'ren-3', { sourcePath: 'Sources/A.pdf', page: 1 });
      await renameCitationSourcePath(vault, 'ren-3', 'Sources/A.pdf', 'Sources/B.pdf');
      await expect(
        writeInstrumentCitation(vault, 'ren-3', { sourcePath: 'Sources/C.pdf', page: 9 }),
      ).rejects.toThrow(/refusing to overwrite an immutable record/);
      expect(await readInstrumentCitation(vault, 'ren-3')).toEqual({
        sourcePath: 'Sources/B.pdf',
        page: 1,
      });
    });
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
    const allowedKeys = new Set([
      'instrumentId',
      'sourcePath',
      'page',
      'section',
      'schemaVersion',
      'passageDigest',
      'sourceRevision',
    ]);
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

  // [D-292] (ol-egov.141.89.2.7, closed): passageDigest/sourceRevision written at creation;
  // older (schema-version-1) records have neither. ol-2zfj.154's own acceptance criteria.
  it('[D-292] writes and reads passageDigest/sourceRevision when the caller supplies them', async () => {
    const vault = new FolderSource(tempRoot);
    await writeInstrumentCitation(vault, 'mcq-digest', {
      sourcePath: 'Sources/Lecture 3.pdf',
      page: 4,
      passageDigest: 'digest-abc',
      sourceRevision: 'revision-1',
    });

    const found = await readInstrumentCitation(vault, 'mcq-digest');
    expect(found).toEqual({
      sourcePath: 'Sources/Lecture 3.pdf',
      page: 4,
      passageDigest: 'digest-abc',
      sourceRevision: 'revision-1',
    });
  });

  it('isCitationRecord rejects a non-empty-string-typed passageDigest or sourceRevision', () => {
    expect(
      isCitationRecord({
        instrumentId: 'x',
        sourcePath: 'a.pdf',
        schemaVersion: 2,
        passageDigest: 7,
      }),
    ).toBe(false);
    expect(
      isCitationRecord({
        instrumentId: 'x',
        sourcePath: 'a.pdf',
        schemaVersion: 2,
        sourceRevision: '',
      }),
    ).toBe(false);
    expect(
      isCitationRecord({
        instrumentId: 'x',
        sourcePath: 'a.pdf',
        schemaVersion: 2,
        passageDigest: 'd',
        sourceRevision: 'r',
      }),
    ).toBe(true);
  });

  describe('[D-292] classifyCitationFreshness — the three states', () => {
    it('fresh: an observed digest matching the recorded passageDigest', () => {
      const citation = { sourcePath: 'Sources/A.pdf', passageDigest: 'digest-abc' };
      expect(classifyCitationFreshness(citation, 'digest-abc')).toBe('fresh');
    });

    it('stale: an observed digest that does not match the recorded passageDigest', () => {
      const citation = { sourcePath: 'Sources/A.pdf', passageDigest: 'digest-abc' };
      expect(classifyCitationFreshness(citation, 'digest-changed')).toBe('stale');
    });

    it('unknown: a legacy (schema-version-1) citation with no passageDigest at all', () => {
      const citation = { sourcePath: 'Sources/A.pdf' };
      expect(classifyCitationFreshness(citation, 'digest-abc')).toBe('unknown');
    });

    it('unknown: a passageDigest is recorded but the caller has no current observation', () => {
      const citation = { sourcePath: 'Sources/A.pdf', passageDigest: 'digest-abc' };
      expect(classifyCitationFreshness(citation, undefined)).toBe('unknown');
    });
  });
});
