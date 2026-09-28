// `[D-416]` (ruled 2026-09-28, `ol-egov.141.89.6.63`): an explain-back attempt
// she set aside with Try again is kept in her log as its own content-free
// record, and the accepted retry's review names the attempt it followed.
// Additive at v6 — a new `kind` literal and one optional field on the review,
// no schemaVersion bump. What this file has to prove:
//
//   1. the v6 union discriminates the new kind; v5 never carried it;
//   2. its fields are the ruled ones: attempt id, the attempt it followed,
//      the outcome (a verdict, or could-not-assess with none), acceptance
//      `not-accepted` and nothing else, the rung, the duration;
//   3. no content survives a parse (D-005): no answer, feedback, passage or
//      missed points;
//   4. the review's `followsAttemptId` is explain-back-only, optional, and a
//      line without it is unchanged byte for byte.
import { describe, expect, it } from 'vitest';
import {
  type ExplainBackSetAsideLogRecordV6,
  explainBackCorrectnessVerdict,
  explainBackSetAsideLogRecord,
  explainBackSetAsideLogRecordV6,
  reviewLogEntry,
  reviewLogEntryV5,
  reviewLogRecordV6,
} from './review-log.js';

const provenance = { taskId: 'explain-back.judge.v1', promptVersion: '3', modelId: 'model-x' };

function setAsideLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    kind: 'explain-back-set-aside',
    eventId: 'set-aside-1',
    timestamp: '2026-09-28T10:15:00-04:00',
    instrumentId: 'explain-back:concept-a',
    conceptIds: ['concept-a'],
    attemptId: 'attempt-2',
    followsAttemptId: 'attempt-1',
    outcome: { kind: 'graded', verdict: 'partial', artifactProvenance: provenance },
    acceptance: 'not-accepted',
    supportLevelShown: 'guided',
    durationMs: 42000,
    ...over,
  };
}

function explainBackReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'review-1',
    timestamp: '2026-09-28T10:20:00-04:00',
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    wasUnsure: false,
    durationMs: 30000,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    conceptIds: ['concept-a'],
    ...over,
  };
}

