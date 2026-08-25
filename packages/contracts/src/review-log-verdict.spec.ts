// `ol-548w` (INV-6): the accept/edit/reject verdict, additive to the v4
// discriminated union the same way `suspend`/`unsuspend` were additive at v2
// (D-020) — no schemaVersion bump, because nothing about an EXISTING kind's
// shape changes here. What this file has to prove:
//
//   1. `reviewLogEntryV4`/`reviewLogEntry` really discriminate all THREE
//      kinds now — `review`, `suspend`/`unsuspend`, AND `verdict` — the same
//      concern `review-log.spec.ts`'s header names for the original two;
//   2. `kind: 'verdict'` is required, never defaulted or inferred;
//   3. `conceptIds` is non-empty by schema, same rule every review/suspend
//      shape enforces, for the same reason (an un-backfillable hole);
//   4. `artifactProvenance` carries no content-shaped field — only the three
//      D-005-permitted identifiers — and is required, not optional, because
//      every verdict is about something Olea drafted.
import { describe, expect, it } from 'vitest';
import {
  artifactProvenance,
  artifactVerdict,
  reviewLogEntry,
  reviewLogRecordV4,
  suspendLogRecordV4,
  verdictLogRecord,
  verdictLogRecordV4,
} from './review-log.js';

const PROVENANCE = {
  taskId: 'card.generate.v1',
  promptVersion: '2026-08-20',
  modelId: 'workers-ai:test-model',
} as const;

function verdictLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
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

describe('verdictLogRecordV4', () => {
  it('parses a well-formed verdict line', () => {
    const parsed = verdictLogRecordV4.safeParse(verdictLine());
    expect(parsed.success).toBe(true);
  });

  it('requires `kind: "verdict"` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = verdictLine();
    expect(verdictLogRecordV4.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty `conceptIds` — an un-backfillable hole', () => {
    expect(verdictLogRecordV4.safeParse(verdictLine({ conceptIds: [] })).success).toBe(false);
  });

  it('preserves every concept the drafting pass named, in order', () => {
    const parsed = verdictLogRecordV4.parse(
      verdictLine({ conceptIds: ['concept-prov1:A', 'concept-prov1:B'] }),
    );
    expect(parsed.conceptIds).toEqual(['concept-prov1:A', 'concept-prov1:B']);
  });

  it('rejects an unrecognised verdict value', () => {
    expect(verdictLogRecordV4.safeParse(verdictLine({ verdict: 'ignored' })).success).toBe(false);
  });

  it('`verdictLogRecord` is the v4 alias', () => {
    expect(verdictLogRecord).toBe(verdictLogRecordV4);
  });
});

describe('reviewLogEntry / reviewLogEntryV4 — three-way discrimination', () => {
  it('discriminates review, suspend/unsuspend, and verdict lines', () => {
    const reviewLine = {
      schemaVersion: 4,
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
      schemaVersion: 4,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-25T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      conceptIds: ['concept-prov1:Imbrication'],
    };

    expect(reviewLogRecordV4.safeParse(reviewLine).success).toBe(true);
    expect(suspendLogRecordV4.safeParse(suspendLine).success).toBe(true);

    for (const line of [reviewLine, suspendLine, verdictLine()]) {
      const parsed = reviewLogEntry.safeParse(line);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.kind).toBe(line.kind);
    }
  });

  it('a verdict line with a review-only field set does not smuggle through', () => {
    // `rating`/`selectionContext` are review-only; a verdict line does not
    // carry them, and this asserts extra review-shaped noise does not defeat
    // the discriminator into picking the wrong branch.
    const malformed = verdictLine({ rating: 'good' });
    const parsed = reviewLogEntry.safeParse(malformed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('verdict');
      expect(parsed.data).not.toHaveProperty('rating');
    }
  });
});
