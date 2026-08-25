// PERMANENT SUITE (`ol-g6zg`, implementing `ol-7328`'s ruling, INV-4). Schema
// version 4 — mastery is a per-concept quantity, stamped at write time.
//
// This file is the v4 half of `review-log.spec.ts` and `review-log-v3.spec.ts`,
// kept separate for the reason that file gives: v1, v2 and v3 are frozen shapes
// and every guarantee they carried is still asserted there, against the
// versioned schema objects rather than against the moving aliases.
//
// What v4 has to prove, and none of it is "does zod work" trivia:
//
//   1. v4 is v3 with `masteryAtTime` *moved* — out of `selectionContext`, onto
//      the record beside `conceptIds`. No other field appeared, vanished or
//      changed type, and `selectionContext` itself is untouched for v1–v3;
//   2. the field is optional, and absence means exactly what `null` meant —
//      "not recorded" — while every other context field stays an explicit null;
//   3. the map's keys and `conceptIds` agree, enforced at the **record**, both
//      directions. This is the invariant the whole move exists to make
//      expressible: `selectionContext` cannot see `conceptIds`, so it could
//      never have been checked from inside the field;
//   4. the `not-attributable` arm exists, carries a value, and is deliberately
//      *not* keyed by anything — it is what the migration writes when the log
//      never captured which concept a mastery state described;
//   5. the versions never silently cross, in both directions, so "read the
//      version first, never guess" stays enforceable rather than aspirational.
import { describe, expect, it } from 'vitest';
import {
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV3,
  reviewLogEntryV4,
  reviewLogRecord,
  reviewLogRecordV1,
  reviewLogRecordV3,
  reviewLogRecordV4,
  selectionContext,
  selectionContextV4,
  suspendLogRecord,
  suspendLogRecordV3,
  suspendLogRecordV4,
} from './review-log.js';

/** The v4 context: v1's five surviving fields, with no `masteryAtTime`. */
const SELECTION_CONTEXT_V4 = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
} as const;

function v3ReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    kind: 'review',
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: { ...SELECTION_CONTEXT_V4, masteryAtTime: 'sprout' },
    conceptIds: ['imbrication'],
    ...over,
  };
}

function v4ReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    kind: 'review',
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: SELECTION_CONTEXT_V4,
    conceptIds: ['imbrication'],
    ...over,
  };
}

function v3SuspendLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    conceptIds: ['imbrication'],
    ...over,
  };
}

function v4SuspendLine(over: Record<string, unknown> = {}) {
  return { ...v3SuspendLine(), schemaVersion: 4, ...over };
}

describe('review-log schema version 4 is the current one', () => {
  it('the version writers stamp is 4', () => {
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(4);
  });

  it('`reviewLogRecord` and `suspendLogRecord` alias the v4 shapes', () => {
    expect(reviewLogRecord).toBe(reviewLogRecordV4);
    expect(suspendLogRecord).toBe(suspendLogRecordV4);
    expect(reviewLogEntry).toBe(reviewLogEntryV4);
  });
});

describe('v4 is v3 with masteryAtTime moved — nothing else changed', () => {
  it('the record gains exactly one key, and it is the one that left the context', () => {
    const v3Keys = Object.keys(reviewLogRecordV3.shape).sort();
    const v4Keys = Object.keys(reviewLogRecordV4.shape).sort();
    expect(v4Keys).toEqual([...v3Keys, 'masteryAtTime'].sort());
  });

  it("v4's selectionContext is v1's minus that one field", () => {
    const v1ContextKeys = Object.keys(selectionContext.shape);
    expect(Object.keys(selectionContextV4.shape)).toEqual(
      v1ContextKeys.filter((k) => k !== 'masteryAtTime'),
    );
  });

  it('the shared selectionContext object is untouched — v1 still carries the singular field', () => {
    // The reason the field moved rather than changed type in place. This object
    // is referenced by `reviewLogRecordV1` and inherited by v2 and v3; retyping
    // `masteryAtTime` here would have retyped it on a shape that is never
    // edited again, because a v1 record on disk keeps the meaning v1 gave it.
    expect(Object.keys(selectionContext.shape)).toContain('masteryAtTime');
    expect(Object.keys(reviewLogRecordV1.shape)).toContain('selectionContext');
    expect(reviewLogRecordV1.shape.selectionContext).toBe(selectionContext);
  });

  it('the suspend record gains nothing at all — only its version moved', () => {
    expect(Object.keys(suspendLogRecordV4.shape).sort()).toEqual(
      Object.keys(suspendLogRecordV3.shape).sort(),
    );
    expect(suspendLogRecordV4.parse(v4SuspendLine()).schemaVersion).toBe(4);
  });

  it('emits its keys in one fixed order, whatever order the input arrived in', () => {
    // Load-bearing, not cosmetic: `merge.ts` compares duplicate `eventId`s by
    // their serialised form, so a record reaching one device through the
    // migration and another natively must serialise byte-identically. That only
    // holds if every v4 record goes through this one schema, and this pins the
    // order it emits — v3's order with `masteryAtTime` appended, and
    // `selectionContext` still in the slot v3 gave it.
    const shuffled = {
      masteryAtTime: { attribution: 'per-concept', byConcept: { imbrication: 'sprout' } },
      conceptIds: ['imbrication'],
      selectionContext: SELECTION_CONTEXT_V4,
      kind: 'review',
      schemaVersion: 4,
      durationMs: 1200,
      wasUnsure: false,
      rating: 'good',
      instrumentType: 'qa',
      instrumentId: 'qa:imbrication:1',
      timestamp: '2026-08-10T09:00:00-04:00',
      eventId: 'e1',
    };
    expect(Object.keys(reviewLogRecordV4.parse(shuffled))).toEqual([
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
      'masteryAtTime',
    ]);
  });

  it('a stray v3-shaped masteryAtTime inside selectionContext is stripped, not persisted', () => {
    // Otherwise a v4 record could carry two answers to the same question, one
    // of them in the place a v3 reader would look.
    const parsed = reviewLogRecordV4.parse(
      v4ReviewLine({ selectionContext: { ...SELECTION_CONTEXT_V4, masteryAtTime: 'sapling' } }),
    );
    expect(parsed.selectionContext).not.toHaveProperty('masteryAtTime');
    expect(parsed.masteryAtTime).toBeUndefined();
  });
});

