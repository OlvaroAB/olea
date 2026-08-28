import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  explainBackGradeEvents,
  explainBackGradeHistoryByInstrument,
  latestExplainBackGradeByInstrument,
} from './explain-back-history.js';
import { appendReviewLogRecord, type ReviewLogRecordInput } from './write.js';

const PROVENANCE = {
  taskId: 'explain-back.solo.v1',
  promptVersion: '2026-08-26',
  modelId: 'workers-ai:test-model',
} as const;

function explainBackInput(overrides: Partial<ReviewLogRecordInput> = {}): ReviewLogRecordInput {
  return {
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'explain-back:imbrication:1',
    instrumentType: 'explain-back',
    conceptIds: ['imbrication'],
    rating: null,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('explainBackGradeEvents', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-eb-history-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('picks out only review records that actually carry explainBackGrade', async () => {
    const vault = new FolderSource(tempRoot);
    const graded = await appendReviewLogRecord(
      vault,
      explainBackInput({
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content:g1',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'graded-1' },
    );
    const ungraded = await appendReviewLogRecord(
      vault,
      explainBackInput({ timestamp: '2026-08-10T09:05:00-04:00' }),
      { deviceId: 'desktop', generateEventId: () => 'ungraded-1' },
    );
    const otherKind = await appendReviewLogRecord(
      vault,
      // A `qa` review can never carry `explainBackGrade` (schema-enforced),
      // and must not be picked up as if it were graded.
      {
        timestamp: '2026-08-10T09:10:00-04:00',
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
      },
      { deviceId: 'desktop', generateEventId: () => 'qa-1' },
    );

    const events = explainBackGradeEvents([graded.record, ungraded.record, otherKind.record]);
    expect(events.map((e) => e.eventId)).toEqual(['graded-1']);
  });
});

describe('explainBackGradeHistoryByInstrument (F5 scenario: the per-instrument view is a projection, never a second write)', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-eb-history-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('an instrument with one graded attempt has a one-entry, unsuperseded history', async () => {
    const vault = new FolderSource(tempRoot);
    const { record } = await appendReviewLogRecord(
      vault,
      explainBackInput({
        explainBackGrade: {
          soloLevel: 'unistructural',
          contentRef: 'content:only',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'only' },
    );

    const history = explainBackGradeHistoryByInstrument([record]);
    const entries = history.get('explain-back:imbrication:1');
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      eventId: 'only',
      instrumentId: 'explain-back:imbrication:1',
      soloLevel: 'unistructural',
      contentRef: 'content:only',
      revisionOf: null,
      superseded: false,
    });
  });

  it('orders multiple attempts oldest-first and marks every but the last superseded, regardless of input order', async () => {
    const vault = new FolderSource(tempRoot);
    const first = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-10T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'prestructural',
          contentRef: 'content:attempt-1',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'attempt-1' },
    );
    const second = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-12T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'multistructural',
          contentRef: 'content:attempt-2',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'attempt-2' },
    );
    const third = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-14T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content:attempt-3',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'attempt-3' },
    );

    // Deliberately handed in out of chronological order — the projection
    // must not trust input order (mirrors ./suspension.ts and ./verdicts.ts).
    const history = explainBackGradeHistoryByInstrument([
      third.record,
      first.record,
      second.record,
    ]);
    const entries = history.get('explain-back:imbrication:1');
    expect(entries?.map((e) => e.eventId)).toEqual(['attempt-1', 'attempt-2', 'attempt-3']);
    expect(entries?.map((e) => e.superseded)).toEqual([true, true, false]);
    expect(entries?.map((e) => e.soloLevel)).toEqual([
      'prestructural',
      'multistructural',
      'relational',
    ]);
  });

  it('keeps two instruments’ histories separate', async () => {
    const vault = new FolderSource(tempRoot);
    const a = await appendReviewLogRecord(
      vault,
      explainBackInput({
        instrumentId: 'explain-back:imbrication:1',
        explainBackGrade: {
          soloLevel: 'unistructural',
          contentRef: 'content:a',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'a1' },
    );
    const b = await appendReviewLogRecord(
      vault,
      explainBackInput({
        instrumentId: 'explain-back:bioturbation:1',
        conceptIds: ['bioturbation'],
        explainBackGrade: {
          soloLevel: 'extended-abstract',
          contentRef: 'content:b',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'b1' },
    );

    const history = explainBackGradeHistoryByInstrument([a.record, b.record]);
    expect(history.size).toBe(2);
    expect(history.get('explain-back:imbrication:1')?.[0]?.contentRef).toBe('content:a');
    expect(history.get('explain-back:bioturbation:1')?.[0]?.contentRef).toBe('content:b');
  });

  it('a re-grade of the same answer carries revisionOf verbatim, and it plays no part in ordering', async () => {
    const vault = new FolderSource(tempRoot);
    const original = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-10T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'multistructural',
          contentRef: 'content:original',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'original' },
    );
    const regrade = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-11T09:00:00-04:00',
        // Same contentRef as `original` — this is a re-grade of the SAME
        // recorded answer under a changed rubric, not a fresh attempt.
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content:original',
          revisionOf: 'original',
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'regrade' },
    );

    const entries = explainBackGradeHistoryByInstrument([original.record, regrade.record]).get(
      'explain-back:imbrication:1',
    );
    expect(entries?.map((e) => e.eventId)).toEqual(['original', 'regrade']);
    expect(entries?.[1]?.revisionOf).toBe('original');
    expect(entries?.[1]?.superseded).toBe(false);
  });

  it('an instrument never graded is absent from the map entirely', async () => {
    const vault = new FolderSource(tempRoot);
    const { record } = await appendReviewLogRecord(vault, explainBackInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'ungraded',
    });

    const history = explainBackGradeHistoryByInstrument([record]);
    expect(history.has('explain-back:imbrication:1')).toBe(false);
    expect(history.size).toBe(0);
  });
});

describe('latestExplainBackGradeByInstrument', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-eb-history-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves to the same most-recent attempt the history projection puts last', async () => {
    const vault = new FolderSource(tempRoot);
    const first = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-10T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'unistructural',
          contentRef: 'content:first',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'first' },
    );
    const latest = await appendReviewLogRecord(
      vault,
      explainBackInput({
        timestamp: '2026-08-12T09:00:00-04:00',
        explainBackGrade: {
          soloLevel: 'extended-abstract',
          contentRef: 'content:latest',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'latest' },
    );

    const map = latestExplainBackGradeByInstrument([first.record, latest.record]);
    const entry = map.get('explain-back:imbrication:1');
    expect(entry?.eventId).toBe('latest');
    expect(entry?.soloLevel).toBe('extended-abstract');
    expect(entry?.superseded).toBe(false);
  });
});
