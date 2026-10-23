import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReviewLogHistory } from '../session/history.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  explainBackGradeEvents,
  explainBackGradeHistoryByInstrument,
  latestExplainBackGradeByInstrument,
  practiceExplanationHistoryByInstrument,
} from './explain-back-history.js';
import {
  appendNonAttemptRecord,
  appendReviewLogRecord,
  type RecordPracticeExplanationInput,
  type ReviewLogRecordInput,
  recordPracticeExplanation,
} from './write.js';

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
    expect(entry && 'soloLevel' in entry).toBe(false);
    expect(entry?.superseded).toBe(false);
  });
});

// Scenarios: `features/F8-concepts-scope.md`, "F8.4b in v0.9" ([D-603], [D-614]), tagged
// `@auto:core/review-log/explain-back-history.spec`. Real writers on a real folder; ids and text
// are structural placeholders (INV-3).
describe('F8.4b in v0.9: no depth reading on any row, her practice explanations listed', () => {
  let tempRoot: string;
  let counter = 0;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-eb-practice-history-'));
    counter = 0;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const QUESTION = 'explain-back:concept-a';

  function answerInput(
    over: Partial<RecordPracticeExplanationInput> = {},
  ): RecordPracticeExplanationInput {
    return {
      timestamp: '2026-10-21T10:15:00-04:00',
      instrumentId: QUESTION,
      attemptId: 'attempt-1',
      conceptIds: ['concept-a'],
      promptShape: 'concept',
      trigger: 'repeated-failure',
      durationMs: 60000,
      answer: 'synthetic answer',
      passagesShownInView: [],
      ...over,
    };
  }

  async function save(over: Partial<RecordPracticeExplanationInput> = {}) {
    const vault = new FolderSource(tempRoot);
    return recordPracticeExplanation(vault, answerInput(over), {
      deviceId: 'desktop',
      generateEventId: () => `pe-event-${++counter}`,
      generateContentId: () => `desktop.pe-content-${counter}`,
    });
  }

  async function entries() {
    return (await readReviewLogHistory(new FolderSource(tempRoot))).entries;
  }

  it('no row carries a SOLO level, a depth, a grade or a number, graded attempts included', async () => {
    const vault = new FolderSource(tempRoot);
    await appendReviewLogRecord(
      vault,
      explainBackInput({
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content:graded',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
      { deviceId: 'desktop', generateEventId: () => 'graded-1' },
    );
    await save();
    const log = await entries();

    const graded = explainBackGradeHistoryByInstrument(log).get('explain-back:imbrication:1');
    expect(graded?.[0] && Object.keys(graded[0])).not.toContain('soloLevel');
    const practice = practiceExplanationHistoryByInstrument(log).get(QUESTION);
    expect(practice?.[0] && Object.keys(practice[0]).sort()).toEqual([
      'conceptIds',
      'contentRef',
      'eventId',
      'instrumentId',
      'timestamp',
    ]);
  });

  it('lists every saved practice explanation, one row each, oldest first however the log arrives', async () => {
    await save({ attemptId: 'a-3', timestamp: '2026-10-23T09:00:00-04:00' });
    await save({ attemptId: 'a-1', timestamp: '2026-10-21T09:00:00-04:00' });
    await save({ attemptId: 'a-2', timestamp: '2026-10-22T09:00:00-04:00' });
    const log = await entries();
    const forward = practiceExplanationHistoryByInstrument(log).get(QUESTION);
    const reversed = practiceExplanationHistoryByInstrument([...log].reverse()).get(QUESTION);
    expect(forward?.map((row) => row.timestamp.slice(0, 10))).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(reversed).toEqual(forward);
  });

  it('reading the same log again and again never adds a row', async () => {
    await save();
    const log = await entries();
    for (let reopen = 0; reopen < 3; reopen += 1) {
      expect(practiceExplanationHistoryByInstrument(log).get(QUESTION)).toHaveLength(1);
    }
    // The same line seen on two devices is one saved explanation.
    expect(practiceExplanationHistoryByInstrument([...log, ...log]).get(QUESTION)).toHaveLength(1);
  });

  it('an answer the local check flagged is still her saved text, so it is listed', async () => {
    await save({ localCheckFlagged: true });
    const rows = practiceExplanationHistoryByInstrument(await entries()).get(QUESTION);
    expect(rows).toHaveLength(1);
  });

  it('a skipped prompt and a prompt closed without an answer have no row', async () => {
    const vault = new FolderSource(tempRoot);
    for (const [index, trigger] of (['on-demand', 'repeated-failure'] as const).entries()) {
      await appendNonAttemptRecord(
        vault,
        { timestamp: '2026-10-21T09:00:00-04:00', conceptIds: ['concept-a'], trigger },
        { deviceId: 'desktop', generateEventId: () => `na-${index}` },
      );
    }
    const log = await entries();
    expect(log.some((entry) => entry.kind === 'non-attempt')).toBe(true);
    expect(practiceExplanationHistoryByInstrument(log).size).toBe(0);
    expect(explainBackGradeHistoryByInstrument(log).size).toBe(0);
  });
});