describe('masteryAtTime is optional, and absent means "not recorded"', () => {
  it('a record with no masteryAtTime parses, and does not acquire the key', () => {
    // This is what every writer produces today and will until C5.4's rollup
    // exists (`ol-p4t06`). It is a true statement, not a placeholder.
    const parsed = reviewLogRecordV4.parse(v4ReviewLine());
    expect(parsed.masteryAtTime).toBeUndefined();
    expect(Object.hasOwn(parsed, 'masteryAtTime')).toBe(false);
  });

  it('the other context fields are still required, still explicit', () => {
    // The explicit-null discipline is unchanged for them: an omitted key would
    // make "we had no value" and "we never recorded this field"
    // indistinguishable a semester later, which is the question the Phase A→B
    // checkpoint has to answer.
    for (const key of ['examProximity', 'yieldRank', 'planVersion', 'dueState'] as const) {
      const { [key]: _dropped, ...rest } = SELECTION_CONTEXT_V4;
      expect(reviewLogRecordV4.safeParse(v4ReviewLine({ selectionContext: rest })).success).toBe(
        false,
      );
    }
  });

  it('null is not accepted where the field used to be nullable — absence is the encoding', () => {
    expect(reviewLogRecordV4.safeParse(v4ReviewLine({ masteryAtTime: null })).success).toBe(false);
  });

  it('rejects a bare mastery state — the v3 shape does not survive the move', () => {
    expect(reviewLogRecordV4.safeParse(v4ReviewLine({ masteryAtTime: 'sprout' })).success).toBe(
      false,
    );
  });

  it('rejects an untagged map — the discriminator is never inferred from shape', () => {
    expect(
      reviewLogRecordV4.safeParse(v4ReviewLine({ masteryAtTime: { imbrication: 'sprout' } }))
        .success,
    ).toBe(false);
  });
});

