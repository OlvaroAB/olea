// `[D-367]` (ol-0r92.118): `appendReviewLogRecord` writes the optional review
// `origin` when the caller passes one, and writes nothing in its place when it
// does not. Write, read back, legacy absent, never a placeholder, and INV-2's
// extend-never-rewrite for a file that already holds reviews of the same
// instrument written before the hand-off: those earlier lines keep every byte
// and never acquire the field, so nothing already recorded is relabelled or
// turned into a different kind of evidence after the fact.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import { appendReviewLogRecord, type ReviewLogRecordInput } from './write.js';

describe('appendReviewLogRecord — the review origin ([D-367])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-review-origin-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const day = '2026-09-26';
  const timestamp = '2026-09-26T09:30:00-04:00';
  const selectionContext = {
    dueState: 'new',
    examProximity: 4,
    yieldRank: null,
    instrumentTypesOffered: ['qa'],
    planVersion: null,
  } as const;

  function input(over: Partial<ReviewLogRecordInput> = {}): ReviewLogRecordInput {
    return {
      timestamp,
      instrumentId: 'qa:concept-a:1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      rating: 'good',
      wasUnsure: false,
      durationMs: 5100,
      selectionContext: { ...selectionContext, instrumentTypesOffered: ['qa'] },
      ...over,
    };
  }

  /** The line the writer lays out for `input()` with no optional field — the layout every record before `[D-367]` has. */
  function expectedLine(eventId: string, extra: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
      schemaVersion: 5,
      kind: 'review',
      eventId,
      timestamp,
      instrumentId: 'qa:concept-a:1',
      instrumentType: 'qa',
      rating: 'good',
      wasUnsure: false,
      durationMs: 5100,
      selectionContext,
      conceptIds: ['concept-a'],
      ...extra,
    })}\n`;
  }

  async function fileText(): Promise<string> {
    return readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8');
  }

  it('write: records the ruled value, last on the line it appends', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, input({ origin: 'practice-paper' }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-1',
    });

    expect(result.record.origin).toBe('practice-paper');
    expect(await fileText()).toBe(expectedLine('review-1', { origin: 'practice-paper' }));
  });

  it('read: parseReviewLog returns the written record with its origin intact', async () => {
    const source = new FolderSource(tempRoot);
    await appendReviewLogRecord(source, input({ origin: 'practice-paper' }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-1',
    });

    const parsed = parseReviewLog(await fileText());
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind === 'review') expect(record.origin).toBe('practice-paper');
  });

  it('absent: a review with no origin is written exactly as before the field existed', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'review-1',
    });

    expect(Object.hasOwn(result.record, 'origin')).toBe(false);
    expect(await fileText()).toBe(expectedLine('review-1'));
  });

  it('absent: an undefined origin forced past the types leaves no key on the record or the line', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, input({ origin: undefined }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-1',
    });

    expect(Object.hasOwn(result.record, 'origin')).toBe(false);
    expect(await fileText()).toBe(expectedLine('review-1'));
  });

  it('never a placeholder or a flag: a bad value is refused before any byte is written', async () => {
    const source = new FolderSource(tempRoot);
    for (const bad of [null, '', true, 'from a practice paper']) {
      await expect(
        appendReviewLogRecord(
          source,
          input({ origin: bad as unknown as ReviewLogRecordInput['origin'] }),
          { deviceId: 'desktop' },
        ),
      ).rejects.toThrow(/schema validation/);
    }
    await expect(fileText()).rejects.toThrow();
  });

  it('INV-2: earlier reviews of the same instrument keep every byte and never acquire the field', async () => {
    // A file already holding two reviews of this instrument, one of them a
    // hand-written line in the exact layout an older build produced, the
    // other written by this writer with no origin.
    const path = join(tempRoot, reviewLogPath(day, 'desktop'));
    await mkdir(dirname(path), { recursive: true });
    const legacy = expectedLine('review-legacy');
    await writeFile(path, legacy, 'utf8');
    const source = new FolderSource(tempRoot);
    await appendReviewLogRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'review-before',
    });
    const before = await fileText();

    await appendReviewLogRecord(source, input({ origin: 'practice-paper' }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-after',
    });
    const after = await fileText();

    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length)).toBe(
      expectedLine('review-after', { origin: 'practice-paper' }),
    );

    const parsed = parseReviewLog(after);
    expect(parsed.invalidLines).toEqual([]);
    const origins = parsed.records.map((record) =>
      record.kind === 'review' ? (record.origin ?? null) : 'not-a-review',
    );
    expect(origins).toEqual([null, null, 'practice-paper']);
    for (const record of parsed.records.slice(0, 2)) {
      expect(Object.hasOwn(record, 'origin')).toBe(false);
    }
  });

  it('INV-2: a line carrying the field, and one without it, both re-serialise byte-identically after a read', async () => {
    const source = new FolderSource(tempRoot);
    await appendReviewLogRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'review-1',
    });
    await appendReviewLogRecord(source, input({ origin: 'practice-paper' }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-2',
    });
    const text = await fileText();
    const reserialised = parseReviewLog(text)
      .records.map((record) => `${JSON.stringify(record)}\n`)
      .join('');
    expect(reserialised).toBe(text);
  });
});
