import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import { suspendedInstrumentIds } from './suspension.js';
import {
  appendReviewLogRecord,
  appendSuspendRecord,
  type ReviewLogRecordInput,
  type SuspendLogRecordInput,
} from './write.js';

function baseInput(overrides: Partial<ReviewLogRecordInput> = {}): ReviewLogRecordInput {
  return {
    timestamp: '2026-08-10T09:05:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    conceptIds: ['imbrication'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa', 'cloze'],
      planVersion: null,
    },
    // No `masteryAtTime`. Every writer omits it until C5.4's rollup exists
    // (`ol-p4t06`), and absence means "not recorded", which is true. This
    // helper is deliberately the *default* writer shape rather than a maximal
    // one, so the tests below assert what really reaches her vault today.
    ...overrides,
  };
}

describe('appendReviewLogRecord', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-review-log-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('stamps schemaVersion and a generated eventId, and writes to the C5.2 path derived from the timestamp', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'fixed-event-1',
    });

    expect(result.record.schemaVersion).toBe(4);
    expect(result.record.kind).toBe('review');
    expect(result.record.eventId).toBe('fixed-event-1');
    expect(result.path).toBe(reviewLogPath('2026-08-10', 'desktop'));

    const raw = await readFile(join(tempRoot, result.path), 'utf8');
    expect(raw).toBe(`${JSON.stringify(result.record)}\n`);
  });

  it('uses crypto.randomUUID() by default when no generator is supplied', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, baseInput(), { deviceId: 'desktop' });
    expect(result.record.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("derives the file date from the timestamp's own local date, never UTC-normalised", async () => {
    // 2026-08-11T01:15:00+05:00 is 2026-08-10T20:15:00Z in UTC — a UTC-based
    // "which day" calculation would file this under 2026-08-10. The vault
    // path must use the literal local date in the timestamp instead.
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(
      source,
      baseInput({ timestamp: '2026-08-11T01:15:00+05:00' }),
      { deviceId: 'desktop', generateEventId: () => 'e1' },
    );
    expect(result.path).toBe(reviewLogPath('2026-08-11', 'desktop'));
  });

  it('a second append adds exactly one more line and does not rewrite the first', async () => {
    const source = new FolderSource(tempRoot);
    const first = await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'e1',
    });
    const rawAfterFirst = await readFile(join(tempRoot, first.path), 'utf8');

    const second = await appendReviewLogRecord(
      source,
      baseInput({ instrumentId: 'cloze:bioturbation:1', instrumentType: 'cloze' }),
      { deviceId: 'desktop', generateEventId: () => 'e2' },
    );
    const rawAfterSecond = await readFile(join(tempRoot, second.path), 'utf8');

    expect(rawAfterSecond.startsWith(rawAfterFirst)).toBe(true);
    expect(rawAfterSecond).toBe(`${rawAfterFirst}${JSON.stringify(second.record)}\n`);

    const parsed = parseReviewLog(rawAfterSecond);
    expect(parsed.records).toEqual([first.record, second.record]);
    expect(parsed.invalidLines).toEqual([]);
  });

  it('INV-2: appending never alters a single pre-existing byte — proven at the byte level across three appends', async () => {
    const source = new FolderSource(tempRoot);
    const r1 = await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'e1',
    });
    const buf1 = await readFile(join(tempRoot, r1.path));

    const r2 = await appendReviewLogRecord(source, baseInput({ rating: 'again' }), {
      deviceId: 'desktop',
      generateEventId: () => 'e2',
    });
    const buf2 = await readFile(join(tempRoot, r2.path));
    expect(buf2.subarray(0, buf1.length).equals(buf1)).toBe(true);
    expect(buf2.length).toBeGreaterThan(buf1.length);

    const r3 = await appendReviewLogRecord(source, baseInput({ rating: 'hard' }), {
      deviceId: 'desktop',
      generateEventId: () => 'e3',
    });
    const buf3 = await readFile(join(tempRoot, r3.path));
    expect(buf3.subarray(0, buf2.length).equals(buf2)).toBe(true);
    expect(buf3.subarray(0, buf1.length).equals(buf1)).toBe(true);
  });

  it('INV-2 under crash recovery: a pre-existing non-newline-terminated (crash-truncated) file gains only an added `\\n` plus the new line — nothing already on disk is rewritten', async () => {
    const crashContent = '{"schemaVersion":1,"eventId":"stale","timestamp":"2026-08-10T20:1';
    const path = reviewLogPath('2026-08-10', 'desktop');
    const absolute = join(tempRoot, ...path.split('/'));
    await mkdir(join(tempRoot, '.olea', 'reviews'), { recursive: true });
    await writeFile(absolute, crashContent, 'utf8');
    const before = await readFile(absolute);

    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'recovered',
    });
    const after = await readFile(join(tempRoot, result.path));

    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    const expectedAdded = `\n${JSON.stringify(result.record)}\n`;
    expect(after.length).toBe(before.length + Buffer.byteLength(expectedAdded, 'utf8'));

    // And the reader recovers what it can: the crash fragment reported as
    // invalid, the new record intact.
    const parsed = parseReviewLog(after.toString('utf8'));
    expect(parsed.records).toEqual([result.record]);
    expect(parsed.invalidLines).toHaveLength(1);
    expect(parsed.invalidLines[0]?.raw).toBe(crashContent);
  });

  it('validates before writing: a schema-invalid record throws and nothing is written', async () => {
    const source = new FolderSource(tempRoot);
    const invalid = {
      ...baseInput(),
      rating: 'not-a-real-rating',
    } as unknown as ReviewLogRecordInput;

    await expect(appendReviewLogRecord(source, invalid, { deviceId: 'desktop' })).rejects.toThrow();
    expect(await source.exists(reviewLogPath('2026-08-10', 'desktop'))).toBe(false);
  });

  it('regression guard: a nullable selectionContext key omitted entirely (not written as null) is rejected before writing', async () => {
    const source = new FolderSource(tempRoot);
    const input = baseInput();
    const mutableContext: Record<string, unknown> = { ...input.selectionContext };
    delete mutableContext.examProximity;
    const withOmittedKey = {
      ...input,
      selectionContext: mutableContext,
    } as unknown as ReviewLogRecordInput;

    await expect(
      appendReviewLogRecord(source, withOmittedKey, { deviceId: 'desktop' }),
    ).rejects.toThrow(/schema validation/);
    expect(await source.exists(reviewLogPath('2026-08-10', 'desktop'))).toBe(false);
  });

  it('writes every Phase A nullable field as an explicit `null`, never an omitted key', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'e1',
    });
    const raw = await readFile(join(tempRoot, result.path), 'utf8');
    const parsedLine = JSON.parse(raw.trimEnd()) as Record<string, unknown>;
    const context = parsedLine.selectionContext as Record<string, unknown>;

    for (const key of ['examProximity', 'yieldRank', 'planVersion']) {
      expect(Object.hasOwn(context, key)).toBe(true);
      expect(context[key]).toBeNull();
    }
    // The full key set — proves no key silently dropped either, not just
    // the three that happen to be null in Phase A.
    expect(Object.keys(context).sort()).toEqual(
      ['dueState', 'examProximity', 'instrumentTypesOffered', 'planVersion', 'yieldRank'].sort(),
    );
    // `masteryAtTime` left this object with `ol-g6zg` and is not silently
    // still here under the old meaning.
    expect(Object.hasOwn(context, 'masteryAtTime')).toBe(false);
    expect(Object.keys(parsedLine).sort()).toEqual(
      [
        'schemaVersion',
        'kind',
        'eventId',
        'timestamp',
        'instrumentId',
        'instrumentType',
        'conceptIds',
        'rating',
        'wasUnsure',
        'durationMs',
        'selectionContext',
      ].sort(),
    );
    // And `masteryAtTime` is absent from the record too — the one key on a v4
    // review that may be. This is the assertion that would fail the day
    // something starts inventing a mastery value before C5.4 exists.
    expect(Object.hasOwn(parsedLine, 'masteryAtTime')).toBe(false);
  });

  // `ol-g6zg`. Nothing writes these yet — C5.4's rollup (`ol-p4t06`) is the
  // first intended producer. The writer is tested against them anyway, because
  // the guard that matters is the one standing between a future caller's bug
  // and a permanently wrong line in her vault, and it has to exist before the
  // caller does (INV-4).
  describe('masteryAtTime, when a writer does supply it', () => {
    it('writes a per-concept map through to the bytes, keyed by the record’s own concepts', async () => {
      const source = new FolderSource(tempRoot);
      const result = await appendReviewLogRecord(
        source,
        baseInput({
          conceptIds: ['imbrication', 'bioturbation'],
          masteryAtTime: {
            attribution: 'per-concept',
            byConcept: { imbrication: 'sprout', bioturbation: 'sprout' },
          },
        }),
        { deviceId: 'desktop', generateEventId: () => 'e1' },
      );
      const raw = await readFile(join(tempRoot, result.path), 'utf8');
      expect(raw.trimEnd()).toContain(
        '"masteryAtTime":{"attribution":"per-concept","byConcept":{"imbrication":"sprout","bioturbation":"sprout"}}',
      );
    });

    it('refuses a map naming a concept the record does not, before any byte reaches the vault', async () => {
      const source = new FolderSource(tempRoot);
      await expect(
        appendReviewLogRecord(
          source,
          baseInput({
            masteryAtTime: {
              attribution: 'per-concept',
              byConcept: { imbrication: 'sprout', appoggiatura: 'sapling' },
            },
          }),
          { deviceId: 'desktop' },
        ),
      ).rejects.toThrow(/schema validation/);
      expect(await source.exists(reviewLogPath('2026-08-10', 'desktop'))).toBe(false);
    });

    it('refuses a map that omits a concept the record names', async () => {
      const source = new FolderSource(tempRoot);
      await expect(
        appendReviewLogRecord(
          source,
          baseInput({
            conceptIds: ['imbrication', 'bioturbation'],
            masteryAtTime: {
              attribution: 'per-concept',
              byConcept: { imbrication: 'sprout' },
            },
          }),
          { deviceId: 'desktop' },
        ),
      ).rejects.toThrow(/schema validation/);
      expect(await source.exists(reviewLogPath('2026-08-10', 'desktop'))).toBe(false);
    });
  });

  it('accepts explain-back with a null rating and null durationMs (F2.16: explain-back produces no rating)', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(
      source,
      baseInput({
        instrumentId: 'explain-back:cementation:1',
        instrumentType: 'explain-back',
        rating: null,
        durationMs: null,
      }),
      { deviceId: 'desktop', generateEventId: () => 'e1' },
    );
    expect(result.record.rating).toBeNull();
    expect(result.record.durationMs).toBeNull();
  });

  it('accepts MCQ rated "easy" — the schema deliberately does not exclude it (contracts review-log.ts, F2.16)', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendReviewLogRecord(
      source,
      baseInput({ instrumentId: 'mcq:appoggiatura:1', instrumentType: 'mcq', rating: 'easy' }),
      { deviceId: 'desktop', generateEventId: () => 'e1' },
    );
    expect(result.record.rating).toBe('easy');
  });

  it('rejects an invalid device id before writing', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendReviewLogRecord(source, baseInput(), { deviceId: 'has/slash' }),
    ).rejects.toThrow();
  });
});

