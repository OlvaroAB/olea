// `[D-460]` (ruled 2026-09-30, `ol-egov.141.89.6.80`; shape from `ol-egov.141.89.6.86`): the
// feedback exposure marker, the fact that an explain-back attempt's graded result was displayed,
// holding the attempt's identity (question id, attempt id) and the time, never the feedback.
// Additive at v6: a new `kind` literal, no schemaVersion bump. What this file has to prove:
//
//   1. the v6 union discriminates the new kind; v5 never carried it;
//   2. its fields are exactly the ruled ones, each required;
//   3. no content survives a parse (D-005): no answer, feedback, verdict, passage or points;
//   4. a well-formed line round-trips byte for byte, so a reader never rewrites what was written.
//
// Ids are structural placeholders (INV-3).
import { describe, expect, it } from 'vitest';
import {
  type ExplainBackFeedbackShownLogRecordV6,
  explainBackFeedbackShownLogRecord,
  explainBackFeedbackShownLogRecordV6,
  reviewLogEntry,
  reviewLogEntryV5,
} from './review-log.js';

function markerLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    kind: 'explain-back-feedback-shown',
    eventId: 'marker-1',
    timestamp: '2026-10-05T10:15:00-04:00',
    instrumentId: 'explain-back:concept-a',
    attemptId: 'attempt-1',
    ...over,
  };
}

describe('explainBackFeedbackShownLogRecordV6 ([D-460])', () => {
  it('parses a well-formed marker line at version 6', () => {
    expect(explainBackFeedbackShownLogRecordV6.safeParse(markerLine()).success).toBe(true);
  });

  it('round-trips byte for byte', () => {
    const line = JSON.stringify(markerLine());
    expect(JSON.stringify(explainBackFeedbackShownLogRecordV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('the current union reads it as its own kind, and v5 never carried it', () => {
    const parsed = reviewLogEntry.safeParse(markerLine());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('explain-back-feedback-shown');
    expect(reviewLogEntryV5.safeParse(markerLine({ schemaVersion: 5 })).success).toBe(false);
  });

  it('`explainBackFeedbackShownLogRecord` is the v6 alias', () => {
    expect(explainBackFeedbackShownLogRecord).toBe(explainBackFeedbackShownLogRecordV6);
  });

  it('accepts only version 6', () => {
    for (const schemaVersion of [1, 2, 3, 5, 7]) {
      expect(
        explainBackFeedbackShownLogRecordV6.safeParse(markerLine({ schemaVersion })).success,
        String(schemaVersion),
      ).toBe(false);
    }
  });

  it('requires every field: an attempt is named by its question and its own id, at a time with an offset', () => {
    for (const key of ['eventId', 'timestamp', 'instrumentId', 'attemptId']) {
      const line: Record<string, unknown> = markerLine();
      delete line[key];
      expect(explainBackFeedbackShownLogRecordV6.safeParse(line).success, key).toBe(false);
      expect(
        explainBackFeedbackShownLogRecordV6.safeParse(markerLine({ [key]: '' })).success,
        `${key} empty`,
      ).toBe(false);
    }
    expect(
      explainBackFeedbackShownLogRecordV6.safeParse(
        markerLine({ timestamp: '2026-10-05T10:15:00' }),
      ).success,
    ).toBe(false);
  });

  it('carries no content (D-005): answer, feedback, verdict, passage and missed points never survive a parse', () => {
    const parsed = explainBackFeedbackShownLogRecordV6.parse(
      markerLine({
        answer: 'synthetic answer text',
        studentAnswer: 'synthetic answer text',
        feedback: 'synthetic feedback',
        verdict: 'partial',
        outcome: { kind: 'graded', verdict: 'partial' },
        missedPoints: ['synthetic point'],
        citedPassage: 'synthetic passage',
        conceptIds: ['concept-a'],
        supportLevelShown: 'guided',
      }),
    );
    const keys: (keyof ExplainBackFeedbackShownLogRecordV6)[] = [
      'schemaVersion',
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'attemptId',
    ];
    expect(Object.keys(parsed).sort()).toEqual([...keys].sort());
    expect(JSON.stringify(parsed)).not.toContain('synthetic');
  });
});
