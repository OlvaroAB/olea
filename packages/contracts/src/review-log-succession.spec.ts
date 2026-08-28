// `[D-133]` (`ol-w00s` / `ol-2zfj.37`): the succession event, additive to the
// v5 discriminated union the same way `verdict` was additive at v4/v5 — no
// schemaVersion bump for this kind's own arrival, same reasoning
// `review-log-verdict.spec.ts` states for its own kind. What this file has
// to prove:
//
//   1. `reviewLogEntry` discriminates all FOUR kinds now — `review`,
//      `suspend`/`unsuspend`, `verdict`, AND `succession`;
//   2. `kind: 'succession'` is required, never defaulted or inferred;
//   3. both instrument ids are required and non-empty — the fact of
//      succession has no meaning with either missing;
//   4. the record carries no `instrumentType` or `conceptIds` — it is
//      deliberately narrower than a verdict, per its own doc comment.
import { describe, expect, it } from 'vitest';
import {
  reviewLogEntry,
  reviewLogRecordV5,
  successionLogRecord,
  successionLogRecordV5,
  suspendLogRecordV5,
  verdictLogRecordV5,
} from './review-log.js';

function successionLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'succession',
    eventId: 'sc1',
    timestamp: '2026-08-28T09:00:00-04:00',
    predecessorInstrumentId: 'mcq:oldid1',
    successorInstrumentId: 'mcq:newid1',
    ...over,
  };
}

describe('successionLogRecordV5', () => {
  it('parses a well-formed succession line', () => {
    const parsed = successionLogRecordV5.safeParse(successionLine());
    expect(parsed.success).toBe(true);
  });

  it('requires `kind: "succession"` — not defaulted, not inferred', () => {
    const { kind: _drop, ...rest } = successionLine();
    expect(successionLogRecordV5.safeParse(rest).success).toBe(false);
  });

  it('rejects a missing or empty predecessorInstrumentId', () => {
    const { predecessorInstrumentId: _drop, ...rest } = successionLine();
    expect(successionLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      successionLogRecordV5.safeParse(successionLine({ predecessorInstrumentId: '' })).success,
    ).toBe(false);
  });

  it('rejects a missing or empty successorInstrumentId', () => {
    const { successorInstrumentId: _drop, ...rest } = successionLine();
    expect(successionLogRecordV5.safeParse(rest).success).toBe(false);
    expect(
      successionLogRecordV5.safeParse(successionLine({ successorInstrumentId: '' })).success,
    ).toBe(false);
  });

  it('carries no `instrumentType` or `conceptIds` — narrower than a verdict by design', () => {
    const parsed = successionLogRecordV5.parse(successionLine());
    expect(Object.hasOwn(parsed, 'instrumentType')).toBe(false);
    expect(Object.hasOwn(parsed, 'conceptIds')).toBe(false);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'schemaVersion',
        'kind',
        'eventId',
        'timestamp',
        'predecessorInstrumentId',
        'successorInstrumentId',
      ].sort(),
    );
  });

  it('`successionLogRecord` is the v5 alias', () => {
    expect(successionLogRecord).toBe(successionLogRecordV5);
  });
});

describe('reviewLogEntry / reviewLogEntryV5 — four-way discrimination', () => {
  it('discriminates review, suspend/unsuspend, verdict, and succession lines', () => {
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
    const verdictLine = {
      schemaVersion: 5,
      kind: 'verdict',
      eventId: 'v1',
      timestamp: '2026-08-25T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      instrumentType: 'qa',
      conceptIds: ['concept-prov1:Imbrication'],
      verdict: 'accepted',
      artifactProvenance: {
        taskId: 'card.generate.v1',
        promptVersion: '2026-08-20',
        modelId: 'workers-ai:test-model',
      },
    };

    expect(reviewLogRecordV5.safeParse(reviewLine).success).toBe(true);
    expect(suspendLogRecordV5.safeParse(suspendLine).success).toBe(true);
    expect(verdictLogRecordV5.safeParse(verdictLine).success).toBe(true);

    for (const line of [reviewLine, suspendLine, verdictLine, successionLine()]) {
      const parsed = reviewLogEntry.safeParse(line);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.kind).toBe(line.kind);
    }
  });

  it('a succession line with verdict-shaped noise does not smuggle through', () => {
    const malformed = successionLine({ verdict: 'accepted', instrumentType: 'mcq' });
    const parsed = reviewLogEntry.safeParse(malformed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('succession');
      expect(parsed.data).not.toHaveProperty('verdict');
      expect(parsed.data).not.toHaveProperty('instrumentType');
    }
  });
});