// F2.6's durable half (D-020). Suspending is an APPEND, not a mutation, and
// unsuspending is a second append rather than a retraction of the first — the
// whole reason the suspended set can be a projection instead of stored state.
describe('appendSuspendRecord', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-suspend-log-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function suspendInput(overrides: Partial<SuspendLogRecordInput> = {}): SuspendLogRecordInput {
    return {
      kind: 'suspend',
      timestamp: '2026-08-10T09:20:00-04:00',
      instrumentId: 'cloze:bioturbation:1',
      conceptIds: ['bioturbation'],
      ...overrides,
    };
  }

  it('appends a suspend event carrying its instrumentId and conceptIds, into the same C5.2 daily file as reviews', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendSuspendRecord(source, suspendInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'suspend-1',
    });

    expect(result.record.schemaVersion).toBe(4);
    expect(result.record.kind).toBe('suspend');
    expect(result.record.eventId).toBe('suspend-1');
    expect(result.record.instrumentId).toBe('cloze:bioturbation:1');
    expect(result.record.conceptIds).toEqual(['bioturbation']);
    expect(result.path).toBe(reviewLogPath('2026-08-10', 'desktop'));

    const raw = await readFile(join(tempRoot, result.path), 'utf8');
    expect(raw).toBe(`${JSON.stringify(result.record)}\n`);
  });

  it('stamps kind from its input — unsuspend goes through the same call', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendSuspendRecord(source, suspendInput({ kind: 'unsuspend' }), {
      deviceId: 'desktop',
      generateEventId: () => 'unsuspend-1',
    });
    expect(result.record.kind).toBe('unsuspend');
  });

  it('unsuspending appends a SECOND event and leaves the original suspend on disk unchanged', async () => {
    const source = new FolderSource(tempRoot);
    const suspend = await appendSuspendRecord(source, suspendInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'suspend-1',
    });
    const afterSuspend = await readFile(join(tempRoot, suspend.path), 'utf8');

    await appendSuspendRecord(
      source,
      suspendInput({ kind: 'unsuspend', timestamp: '2026-08-10T13:00:00-04:00' }),
      { deviceId: 'desktop', generateEventId: () => 'unsuspend-1' },
    );
    const afterUnsuspend = await readFile(join(tempRoot, suspend.path), 'utf8');

    // Not "the suspend line was updated" — the suspend line is still literally
    // the prefix of the file. Nothing was rewritten.
    expect(afterUnsuspend.startsWith(afterSuspend)).toBe(true);
    const parsed = parseReviewLog(afterUnsuspend);
    expect(parsed.records.map((r) => r.kind)).toEqual(['suspend', 'unsuspend']);
    expect(suspendedInstrumentIds(parsed.records)).toEqual(new Set());
  });

  it('suspending mid-session interleaves with reviews in the one file, and no earlier line is rewritten', async () => {
    const source = new FolderSource(tempRoot);
    await appendReviewLogRecord(source, baseInput(), {
      deviceId: 'desktop',
      generateEventId: () => 'r1',
    });
    const beforeSuspend = await readFile(
      join(tempRoot, reviewLogPath('2026-08-10', 'desktop')),
      'utf8',
    );
    const suspend = await appendSuspendRecord(source, suspendInput(), {
      deviceId: 'desktop',
      generateEventId: () => 's1',
    });
    const after = await readFile(join(tempRoot, suspend.path), 'utf8');

    expect(after.startsWith(beforeSuspend)).toBe(true);
    const parsed = parseReviewLog(after);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((r) => r.kind)).toEqual(['review', 'suspend']);
    expect(suspendedInstrumentIds(parsed.records)).toEqual(new Set(['cloze:bioturbation:1']));
  });

  it('uses crypto.randomUUID() by default when no generator is supplied', async () => {
    const source = new FolderSource(tempRoot);
    const result = await appendSuspendRecord(source, suspendInput(), { deviceId: 'desktop' });
    expect(result.record.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('validates before writing: a blank instrumentId never reaches the vault', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendSuspendRecord(source, suspendInput({ instrumentId: '' }), { deviceId: 'desktop' }),
    ).rejects.toThrow(/schema validation/);
  });

  it('rejects an invalid device id before writing', async () => {
    const source = new FolderSource(tempRoot);
    await expect(
      appendSuspendRecord(source, suspendInput(), { deviceId: 'has/slash' }),
    ).rejects.toThrow();
  });
});
