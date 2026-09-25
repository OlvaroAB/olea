import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  DECLARED_RECENT_OBSERVATION_WINDOW_DAYS,
  findComparableObservationDisagreements,
} from './tiebreak.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:widget-theory:1',
    instrumentType: 'qa',
    conceptIds: ['widget-theory'],
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
    ...overrides,
  };
}

const ASOF = '2026-08-15';
const SAME_SOURCE = () => 'rev-1';

describe('findComparableObservationDisagreements', () => {
  it('returns nothing for an empty log', () => {
    expect(findComparableObservationDisagreements({ entries: [], asOf: ASOF }).size).toBe(0);
  });

  it('flags a concept whose two most recent comparable observations disagree, when a source-version resolver is supplied', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    const result = findComparableObservationDisagreements({
      entries,
      asOf: ASOF,
      resolveSourceVersion: SAME_SOURCE,
    });

    const disagreement = result.get('widget-theory');
    expect(disagreement).toBeDefined();
    expect([...(disagreement?.disagreeingInstrumentIds ?? [])]).toEqual(['qa:widget-theory:1']);
  });

  it('never flags anything when `resolveSourceVersion` is omitted — the documented reachability gap', () => {
    // Same entries as the positive case above, WITHOUT a source-version
    // resolver — source version is one of the clause's four required
    // comparability facts and nothing in the review log carries it, so this
    // must stay empty until a real producer is wired (module doc).
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(findComparableObservationDisagreements({ entries, asOf: ASOF }).size).toBe(0);
  });

  it('does not flag when the shown support level is unrecorded on either observation — unknown is never comparable', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ eventId: 'r1', timestamp: '2026-08-08T09:00:00-04:00', rating: 'good' }), // no supportLevelShown
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it("does not flag when the two observations differ in tier (e.g. mcq vs qa) — a different-tier split is never a conflict (C5.10's own example)", () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'mcq:widget-theory:1',
        instrumentType: 'mcq',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it('does not flag when the two most recent comparable observations agree', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it('a lone failure several observations back does not flag today\'s tidy pair — "two successes and a failure" is consistent with any probabilistic recall model (C5.10\'s own words)', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-01T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r3',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
    ];

    // Only the two MOST RECENT (r2, r3) are compared — both successes — so
    // the older failure (r1) never re-enters as a manufactured disagreement.
    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it(`does not flag when the second-most-recent observation falls outside the ${DECLARED_RECENT_OBSERVATION_WINDOW_DAYS}-day recency window`, () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-07-01T09:00:00-04:00', // well over the window before asOf
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it('does not flag a concept with only one qualifying observation', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it('ignores explain-back reviews entirely — never FSRS-scheduled, never a "recall observation"', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'explain-back:widget-theory:1',
        instrumentType: 'explain-back',
        rating: null,
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'explain-back:widget-theory:1',
        instrumentType: 'explain-back',
        rating: null,
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: SAME_SOURCE,
      }).size,
    ).toBe(0);
  });

  it('keeps two concepts independent — a disagreement on one never touches the other', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        conceptIds: ['widget-theory'],
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        conceptIds: ['widget-theory'],
        rating: 'again',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r3',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'qa:gadget-theory:1',
        conceptIds: ['gadget-theory'],
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r4',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'qa:gadget-theory:1',
        conceptIds: ['gadget-theory'],
        rating: 'good',
        supportLevelShown: 'independent',
      }),
    ];

    const result = findComparableObservationDisagreements({
      entries,
      asOf: ASOF,
      resolveSourceVersion: SAME_SOURCE,
    });

    expect(result.has('widget-theory')).toBe(true);
    expect(result.has('gadget-theory')).toBe(false);
  });

  it('does not flag when the resolved source version differs between the two observations — a source change explains the split', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:2',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    const versionByInstrument: Readonly<Record<string, string>> = {
      'qa:widget-theory:1': 'rev-1',
      'qa:widget-theory:2': 'rev-2',
    };

    const result = findComparableObservationDisagreements({
      entries,
      asOf: ASOF,
      resolveSourceVersion: (instrumentId) => versionByInstrument[instrumentId],
    });

    expect(result.size).toBe(0);
  });

  it('does not flag when the source-version resolver returns undefined for an instrument it does not know', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        eventId: 'r1',
        timestamp: '2026-08-08T09:00:00-04:00',
        rating: 'good',
        supportLevelShown: 'independent',
      }),
      review({
        eventId: 'r2',
        timestamp: '2026-08-12T09:00:00-04:00',
        rating: 'again',
        supportLevelShown: 'independent',
      }),
    ];

    expect(
      findComparableObservationDisagreements({
        entries,
        asOf: ASOF,
        resolveSourceVersion: () => undefined,
      }).size,
    ).toBe(0);
  });
});
