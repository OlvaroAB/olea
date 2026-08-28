// PERMANENT SUITE — INV-4, P2-T03. Added in orchestrator verification, not by
// the implementing lane, because both properties below are invisible to a test
// that checks the writer's *inputs* rather than the *bytes it produced*.
//
// The review log cannot be backfilled. A defect here is not a bug that gets
// fixed — it is a semester of history that answers a question wrongly, or not
// at all, in November. So this suite reads the file back as bytes and asserts
// on what is actually on disk.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReviewLog } from '../../src/review-log/parse.js';
import { suspendedInstrumentIds } from '../../src/review-log/suspension.js';
import { appendReviewLogRecord, appendSuspendRecord } from '../../src/review-log/write.js';
import { FolderSource } from '../../src/vault/folder-source.js';

const LOG_PATH = '.olea/reviews/2026-08-10.dev.jsonl';

function record(over: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-08-10T09:00:00.000+12:00',
    instrumentId: 'inst-1',
    instrumentType: 'qa',
    conceptIds: ['concept-1'],
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
    ...over,
  } as Parameters<typeof appendReviewLogRecord>[1];
}

function newVault() {
  const root = mkdtempSync(join(tmpdir(), 'olea-review-log-'));
  mkdirSync(join(root, '.olea', 'reviews'), { recursive: true });
  return { root, source: new FolderSource(root) };
}

describe('review-log wire format', () => {
  it('writes every nullable field as an explicit null in the JSON, never as an absent key', async () => {
    const { root, source } = newVault();
    await appendReviewLogRecord(source, record(), { deviceId: 'dev' });
    const line = readFileSync(join(root, LOG_PATH), 'utf8').trim();

    // This is the assertion that catches a future `?? undefined`, and it can
    // only be made against the serialised bytes: `JSON.stringify` silently
    // DROPS an undefined-valued key, so a record that looks correct in memory
    // can reach disk with the key missing entirely.
    //
    // Why that matters more than it sounds (contracts/review-log.ts): the whole
    // point of capturing `planVersion`, `yieldRank` and `examProximity` as
    // explicit nulls in the current phase is that the Phase A baseline and the
    // Phase B comparison are then the SAME SHAPE. An omitted key makes "we had
    // no value" and "we never recorded this field" indistinguishable a semester
    // later, which is precisely the question the A→B checkpoint has to answer.
    expect(line).toContain('"yieldRank":null');
    expect(line).toContain('"examProximity":null');
    expect(line).toContain('"planVersion":null');
  });

  it('and omits masteryAtTime entirely rather than writing a null for it (`ol-g6zg`)', async () => {
    const { root, source } = newVault();
    await appendReviewLogRecord(source, record(), { deviceId: 'dev' });
    const line = readFileSync(join(root, LOG_PATH), 'utf8').trim();

    // The deliberate exception to the rule above, and the two are asserted
    // side by side so the difference stays visible. The three fields above are
    // scalars in a fixed-shape object: an omitted key would make "we had no
    // value" and "we never recorded this field" indistinguishable a semester
    // later. `masteryAtTime` is a map keyed by the record's own concepts, and
    // its only alternative to a value would be an empty map — "a mastery map
    // was recorded and it names none of the concepts" — which is a statement
    // no writer wants to make and which the record-level invariant rejects
    // anyway. So absence carries the meaning `null` used to, and it is the
    // meaning every writer has today: C5.4's rollup does not exist yet.
    expect(line).not.toContain('masteryAtTime');
    expect(Object.hasOwn(JSON.parse(line), 'masteryAtTime')).toBe(false);
  });

  it('survives a crash-truncated trailing line without losing a record on either side of it', async () => {
    const { root, source } = newVault();
    const abs = join(root, LOG_PATH);

    await appendReviewLogRecord(source, record(), { deviceId: 'dev' });
    const afterOne = readFileSync(abs);

    // A crash mid-append leaves a partial JSON line with no terminator. This is
    // not hypothetical: an append is not atomic, and the process is a mobile app
    // that gets backgrounded and killed.
    writeFileSync(abs, Buffer.concat([afterOne, Buffer.from('{"schemaVersi')]));
    const truncated = readFileSync(abs);

    await appendReviewLogRecord(source, record({ instrumentId: 'inst-2' }), { deviceId: 'dev' });
    const afterTwo = readFileSync(abs);

    // Append-only, asserted as bytes: everything that was on disk before the
    // next append — including the corpse — is still there, unchanged, as a
    // literal prefix. A writer that "repaired" the partial line by rewriting it
    // would pass a record-count check and fail this one.
    expect(afterTwo.subarray(0, truncated.length).equals(truncated)).toBe(true);

    const parsed = parseReviewLog(afterTwo.toString('utf8'));
    // The record written before the crash and the one written after it both
    // survive — a corrupt line costs exactly itself and nothing either side.
    // (`[D-133]`'s `succession` kind carries no `instrumentId` — narrowed away
    // here even though nothing in this suite ever writes one, so the static
    // type of `.records`, the whole current-version union, still checks.)
    expect(
      parsed.records
        .filter((r): r is Exclude<typeof r, { kind: 'succession' }> => r.kind !== 'succession')
        .map((r) => r.instrumentId),
    ).toEqual(['inst-1', 'inst-2']);
    // And the corpse is reported rather than silently swallowed: a log that
    // quietly drops unreadable lines is a log that under-reports her study.
    expect(parsed.invalidLines).toHaveLength(1);
  });
});

