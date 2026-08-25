// PERMANENT SUITE (D-020, `ol-t3sd`, `ol-g6zg`, INV-4). The migration chain is the one
// place a record written months ago acquires a new meaning, so it is tested for
// the two properties that matter and cannot be recovered if they are wrong:
//
//   - **lossless in the only direction it can be.** A v2 record carries exactly
//     one concept id, because the second was never captured. `upgradeV2` maps
//     `conceptId` -> `[conceptId]` and does nothing cleverer: it never consults
//     the vault, never widens a binding, never invents a co-listed name. A
//     guess persisted into an append-only log is indistinguishable from a fact,
//     forever.
//   - **canonical.** Every path into v3 — native, v2->v3, v1->v2->v3 — emits
//     byte-identical JSON for the same event, because `merge.ts` compares
//     duplicate `eventId`s by their serialised form.
import {
  type ReviewLogEntryV3,
  type ReviewLogRecordV1,
  type ReviewLogRecordV2,
  reviewLogRecordV3,
  reviewLogRecordV4,
  type SuspendLogRecordV2,
  suspendLogRecordV3,
  suspendLogRecordV4,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { upgradeV1, upgradeV2, upgradeV3 } from './upgrade.js';

const SELECTION_CONTEXT: ReviewLogRecordV1['selectionContext'] = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  masteryAtTime: 'sprout',
  instrumentTypesOffered: ['qa'],
  planVersion: null,
};

function v1Record(over: Partial<ReviewLogRecordV1> = {}): ReviewLogRecordV1 {
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

function v2Record(over: Partial<ReviewLogRecordV2> = {}): ReviewLogRecordV2 {
  return { ...v1Record(), schemaVersion: 2, kind: 'review', ...over };
}

function v2Suspend(over: Partial<SuspendLogRecordV2> = {}): SuspendLogRecordV2 {
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

describe('upgradeV2 — v2 review record to v3', () => {
  it('maps conceptId to a one-element conceptIds and nothing cleverer', () => {
    const upgraded = upgradeV2(v2Record({ conceptId: 'bioturbation' }));
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.conceptIds).toEqual(['bioturbation']);
  });

  it('never invents a second binding, however many concepts the vault now has', () => {
    // There is no vault argument here, and that is the test: this function
    // cannot consult current state even if a future caller wanted it to.
    expect(upgradeV2.length).toBe(1);
  });

  it('stamps schemaVersion 3 and drops the singular field entirely', () => {
    const upgraded = upgradeV2(v2Record());
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded).not.toHaveProperty('conceptId');
  });

  it('carries every other field verbatim — it swaps one field, it never rewrites', () => {
    const original = v2Record({ rating: 'again', wasUnsure: true, durationMs: null });
    const upgraded = upgradeV2(original) as unknown as Record<string, unknown>;
    const { schemaVersion: _v, conceptIds: _c, ...carried } = upgraded;
    const { schemaVersion: _origV, conceptId: _origC, ...origRest } = original;
    expect(carried).toEqual(origRest);
  });

  it('preserves an explain-back record with its null rating and null durationMs (F2.16)', () => {
    const upgraded = upgradeV2(
      v2Record({ instrumentType: 'explain-back', rating: null, durationMs: null }),
    );
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.rating).toBeNull();
    expect(upgraded.durationMs).toBeNull();
    expect(upgraded.conceptIds).toEqual(['imbrication']);
  });

  it('preserves explicit nulls inside selectionContext rather than omitting keys', () => {
    const upgraded = upgradeV2(v2Record());
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(Object.keys(upgraded.selectionContext).sort()).toEqual(
      [
        'dueState',
        'examProximity',
        'yieldRank',
        'masteryAtTime',
        'instrumentTypesOffered',
        'planVersion',
      ].sort(),
    );
    expect(upgraded.selectionContext.planVersion).toBeNull();
  });
});

