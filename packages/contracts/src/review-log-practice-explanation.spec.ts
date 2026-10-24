// D7.1 / `[D-614]` (ruled 2026-10-23, `ol-egov.141.89.6.128`): in v0.9 a saved explanation is a
// practice explanation, its own ungraded log entry beside the review event and never one.
// Additive at v6: a new `kind` literal, no schemaVersion bump, no v5 form (the precedent of the
// set-aside and feedback-shown kinds). Scenarios: `features/F5-explain-it-back.md` (olea-service),
// "D7.1 / [D-614] — a practice explanation is its own log entry", the three tagged
// `contracts/review-log-practice-explanation.spec`. What this file has to prove:
//
//   1. a distinct kind the v6 union discriminates, never a review; v5 never carried it; no grade,
//      rating, verdict, depth or correctness field, and a line carrying one is refused;
//   2. it carries what D7.1 names (concept, prompt shape, offer, duration, support shown, date,
//      contentRef), plus the attempt identity and the local check's flag, and no text survives a
//      parse (D-005);
//   3. a line round-trips byte for byte (INV-2), and a log written before the kind existed still
//      validates unchanged.
//
// Ids are structural placeholders (INV-3).
import { describe, expect, it } from 'vitest';
import {
  explainBackPromptShape,
  type PracticeExplanationLogRecordV6,
  practiceExplanationLogRecord,
  practiceExplanationLogRecordV6,
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV5,
  reviewLogRecordV6,
} from './review-log.js';

function practiceLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    kind: 'practice-explanation',
    eventId: 'practice-1',
    timestamp: '2026-10-23T10:15:00-04:00',
    instrumentId: 'explain-back:concept-a',
    attemptId: 'attempt-2',
    conceptIds: ['concept-a'],
    promptShape: 'concept',
    trigger: 'repeated-failure',
    offerEventId: 'offer-1',
    durationMs: 64000,
    supportLevelShown: 'guided',
    passageFingerprints: ['digest-1', 'digest-2'],
    contentRef: 'device-a.content-1',
    ...over,
  };
}

const provenance = { taskId: 'explain-back.judge.v1', promptVersion: '3', modelId: 'model-x' };

describe('a practice explanation is its own event kind, never a review event (D7.1, [D-614])', () => {
  it('parses at version 6, and the current union reads it as its own kind', () => {
    expect(practiceExplanationLogRecordV6.safeParse(practiceLine()).success).toBe(true);
    const parsed = reviewLogEntry.safeParse(practiceLine());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('practice-explanation');
  });

  it('is never a review: the review schema refuses it, and v5 never carried the kind', () => {
    expect(reviewLogRecordV6.safeParse(practiceLine()).success).toBe(false);
    expect(reviewLogRecordV6.safeParse(practiceLine({ kind: 'review' })).success).toBe(false);
    expect(reviewLogEntryV5.safeParse(practiceLine({ schemaVersion: 5 })).success).toBe(false);
  });

  it('is additive: the current schema version is still 6, and only version 6 parses', () => {
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(6);
    for (const schemaVersion of [1, 2, 3, 5, 7]) {
      expect(
        practiceExplanationLogRecordV6.safeParse(practiceLine({ schemaVersion })).success,
        String(schemaVersion),
      ).toBe(false);
    }
  });

  it('`practiceExplanationLogRecord` is the v6 alias', () => {
    expect(practiceExplanationLogRecord).toBe(practiceExplanationLogRecordV6);
  });

  it('has no grade, rating, verdict, depth or correctness field, and a line carrying any is refused', () => {
    const shapeKeys = Object.keys(practiceExplanationLogRecordV6.shape);
    const carried = new Set(
      Object.keys(practiceExplanationLogRecordV6.parse(practiceLine({ localCheckFlagged: true }))),
    );
    for (const key of [
      'rating',
      'grade',
      'explainBackGrade',
      'explainBackCorrectness',
      'correctness',
      'verdict',
      'outcome',
      'soloLevel',
      'depth',
    ]) {
      // Declared only as "must be absent": present in the shape, never in a parsed record.
      expect(shapeKeys, key).toContain(key);
      expect(carried.has(key), key).toBe(false);
    }
    const graded: Record<string, unknown>[] = [
      { rating: 'good' },
      { rating: null },
      { grade: 'pass' },
      { explainBackGrade: { soloLevel: 'relational', contentRef: 'c', revisionOf: null } },
      { explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance } },
      { correctness: { chosenIndex: 0, matchedKey: true } },
      { verdict: 'partial' },
      { outcome: { kind: 'graded', verdict: 'partial' } },
      { soloLevel: 'multistructural' },
      { depth: 'relational' },
    ];
    for (const extra of graded) {
      const label = Object.keys(extra)[0] ?? '';
      expect(practiceExplanationLogRecordV6.safeParse(practiceLine(extra)).success, label).toBe(
        false,
      );
      expect(reviewLogEntry.safeParse(practiceLine(extra)).success, `${label} (union)`).toBe(false);
    }
  });
});

