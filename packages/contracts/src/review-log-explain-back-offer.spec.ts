// `[D-178 / LOG-3]` item 2 (`ol-3ux7.5.6`, `ol-0r92.13`): the explain-back-offer
// event, additive to the v5 discriminated union the same way
// `retrospectiveOfferLogRecordV5` is — one shape spanning two `kind` literals,
// no schemaVersion bump for this kind's own arrival, same reasoning
// `review-log-succession.spec.ts` states for its own kind. What this file has
// to prove:
//
//   1. `reviewLogEntry` discriminates the new kinds alongside every other one;
//   2. `kind` is required, never defaulted or inferred;
//   3. the pairing rule: an `explain-back-offered` record carries neither
//      `answers` nor `manner`, and an `explain-back-declined` one carries both
//      — never half a pair;
//   4. `conceptIds` is non-empty, the same invariant every other concept-
//      bearing kind in this file enforces;
//   5. there is no third `accepted` literal, and no reason field of any kind.
import { describe, expect, it } from 'vitest';
import {
  explainBackDeclineManner,
  explainBackOfferEventKind,
  explainBackOfferLogRecord,
  explainBackOfferLogRecordV5,
  explainBackOfferTrigger,
  reviewLogEntry,
} from './review-log.js';

function offeredLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'explain-back-offered',
    eventId: 'offer-1',
    timestamp: '2026-09-02T09:00:00-04:00',
    conceptIds: ['concept-prov1:Imbrication'],
    trigger: 'repeated-failure',
    instrumentId: 'explain-back:imbrication:1',
    ...over,
  };
}

function declinedLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'explain-back-declined',
    eventId: 'decline-1',
    timestamp: '2026-09-02T09:05:00-04:00',
    conceptIds: ['concept-prov1:Imbrication'],
    trigger: 'repeated-failure',
    instrumentId: 'explain-back:imbrication:1',
    answers: 'offer-1',
    manner: 'not-taken',
    ...over,
  };
}

describe('explainBackOfferEventKind / explainBackOfferTrigger / explainBackDeclineManner', () => {
  it('the event kind is exactly the two literals', () => {
    expect(explainBackOfferEventKind.options).toEqual([
      'explain-back-offered',
      'explain-back-declined',
    ]);
  });

  it('the trigger names all four routes: F2.12, F2.14a, her own request, and F5.3a', () => {
    expect(explainBackOfferTrigger.options).toEqual([
      'repeated-failure',
      'strong-recall-proposal',
      'on-demand',
      'scheduling-observation',
    ]);
  });

  it('the decline manner has no third value — `dismissed` is reserved, not built', () => {
    expect(explainBackDeclineManner.options).toEqual(['dismissed', 'not-taken']);
  });
});

