// `[D-460]` (ol-egov.141.89.6.86): the explain-back feedback exposure marker is written to her log
// as its own content-free line, holding the question, the attempt and the time, and reads back as
// one marked attempt however many times it was written. Write, read back, refusal before any byte,
// no content, duplicates harmless, and the whole-log read the plugin composes it with.
// Ids are structural placeholders (INV-3).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewLogEntry } from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReviewLogHistory } from '../session/history.js';
import { FolderSource } from '../vault/folder-source.js';
import { explainBackFeedbackShownAttempts } from './feedback-shown.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import {
  appendExplainBackFeedbackShownRecord,
  appendExplainBackSetAsideRecord,
  type ExplainBackFeedbackShownLogRecordInput,
} from './write.js';

const day = '2026-10-05';
const timestamp = '2026-10-05T10:15:00-04:00';
const INSTRUMENT = 'explain-back:concept-a';

function input(
  over: Partial<ExplainBackFeedbackShownLogRecordInput> = {},
): ExplainBackFeedbackShownLogRecordInput {
  return { timestamp, instrumentId: INSTRUMENT, attemptId: 'attempt-1', ...over };
}

function marker(
  eventId: string,
  over: Partial<ExplainBackFeedbackShownLogRecordInput> = {},
): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'explain-back-feedback-shown',
    eventId,
    ...input(over),
  };
}

describe('appendExplainBackFeedbackShownRecord ([D-460])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-feedback-shown-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function fileText(): Promise<string> {
    return readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8');
  }

  it('write: appends one line with the persisted shape, and nothing else', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendExplainBackFeedbackShownRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'marker-1',
    });

    expect(result.path).toBe(reviewLogPath(day, 'desktop'));
    expect(await fileText()).toBe(
      `${JSON.stringify({
        schemaVersion: 6,
        kind: 'explain-back-feedback-shown',
        eventId: 'marker-1',
        timestamp,
        instrumentId: INSTRUMENT,
        attemptId: 'attempt-1',
      })}\n`,
    );
  });

  it('read: parseReviewLog returns it as its own kind, never an invalid line', async () => {
    const source = new FolderSource(tempRoot);
    await appendExplainBackFeedbackShownRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'marker-1',
    });

    const { records, invalidLines } = parseReviewLog(await fileText());
    expect(invalidLines).toEqual([]);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record?.kind).toBe('explain-back-feedback-shown');
    if (record?.kind === 'explain-back-feedback-shown') {
      expect(record.instrumentId).toBe(INSTRUMENT);
      expect(record.attemptId).toBe('attempt-1');
    }
  });

  it('appends beside the lines already there and rewrites none of them', async () => {
    const source = new FolderSource(tempRoot);
    await appendExplainBackSetAsideRecord(
      source,
      {
        timestamp: '2026-10-05T10:10:00-04:00',
        instrumentId: INSTRUMENT,
        conceptIds: ['concept-a'],
        attemptId: 'attempt-0',
        outcome: { kind: 'unable-to-assess' },
        durationMs: 1000,
      },
      { deviceId: 'desktop', generateEventId: () => 'set-aside-0' },
    );
    const before = await fileText();
    await appendExplainBackFeedbackShownRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'marker-1',
    });
    const after = await fileText();
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length).split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('refuses an invalid record before any byte is written', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendExplainBackFeedbackShownRecord(source, input({ attemptId: '' }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow(/schema validation/);
    await expect(
      appendExplainBackFeedbackShownRecord(source, input({ instrumentId: '' }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow(/schema validation/);
    await expect(
      appendExplainBackFeedbackShownRecord(source, input({ timestamp: '2026-10-05T10:15:00' }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow();
    await expect(fileText()).rejects.toThrow();
  });

  it('never writes content (D-005): a smuggled answer, feedback or verdict key does not reach the line', async () => {
    const source = new FolderSource(tempRoot);
    await appendExplainBackFeedbackShownRecord(
      source,
      {
        ...input(),
        kind: 'review',
        answer: 'synthetic answer',
        feedback: 'synthetic feedback',
        verdict: 'partial',
        conceptIds: ['concept-a'],
      } as unknown as ExplainBackFeedbackShownLogRecordInput,
      { deviceId: 'desktop', generateEventId: () => 'marker-2' },
    );
    const text = await fileText();
    expect(text).not.toContain('synthetic');
    expect(text).not.toContain('partial');
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(
      ['attemptId', 'eventId', 'instrumentId', 'kind', 'schemaVersion', 'timestamp'].sort(),
    );
    expect((JSON.parse(text) as { kind: string }).kind).toBe('explain-back-feedback-shown');
  });

  // @auto:core/review-log/write-feedback-shown.spec — "writing the marker twice is harmless"
  it('writing the marker twice leaves two lines and reads back as one marked attempt', async () => {
    const source = new FolderSource(tempRoot);
    const ids = ['marker-1', 'marker-2'];
    for (let i = 0; i < 2; i += 1) {
      await appendExplainBackFeedbackShownRecord(source, input(), {
        deviceId: 'desktop',
        generateEventId: () => ids[i] ?? 'extra',
      });
    }
    expect((await fileText()).split('\n').filter(Boolean)).toHaveLength(2);

    const history = await readReviewLogHistory(source);
    expect(history.invalidLines).toEqual([]);
    expect(history.entries).toHaveLength(2);
    expect(explainBackFeedbackShownAttempts(history.entries, INSTRUMENT)).toEqual([
      { attemptId: 'attempt-1', timestamp },
    ]);
  });
});

describe('explainBackFeedbackShownAttempts ([D-460])', () => {
  it('names each marked attempt at the question once, timed by its earliest marker, in first-seen order', () => {
    const entries = [
      marker('m1', { attemptId: 'attempt-1', timestamp: '2026-10-05T10:15:00-04:00' }),
      marker('m2', { attemptId: 'attempt-2', timestamp: '2026-10-05T10:20:00-04:00' }),
      // A retried write of attempt-1 that reports an earlier moment wins on time, not on order.
      marker('m3', { attemptId: 'attempt-1', timestamp: '2026-10-05T10:14:00-04:00' }),
      marker('m4', { attemptId: 'attempt-2', timestamp: '2026-10-05T10:25:00-04:00' }),
    ];
    expect(explainBackFeedbackShownAttempts(entries, INSTRUMENT)).toEqual([
      { attemptId: 'attempt-1', timestamp: '2026-10-05T10:14:00-04:00' },
      { attemptId: 'attempt-2', timestamp: '2026-10-05T10:20:00-04:00' },
    ]);
  });

  it('ignores markers for other questions and every other kind of entry', () => {
    const entries: ReviewLogEntry[] = [
      marker('m1', { instrumentId: 'explain-back:concept-b' }),
      {
        schemaVersion: 6,
        kind: 'explain-back-set-aside',
        eventId: 's1',
        timestamp,
        instrumentId: INSTRUMENT,
        conceptIds: ['concept-a'],
        attemptId: 'attempt-9',
        outcome: { kind: 'graded', verdict: 'partial' },
        acceptance: 'not-accepted',
        durationMs: 1000,
      },
    ];
    expect(explainBackFeedbackShownAttempts(entries, INSTRUMENT)).toEqual([]);
    expect(explainBackFeedbackShownAttempts(entries, 'explain-back:concept-b')).toEqual([
      { attemptId: 'attempt-1', timestamp },
    ]);
  });

  it('an old log with no marker names no attempt', () => {
    expect(explainBackFeedbackShownAttempts([], INSTRUMENT)).toEqual([]);
  });
});
