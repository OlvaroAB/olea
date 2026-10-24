import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  isPaperOriginRecord,
  PAPER_ORIGIN_RECORD_SCHEMA_VERSION,
  PAPER_ORIGIN_STORE_FOLDER,
  paperOriginStorePath,
  readInstrumentPaperOrigin,
  removeInstrumentPaperOrigin,
  writeInstrumentPaperOrigin,
} from './paper-origin-store.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 hand-off — a flashcard item enters review
// with its origin in a side record", tagged `@auto:core/oracle/paper-store.spec` (this store is the
// side record those scenarios read).

const ID = 'prov:uid-1#^abc123:1';
const ORIGIN = { paperId: 'paper-key1:p1', slotId: 'slot-0' };

describe('paper-origin-store', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-origin-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lives under .olea/paper-origins, one percent-encoded file per instrument id', () => {
    expect(PAPER_ORIGIN_STORE_FOLDER).toBe('.olea/paper-origins');
    expect(paperOriginStorePath(ID)).toBe(`.olea/paper-origins/${encodeURIComponent(ID)}.json`);
  });

  it('writes the two ids and nothing else, and reads them back', async () => {
    expect(await writeInstrumentPaperOrigin(vault, ID, ORIGIN)).toBe(true);
    const onDisk: unknown = JSON.parse(
      await readFile(join(root, paperOriginStorePath(ID)), 'utf8'),
    );
    expect(onDisk).toEqual({
      schemaVersion: PAPER_ORIGIN_RECORD_SCHEMA_VERSION,
      instrumentId: ID,
      ...ORIGIN,
    });
    expect(isPaperOriginRecord(onDisk)).toBe(true);
    expect(await readInstrumentPaperOrigin(vault, ID)).toEqual(ORIGIN);
  });

  it('is write-once: the same origin again is a no-op, a different one throws and leaves the file', async () => {
    await writeInstrumentPaperOrigin(vault, ID, ORIGIN);
    const before = await readFile(join(root, paperOriginStorePath(ID)), 'utf8');

    expect(await writeInstrumentPaperOrigin(vault, ID, ORIGIN)).toBe(false);
    await expect(
      writeInstrumentPaperOrigin(vault, ID, { paperId: ORIGIN.paperId, slotId: 'slot-9' }),
    ).rejects.toThrow(/refusing to overwrite/);
    expect(await readFile(join(root, paperOriginStorePath(ID)), 'utf8')).toBe(before);
  });

  it('refuses blank ids and ids with whitespace, writing nothing', async () => {
    await expect(writeInstrumentPaperOrigin(vault, '', ORIGIN)).rejects.toThrow(/instrumentId/);
    await expect(
      writeInstrumentPaperOrigin(vault, ID, { paperId: 'a b', slotId: 'slot-0' }),
    ).rejects.toThrow(/paperId/);
    await expect(
      writeInstrumentPaperOrigin(vault, ID, { paperId: ORIGIN.paperId, slotId: '' }),
    ).rejects.toThrow(/slotId/);
    expect(await vault.exists(paperOriginStorePath(ID))).toBe(false);
  });

  it('reads an absent, corrupt, malformed or mismatched file as undefined, never throwing', async () => {
    expect(await readInstrumentPaperOrigin(vault, ID)).toBeUndefined();
    expect(await readInstrumentPaperOrigin(vault, '')).toBeUndefined();
    await mkdir(join(root, PAPER_ORIGIN_STORE_FOLDER), { recursive: true });
    const file = join(root, paperOriginStorePath(ID));
    await writeFile(file, '{not json');
    expect(await readInstrumentPaperOrigin(vault, ID)).toBeUndefined();
    await writeFile(file, JSON.stringify({ schemaVersion: 1, instrumentId: ID, paperId: '' }));
    expect(await readInstrumentPaperOrigin(vault, ID)).toBeUndefined();
    await writeFile(file, JSON.stringify({ schemaVersion: 1, instrumentId: 'other', ...ORIGIN }));
    expect(await readInstrumentPaperOrigin(vault, ID)).toBeUndefined();
  });

  it('takes back only a record of the same origin, and refuses a vault that cannot delete', async () => {
    await writeInstrumentPaperOrigin(vault, ID, ORIGIN);
    await removeInstrumentPaperOrigin(vault, ID, { paperId: ORIGIN.paperId, slotId: 'slot-9' });
    expect(await readInstrumentPaperOrigin(vault, ID)).toEqual(ORIGIN);

    const noDelete = new FolderSource(root);
    Object.defineProperty(noDelete, 'delete', { value: undefined });
    await expect(removeInstrumentPaperOrigin(noDelete, ID, ORIGIN)).rejects.toThrow(
      /cannot delete/,
    );
    expect(await readInstrumentPaperOrigin(vault, ID)).toEqual(ORIGIN);

    await removeInstrumentPaperOrigin(vault, ID, ORIGIN);
    expect(await vault.exists(paperOriginStorePath(ID))).toBe(false);
    // A second take-back of a record already gone is a no-op.
    await removeInstrumentPaperOrigin(vault, ID, ORIGIN);
  });
});