describe('it records what D7.1 names, and her text only by reference', () => {
  it('carries the concept, prompt shape, offer, duration, support shown, date and contentRef', () => {
    const record = practiceExplanationLogRecordV6.parse(practiceLine());
    expect(record.conceptIds).toEqual(['concept-a']);
    expect(record.promptShape).toBe('concept');
    expect(record.trigger).toBe('repeated-failure');
    expect(record.offerEventId).toBe('offer-1');
    expect(record.durationMs).toBe(64000);
    expect(record.supportLevelShown).toBe('guided');
    expect(record.passageFingerprints).toEqual(['digest-1', 'digest-2']);
    expect(record.timestamp).toBe('2026-10-23T10:15:00-04:00');
    expect(record.contentRef).toBe('device-a.content-1');
    // The attempt identity the writer is idempotent on, and the [D-460] marker's join key.
    expect(record.instrumentId).toBe('explain-back:concept-a');
    expect(record.attemptId).toBe('attempt-2');
  });

  it('the prompt shape is a concept or a relation, and nothing else', () => {
    expect(explainBackPromptShape.options).toEqual(['concept', 'relation']);
    expect(
      practiceExplanationLogRecordV6.safeParse(
        practiceLine({ promptShape: 'relation', conceptIds: ['concept-a', 'concept-b'] }),
      ).success,
    ).toBe(true);
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ promptShape: 'topic' })).success,
    ).toBe(false);
  });

  it('requires the identity, the concept, the shape, the trigger, the duration key, the date and the contentRef', () => {
    for (const key of [
      'eventId',
      'timestamp',
      'instrumentId',
      'attemptId',
      'conceptIds',
      'promptShape',
      'trigger',
      'durationMs',
      'contentRef',
    ]) {
      const line: Record<string, unknown> = practiceLine();
      delete line[key];
      expect(practiceExplanationLogRecordV6.safeParse(line).success, key).toBe(false);
    }
    for (const key of ['eventId', 'instrumentId', 'attemptId', 'contentRef', 'offerEventId']) {
      expect(
        practiceExplanationLogRecordV6.safeParse(practiceLine({ [key]: '' })).success,
        `${key} empty`,
      ).toBe(false);
    }
    expect(practiceExplanationLogRecordV6.safeParse(practiceLine({ conceptIds: [] })).success).toBe(
      false,
    );
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ timestamp: '2026-10-23T10:15:00' }))
        .success,
    ).toBe(false);
    // `null` is the "nothing timed it" value, as on the review record.
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ durationMs: null })).success,
    ).toBe(true);
  });

  it('the offer reference follows [D-369]: absent on a self-initiated prompt, refused there', () => {
    const onDemand = practiceLine({ trigger: 'on-demand' });
    delete (onDemand as Record<string, unknown>).offerEventId;
    expect(practiceExplanationLogRecordV6.safeParse(onDemand).success).toBe(true);
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ trigger: 'on-demand' })).success,
    ).toBe(false);
    const noOffer: Record<string, unknown> = practiceLine();
    delete noOffer.offerEventId;
    expect(practiceExplanationLogRecordV6.safeParse(noOffer).success).toBe(true);
  });

  it('support shown: passages by digest beside guided only; guided alone is the coarser fact; absent is unknown', () => {
    const coarse: Record<string, unknown> = practiceLine();
    delete coarse.passageFingerprints;
    expect(practiceExplanationLogRecordV6.safeParse(coarse).success).toBe(true);

    const none: Record<string, unknown> = practiceLine({ supportLevelShown: 'independent' });
    delete none.passageFingerprints;
    expect(practiceExplanationLogRecordV6.safeParse(none).success).toBe(true);

    const unknown: Record<string, unknown> = practiceLine();
    delete unknown.supportLevelShown;
    delete unknown.passageFingerprints;
    expect(practiceExplanationLogRecordV6.safeParse(unknown).success).toBe(true);

    // A passage list beside a rung that says none was shown, or beside an unknown rung, contradicts it.
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ supportLevelShown: 'independent' }))
        .success,
    ).toBe(false);
    const listWithoutRung: Record<string, unknown> = practiceLine();
    delete listWithoutRung.supportLevelShown;
    expect(practiceExplanationLogRecordV6.safeParse(listWithoutRung).success).toBe(false);
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ passageFingerprints: [] })).success,
    ).toBe(false);
  });

  it("the local check's flag is one literal: true when flagged, absent otherwise", () => {
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ localCheckFlagged: true })).success,
    ).toBe(true);
    expect(
      practiceExplanationLogRecordV6.safeParse(practiceLine({ localCheckFlagged: false })).success,
    ).toBe(false);
    expect(practiceExplanationLogRecordV6.parse(practiceLine()).localCheckFlagged).toBeUndefined();
  });

  it('neither her text nor any passage text is on the record (D-005)', () => {
    const parsed = practiceExplanationLogRecordV6.parse(
      practiceLine({
        answer: 'synthetic answer text',
        studentAnswer: 'synthetic answer text',
        text: 'synthetic answer text',
        passages: ['synthetic passage'],
        sourceBlocks: [{ blockId: 'b', text: 'synthetic passage' }],
        reflectionPrompts: ['synthetic prompt'],
        feedback: 'synthetic feedback',
      }),
    );
    const keys: (keyof PracticeExplanationLogRecordV6)[] = [
      'schemaVersion',
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'attemptId',
      'conceptIds',
      'promptShape',
      'trigger',
      'offerEventId',
      'durationMs',
      'supportLevelShown',
      'passageFingerprints',
      'contentRef',
    ];
    expect(Object.keys(parsed).sort()).toEqual([...keys].sort());
    expect(JSON.stringify(parsed)).not.toContain('synthetic');
  });
});