// D-020. The version bump and the suspension record are persisted decisions, so
// the same rule applies to them as to everything above: assert the BYTES.
describe('review-log wire format — current schema version and suspension events (D-020, `ol-t3sd`, `ol-g6zg`, `ol-tka5`)', () => {
  function suspendInput(over: Record<string, unknown> = {}) {
    return {
      kind: 'suspend',
      timestamp: '2026-08-10T09:30:00.000+12:00',
      instrumentId: 'inst-1',
      conceptIds: ['concept-1'],
      ...over,
    } as Parameters<typeof appendSuspendRecord>[1];
  }

  it('the writer stamps schemaVersion 5 and kind "review" into the bytes it produces', async () => {
    const { root, source } = newVault();
    await appendReviewLogRecord(source, record(), { deviceId: 'dev' });
    const line = readFileSync(join(root, LOG_PATH), 'utf8').trim();
    expect(line).toContain('"schemaVersion":5');
    expect(line).toContain('"kind":"review"');
  });

  it('a suspend event reaches disk with exactly its six fields — nothing nulled out, nothing invented', async () => {
    const { root, source } = newVault();
    await appendSuspendRecord(source, suspendInput(), { deviceId: 'dev' });
    const written = JSON.parse(readFileSync(join(root, LOG_PATH), 'utf8').trim());
    expect(Object.keys(written).sort()).toEqual([
      'conceptIds',
      'eventId',
      'instrumentId',
      'kind',
      'schemaVersion',
      'timestamp',
    ]);
    // Named individually as well as by key set, because the absences are the
    // decision: a suspend is not a review with the review fields set to null,
    // there is no `reason` field F2.6 never asked for, and the device is in
    // the file path rather than the record.
    expect(written).not.toHaveProperty('rating');
    expect(written).not.toHaveProperty('wasUnsure');
    expect(written).not.toHaveProperty('durationMs');
    expect(written).not.toHaveProperty('selectionContext');
    expect(written).not.toHaveProperty('reason');
    expect(written).not.toHaveProperty('deviceId');
  });

  it('stamps kind from its input: unsuspend is written as its own event, not as a flag', async () => {
    const { root, source } = newVault();
    await appendSuspendRecord(source, suspendInput({ kind: 'unsuspend' }), { deviceId: 'dev' });
    expect(readFileSync(join(root, LOG_PATH), 'utf8')).toContain('"kind":"unsuspend"');
  });

  it('suspension and review events share one append path: same daily file, append-only, nothing rewritten', async () => {
    const { root, source } = newVault();
    const abs = join(root, LOG_PATH);

    await appendReviewLogRecord(source, record(), { deviceId: 'dev' });
    const afterReview = readFileSync(abs);

    await appendSuspendRecord(source, suspendInput(), { deviceId: 'dev' });
    const afterSuspend = readFileSync(abs);

    // Byte-level append-only: the review line is still there, unmodified, as a
    // literal prefix. This is the property that would quietly break if the
    // suspend writer had its own copy of the append logic.
    expect(afterSuspend.subarray(0, afterReview.length).equals(afterReview)).toBe(true);

    await appendSuspendRecord(
      source,
      suspendInput({ kind: 'unsuspend', timestamp: '2026-08-10T10:00:00.000+12:00' }),
      {
        deviceId: 'dev',
      },
    );
    const afterUnsuspend = readFileSync(abs);
    expect(afterUnsuspend.subarray(0, afterSuspend.length).equals(afterSuspend)).toBe(true);

    // Unsuspending appended a SECOND event; the suspend is still on disk.
    const parsed = parseReviewLog(afterUnsuspend.toString('utf8'));
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((r) => r.kind)).toEqual(['review', 'suspend', 'unsuspend']);
    expect(suspendedInstrumentIds(parsed.records)).toEqual(new Set());
  });

  it('a suspension event survives a crash-truncated line either side of it', async () => {
    const { root, source } = newVault();
    const abs = join(root, LOG_PATH);

    await appendSuspendRecord(source, suspendInput(), { deviceId: 'dev' });
    const afterOne = readFileSync(abs);
    writeFileSync(abs, Buffer.concat([afterOne, Buffer.from('{"schemaVersion":2,"kind":"unsus')]));

    await appendSuspendRecord(source, suspendInput({ instrumentId: 'inst-2' }), {
      deviceId: 'dev',
    });

    const parsed = parseReviewLog(readFileSync(abs, 'utf8'));
    expect(
      parsed.records
        .filter((r): r is Exclude<typeof r, { kind: 'succession' }> => r.kind !== 'succession')
        .map((r) => r.instrumentId),
    ).toEqual(['inst-1', 'inst-2']);
    expect(parsed.invalidLines).toHaveLength(1);
    expect(suspendedInstrumentIds(parsed.records)).toEqual(new Set(['inst-1', 'inst-2']));
  });

  it('refuses to write a suspension event that fails the schema, before any byte reaches the vault', async () => {
    const { root, source } = newVault();
    await expect(
      appendSuspendRecord(source, suspendInput({ conceptIds: [''] }), { deviceId: 'dev' }),
    ).rejects.toThrow(/schema validation/);
    expect(existsSync(join(root, LOG_PATH))).toBe(false);
  });
});
