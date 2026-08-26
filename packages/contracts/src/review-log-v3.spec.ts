// PERMANENT SUITE (D-031 successor `ol-t3sd`, INV-4). Schema version 3 — one
// instrument may be evidence for **every** concept its note names.
//
// This file is the v3 half of `review-log.spec.ts`, kept separate so that
// file's v1/v2 assertions stay visibly untouched: v1 and v2 are frozen shapes
// and every guarantee they carried is still asserted there, against the
// versioned schema objects rather than against the moving `reviewLogRecord`
// alias.
//
// What v3 has to prove, and none of it is "does zod work" trivia:
//
//   1. v3 is v2 with `conceptId` replaced by a non-empty `conceptIds` array —
//      no other field moved, appeared or vanished;
//   2. the three versions never silently cross: a v2 line does not validate as
//      v3 and a v3 line does not validate as v2, so "read the version first,
//      never guess" stays enforceable rather than aspirational;
//   3. `conceptIds` is `.min(1)` — an empty list is a record that says nothing
//      about what she practised, which is exactly the un-backfillable hole
//      INV-4 exists to prevent;
//   4. the suspend record gets the same treatment, for the reason its own doc
//      gives: the binding is captured at event time because it is not
//      reconstructible later.
import { describe, expect, it } from 'vitest';
import {
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV2,
  reviewLogEntryV3,
  reviewLogRecord,
  reviewLogRecordV2,
  reviewLogRecordV3,
  suspendLogRecord,
  suspendLogRecordV2,
  suspendLogRecordV3,
} from './review-log.js';

const SELECTION_CONTEXT = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  masteryAtTime: 'sprout',
  instrumentTypesOffered: ['qa'],
  planVersion: null,
} as const;

function v2ReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    kind: 'review',
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

function v3ReviewLine(over: Record<string, unknown> = {}) {
  const { conceptId: _dropped, ...rest } = v2ReviewLine();
  return { ...rest, schemaVersion: 3, conceptIds: ['imbrication'], ...over };
}