describe('it round-trips, and logs written before it existed still validate', () => {
  it('a practice explanation line round-trips byte for byte, in every support form', () => {
    const coarse: Record<string, unknown> = practiceLine({ localCheckFlagged: true });
    delete coarse.passageFingerprints;
    const onDemand: Record<string, unknown> = practiceLine({
      trigger: 'on-demand',
      promptShape: 'relation',
      conceptIds: ['concept-a', 'concept-b'],
      durationMs: null,
      supportLevelShown: 'independent',
    });
    delete onDemand.offerEventId;
    delete onDemand.passageFingerprints;
    for (const line of [practiceLine(), coarse, onDemand]) {
      const text = JSON.stringify(line);
      expect(JSON.stringify(practiceExplanationLogRecordV6.parse(JSON.parse(text)))).toBe(text);
      expect(JSON.stringify(reviewLogEntry.parse(JSON.parse(text)))).toBe(text);
    }
  });

  it('a log written before the kind existed validates and reads back unchanged', () => {
    const before = [
      {
        schemaVersion: 6,
        kind: 'review',
        eventId: 'review-1',
        timestamp: '2026-10-01T09:00:00-04:00',
        instrumentId: 'qa:concept-a:1',
        instrumentType: 'qa',
        rating: 'good',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
        conceptIds: ['concept-a'],
      },
      {
        schemaVersion: 6,
        kind: 'non-attempt',
        eventId: 'non-attempt-1',
        timestamp: '2026-10-01T09:05:00-04:00',
        conceptIds: ['concept-a'],
        trigger: 'on-demand',
      },
      {
        schemaVersion: 6,
        kind: 'explain-back-feedback-shown',
        eventId: 'marker-1',
        timestamp: '2026-10-01T09:10:00-04:00',
        instrumentId: 'explain-back:concept-a',
        attemptId: 'attempt-1',
      },
      {
        schemaVersion: 5,
        kind: 'suspend',
        eventId: 'suspend-1',
        timestamp: '2026-09-01T09:00:00-04:00',
        instrumentId: 'qa:concept-a:1',
        conceptIds: ['concept-a'],
      },
    ];
    for (const line of before) {
      const text = JSON.stringify(line);
      const schema = line.schemaVersion === 5 ? reviewLogEntryV5 : reviewLogEntry;
      const parsed = schema.safeParse(JSON.parse(text));
      expect(parsed.success, line.kind).toBe(true);
      if (parsed.success) expect(JSON.stringify(parsed.data), line.kind).toBe(text);
    }
  });
});
