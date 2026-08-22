import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { parseReviewLog } from './parse.js';

function record(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 4,
    kind: 'review',
    eventId: 'r1',
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
    // v4: mastery is per concept and lives on the record, not in the context
    // (`ol-g6zg`). One concept here, so one entry.
    masteryAtTime: { attribution: 'per-concept', byConcept: { imbrication: 'coming' } },
    ...overrides,
  };
}

function line(rec: ReviewLogEntry): string {
  return JSON.stringify(rec);
}

describe('parseReviewLog — well-formed content', () => {
  it('empty content yields no records and no invalid lines', () => {
    expect(parseReviewLog('')).toEqual({ records: [], invalidLines: [] });
  });

  it('parses N newline-terminated records in order', () => {
    const r1 = record({ eventId: 'a' });
    const r2 = record({ eventId: 'b' });
    const result = parseReviewLog(`${line(r1)}\n${line(r2)}\n`);
    expect(result.records).toEqual([r1, r2]);
    expect(result.invalidLines).toEqual([]);
  });

  it('parses a final line even when the file has no trailing newline', () => {
    const r1 = record({ eventId: 'a' });
    const result = parseReviewLog(line(r1));
    expect(result.records).toEqual([r1]);
    expect(result.invalidLines).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    const r1 = record({ eventId: 'a' });
    const r2 = record({ eventId: 'b' });
    const result = parseReviewLog(`${line(r1)}\r\n${line(r2)}\r\n`);
    expect(result.records).toEqual([r1, r2]);
    expect(result.invalidLines).toEqual([]);
  });

  it('silently tolerates blank lines, mid-file and trailing', () => {
    const r1 = record({ eventId: 'a' });
    const result = parseReviewLog(`${line(r1)}\n\n\n`);
    expect(result.records).toEqual([r1]);
    expect(result.invalidLines).toEqual([]);
  });
});

describe('parseReviewLog — tolerating a partially-written trailing line (crash mid-append)', () => {
  it('recovers every complete record before a truncated final line, and reports the fragment', () => {
    const r1 = record({ eventId: 'a' });
    const truncated =
      '{"schemaVersion":2,"kind":"review","eventId":"b","timestamp":"2026-08-10T20:1';
    const content = `${line(r1)}\n${truncated}`;

    const result = parseReviewLog(content);
    expect(result.records).toEqual([r1]);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.lineNumber).toBe(2);
    expect(result.invalidLines[0]?.raw).toBe(truncated);
  });

  it('does not throw on a truncated trailing line', () => {
    const truncated = '{"schemaVersion":2,"kind":"review","eventId":"b","timestamp":"2026-08-10T2';
    expect(() => parseReviewLog(truncated)).not.toThrow();
  });
});

describe('parseReviewLog — invalid lines anywhere, not just the last', () => {
  it('isolates a bad JSON line in the middle: everything else still parses', () => {
    const r1 = record({ eventId: 'a' });
    const r3 = record({ eventId: 'c' });
    const content = `${line(r1)}\nnot json at all\n${line(r3)}\n`;

    const result = parseReviewLog(content);
    expect(result.records).toEqual([r1, r3]);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.lineNumber).toBe(2);
  });

  it('isolates a line that is valid JSON but fails schema validation (bad enum value)', () => {
    const r1 = record({ eventId: 'a' });
    const badRating = { ...record({ eventId: 'bad' }), rating: 'not-a-real-rating' };
    const content = `${line(r1)}\n${JSON.stringify(badRating)}\n`;

    const result = parseReviewLog(content);
    expect(result.records).toEqual([r1]);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.reason).toBeTruthy();
  });

  it('rejects — as an invalid line, not a silently-accepted record — a nullable key omitted entirely rather than written as null', () => {
    const withOmittedKey = record({ eventId: 'omitted' });
    // Mirrors a future writer regression: someone drops `examProximity`
    // from the selection context instead of writing `null`. Constructed via
    // a real JS object with the key deleted (not just typed loosely) so the
    // JSON actually serialized here truly lacks the key, the same as a real
    // corrupted/regressed writer's output would.
    const mutableContext: Record<string, unknown> = { ...withOmittedKey.selectionContext };
    delete mutableContext.examProximity;
    const malformed = { ...withOmittedKey, selectionContext: mutableContext };

    const result = parseReviewLog(`${JSON.stringify(malformed)}\n`);
    expect(result.records).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('reports the offending line byte-exactly: `raw` is untrimmed and keeps a CRLF carriage return', () => {
    // ol-inv2remainder: added because a mutation that reported `rawLine.trim()`
    // instead of `rawLine` left the whole suite green. `raw` is the only
    // surviving record of bytes the reader could not interpret, and the
    // whitespace is diagnostic, not noise — leading indentation or a stray
    // \r is what tells you which writer produced the corrupt line, and a
    // report that quietly reshapes the bytes is a report you cannot trust
    // about a log that cannot be backfilled.
    const fragment =
      '   {"schemaVersion":2,"kind":"review","eventId":"b","timestamp":"2026-08-10T20:1   ';
    const result = parseReviewLog(`${fragment}\r\n`);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.raw).toBe(`${fragment}\r`);
  });
});

