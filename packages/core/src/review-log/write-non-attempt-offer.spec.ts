// `[D-369]` (ol-egov.141.89.6.53): `appendNonAttemptRecord` writes the
// optional offer reference — the offer event's own eventId — when one exists,
// and writes nothing in its place when none does. Write, read back, legacy
// absent, never a placeholder, and INV-2's extend-never-rewrite for a file
// that already holds a line written before the field existed.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import { appendNonAttemptRecord, type NonAttemptLogRecordInput } from './write.js';

describe('appendNonAttemptRecord — the offer reference ([D-369])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-non-attempt-offer-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const day = '2026-09-25';
  const timestamp = '2026-09-25T10:15:00-04:00';

  function input(over: Partial<NonAttemptLogRecordInput> = {}): NonAttemptLogRecordInput {
    return { timestamp, conceptIds: ['concept-a'], trigger: 'repeated-failure', ...over };
  }

  async function fileText(): Promise<string> {
    return readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8');
  }

  it('write: records the offer event’s own eventId, verbatim, on the line it appends', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendNonAttemptRecord(source, input({ offerEventId: 'offer-event-7' }), {
      deviceId: 'desktop',
      generateEventId: () => 'non-attempt-1',
    });

    expect(result.record.offerEventId).toBe('offer-event-7');
    expect(await fileText()).toBe(
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'non-attempt',
        eventId: 'non-attempt-1',
        timestamp,
        conceptIds: ['concept-a'],
        trigger: 'repeated-failure',
        offerEventId: 'offer-event-7',
      })}\n`,
    );
  });

  it('read: parseReviewLog returns the written record with its offer reference intact', async () => {
    const source = new FolderSource(tempRoot);
    await appendNonAttemptRecord(source, input({ offerEventId: 'offer-event-7' }), {
      deviceId: 'desktop',
      generateEventId: () => 'non-attempt-1',
    });

    const { records, invalidLines } = parseReviewLog(await fileText());
    expect(invalidLines).toEqual([]);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record?.kind).toBe('non-attempt');
    if (record?.kind === 'non-attempt') expect(record.offerEventId).toBe('offer-event-7');
  });

  it('absent when no offer stands behind the prompt: no key on the record or the line, never null', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendNonAttemptRecord(source, input({ trigger: 'on-demand' }), {
      deviceId: 'desktop',
      generateEventId: () => 'non-attempt-2',
    });

    expect(Object.hasOwn(result.record, 'offerEventId')).toBe(false);
    const text = await fileText();
    expect(text).not.toContain('offerEventId');
    // The bytes are exactly what this writer produced before the field existed.
    expect(text).toBe(
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'non-attempt',
        eventId: 'non-attempt-2',
        timestamp,
        conceptIds: ['concept-a'],
        trigger: 'on-demand',
      })}\n`,
    );
  });

  it('an undefined value forced past the types is dropped, never kept as a key on the record', async () => {
    const source = new FolderSource(tempRoot);
    const forced = { ...input(), offerEventId: undefined } as unknown as NonAttemptLogRecordInput;
    const result = await appendNonAttemptRecord(source, forced, {
      deviceId: 'desktop',
      generateEventId: () => 'non-attempt-3',
    });

    expect(Object.hasOwn(result.record, 'offerEventId')).toBe(false);
    expect(await fileText()).not.toContain('offerEventId');
  });

  it('refuses a null placeholder before any byte is written', async () => {
    const source = new FolderSource(tempRoot);
    const forced = { ...input(), offerEventId: null } as unknown as NonAttemptLogRecordInput;
    await expect(appendNonAttemptRecord(source, forced, { deviceId: 'desktop' })).rejects.toThrow(
      /schema validation/,
    );
    expect(await source.exists(reviewLogPath(day, 'desktop'))).toBe(false);
  });

  it('refuses an offer reference on a self-initiated (on-demand) prompt before any byte is written', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendNonAttemptRecord(source, input({ trigger: 'on-demand', offerEventId: 'offer-1' }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow(/schema validation/);
    expect(await source.exists(reviewLogPath(day, 'desktop'))).toBe(false);
  });

  it('legacy absent: a line written before the field existed still reads, and an append leaves its bytes as a literal prefix (INV-2)', async () => {
    const legacyLine = JSON.stringify({
      schemaVersion: 5,
      kind: 'non-attempt',
      eventId: 'legacy-1',
      timestamp: '2026-09-25T09:00:00-04:00',
      conceptIds: ['concept-a'],
      trigger: 'scheduling-observation',
    });
    const absolute = join(tempRoot, reviewLogPath(day, 'desktop'));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${legacyLine}\n`, 'utf8');

    const source = new FolderSource(tempRoot);
    await appendNonAttemptRecord(source, input({ offerEventId: 'offer-event-7' }), {
      deviceId: 'desktop',
      generateEventId: () => 'non-attempt-4',
    });

    const text = await fileText();
    expect(text.startsWith(`${legacyLine}\n`)).toBe(true);

    const { records, invalidLines } = parseReviewLog(text);
    expect(invalidLines).toEqual([]);
    expect(records.map((record) => record.eventId)).toEqual(['legacy-1', 'non-attempt-4']);
    const [legacy, fresh] = records;
    expect(legacy !== undefined && Object.hasOwn(legacy, 'offerEventId')).toBe(false);
    expect(JSON.stringify(legacy)).toBe(legacyLine);
    if (fresh?.kind === 'non-attempt') expect(fresh.offerEventId).toBe('offer-event-7');
  });
});