describe('explainBackOfferLogRecordV5', () => {
  it('parses a well-formed offered line', () => {
    expect(explainBackOfferLogRecordV5.safeParse(offeredLine()).success).toBe(true);
  });

  it('parses a well-formed declined line', () => {
    expect(explainBackOfferLogRecordV5.safeParse(declinedLine()).success).toBe(true);
  });

  it('requires `kind` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = offeredLine();
    expect(explainBackOfferLogRecordV5.safeParse(rest).success).toBe(false);
  });

  it('rejects a `kind` outside the two literals — no third "accepted" value', () => {
    expect(explainBackOfferLogRecordV5.safeParse(offeredLine({ kind: 'accepted' })).success).toBe(
      false,
    );
  });

  it('rejects a missing or empty conceptIds', () => {
    const { conceptIds: _drop, ...rest } = offeredLine();
    expect(explainBackOfferLogRecordV5.safeParse(rest).success).toBe(false);
    expect(explainBackOfferLogRecordV5.safeParse(offeredLine({ conceptIds: [] })).success).toBe(
      false,
    );
  });

  it('instrumentId is optional — present for F2.12 routing, absent for an on-demand request', () => {
    const { instrumentId: _drop, ...rest } = offeredLine({ trigger: 'on-demand' });
    expect(explainBackOfferLogRecordV5.safeParse(rest).success).toBe(true);
  });

  describe('the offered/declined pairing (modelled on disputeLogRecordV5’s resolves/outcome)', () => {
    it('an offered record carries neither `answers` nor `manner`', () => {
      expect(explainBackOfferLogRecordV5.safeParse(offeredLine()).success).toBe(true);
      expect(
        explainBackOfferLogRecordV5.safeParse(offeredLine({ answers: 'offer-1' })).success,
      ).toBe(false);
      expect(
        explainBackOfferLogRecordV5.safeParse(offeredLine({ manner: 'not-taken' })).success,
      ).toBe(false);
    });

    it('a declined record carries both `answers` and `manner` — half the pair is refused', () => {
      expect(explainBackOfferLogRecordV5.safeParse(declinedLine()).success).toBe(true);
      const { answers: _drop, ...missingAnswers } = declinedLine();
      expect(explainBackOfferLogRecordV5.safeParse(missingAnswers).success).toBe(false);
      const { manner: _drop2, ...missingManner } = declinedLine();
      expect(explainBackOfferLogRecordV5.safeParse(missingManner).success).toBe(false);
    });

    it('`answers` must be non-empty when present', () => {
      expect(explainBackOfferLogRecordV5.safeParse(declinedLine({ answers: '' })).success).toBe(
        false,
      );
    });
  });

  it('carries no reason field of any kind (D-005 / `[D-095]`’s same restraint)', () => {
    const parsed = explainBackOfferLogRecordV5.parse(declinedLine());
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'schemaVersion',
        'kind',
        'eventId',
        'timestamp',
        'conceptIds',
        'trigger',
        'instrumentId',
        'answers',
        'manner',
      ].sort(),
    );
  });

  it('`explainBackOfferLogRecord` is the v5 alias', () => {
    expect(explainBackOfferLogRecord).toBe(explainBackOfferLogRecordV5);
  });
});

// `[D-204 / LOG-4]` (`ol-egov.95`, `ol-0r92.25`): F5.3a's reciprocal prompt
// (the scheduling-observation trigger, `ol-0r92.11`) gets its own literal
// rather than reusing one of the three `[D-178]` triggers — additive on v5,
// no `schemaVersion` bump, same reasoning `[D-178]` applied when the field
// itself was introduced.
describe('scheduling-observation trigger (`[D-204 / LOG-4]`)', () => {
  it('an explain-back-offered record with the fourth trigger validates under v5, no schemaVersion bump', () => {
    const parsed = explainBackOfferLogRecordV5.safeParse(
      offeredLine({ trigger: 'scheduling-observation', conceptIds: ['concept-neighbour1'] }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.schemaVersion).toBe(5);
  });

  it('the paired decline also validates with the fourth trigger', () => {
    expect(
      explainBackOfferLogRecordV5.safeParse(
        declinedLine({ trigger: 'scheduling-observation', conceptIds: ['concept-neighbour1'] }),
      ).success,
    ).toBe(true);
  });

  it('an unknown trigger literal still fails', () => {
    expect(
      explainBackOfferLogRecordV5.safeParse(offeredLine({ trigger: 'neighbour-hint' })).success,
    ).toBe(false);
  });
});

describe('reviewLogEntry discriminates the explain-back-offer kinds alongside every other one', () => {
  it('parses both offered and declined lines as members of the current union', () => {
    expect(reviewLogEntry.safeParse(offeredLine()).success).toBe(true);
    expect(reviewLogEntry.safeParse(declinedLine()).success).toBe(true);
  });

  it('a declined line without its pairing fields fails the union the same way it fails the record', () => {
    const { answers: _drop, ...missingAnswers } = declinedLine();
    expect(reviewLogEntry.safeParse(missingAnswers).success).toBe(false);
  });
});