// D-020: the reader reads `schemaVersion` FIRST and never guesses a shape.
// These are the branch-selection tests for that rule; the round-trip and
// migration evidence against real on-disk history is in
// `test/review-log/golden.spec.ts`.
describe('parseReviewLog — version first, never guess', () => {
  // v1 only ever carried a single `conceptId`, never `conceptIds` — that is
  // the whole reason `upgradeV2` exists (contracts' review-log.ts doc). Built
  // independently of `record()`'s v3 shape, taking `record()`'s single
  // `conceptIds` entry as the one concept v1 could ever have named, so the
  // chained v1 -> v2 -> v3 upgrade below is checked against a genuine v1 line.
  function v1Record(overrides: Record<string, unknown> = {}) {
    const { kind: _dropped, conceptIds, masteryAtTime, selectionContext, ...rest } = record();
    // v1 kept mastery *inside* the context and singular, because a v1 record
    // named one concept and there was nothing else the value could describe.
    // Rebuilding it that way here is what makes the chained upgrade below a
    // test of a genuine v1 line rather than of a lightly-edited current one.
    const singular =
      masteryAtTime?.attribution === 'per-concept'
        ? (Object.values(masteryAtTime.byConcept)[0] ?? null)
        : null;
    return {
      ...rest,
      schemaVersion: 1,
      conceptId: conceptIds[0],
      selectionContext: { ...selectionContext, masteryAtTime: singular },
      ...overrides,
    };
  }

  it('reads a v1 line against the v1 schema and hands back an upgraded v4 review event', () => {
    const result = parseReviewLog(`${JSON.stringify(v1Record({ eventId: 'legacy' }))}\n`);
    expect(result.invalidLines).toEqual([]);
    expect(result.records).toEqual([record({ eventId: 'legacy' })]);
  });

  it('a v1 line that is invalid *as v1* is reported, not retried against v2', () => {
    const result = parseReviewLog(`${JSON.stringify(v1Record({ rating: 'brilliant' }))}\n`);
    expect(result.records).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('a v1 line carrying a kind is still read as v1 — the version decides, not the fields present', () => {
    // v1 has no `kind`; zod strips the unknown key rather than routing the line
    // to v2. The point is that no reader ever infers a version from a shape.
    const result = parseReviewLog(`${JSON.stringify(v1Record({ kind: 'suspend' }))}\n`);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.kind).toBe('review');
  });

  it('reads a v2 suspend line and a v2 unsuspend line from the same file as suspension events', () => {
    const suspend = {
      schemaVersion: 2,
      kind: 'suspend',
      eventId: 's1',
      timestamp: '2026-08-10T09:00:00-04:00',
      instrumentId: 'qa:imbrication:1',
      conceptId: 'imbrication',
    };
    const unsuspend = { ...suspend, kind: 'unsuspend', eventId: 'u1' };
    const result = parseReviewLog(`${JSON.stringify(suspend)}\n${JSON.stringify(unsuspend)}\n`);
    expect(result.invalidLines).toEqual([]);
    expect(result.records.map((r) => r.kind)).toEqual(['suspend', 'unsuspend']);
  });

  it('a v4 line with no kind is invalid — the discriminator is required, never defaulted', () => {
    const { kind: _dropped, ...noKind } = record({ eventId: 'nokind' });
    const result = parseReviewLog(`${JSON.stringify(noKind)}\n`);
    expect(result.records).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('an unknown FUTURE version is reported, never reinterpreted as the newest one this build knows', () => {
    // A newer device writing v5 into a synced vault must not have its records
    // silently re-read as v4 by an older build — that is data loss disguised
    // as tolerance, and the log cannot be backfilled to undo it.
    const future = { ...record({ eventId: 'future' }), schemaVersion: 5 };
    const result = parseReviewLog(`${JSON.stringify(future)}\n`);
    expect(result.records).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.reason).toContain('5');
  });

  it('a line with no schemaVersion at all is reported with a reason saying so', () => {
    const { schemaVersion: _dropped, ...noVersion } = record({ eventId: 'nover' });
    const result = parseReviewLog(`${JSON.stringify(noVersion)}\n`);
    expect(result.records).toEqual([]);
    expect(result.invalidLines[0]?.reason).toContain('schemaVersion');
  });

  it('...and is refused BY THE VERSION GATE, not by a schema it was quietly routed into', () => {
    // ol-inv2remainder: the sibling test above cannot tell those two apart.
    // A mutation replacing the `version === 2` check with `version !== 1` —
    // i.e. the reader guessing the current shape for anything it does not
    // recognise, the exact failure mode this module's doc forbids — left it
    // green, because the zod error from the guessed-at schema also mentions
    // `schemaVersion` (it is the failing key). Only the refusal branch emits
    // this phrasing, so this is the assertion that distinguishes "refused"
    // from "tried v2 and it happened to fail".
    const { schemaVersion: _dropped, ...noVersion } = record({ eventId: 'nover' });
    const result = parseReviewLog(`${JSON.stringify(noVersion)}\n`);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.reason).toContain('guessing one is forbidden');
  });

  it('a line that is valid JSON but not an object at all does not throw', () => {
    const result = parseReviewLog('null\n42\n"a string"\n[]\n');
    expect(result.records).toEqual([]);
    expect(result.invalidLines).toHaveLength(4);
  });

  it('v1 and v4 lines mixed in one file both parse, in file order', () => {
    // The real shape of a synced vault mid-upgrade: an old device's file and a
    // new device's file both exist, and one may even have both.
    const content = `${JSON.stringify(v1Record({ eventId: 'old' }))}\n${line(record({ eventId: 'new' }))}\n`;
    const result = parseReviewLog(content);
    expect(result.invalidLines).toEqual([]);
    expect(result.records.map((r) => r.eventId)).toEqual(['old', 'new']);
    expect(result.records.every((r) => r.schemaVersion === 4)).toBe(true);
  });
});
