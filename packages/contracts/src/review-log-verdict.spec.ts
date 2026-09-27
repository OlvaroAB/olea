// `ol-548w` (INV-6): the accept/edit/reject verdict, additive to the v4
// discriminated union the same way `suspend`/`unsuspend` were additive at v2
// (D-020) — no schemaVersion bump was needed for THIS kind's shape at the
// time it shipped. `ol-tka5`/`[D-109]` later moved every kind in the union to
// v5 together (the "one version per line" rule), so this file's literals
// read `schemaVersion: 5` today, but the assertions below are unchanged: they
// are about the verdict SHAPE, not about which version number currently
// carries it. What this file has to prove:
//
//   1. `reviewLogEntry` really discriminates all THREE kinds now — `review`,
//      `suspend`/`unsuspend`, AND `verdict` — the same concern
//      `review-log.spec.ts`'s header names for the original two;
//   2. `kind: 'verdict'` is required, never defaulted or inferred;
//   3. `conceptIds` is non-empty by schema, same rule every review/suspend
//      shape enforces, for the same reason (an un-backfillable hole);
//   4. `artifactProvenance` carries no content-shaped field — only the three
//      D-005-permitted identifiers — and is required on every v5 verdict and
//      on a v6 accept or edit, because a draft always names the call that
//      drafted it;
//   5. `[D-396]` (`ol-v7r5.101`): at v6 a rejection, and a restore, may omit
//      it, with the instrument's identity still required, and `restores`
//      marks her deliberate restore. Inside v6, no version bump — the
//      schema's own doc says why; the key-list pin and the old-record read
//      test below hold every line written before the change to its meaning.
import { describe, expect, it } from 'vitest';
import {
  artifactProvenance,
  artifactVerdict,
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV5,
  reviewLogRecordV5,
  suspendLogRecordV5,
  verdictLogRecord,
  verdictLogRecordV5,
  verdictLogRecordV6,
} from './review-log.js';

const PROVENANCE = {
  taskId: 'card.generate.v1',
  promptVersion: '2026-08-20',
  modelId: 'workers-ai:test-model',
} as const;

function verdictLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId: 'v1',
    timestamp: '2026-08-25T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['concept-prov1:Imbrication'],
    verdict: 'accepted',
    artifactProvenance: PROVENANCE,
    ...over,
  };
}

describe('artifactVerdict', () => {
  it('is exactly the three named verdicts', () => {
    expect(artifactVerdict.options).toEqual(['accepted', 'edited', 'rejected']);
  });
});

describe('artifactProvenance', () => {
  it('accepts exactly the three D-005-permitted identifiers', () => {
    expect(artifactProvenance.safeParse(PROVENANCE).success).toBe(true);
  });

  it('rejects a missing field — every verdict is about something Olea drafted', () => {
    const { promptVersion: _drop, ...rest } = PROVENANCE;
    expect(artifactProvenance.safeParse(rest).success).toBe(false);
  });
});

describe('verdictLogRecordV5', () => {
  it('parses a well-formed verdict line', () => {
    const parsed = verdictLogRecordV5.safeParse(verdictLine());
    expect(parsed.success).toBe(true);
  });

  it('requires `kind: "verdict"` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = verdictLine();
    expect(verdictLogRecordV5.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty `conceptIds` — an un-backfillable hole', () => {
    expect(verdictLogRecordV5.safeParse(verdictLine({ conceptIds: [] })).success).toBe(false);
  });

  it('preserves every concept the drafting pass named, in order', () => {
    const parsed = verdictLogRecordV5.parse(
      verdictLine({ conceptIds: ['concept-prov1:A', 'concept-prov1:B'] }),
    );
    expect(parsed.conceptIds).toEqual(['concept-prov1:A', 'concept-prov1:B']);
  });

  it('rejects an unrecognised verdict value', () => {
    expect(verdictLogRecordV5.safeParse(verdictLine({ verdict: 'ignored' })).success).toBe(false);
  });

  it('`verdictLogRecord` is the v6 alias (v6 is current since ol-95vv.8)', () => {
    expect(verdictLogRecord).toBe(verdictLogRecordV6);
  });
});

describe('reviewLogEntry / reviewLogEntryV5 — three-way discrimination', () => {
  it('discriminates review, suspend/unsuspend, and verdict lines', () => {
    const reviewLine = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r1',
      timestamp: '2026-08-25T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      instrumentType: 'qa',
      conceptIds: ['concept-prov1:Imbrication'],
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
    };
    const suspendLine = {
      schemaVersion: 5,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-25T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      conceptIds: ['concept-prov1:Imbrication'],
    };

    expect(reviewLogRecordV5.safeParse(reviewLine).success).toBe(true);
    expect(suspendLogRecordV5.safeParse(suspendLine).success).toBe(true);

    for (const line of [reviewLine, suspendLine, verdictLine()]) {
      const parsed = reviewLogEntryV5.safeParse(line);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.kind).toBe(line.kind);
    }
  });

  it('a verdict line with a review-only field set does not smuggle through', () => {
    // `rating`/`selectionContext` are review-only; a verdict line does not
    // carry them, and this asserts extra review-shaped noise does not defeat
    // the discriminator into picking the wrong branch.
    const malformed = verdictLine({ rating: 'good' });
    const parsed = reviewLogEntryV5.safeParse(malformed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('verdict');
      expect(parsed.data).not.toHaveProperty('rating');
    }
  });
});