describe('explainBackSetAsideLogRecordV6 ([D-416])', () => {
  it('parses a well-formed graded set-aside line at version 6', () => {
    const parsed = explainBackSetAsideLogRecordV6.safeParse(setAsideLine());
    expect(parsed.success).toBe(true);
  });

  it('round-trips byte for byte', () => {
    const line = JSON.stringify(setAsideLine());
    expect(JSON.stringify(explainBackSetAsideLogRecordV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('is a member of the current union, and never of v5', () => {
    const parsed = reviewLogEntry.safeParse(setAsideLine());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('explain-back-set-aside');
    expect(reviewLogEntryV5.safeParse(setAsideLine({ schemaVersion: 5 })).success).toBe(false);
  });

  it('`explainBackSetAsideLogRecord` is the v6 alias', () => {
    expect(explainBackSetAsideLogRecord).toBe(explainBackSetAsideLogRecordV6);
  });

  it('rejects any other schemaVersion', () => {
    for (const schemaVersion of [5, 7]) {
      expect(
        explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ schemaVersion })).success,
      ).toBe(false);
    }
  });

  it('requires every ruled field', () => {
    for (const key of [
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'conceptIds',
      'attemptId',
      'outcome',
      'acceptance',
      'durationMs',
    ]) {
      const line: Record<string, unknown> = setAsideLine();
      delete line[key];
      expect(explainBackSetAsideLogRecordV6.safeParse(line).success, key).toBe(false);
    }
  });

  it('acceptance is not-accepted and nothing else: an accepted attempt is the review record', () => {
    for (const acceptance of ['accepted', 'pending', '']) {
      expect(
        explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ acceptance })).success,
        acceptance,
      ).toBe(false);
    }
  });

  it('the first attempt at a question carries no followsAttemptId', () => {
    const { followsAttemptId: _drop, ...first } = setAsideLine({
      supportLevelShown: 'independent',
    });
    const parsed = explainBackSetAsideLogRecordV6.parse(first);
    expect(Object.hasOwn(parsed, 'followsAttemptId')).toBe(false);
  });

  it('an attempt never follows itself', () => {
    const result = explainBackSetAsideLogRecordV6.safeParse(
      setAsideLine({ followsAttemptId: 'attempt-2' }),
    );
    expect(result.success).toBe(false);
  });

  it('keeps each of the three verdicts, with or without a stamp', () => {
    for (const verdict of explainBackCorrectnessVerdict.options) {
      expect(
        explainBackSetAsideLogRecordV6.safeParse(
          setAsideLine({ outcome: { kind: 'graded', verdict } }),
        ).success,
        verdict,
      ).toBe(true);
    }
  });

  it('a graded outcome requires its verdict', () => {
    expect(
      explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ outcome: { kind: 'graded' } }))
        .success,
    ).toBe(false);
  });

  it('could-not-assess carries no verdict: one is stripped, never kept', () => {
    const parsed = explainBackSetAsideLogRecordV6.parse(
      setAsideLine({ outcome: { kind: 'unable-to-assess', verdict: 'correct' } }),
    );
    expect(parsed.outcome).toEqual({ kind: 'unable-to-assess' });
  });

  it('the rung is optional (absent = unknown), and only a ladder value', () => {
    const { supportLevelShown: _drop, ...rest } = setAsideLine();
    expect(explainBackSetAsideLogRecordV6.safeParse(rest).success).toBe(true);
    expect(
      explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ supportLevelShown: 'helped' }))
        .success,
    ).toBe(false);
  });

  it('durationMs is nullable, never absent', () => {
    expect(
      explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ durationMs: null })).success,
    ).toBe(true);
    expect(explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ durationMs: -1 })).success).toBe(
      false,
    );
  });

  it('rejects an empty concept list', () => {
    expect(explainBackSetAsideLogRecordV6.safeParse(setAsideLine({ conceptIds: [] })).success).toBe(
      false,
    );
  });

  it('carries no content (D-005): answer, feedback, passage and missed points never survive a parse', () => {
    const parsed = explainBackSetAsideLogRecordV6.parse(
      setAsideLine({
        answer: 'synthetic answer text',
        studentAnswer: 'synthetic answer text',
        feedback: 'synthetic feedback',
        missedPoints: ['synthetic point'],
        citedPassage: 'synthetic passage',
        contentRef: 'content-1',
        rating: 'good',
        explainBackGrade: { soloLevel: 'relational' },
        explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
      }),
    );
    const keys: (keyof ExplainBackSetAsideLogRecordV6)[] = [
      'schemaVersion',
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'conceptIds',
      'attemptId',
      'followsAttemptId',
      'outcome',
      'acceptance',
      'supportLevelShown',
      'durationMs',
    ];
    expect(Object.keys(parsed).sort()).toEqual([...keys].sort());
    expect(Object.keys(parsed.outcome).sort()).toEqual(
      ['artifactProvenance', 'kind', 'verdict'].sort(),
    );
  });
});

describe('the review record’s followsAttemptId ([D-416])', () => {
  it('an accepted explain-back retry names the attempt it followed', () => {
    const parsed = reviewLogRecordV6.parse(
      explainBackReviewLine({ supportLevelShown: 'guided', followsAttemptId: 'attempt-2' }),
    );
    expect(parsed.followsAttemptId).toBe('attempt-2');
    const read = reviewLogEntry.parse(
      explainBackReviewLine({ supportLevelShown: 'guided', followsAttemptId: 'attempt-2' }),
    );
    expect(read.kind === 'review' && read.followsAttemptId).toBe('attempt-2');
  });

  it('is the last key, so a record without it serialises exactly as before', () => {
    const without = JSON.stringify(explainBackReviewLine());
    expect(JSON.stringify(reviewLogRecordV6.parse(JSON.parse(without)))).toBe(without);
    const withLink = JSON.stringify(explainBackReviewLine({ followsAttemptId: 'attempt-2' }));
    expect(JSON.stringify(reviewLogRecordV6.parse(JSON.parse(withLink)))).toBe(withLink);
  });

  it('only on an explain-back review', () => {
    const result = reviewLogRecordV6.safeParse(
      explainBackReviewLine({
        instrumentType: 'qa',
        instrumentId: 'qa:concept-a:1',
        rating: 'good',
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
        followsAttemptId: 'attempt-2',
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('followsAttemptId');
  });

  it('never empty', () => {
    expect(
      reviewLogRecordV6.safeParse(explainBackReviewLine({ followsAttemptId: '' })).success,
    ).toBe(false);
  });
});
