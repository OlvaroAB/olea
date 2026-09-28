// `[D-416]` (ol-egov.141.89.6.63): Try again keeps the attempt she set aside
// in her log as its own content-free record, and the accepted retry's review
// names the attempt it followed, so the attempt sequence reads back from the
// log alone. Write, read back, absent-means-absent, refusal before any byte,
// and the retry link through the explain-back review composer.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcceptedSoloGrading } from '../grading/explainBackSolo.js';
import { composeGradedExplainBackReviewRecord } from '../study-session/explain-back-grade-write.js';
import { FolderSource } from '../vault/folder-source.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import {
  appendExplainBackSetAsideRecord,
  appendReviewLogRecord,
  type ExplainBackSetAsideLogRecordInput,
} from './write.js';

const day = '2026-09-28';
const timestamp = '2026-09-28T10:15:00-04:00';
const provenance = { taskId: 'explain-back.judge.v1', promptVersion: '3', modelId: 'model-x' };

function input(
  over: Partial<ExplainBackSetAsideLogRecordInput> = {},
): ExplainBackSetAsideLogRecordInput {
  return {
    timestamp,
    instrumentId: 'explain-back:concept-a',
    conceptIds: ['concept-a'],
    attemptId: 'attempt-1',
    outcome: { kind: 'graded', verdict: 'partial', artifactProvenance: provenance },
    supportLevelShown: 'independent',
    durationMs: 42000,
    ...over,
  };
}

describe('appendExplainBackSetAsideRecord ([D-416])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-set-aside-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function fileText(): Promise<string> {
    return readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8');
  }

  it('write: appends one line with the persisted shape, acceptance stamped not-accepted', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendExplainBackSetAsideRecord(source, input(), {
      deviceId: 'desktop',
      generateEventId: () => 'set-aside-1',
    });

    expect(result.record.acceptance).toBe('not-accepted');
    expect(await fileText()).toBe(
      `${JSON.stringify({
        schemaVersion: 6,
        kind: 'explain-back-set-aside',
        eventId: 'set-aside-1',
        timestamp,
        instrumentId: 'explain-back:concept-a',
        conceptIds: ['concept-a'],
        attemptId: 'attempt-1',
        outcome: { kind: 'graded', verdict: 'partial', artifactProvenance: provenance },
        acceptance: 'not-accepted',
        supportLevelShown: 'independent',
        durationMs: 42000,
      })}\n`,
    );
  });

  it('read: parseReviewLog returns it as its own kind, never an invalid line', async () => {
    const source = new FolderSource(tempRoot);
    await appendExplainBackSetAsideRecord(
      source,
      input({ attemptId: 'attempt-2', followsAttemptId: 'attempt-1' }),
      { deviceId: 'desktop', generateEventId: () => 'set-aside-2' },
    );

    const { records, invalidLines } = parseReviewLog(await fileText());
    expect(invalidLines).toEqual([]);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record?.kind).toBe('explain-back-set-aside');
    if (record?.kind === 'explain-back-set-aside') {
      expect(record.attemptId).toBe('attempt-2');
      expect(record.followsAttemptId).toBe('attempt-1');
    }
  });

  it('a first attempt and an unknown rung are true absences, never keys set to undefined', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendExplainBackSetAsideRecord(
      source,
      {
        ...input({ outcome: { kind: 'unable-to-assess' } }),
        followsAttemptId: undefined,
        supportLevelShown: undefined,
      } as unknown as ExplainBackSetAsideLogRecordInput,
      { deviceId: 'desktop', generateEventId: () => 'set-aside-3' },
    );

    expect(Object.hasOwn(result.record, 'followsAttemptId')).toBe(false);
    expect(Object.hasOwn(result.record, 'supportLevelShown')).toBe(false);
    const line = JSON.parse(await fileText()) as Record<string, unknown>;
    expect(Object.hasOwn(line, 'followsAttemptId')).toBe(false);
    expect(line.outcome).toEqual({ kind: 'unable-to-assess' });
  });

  it('refuses an invalid record before any byte is written', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendExplainBackSetAsideRecord(source, input({ conceptIds: [] }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow(/schema validation/);
    await expect(
      appendExplainBackSetAsideRecord(source, input({ followsAttemptId: 'attempt-1' }), {
        deviceId: 'desktop',
      }),
    ).rejects.toThrow(/schema validation/);
    await expect(fileText()).rejects.toThrow();
  });

  it('never writes content (D-005): a smuggled answer or feedback key does not reach the line', async () => {
    const source = new FolderSource(tempRoot);
    await appendExplainBackSetAsideRecord(
      source,
      {
        ...input(),
        answer: 'synthetic answer',
        feedback: 'synthetic feedback',
      } as unknown as ExplainBackSetAsideLogRecordInput,
      { deviceId: 'desktop', generateEventId: () => 'set-aside-4' },
    );
    const text = await fileText();
    expect(text).not.toContain('synthetic');
  });
});

describe('the accepted retry names the attempt it followed ([D-416])', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-set-aside-retry-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const accepted: AcceptedSoloGrading = {
    status: 'accepted',
    soloLevel: 'relational',
    rationale: 'synthetic rationale',
    citedBlockIds: ['blk-1'],
  };

  function compose(followsAttemptId?: string) {
    return composeGradedExplainBackReviewRecord({
      subject: {
        instrumentId: 'explain-back:concept-a',
        conceptIds: ['concept-a'],
        timestamp: '2026-09-28T10:20:00-04:00',
        wasUnsure: false,
        durationMs: 30000,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['explain-back'],
          planVersion: null,
        },
        supportLevelShown: 'guided',
        ...(followsAttemptId !== undefined ? { followsAttemptId } : {}),
      },
      accepted,
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back.solo.v1',
        promptVersion: '1.0.0',
        modelId: 'model-x',
      },
    });
  }

  it('the composer carries followsAttemptId onto the review, and omits it for a first attempt', () => {
    expect(compose('attempt-2').followsAttemptId).toBe('attempt-2');
    expect(Object.hasOwn(compose(), 'followsAttemptId')).toBe(false);
  });

  it('the sequence reads back from the log alone: review → last set-aside → first attempt', async () => {
    const source = new FolderSource(tempRoot);
    const options = (id: string) => ({ deviceId: 'desktop', generateEventId: () => id });
    await appendExplainBackSetAsideRecord(source, input({ attemptId: 'attempt-1' }), options('e1'));
    await appendExplainBackSetAsideRecord(
      source,
      input({
        attemptId: 'attempt-2',
        followsAttemptId: 'attempt-1',
        supportLevelShown: 'guided',
        outcome: { kind: 'graded', verdict: 'incorrect', artifactProvenance: provenance },
      }),
      options('e2'),
    );
    await appendReviewLogRecord(source, compose('attempt-2'), options('e3'));

    const { records, invalidLines } = parseReviewLog(
      await readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8'),
    );
    expect(invalidLines).toEqual([]);
    const byAttempt = new Map(
      records.flatMap((r) => (r.kind === 'explain-back-set-aside' ? [[r.attemptId, r]] : [])),
    );
    const review = records.find((r) => r.kind === 'review');
    const chain: string[] = [];
    let next = review?.kind === 'review' ? review.followsAttemptId : undefined;
    while (next !== undefined) {
      chain.push(next);
      next = byAttempt.get(next)?.followsAttemptId;
    }
    expect(chain).toEqual(['attempt-2', 'attempt-1']);
    expect([...byAttempt.values()].map((r) => r.acceptance)).toEqual([
      'not-accepted',
      'not-accepted',
    ]);
  });
});
