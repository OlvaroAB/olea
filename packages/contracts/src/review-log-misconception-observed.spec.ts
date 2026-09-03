// `[D-202]` (`ol-egov.92`, ruled 2026-09-03; build bead `ol-0r92.44`): a wrong
// MCQ pick appends a `misconception-observed` event, additive to the v5
// discriminated union the same way `review-log-explain-back-offer.spec.ts`
// proves `explainBackOfferLogRecordV5` is — one new `kind` literal, no
// `schemaVersion` bump. What this file has to prove:
//
//   1. `reviewLogEntry` discriminates the new kind alongside every other one;
//   2. `kind` and every other field are required, never defaulted;
//   3. the distractor provenance is `{ text, believes, source_says }`, all
//      three non-empty, field-for-field the generation-time shape;
//   4. `misconceptionId` and `reviewEventId` are plain non-empty strings —
//      this schema encodes no matching/aggregation key, only the mint and
//      the pairing pointer (`ol-pjs7`'s aggregation is a read-time concern);
//   5. `conceptIds` is non-empty, the same invariant every other concept-
//      bearing kind in this file enforces;
//   6. there is no field this record could carry that would let content
//      beyond the one chosen distractor leak in (D-005).
import { describe, expect, it } from 'vitest';
import {
  mcqMisconceptionProvenance,
  misconceptionObservedLogRecord,
  misconceptionObservedLogRecordV5,
  reviewLogEntry,
} from './review-log.js';

function observedLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'misconception-observed',
    eventId: 'misc-observed-1',
    timestamp: '2026-09-03T09:00:00-04:00',
    instrumentId: 'mcq:imbrication:1',
    conceptIds: ['concept-prov1:Imbrication'],
    reviewEventId: 'review-1',
    misconceptionId: 'misconception-1',
    distractor: {
      text: 'a plausible wrong option',
      believes: 'she believes the wrong thing this option encodes',
      source_says: 'what the source material actually says instead',
    },
    ...over,
  };
}

describe('mcqMisconceptionProvenance', () => {
  it('parses a well-formed { text, believes, source_says } object', () => {
    expect(
      mcqMisconceptionProvenance.safeParse({
        text: 'x',
        believes: 'y',
        source_says: 'z',
      }).success,
    ).toBe(true);
  });

  it.each(['text', 'believes', 'source_says'])('rejects an empty %s', (field) => {
    expect(
      mcqMisconceptionProvenance.safeParse({
        text: 'x',
        believes: 'y',
        source_says: 'z',
        [field]: '',
      }).success,
    ).toBe(false);
  });

  it.each(['text', 'believes', 'source_says'])('rejects a missing %s', (field) => {
    const full = { text: 'x', believes: 'y', source_says: 'z' } as Record<string, string>;
    delete full[field];
    expect(mcqMisconceptionProvenance.safeParse(full).success).toBe(false);
  });
});

describe('misconceptionObservedLogRecordV5', () => {
  it('parses a well-formed line', () => {
    expect(misconceptionObservedLogRecordV5.safeParse(observedLine()).success).toBe(true);
  });

  it('requires `kind` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = observedLine();
    expect(misconceptionObservedLogRecordV5.safeParse(rest).success).toBe(false);
  });

  it('rejects a `kind` outside the one literal', () => {
    expect(
      misconceptionObservedLogRecordV5.safeParse(observedLine({ kind: 'observed' })).success,
    ).toBe(false);
  });

  it('rejects a missing or empty conceptIds', () => {
    const { conceptIds: _drop, ...rest } = observedLine();
    expect(misconceptionObservedLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      misconceptionObservedLogRecordV5.safeParse(observedLine({ conceptIds: [] })).success,
    ).toBe(false);
  });

  it('requires `reviewEventId` — the pointer to the paired review record', () => {
    const { reviewEventId: _drop, ...rest } = observedLine();
    expect(misconceptionObservedLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      misconceptionObservedLogRecordV5.safeParse(observedLine({ reviewEventId: '' })).success,
    ).toBe(false);
  });

  it('requires `misconceptionId` — non-empty, no shape opinion beyond that', () => {
    const { misconceptionId: _drop, ...rest } = observedLine();
    expect(misconceptionObservedLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      misconceptionObservedLogRecordV5.safeParse(observedLine({ misconceptionId: '' })).success,
    ).toBe(false);
  });

  it('requires `distractor`, and it must be a full provenance object', () => {
    const { distractor: _drop, ...rest } = observedLine();
    expect(misconceptionObservedLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      misconceptionObservedLogRecordV5.safeParse(
        observedLine({ distractor: { text: 'x', believes: 'y' } }),
      ).success,
    ).toBe(false);
  });

  it('carries exactly these fields — no room for content beyond the one distractor (D-005)', () => {
    const parsed = misconceptionObservedLogRecordV5.parse(observedLine());
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'schemaVersion',
        'kind',
        'eventId',
        'timestamp',
        'instrumentId',
        'conceptIds',
        'reviewEventId',
        'misconceptionId',
        'distractor',
      ].sort(),
    );
  });

  it('`misconceptionObservedLogRecord` is the v5 alias', () => {
    expect(misconceptionObservedLogRecord).toBe(misconceptionObservedLogRecordV5);
  });
});

describe('reviewLogEntry discriminates misconception-observed alongside every other kind', () => {
  it('parses an observed line as a member of the current union', () => {
    expect(reviewLogEntry.safeParse(observedLine()).success).toBe(true);
  });

  it('a line missing its distractor fails the union the same way it fails the record', () => {
    const { distractor: _drop, ...rest } = observedLine();
    expect(reviewLogEntry.safeParse(rest).success).toBe(false);
  });
});
