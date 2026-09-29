/**
 * The unit manifest log on a real folder (`[D-445]`, `ol-egov.141.89.8.43`): the path convention,
 * append-only semantics, the crash-truncated line, and the byte-identical read-back (INV-2). Every
 * string below is invented (INV-3).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../../vault/folder-source.js';
import { enumeratedRecord, unitRecord } from './fixtures.js';
import {
  appendUnitManifestRecords,
  readUnitManifestLog,
  UNIT_MANIFEST_FOLDER,
  unitManifestLogPath,
} from './log.js';
import { parseUnitManifestLog, serialiseUnitManifestRecord } from './records.js';

const enumerated = enumeratedRecord;

describe('unitManifestLogPath', () => {
  it('names one file per day per device under .olea/unit-manifests', () => {
    expect(UNIT_MANIFEST_FOLDER).toBe('.olea/unit-manifests');
    expect(unitManifestLogPath('2026-09-29', 'olea-k3f9zq1m7x2p')).toBe(
      '.olea/unit-manifests/2026-09-29.olea-k3f9zq1m7x2p.jsonl',
    );
  });

  it('throws on a malformed date or device id, as the sibling logs do', () => {
    expect(() => unitManifestLogPath('29/09/2026', 'device-a')).toThrow(/calendar date/);
    expect(() => unitManifestLogPath('2026-09-29', '../escape')).toThrow(/device id/);
    expect(() => unitManifestLogPath('2026-09-29', '')).toThrow(/device id/);
  });
});

describe('appendUnitManifestRecords', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-unit-manifests-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes to the day and device path taken from the record, and nothing else', async () => {
    const vault = new FolderSource(tempRoot);
    const record = enumerated();
    const written = await appendUnitManifestRecords(vault, [record]);
    expect(written).toEqual([unitManifestLogPath('2026-09-29', 'device-a')]);
    expect(await readFile(join(tempRoot, written[0] as string), 'utf8')).toBe(
      serialiseUnitManifestRecord(record),
    );
  });

  it('is append-only: a second append keeps every earlier byte and adds exactly its own lines', async () => {
    const vault = new FolderSource(tempRoot);
    await appendUnitManifestRecords(vault, [enumerated(), unitRecord({ clock: 2 })]);
    const path = join(tempRoot, unitManifestLogPath('2026-09-29', 'device-a'));
    const before = await readFile(path, 'utf8');

    await appendUnitManifestRecords(vault, [unitRecord({ clock: 3, page: 2 })]);
    const after = await readFile(path, 'utf8');

    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length)).toBe(
      serialiseUnitManifestRecord(unitRecord({ clock: 3, page: 2 })),
    );
    expect(after.split('\n').filter((l) => l !== '')).toHaveLength(3);
  });

  it('never rewrites, reorders or compacts: a superseded state stays on disk as input', async () => {
    const vault = new FolderSource(tempRoot);
    await appendUnitManifestRecords(vault, [
      unitRecord({ clock: 1, readingState: { kind: 'pending', reason: 'queued' } }),
    ]);
    await appendUnitManifestRecords(vault, [
      unitRecord({ clock: 2, readingState: { kind: 'read', method: 'text-layer' } }),
    ]);
    const lines = (
      await readFile(join(tempRoot, unitManifestLogPath('2026-09-29', 'device-a')), 'utf8')
    )
      .split('\n')
      .filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"pending"');
    expect(lines[1]).toContain('"read"');
  });

  it('records for different devices or days land in different files, and one call may span them', async () => {
    const vault = new FolderSource(tempRoot);
    const written = await appendUnitManifestRecords(vault, [
      enumerated({ deviceId: 'device-a' }),
      enumerated({ deviceId: 'device-b', clock: 2 }),
      enumerated({ at: '2026-09-30T00:05:00+10:00', clock: 3 }),
    ]);
    expect(written).toEqual([
      unitManifestLogPath('2026-09-29', 'device-a'),
      unitManifestLogPath('2026-09-29', 'device-b'),
      unitManifestLogPath('2026-09-30', 'device-a'),
    ]);
  });

  it('closes a crash-truncated trailing line with its own newline rather than welding onto it', async () => {
    const vault = new FolderSource(tempRoot);
    const rel = unitManifestLogPath('2026-09-29', 'device-a');
    const first = serialiseUnitManifestRecord(unitRecord({ clock: 1 }));
    const torn = serialiseUnitManifestRecord(unitRecord({ clock: 2, page: 2 })).slice(0, 50);
    await appendUnitManifestRecords(vault, [unitRecord({ clock: 1 })]);
    await writeFile(join(tempRoot, rel), first + torn);

    await appendUnitManifestRecords(vault, [unitRecord({ clock: 3, page: 3 })]);

    const raw = await readFile(join(tempRoot, rel), 'utf8');
    expect(raw.startsWith(first + torn)).toBe(true);
    const parsed = parseUnitManifestLog(raw);
    expect(parsed.records.map((r) => r.clock)).toEqual([1, 3]);
    expect(parsed.invalidLines).toHaveLength(1);
  });

  it('refuses a record whose timestamp carries no date, instead of writing to a wrong file', async () => {
    const vault = new FolderSource(tempRoot);
    await expect(
      appendUnitManifestRecords(vault, [enumerated({ at: 'yesterday' })]),
    ).rejects.toThrow(/ISO-8601/);
  });
});

describe('readUnitManifestLog', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-unit-manifests-read-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads back exactly what was appended, and the file re-serialises to its own bytes (INV-2)', async () => {
    const vault = new FolderSource(tempRoot);
    const records = [
      enumerated(),
      unitRecord({ clock: 2, readingState: { kind: 'read', method: 'text-layer' } }),
      unitRecord({
        clock: 3,
        page: 2,
        readingState: { kind: 'partial', method: 'image', coverage: 'synthetic' },
      }),
    ];
    const [path] = await appendUnitManifestRecords(vault, records);

    const read = await readUnitManifestLog(vault, [path as string]);
    expect(read.records).toEqual(records);
    expect(read.invalidLines).toEqual([]);
    const bytes = await readFile(join(tempRoot, path as string), 'utf8');
    expect(read.records.map(serialiseUnitManifestRecord).join('')).toBe(bytes);
  });

  it('skips a path that does not exist and reads the rest in sorted path order', async () => {
    const vault = new FolderSource(tempRoot);
    await appendUnitManifestRecords(vault, [
      enumerated({ deviceId: 'device-b', clock: 5 }),
      enumerated({ deviceId: 'device-a', clock: 4 }),
    ]);
    const read = await readUnitManifestLog(vault, [
      unitManifestLogPath('2026-09-29', 'device-b'),
      unitManifestLogPath('2026-01-01', 'device-a'),
      unitManifestLogPath('2026-09-29', 'device-a'),
    ]);
    expect(read.records.map((r) => r.deviceId)).toEqual(['device-a', 'device-b']);
  });

  it('reports an invalid line by file and keeps every valid record around it', async () => {
    const vault = new FolderSource(tempRoot);
    const path = unitManifestLogPath('2026-09-29', 'device-a');
    await appendUnitManifestRecords(vault, [enumerated()]);
    const good = await readFile(join(tempRoot, path), 'utf8');
    await writeFile(join(tempRoot, path), `${good}not json at all\n${good}`);

    const read = await readUnitManifestLog(vault, [path]);
    expect(read.records).toHaveLength(2);
    expect(read.invalidLines).toHaveLength(1);
    expect(read.invalidLines[0]?.path).toBe(path);
    expect(read.invalidLines[0]?.lines[0]?.lineNumber).toBe(2);
  });

  it('an empty context reads as no records (INV-5): no folder, no files', async () => {
    const vault = new FolderSource(tempRoot);
    expect(await readUnitManifestLog(vault, [])).toEqual({ records: [], invalidLines: [] });
    expect(
      await readUnitManifestLog(vault, [unitManifestLogPath('2026-09-29', 'device-a')]),
    ).toEqual({ records: [], invalidLines: [] });
  });
});
