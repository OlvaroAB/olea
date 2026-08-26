// PERMANENT SUITE (D-020, INV-4). The review log cannot be backfilled, so the
// properties asserted here are not "does zod work" trivia — they are the
// guarantees every reader of a semester of history depends on:
//
//   1. v1 stays exactly the shape it was frozen as, and does NOT accidentally
//      accept a v2 line (or vice versa);
//   2. the v2 `kind` discriminator is REQUIRED, never defaulted;
//   3. the discriminated union really discriminates all three kinds —
//      `review`, `suspend`, AND `unsuspend` — which is the one thing that had
//      to be proven rather than assumed, because `suspendLogRecord`'s
//      discriminator is a two-member `z.enum` rather than a `z.literal`, and
//      only zod v4 accepts that in `z.discriminatedUnion`.
//
// If (3) ever regresses, the fallback is `z.union` plus an explicit `kind`
// check — but silently falling back is what these tests exist to prevent.
import { describe, expect, it } from 'vitest';
import {
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntryV2,
  reviewLogRecord,
  reviewLogRecordV1,
  reviewLogRecordV2,
  reviewLogRecordV3,
  reviewLogRecordV5,
  suspendLogRecordV2,
} from './review-log.js';

const SELECTION_CONTEXT = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  masteryAtTime: 'sprout',
  instrumentTypesOffered: ['qa'],
  planVersion: null,
} as const;

function v1Line(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptId: 'imbrication',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: SELECTION_CONTEXT,
    ...over,
  };
}

function v2ReviewLine(over: Record<string, unknown> = {}) {
  return { ...v1Line(), schemaVersion: 2, kind: 'review', ...over };
}

function suspendLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    conceptId: 'imbrication',
    ...over,
  };
}

describe('review-log schema versions', () => {
  it('the current version writers stamp is 5, and v2 is no longer it', () => {
    // Retargeted by `ol-t3sd`, `ol-g6zg` and again by `ol-tka5`, not deleted:
    // the assertion "writers stamp the newest version" is the one that had to
    // keep holding across each bump. Every v1/v2 shape assertion below is
    // untouched — they test frozen schemas by name, which is why they did not
    // have to move.
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(5);
  });

  it('v1 is unchanged: it still accepts a v1 line with no kind at all', () => {
    expect(reviewLogRecordV1.safeParse(v1Line()).success).toBe(true);
  });

  it('v1 rejects a v2 line and v2 rejects a v1 line — versions never silently cross', () => {
    // This is what makes "read the version first, never guess" enforceable: a
    // reader that guessed wrong gets a validation failure, not a half-parsed
    // record.
    expect(reviewLogRecordV1.safeParse(v2ReviewLine()).success).toBe(false);
    expect(reviewLogRecordV2.safeParse(v1Line()).success).toBe(false);
  });

  it('v2 is v1 plus exactly one key, `kind` — no field was dropped in the bump', () => {
    const v1Keys = Object.keys(reviewLogRecordV1.shape).sort();
    const v2Keys = Object.keys(reviewLogRecordV2.shape).sort();
    expect(v2Keys).toEqual([...v1Keys, 'kind'].sort());
  });

  it('`reviewLogRecord` aliases the current review version, not a frozen one', () => {
    expect(reviewLogRecord).toBe(reviewLogRecordV5);
    expect(reviewLogRecord).not.toBe(reviewLogRecordV1);
    expect(reviewLogRecord).not.toBe(reviewLogRecordV2);
    expect(reviewLogRecord).not.toBe(reviewLogRecordV3);
  });
});

describe('v2 `kind` is required, never defaulted', () => {
  it('a v2 review line with kind omitted is rejected outright', () => {
    const { kind: _dropped, ...noKind } = v2ReviewLine();
    expect(reviewLogRecordV2.safeParse(noKind).success).toBe(false);
    // And through the union too — this is the case a defaulted discriminator
    // would have quietly accepted as a review.
    expect(reviewLogEntryV2.safeParse(noKind).success).toBe(false);
  });

  it('a suspend line with kind omitted is rejected outright', () => {
    const { kind: _dropped, ...noKind } = suspendLine();
    expect(suspendLogRecordV2.safeParse(noKind).success).toBe(false);
    expect(reviewLogEntryV2.safeParse(noKind).success).toBe(false);
  });
});