describe('upgradeV2 — v2 suspension events', () => {
  it('makes the same one-element mapping on a suspend', () => {
    const upgraded = upgradeV2(v2Suspend({ conceptId: 'cementation' }));
    expect(upgraded.kind).toBe('suspend');
    if (upgraded.kind === 'review') throw new Error('expected a suspension entry');
    expect(upgraded.conceptIds).toEqual(['cementation']);
    expect(upgraded.schemaVersion).toBe(3);
  });

  it('keeps unsuspend an unsuspend — the discriminator is carried, never re-derived', () => {
    const upgraded = upgradeV2(v2Suspend({ kind: 'unsuspend', eventId: 'u1' }));
    expect(upgraded.kind).toBe('unsuspend');
  });

  it('gains no review fields on the way through', () => {
    const upgraded = upgradeV2(v2Suspend());
    expect(Object.keys(upgraded).sort()).toEqual([
      'conceptIds',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
  });
});

describe('every path into v3 serialises identically', () => {
  it('v1 -> v2 -> v3 and a natively-parsed v3 record of the same event are byte-identical', () => {
    // `merge.ts` compares duplicate `eventId`s by serialised form. If the two
    // paths disagreed by so much as key order, the same event arriving from an
    // old device and a new one would look like an id collision and throw.
    const migrated = upgradeV2(upgradeV1(v1Record()));
    const native = reviewLogRecordV3.parse({
      schemaVersion: 3,
      kind: 'review',
      eventId: 'e1',
      timestamp: '2026-08-10T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      instrumentType: 'qa',
      conceptIds: ['imbrication'],
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
    });
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(native));
  });

  it('v2 -> v3 and a natively-parsed v3 suspension of the same event are byte-identical', () => {
    const migrated = upgradeV2(v2Suspend());
    const native = suspendLogRecordV3.parse({
      schemaVersion: 3,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-10T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      conceptIds: ['imbrication'],
    });
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(native));
  });

  it('is idempotent in the only sense that applies: v1 through the chain equals v2 through it', () => {
    const viaV1 = upgradeV2(upgradeV1(v1Record()));
    const viaV2 = upgradeV2(v2Record());
    expect(JSON.stringify(viaV1)).toBe(JSON.stringify(viaV2));
  });
});

describe('upgradeV1 is unchanged — it still produces v2, not v3', () => {
  it('stamps kind and stops there; the second hop is upgradeV2 and is separately testable', () => {
    const upgraded = upgradeV1(v1Record());
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.kind).toBe('review');
    expect(upgraded.conceptId).toBe('imbrication');
  });
});

// `ol-g6zg`. The v3 -> v4 hop is the first migration in this chain that had a
// genuinely undecidable case in it, and the tests below are mostly about the
// case it declines rather than the ones it handles.
function v3Review(over: Partial<ReviewLogEntryV3> = {}): ReviewLogEntryV3 {
  return reviewLogRecordV3.parse({
    schemaVersion: 3,
    kind: 'review',
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['imbrication'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: SELECTION_CONTEXT,
    ...over,
  });
}

function v3Suspend(over: Record<string, unknown> = {}): ReviewLogEntryV3 {
  return suspendLogRecordV3.parse({
    schemaVersion: 3,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    conceptIds: ['imbrication'],
    ...over,
  });
}

describe('upgradeV3 — one concept, so one place the value can belong', () => {
  it('maps the singular value to a one-entry map keyed by that concept', () => {
    const upgraded = upgradeV3(v3Review());
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout' },
    });
  });

  it('never invents an attribution, whatever the vault now says', () => {
    // There is no vault argument here, and that is the test: this function
    // cannot consult current state even if a future caller wanted it to. The
    // same assertion `upgradeV2` carries, for the same reason — a guess
    // persisted into an append-only log is indistinguishable from a fact.
    expect(upgradeV3.length).toBe(1);
  });

  it('stamps schemaVersion 4 and empties the field out of selectionContext', () => {
    const upgraded = upgradeV3(v3Review());
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.selectionContext).not.toHaveProperty('masteryAtTime');
  });

  it('carries every other field verbatim — it moves one field, it never rewrites', () => {
    const original = v3Review({ rating: 'again', wasUnsure: true, durationMs: null });
    const upgraded = upgradeV3(original) as unknown as Record<string, unknown>;
    const {
      schemaVersion: _v,
      masteryAtTime: _m,
      selectionContext: newContext,
      ...carried
    } = upgraded;
    const {
      schemaVersion: _origV,
      selectionContext: origContext,
      ...origRest
    } = original as Record<string, unknown>;
    expect(carried).toEqual(origRest);
    const { masteryAtTime: _dropped, ...origContextRest } = origContext as Record<string, unknown>;
    expect(newContext).toEqual(origContextRest);
  });

  it('a null value becomes an absent field — the same statement in the new shape', () => {
    const upgraded = upgradeV3(
      v3Review({ selectionContext: { ...SELECTION_CONTEXT, masteryAtTime: null } }),
    );
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).toBeUndefined();
    expect(Object.hasOwn(upgraded, 'masteryAtTime')).toBe(false);
  });
});