describe('verdictLogRecordV6 — [D-396]: provenance optional on a rejection, and the restore (ol-v7r5.101)', () => {
  function v6(over: Record<string, unknown> = {}) {
    return verdictLine({ schemaVersion: 6, ...over });
  }
  function withoutProvenance(over: Record<string, unknown> = {}) {
    const { artifactProvenance: _drop, ...rest } = v6(over);
    return rest;
  }

  it('stays inside v6: no version bump', () => {
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(6);
  });

  it('pins the v6 key list: the v5 keys in their order, then `restores`', () => {
    expect(Object.keys(verdictLogRecordV6.shape)).toEqual([
      ...Object.keys(verdictLogRecordV5.shape),
      'restores',
    ]);
    expect(Object.keys(verdictLogRecordV5.shape)).toEqual([
      'schemaVersion',
      'kind',
      'eventId',
      'timestamp',
      'instrumentId',
      'instrumentType',
      'conceptIds',
      'verdict',
      'artifactProvenance',
    ]);
  });

  it('reads a line written before the change to the same meaning, byte-identically', () => {
    for (const value of artifactVerdict.options) {
      const raw = JSON.stringify(v6({ verdict: value }));
      const parsed = reviewLogEntry.parse(JSON.parse(raw));
      expect(JSON.stringify(parsed)).toBe(raw);
      expect(parsed).not.toHaveProperty('restores');
    }
  });

  it('a rejection with no provenance parses, and gains nothing on the way', () => {
    const line = withoutProvenance({ verdict: 'rejected' });
    const parsed = reviewLogEntry.parse(line);
    expect(parsed).toEqual(line);
    expect(parsed).not.toHaveProperty('artifactProvenance');
  });

  it('an accept or an edit of a draft still names the call that drafted it', () => {
    for (const value of ['accepted', 'edited'] as const) {
      expect(verdictLogRecordV6.safeParse(withoutProvenance({ verdict: value })).success).toBe(
        false,
      );
    }
  });

  it('missing provenance never loosens identity: the instrument id, type and concepts stay required', () => {
    for (const key of ['instrumentId', 'instrumentType', 'conceptIds'] as const) {
      const { [key]: _drop, ...rest } = withoutProvenance({ verdict: 'rejected' });
      expect(verdictLogRecordV6.safeParse(rest).success).toBe(false);
    }
    expect(
      verdictLogRecordV6.safeParse(withoutProvenance({ verdict: 'rejected', instrumentId: '' }))
        .success,
    ).toBe(false);
    expect(
      verdictLogRecordV6.safeParse(withoutProvenance({ verdict: 'rejected', conceptIds: [] }))
        .success,
    ).toBe(false);
  });

  it('a partial provenance is refused, never read as absent', () => {
    const { modelId: _drop, ...partial } = PROVENANCE;
    expect(
      verdictLogRecordV6.safeParse(v6({ verdict: 'rejected', artifactProvenance: partial }))
        .success,
    ).toBe(false);
  });

  it('a restore is an accepted verdict naming the rejection it lifts, with or without provenance', () => {
    const restore = v6({ eventId: 'v9', verdict: 'accepted', restores: 'v1' });
    expect(reviewLogEntry.parse(restore)).toEqual(restore);
    const bare = withoutProvenance({ eventId: 'v9', verdict: 'accepted', restores: 'v1' });
    expect(reviewLogEntry.parse(bare)).toEqual(bare);
  });

  it('a rejection or an edit never carries `restores`, a restore never names itself or nothing', () => {
    for (const value of ['rejected', 'edited'] as const) {
      expect(verdictLogRecordV6.safeParse(v6({ verdict: value, restores: 'v0' })).success).toBe(
        false,
      );
    }
    expect(
      verdictLogRecordV6.safeParse(v6({ eventId: 'v9', verdict: 'accepted', restores: 'v9' }))
        .success,
    ).toBe(false);
    expect(verdictLogRecordV6.safeParse(v6({ verdict: 'accepted', restores: '' })).success).toBe(
      false,
    );
  });

  it('v5 is unchanged: a v5 verdict still requires provenance and knows no `restores`', () => {
    const { artifactProvenance: _drop, ...rest } = verdictLine({ verdict: 'rejected' });
    expect(verdictLogRecordV5.safeParse(rest).success).toBe(false);
    const parsed = verdictLogRecordV5.parse(verdictLine({ restores: 'v0' }));
    expect(parsed).not.toHaveProperty('restores');
  });
});