describe('the map and conceptIds agree — a RECORD-level invariant, not a field-level one', () => {
  it('accepts a map naming exactly the record’s concepts', () => {
    const parsed = reviewLogRecordV4.parse(
      v4ReviewLine({
        conceptIds: ['imbrication', 'bioturbation'],
        masteryAtTime: {
          attribution: 'per-concept',
          byConcept: { imbrication: 'sprout', bioturbation: 'sprout' },
        },
      }),
    );
    expect(parsed.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout', bioturbation: 'sprout' },
    });
  });

  it('rejects a concept the record does not name — a mastery value for something this was not evidence for', () => {
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({
          masteryAtTime: {
            attribution: 'per-concept',
            byConcept: { imbrication: 'sprout', appoggiatura: 'sapling' },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects a named concept the map omits — a value the writer had and dropped', () => {
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({
          conceptIds: ['imbrication', 'bioturbation'],
          masteryAtTime: { attribution: 'per-concept', byConcept: { imbrication: 'sprout' } },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects an empty map on a record that names concepts', () => {
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({ masteryAtTime: { attribution: 'per-concept', byConcept: {} } }),
      ).success,
    ).toBe(false);
  });

  it('the failure names the field, so a writer bug is diagnosable from the message alone', () => {
    const result = reviewLogRecordV4.safeParse(
      v4ReviewLine({
        masteryAtTime: { attribution: 'per-concept', byConcept: { appoggiatura: 'sapling' } },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['masteryAtTime', 'byConcept']);
  });

  it('a repeated concept id is satisfiable — a map holds a key once, and nothing dedupes her list', () => {
    // `conceptIds` is her order, verbatim: nothing sorts, case-folds or
    // deduplicates it. So the set the map is checked against is the
    // deduplicated list, or a record naming the same concept twice would be
    // unrepresentable rather than merely unusual.
    const parsed = reviewLogRecordV4.parse(
      v4ReviewLine({
        conceptIds: ['imbrication', 'imbrication'],
        masteryAtTime: { attribution: 'per-concept', byConcept: { imbrication: 'sprout' } },
      }),
    );
    expect(parsed.conceptIds).toEqual(['imbrication', 'imbrication']);
  });

  it('the invariant is enforced through the union too, not only on the record schema', () => {
    // `parse.ts` validates a v4 line against the union, so an invariant that
    // only fired on the bare record would not fire on the read path at all.
    expect(
      reviewLogEntryV4.safeParse(
        v4ReviewLine({
          masteryAtTime: { attribution: 'per-concept', byConcept: { appoggiatura: 'sapling' } },
        }),
      ).success,
    ).toBe(false);
  });
});

describe('the not-attributable arm — a value kept, an attribution declined', () => {
  it('accepts a record that names several concepts and attributes its value to none of them', () => {
    // What `upgradeV3` writes for a v3 record with two concepts and one mastery
    // state. Which concept it described was never captured, so assigning it —
    // to one, or to all — would persist a guess into an append-only log.
    const parsed = reviewLogRecordV4.parse(
      v4ReviewLine({
        conceptIds: ['imbrication', 'bioturbation'],
        masteryAtTime: { attribution: 'not-attributable', recorded: 'sprout' },
      }),
    );
    expect(parsed.masteryAtTime).toEqual({ attribution: 'not-attributable', recorded: 'sprout' });
  });

  it('is not checked against conceptIds, because it makes no claim about any of them', () => {
    const parsed = reviewLogRecordV4.parse(
      v4ReviewLine({ masteryAtTime: { attribution: 'not-attributable', recorded: 'sapling' } }),
    );
    expect(parsed.conceptIds).toEqual(['imbrication']);
  });

  it('still requires the value it kept — "not attributable" is not "not recorded"', () => {
    // The two are different facts and are encoded differently: nothing recorded
    // is an absent field, and this arm exists precisely because something *was*
    // recorded.
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({ masteryAtTime: { attribution: 'not-attributable' } }),
      ).success,
    ).toBe(false);
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({ masteryAtTime: { attribution: 'not-attributable', recorded: null } }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unknown attribution tag rather than falling back to a shape', () => {
    expect(
      reviewLogRecordV4.safeParse(
        v4ReviewLine({ masteryAtTime: { attribution: 'primary-concept', recorded: 'sprout' } }),
      ).success,
    ).toBe(false);
  });
});

describe('the four versions never silently cross', () => {
  it('v4 rejects a v3 line and v3 rejects a v4 line', () => {
    expect(reviewLogRecordV4.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogRecordV3.safeParse(v4ReviewLine()).success).toBe(false);
  });

  it('the v3 union still parses v3 lines, and refuses v4 ones', () => {
    // A device still on `0.9.0-alpha.3` must not reinterpret a v4 line as v3.
    // It would find no `masteryAtTime` in the context and read the record as
    // "mastery was never recorded" — a wrong answer that looks like a right one.
    expect(reviewLogEntryV3.safeParse(v3ReviewLine()).success).toBe(true);
    expect(reviewLogEntryV3.safeParse(v4ReviewLine()).success).toBe(false);
    expect(reviewLogEntryV3.safeParse(v4SuspendLine()).success).toBe(false);
  });

  it('the current union parses v4 lines of every kind, and refuses v3 ones', () => {
    expect(reviewLogEntry.safeParse(v4ReviewLine()).success).toBe(true);
    expect(reviewLogEntry.safeParse(v4SuspendLine()).success).toBe(true);
    expect(reviewLogEntry.safeParse(v4SuspendLine({ kind: 'unsuspend' })).success).toBe(true);
    expect(reviewLogEntry.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogEntry.safeParse(v3SuspendLine()).success).toBe(false);
  });

  it('conceptIds keeps every guarantee it had at v3', () => {
    expect(reviewLogRecordV4.safeParse(v4ReviewLine({ conceptIds: [] })).success).toBe(false);
    expect(reviewLogRecordV4.safeParse(v4ReviewLine({ conceptIds: [''] })).success).toBe(false);
    expect(suspendLogRecordV4.safeParse(v4SuspendLine({ conceptIds: [] })).success).toBe(false);
    const { conceptIds: _dropped, ...noConcepts } = v4ReviewLine();
    expect(reviewLogRecordV4.safeParse(noConcepts).success).toBe(false);
  });
});