describe('upgradeV3 — several concepts, so nowhere honest to put the value', () => {
  const multi = v3Review({ conceptIds: ['imbrication', 'bioturbation'] });

  it('keeps the value and declines the attribution', () => {
    const upgraded = upgradeV3(multi);
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).toEqual({ attribution: 'not-attributable', recorded: 'sprout' });
  });

  it('does not assign it to the first concept — there is no primary concept', () => {
    // Picking the first is the option that looks harmless and is not: it is
    // exactly the pick-one-and-persist-it behaviour D-031 was raised to end,
    // and the log would carry it as a fact forever.
    const upgraded = upgradeV3(multi);
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).not.toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout' },
    });
  });

  it('does not assign it to every concept either — that invents two facts instead of one', () => {
    const upgraded = upgradeV3(multi);
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).not.toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout', bioturbation: 'sprout' },
    });
  });

  it('and does not quietly drop it either — the value was really recorded', () => {
    // The failure mode on the other side: encoding "not attributable" as
    // "not recorded" would lose a fact rather than invent one, which is a
    // smaller sin and still a wrong answer to "what did the system believe".
    const upgraded = upgradeV3(multi);
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).toBeDefined();
  });

  it('a multi-concept record with a null value is simply not recorded, not un-attributable', () => {
    const upgraded = upgradeV3(
      v3Review({
        conceptIds: ['imbrication', 'bioturbation'],
        selectionContext: { ...SELECTION_CONTEXT, masteryAtTime: null },
      }),
    );
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.masteryAtTime).toBeUndefined();
  });
});

describe('upgradeV3 — v3 suspension events', () => {
  it('only stamps the version forward: a suspend has no context and no mastery to attribute', () => {
    const upgraded = upgradeV3(v3Suspend());
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.kind).toBe('suspend');
    expect(Object.keys(upgraded).sort()).toEqual([
      'conceptIds',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
  });

  it('keeps unsuspend an unsuspend — the discriminator is carried, never re-derived', () => {
    expect(upgradeV3(v3Suspend({ kind: 'unsuspend', eventId: 'u1' })).kind).toBe('unsuspend');
  });

  it('a multi-concept suspend is untouched — nothing about it was ever ambiguous', () => {
    const upgraded = upgradeV3(v3Suspend({ conceptIds: ['imbrication', 'bioturbation'] }));
    expect(upgraded.conceptIds).toEqual(['imbrication', 'bioturbation']);
  });
});

describe('every path into v4 serialises identically', () => {
  it('v1 -> v2 -> v3 -> v4 and a natively-parsed v4 record of the same event are byte-identical', () => {
    // `merge.ts` compares duplicate `eventId`s by serialised form. If the two
    // paths disagreed by so much as key order, the same event arriving from an
    // old device and a new one would look like an id collision and throw.
    const migrated = upgradeV3(upgradeV2(upgradeV1(v1Record())));
    const native = reviewLogRecordV4.parse({
      schemaVersion: 4,
      kind: 'review',
      eventId: 'e1',
      timestamp: '2026-08-10T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      instrumentType: 'qa',
      conceptIds: ['imbrication'],
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
      masteryAtTime: { attribution: 'per-concept', byConcept: { imbrication: 'sprout' } },
    });
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(native));
  });

  it('v3 -> v4 and a natively-parsed v4 suspension of the same event are byte-identical', () => {
    const migrated = upgradeV3(upgradeV2(v2Suspend()));
    const native = suspendLogRecordV4.parse({
      schemaVersion: 4,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-10T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      conceptIds: ['imbrication'],
    });
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(native));
  });

  it('is idempotent in the only sense that applies: every entry version reaches the same bytes', () => {
    const viaV1 = upgradeV3(upgradeV2(upgradeV1(v1Record())));
    const viaV2 = upgradeV3(upgradeV2(v2Record()));
    const viaV3 = upgradeV3(v3Review());
    expect(JSON.stringify(viaV1)).toBe(JSON.stringify(viaV2));
    expect(JSON.stringify(viaV2)).toBe(JSON.stringify(viaV3));
  });
});

describe('upgradeV2 is unchanged — it still produces v3, not v4', () => {
  it('stops at v3 and leaves masteryAtTime where v3 kept it; the third hop is separately testable', () => {
    const upgraded = upgradeV2(v2Record());
    if (upgraded.kind !== 'review') throw new Error('expected a review entry');
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.selectionContext.masteryAtTime).toBe('sprout');
    expect(upgraded).not.toHaveProperty('masteryAtTime');
  });
});
