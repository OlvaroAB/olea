// P2-T03 acceptance: "two-device same-day append merges cleanly." This
// exercises the full loop — appendReviewLogRecord -> readReviewLogFile ->
// mergeReviewLogRecords — over a real FolderSource against a temp
// directory, standing in for two physical devices sharing a synced vault
// folder. The three scenarios named in the bead: the same eventId appearing
// twice, interleaved orderings, and one device's file being a strict prefix
// of the other's.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from '../../src/review-log/merge.js';
import { parseReviewLog } from '../../src/review-log/parse.js';
import { readReviewLogFile } from '../../src/review-log/read.js';
import { appendReviewLogRecord, type ReviewLogRecordInput } from '../../src/review-log/write.js';
import { FolderSource } from '../../src/vault/folder-source.js';

function inputAt(
  timestamp: string,
  overrides: Partial<ReviewLogRecordInput> = {},
): ReviewLogRecordInput {
  return {
    timestamp,
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['imbrication'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 3000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('two-device same-day review-log merge', () => {
  let tempRoot: string;
  let source: FolderSource;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-two-device-'));
    source = new FolderSource(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('same eventId appearing on both devices collapses to one record, without coordination', async () => {
    // A concrete way this happens without any coordination between devices:
    // she reviews on her phone while it's offline, the event is queued
    // locally with its eventId already assigned, and by the time it
    // actually reaches disk her desktop's sync client has *also* materialised
    // the same already-synced JSONL line into its own device file (e.g. a
    // vault-sync tool that mirrors the whole `.olea/` tree rather than
    // respecting the "owned by one device" convention). Modelled directly
    // here as the same fully-formed record being appended under both device
    // ids with a shared, pre-assigned eventId.
    const shared = { eventId: 'shared-event-1', timestamp: '2026-08-10T09:00:00-04:00' };
    const alphaResult = await appendReviewLogRecord(source, inputAt(shared.timestamp), {
      deviceId: 'alpha',
      generateEventId: () => shared.eventId,
    });
    const betaResult = await appendReviewLogRecord(source, inputAt(shared.timestamp), {
      deviceId: 'beta',
      generateEventId: () => shared.eventId,
    });
    expect(alphaResult.record).toEqual(betaResult.record);

    const alphaLog = await readReviewLogFile(source, alphaResult.path);
    const betaLog = await readReviewLogFile(source, betaResult.path);
    expect(alphaLog.invalidLines).toEqual([]);
    expect(betaLog.invalidLines).toEqual([]);

    const merged = mergeReviewLogRecords(alphaLog.records, betaLog.records);
    expect(merged.records).toHaveLength(1);
    expect(merged.duplicateEventIds).toEqual(['shared-event-1']);
  });

  it('interleaved write orderings across two devices still merge to one chronological, deduplicated list', async () => {
    // Alpha and beta each append in their own local order; neither knows
    // about the other's events or their relative timing.
    await appendReviewLogRecord(source, inputAt('2026-08-10T09:00:00-04:00'), {
      deviceId: 'alpha',
      generateEventId: () => 'a1',
    });
    const alphaSecond = await appendReviewLogRecord(source, inputAt('2026-08-10T09:20:00-04:00'), {
      deviceId: 'alpha',
      generateEventId: () => 'a2',
    });
    await appendReviewLogRecord(source, inputAt('2026-08-10T09:10:00-04:00'), {
      deviceId: 'beta',
      generateEventId: () => 'b1',
    });
    const betaSecond = await appendReviewLogRecord(source, inputAt('2026-08-10T09:30:00-04:00'), {
      deviceId: 'beta',
      generateEventId: () => 'b2',
    });

    const alphaLog = await readReviewLogFile(source, alphaSecond.path);
    const betaLog = await readReviewLogFile(source, betaSecond.path);

    const forward = mergeReviewLogRecords(alphaLog.records, betaLog.records);
    const backward = mergeReviewLogRecords(betaLog.records, alphaLog.records);
    expect(forward).toEqual(backward);
    expect(forward.records.map((r) => r.eventId)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it("one device's file being a strict prefix of the other's merges to exactly the longer file's records", async () => {
    // Same device, read at two different points during a sync — the earlier
    // read's raw bytes are a strict prefix of the later read's raw bytes,
    // and the later read is a strict superset at the record level too.
    const first = await appendReviewLogRecord(source, inputAt('2026-08-10T09:00:00-04:00'), {
      deviceId: 'alpha',
      generateEventId: () => 'a1',
    });
    const earlierRaw = await readFile(join(tempRoot, first.path), 'utf8');

    const second = await appendReviewLogRecord(source, inputAt('2026-08-10T09:15:00-04:00'), {
      deviceId: 'alpha',
      generateEventId: () => 'a2',
    });
    const third = await appendReviewLogRecord(source, inputAt('2026-08-10T09:30:00-04:00'), {
      deviceId: 'alpha',
      generateEventId: () => 'a3',
    });
    const laterRaw = await readFile(join(tempRoot, third.path), 'utf8');

    expect(laterRaw.startsWith(earlierRaw)).toBe(true);
    expect(laterRaw).not.toBe(earlierRaw);

    const earlierSnapshot = parseReviewLog(earlierRaw).records;
    const laterSnapshot = parseReviewLog(laterRaw).records;

    const merged = mergeReviewLogRecords(earlierSnapshot, laterSnapshot);
    expect(merged.records).toEqual(laterSnapshot);
    expect(merged.records.map((r) => r.eventId)).toEqual(['a1', 'a2', 'a3']);
    expect(merged.duplicateEventIds).toEqual(['a1']);
    expect(second.record.eventId).toBe('a2');
  });

  it('a file that was never written reads as zero records, not an error', async () => {
    const result = await readReviewLogFile(source, '.olea/reviews/2026-08-10.never-written.jsonl');
    expect(result).toEqual({ records: [], invalidLines: [], disputes: [] });
  });
});