function v2SuspendLine(over: Record<string, unknown> = {}) {
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

function v3SuspendLine(over: Record<string, unknown> = {}) {
  const { conceptId: _dropped, ...rest } = v2SuspendLine();
  return { ...rest, schemaVersion: 3, conceptIds: ['imbrication'], ...over };
}

describe('review-log schema version 3 is frozen, and is no longer the current one', () => {
  // Retargeted by `ol-g6zg`, not deleted, and the distinction is the same one
  // this file's header draws: the assertions about v3's *shape* below are
  // untouched, because a v3 record on disk keeps the meaning v3 gave it. Only
  // the two assertions that said "v3 is what writers stamp" had to move, and
  // they were assertions about which version was current rather than about v3.
  it('the version writers stamp has moved past 3', () => {
    // Retargeted again by `ol-tka5` (v5) — the assertion is about "moved past
    // 3", not about which later version is current.
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(5);
  });

  it('the current aliases no longer point at the v3 shapes', () => {
    expect(reviewLogRecord).not.toBe(reviewLogRecordV3);
    expect(suspendLogRecord).not.toBe(suspendLogRecordV3);
  });

  it('but the v3 schemas are still here, still exported, and still parse a v3 line', () => {
    // The whole reason a frozen version stays in this file: a semester of v3
    // history in her vault has to keep parsing against the shape that wrote it.
    expect(reviewLogRecordV3.safeParse(v3ReviewLine()).success).toBe(true);
    expect(suspendLogRecordV3.safeParse(v3SuspendLine()).success).toBe(true);
  });
});

describe('v3 is v2 with conceptId replaced by conceptIds — nothing else moved', () => {
  it('the key sets differ in exactly that one swap', () => {
    const v2Keys = Object.keys(reviewLogRecordV2.shape).sort();
    const v3Keys = Object.keys(reviewLogRecordV3.shape).sort();
    expect(v3Keys).toEqual([...v2Keys.filter((k) => k !== 'conceptId'), 'conceptIds'].sort());
  });

  it('the suspend record makes the same one swap and gains nothing else', () => {
    expect(Object.keys(suspendLogRecordV3.shape).sort()).toEqual([
      'conceptIds',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
  });

  it('emits its keys in one fixed order, whatever order the input arrived in', () => {
    // Load-bearing, not cosmetic: `merge.ts` compares duplicate `eventId`s by
    // their serialised form, so a record reaching one device through the
    // migration and another natively must serialise byte-identically. That
    // only holds if every v3 record goes through this one schema, and this
    // pins the order it emits.
    const shuffled = {
      conceptIds: ['imbrication'],
      selectionContext: SELECTION_CONTEXT,
      kind: 'review',
      schemaVersion: 3,
      durationMs: 1200,
      wasUnsure: false,
      rating: 'good',
      instrumentType: 'qa',
      instrumentId: 'qa:imbrication:1',
      timestamp: '2026-08-10T09:00:00-04:00',
      eventId: 'e1',
    };
    expect(Object.keys(reviewLogRecordV3.parse(shuffled))).toEqual([
      'schemaVersion',
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'instrumentType',
      'rating',
      'wasUnsure',
      'durationMs',
      'selectionContext',
      'conceptIds',
    ]);
  });
});

describe('the three versions never silently cross', () => {
  it('v3 rejects a v2 line and v2 rejects a v3 line', () => {
    expect(reviewLogRecordV3.safeParse(v2ReviewLine()).success).toBe(false);
    expect(reviewLogRecordV2.safeParse(v3ReviewLine()).success).toBe(false);
  });

  it('the v2 union still parses v2 lines, and refuses v3 ones', () => {
    // A device still on the old build must not reinterpret a v3 line as v2,
    // and a v3 reader must not reinterpret a v2 line — both directions are
    // how a semester of history acquires two meanings.
    expect(reviewLogEntryV2.safeParse(v2ReviewLine()).success).toBe(true);
    expect(reviewLogEntryV2.safeParse(v2SuspendLine()).success).toBe(true);
    expect(reviewLogEntryV2.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogEntryV2.safeParse(v3SuspendLine()).success).toBe(false);
  });

  it('the v3 union parses v3 lines of every kind, and refuses v2 ones', () => {
    // Retargeted from `reviewLogEntry` to `reviewLogEntryV3` by `ol-g6zg` for
    // the reason above: the alias moved to v4, and this assertion was always
    // about v3's union rather than about whichever union is current.
    expect(reviewLogEntryV3.safeParse(v3ReviewLine()).success).toBe(true);
    expect(reviewLogEntryV3.safeParse(v3SuspendLine()).success).toBe(true);
    expect(reviewLogEntryV3.safeParse(v3SuspendLine({ kind: 'unsuspend' })).success).toBe(true);
    expect(reviewLogEntryV3.safeParse(v2ReviewLine()).success).toBe(false);
    expect(reviewLogEntryV3.safeParse(v2SuspendLine()).success).toBe(false);
  });

  it('and the current union refuses a v3 line outright — a v3 record is never read as v4', () => {
    // The direction that matters most for `ol-g6zg`: a v3 line's mastery value
    // sits inside `selectionContext` and means something a v4 reader would get
    // wrong. It goes through `upgradeV3` or it goes nowhere.
    expect(reviewLogEntry.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogEntry.safeParse(v3SuspendLine()).success).toBe(false);
  });
});

describe('conceptIds says at least one thing, and every entry is a real id', () => {
  it('accepts several concepts — the whole point of the version bump', () => {
    const parsed = reviewLogRecordV3.parse(v3ReviewLine({ conceptIds: ['alpha', 'beta'] }));
    expect(parsed.conceptIds).toEqual(['alpha', 'beta']);
  });

  it('rejects an empty list — a record that names no concept answers nothing later', () => {
    expect(reviewLogRecordV3.safeParse(v3ReviewLine({ conceptIds: [] })).success).toBe(false);
    expect(suspendLogRecordV3.safeParse(v3SuspendLine({ conceptIds: [] })).success).toBe(false);
  });

  it('rejects an empty string inside the list, exactly as v2 rejected an empty conceptId', () => {
    expect(reviewLogRecordV3.safeParse(v3ReviewLine({ conceptIds: [''] })).success).toBe(false);
    expect(reviewLogRecordV3.safeParse(v3ReviewLine({ conceptIds: ['a', ''] })).success).toBe(
      false,
    );
  });

  it('rejects the field missing outright (INV-4: the binding is captured or it is gone)', () => {
    const { conceptIds: _dropped, ...noConcepts } = v3ReviewLine();
    expect(reviewLogRecordV3.safeParse(noConcepts).success).toBe(false);
    const { conceptIds: _alsoDropped, ...noSuspendConcepts } = v3SuspendLine();
    expect(suspendLogRecordV3.safeParse(noSuspendConcepts).success).toBe(false);
  });

  it('does not accept a bare string where a list is required — no silent widening', () => {
    expect(reviewLogRecordV3.safeParse(v3ReviewLine({ conceptIds: 'imbrication' })).success).toBe(
      false,
    );
  });

  it('strips a stray v2-shaped `conceptId` rather than persisting a second answer', () => {
    const parsed = reviewLogRecordV3.parse({ ...v3ReviewLine(), conceptId: 'something-else' });
    expect(parsed).not.toHaveProperty('conceptId');
  });
});

describe('v2 stays exactly as it was frozen', () => {
  it('still accepts a v2 line with a single conceptId, and still requires it', () => {
    expect(reviewLogRecordV2.safeParse(v2ReviewLine()).success).toBe(true);
    const { conceptId: _dropped, ...noConcept } = v2ReviewLine();
    expect(reviewLogRecordV2.safeParse(noConcept).success).toBe(false);
  });

  it('the frozen v2 suspend record still carries conceptId, singular', () => {
    expect(suspendLogRecordV2.safeParse(v2SuspendLine()).success).toBe(true);
    expect(Object.keys(suspendLogRecordV2.shape).sort()).toEqual([
      'conceptId',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
  });
});