describe('the suspend record carries what it needs and nothing it does not', () => {
  it('accepts both suspend and unsuspend', () => {
    expect(suspendLogRecordV2.safeParse(suspendLine()).success).toBe(true);
    expect(suspendLogRecordV2.safeParse(suspendLine({ kind: 'unsuspend' })).success).toBe(true);
  });

  it('rejects any other kind', () => {
    expect(suspendLogRecordV2.safeParse(suspendLine({ kind: 'review' })).success).toBe(false);
    expect(suspendLogRecordV2.safeParse(suspendLine({ kind: 'pause' })).success).toBe(false);
  });

  it('carries conceptId — the instrument→concept binding at event time (INV-4)', () => {
    const { conceptId: _dropped, ...noConcept } = suspendLine();
    expect(suspendLogRecordV2.safeParse(noConcept).success).toBe(false);
  });

  it('has no review-only fields, and no speculative `reason` or `deviceId`', () => {
    // A schema-level assertion, not a comment: if someone later widens the
    // suspend record into a review-shaped one with everything nulled out, or
    // adds a persisted field the contract does not name, this fails.
    expect(Object.keys(suspendLogRecordV2.shape).sort()).toEqual([
      'conceptId',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
  });

  it('strips, rather than persists, review fields handed to it by mistake', () => {
    const parsed = suspendLogRecordV2.parse({ ...suspendLine(), rating: 'good', durationMs: 10 });
    expect(parsed).not.toHaveProperty('rating');
    expect(parsed).not.toHaveProperty('durationMs');
  });
});

describe('the v2 union discriminates every kind (zod v4 enum discriminator)', () => {
  it('routes a review line to the review shape', () => {
    const parsed = reviewLogEntryV2.parse(v2ReviewLine());
    expect(parsed.kind).toBe('review');
    // Narrowing works at the type level too, not just at runtime.
    if (parsed.kind !== 'review') throw new Error('expected a review entry');
    expect(parsed.rating).toBe('good');
  });

  it('routes a suspend line to the suspend shape', () => {
    const parsed = reviewLogEntryV2.parse(suspendLine());
    expect(parsed.kind).toBe('suspend');
    if (parsed.kind === 'review') throw new Error('expected a suspension entry');
    expect(parsed.instrumentId).toBe('qa:imbrication:1');
    expect(parsed).not.toHaveProperty('selectionContext');
  });

  it('routes an unsuspend line to the suspend shape — the second enum member, the one at risk', () => {
    // `suspendLogRecord`'s discriminator is `z.enum(['suspend','unsuspend'])`.
    // A discriminated union that only registered the enum's FIRST member would
    // pass every other test in this file and fail exactly here.
    const parsed = reviewLogEntryV2.parse(suspendLine({ kind: 'unsuspend', eventId: 'u1' }));
    expect(parsed.kind).toBe('unsuspend');
    if (parsed.kind === 'review') throw new Error('expected a suspension entry');
    expect(parsed.eventId).toBe('u1');
  });

  it('rejects an unknown kind rather than falling through to a member shape', () => {
    expect(reviewLogEntryV2.safeParse(suspendLine({ kind: 'archived' })).success).toBe(false);
  });

  it('rejects a v1 line — v1 is deliberately not a member of the v2 union', () => {
    expect(reviewLogEntryV2.safeParse(v1Line()).success).toBe(false);
  });

  it('validates the whole member shape, not just the discriminator', () => {
    expect(reviewLogEntryV2.safeParse(suspendLine({ instrumentId: '' })).success).toBe(false);
    expect(reviewLogEntryV2.safeParse(v2ReviewLine({ rating: 'brilliant' })).success).toBe(false);
  });
});
