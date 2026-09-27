import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  appendCompositionRecord,
  COMPOSITION_LOG_FOLDER,
  compositionLogPath,
  compositionRecordsOfSession,
  readCompositionLog,
  resolveCompositionRecord,
} from './composition-log.js';
import {
  type CompositionRecord,
  parseCompositionRecord,
  serializeCompositionRecord,
} from './composition-record.js';

/** A minimal valid record, built through the strict parser so the fixture is itself checked. */
function record(
  overrides: Partial<Record<keyof CompositionRecord, unknown>> = {},
): CompositionRecord {
  const json = {
    schemaVersion: 1,
    kind: 'compose',
    compositionId: 'composition-key1:a',
    sessionId: 'composition-key1:a',
    parentCompositionId: null,
    composedAt: '2026-09-27T09:00:00+02:00',
    asOf: '2026-09-27',
    reentry: false,
    focusPolicy: 'single',
    course: 'course-a',
    branch: 'deficit',
    groupingSignal: 'none',
    steering: { courses: null, conceptIds: null },
    budgetMinutes: 20,
    planVersion: null,
    policyVersions: {},
    planAllocation: [],
    declaredConstants: {
      urgencyOverrideThreshold: 0.07,
      withinBlockProximityHalfLifeDays: 7,
      materialArrivalCohortHalfLifeDays: 7,
    },
    chosen: [
      {
        instrumentId: 'i-1',
        conceptKey: 'k-1',
        obligationClass: null,
        formatMatch: 'no-preference',
        dedupeReason: null,
        rankedReason: null,
      },
    ],
    setAside: { courses: [], concepts: [], instruments: [] },
    ...overrides,
  };
  const parsed = parseCompositionRecord(json);
  if (parsed === null) throw new Error('fixture is not a valid composition record');
  return parsed;
}

function extension(parent: CompositionRecord, compositionId: string): CompositionRecord {
  return record({
    kind: 'extend',
    compositionId,
    sessionId: parent.sessionId,
    parentCompositionId: parent.compositionId,
    composedAt: '2026-09-27T09:20:00+02:00',
    budgetMinutes: 40,
  });
}

describe('[D-395] composition log', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-composition-log-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("names one file per day per device under Olea's own folder, beside the review log and never inside it", () => {
    expect(COMPOSITION_LOG_FOLDER).toBe('.olea/compositions');
    expect(compositionLogPath('2026-09-27', 'device-1')).toBe(
      '.olea/compositions/2026-09-27.device-1.jsonl',
    );
    expect(() => compositionLogPath('27-09-2026', 'device-1')).toThrow();
    expect(() => compositionLogPath('2026-09-27', '../x')).toThrow();
  });

  it('appends each session as its own record: two sessions on one day and device are two records in one file', async () => {
    const first = record();
    const second = record({
      compositionId: 'composition-key1:b',
      sessionId: 'composition-key1:b',
      composedAt: '2026-09-27T15:00:00+02:00',
    });
    const a = await appendCompositionRecord(vault, first, 'device-1');
    const b = await appendCompositionRecord(vault, second, 'device-1');
    expect(a.path).toBe(b.path);

    const { records } = await readCompositionLog(vault);
    expect(records).toEqual([first, second]);
    expect(new Set(records.map((r) => r.sessionId)).size).toBe(2);
  });

  it('appends an extension as a further record naming the same session, leaving the first record byte-identical', async () => {
    const first = record();
    await appendCompositionRecord(vault, first, 'device-1');
    const path = compositionLogPath('2026-09-27', 'device-1');
    const before = await readFile(join(root, path), 'utf8');

    const grown = extension(first, 'composition-key1:c');
    await appendCompositionRecord(vault, grown, 'device-1');
    const after = await readFile(join(root, path), 'utf8');

    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(before + serializeCompositionRecord(grown));
    const { records } = await readCompositionLog(vault);
    expect(compositionRecordsOfSession(records, first.sessionId)).toEqual([first, grown]);
  });

  it('files a record under the local day of its own composedAt, whatever the UTC day', async () => {
    const lateEvening = record({ composedAt: '2026-09-27T23:30:00-04:00' });
    const { path } = await appendCompositionRecord(vault, lateEvening, 'device-1');
    expect(path).toBe('.olea/compositions/2026-09-27.device-1.jsonl');
  });

  it('closes off a partial trailing line from an interrupted append rather than welding onto it', async () => {
    const path = compositionLogPath('2026-09-27', 'device-1');
    await vault.write(path, '{"schemaVersion":1,"kind":"comp');
    const first = record();
    await appendCompositionRecord(vault, first, 'device-1');
    const { records, invalidLines } = await readCompositionLog(vault);
    expect(records).toEqual([first]);
    expect(invalidLines).toEqual([{ path, lines: [{ lineNumber: 1, reason: 'invalid JSON' }] }]);
  });

  it('finds a probed path on a host whose listing sees nothing', async () => {
    const first = record();
    const { path } = await appendCompositionRecord(vault, first, 'device-1');
    const blind = {
      exists: (p: string) => vault.exists(p),
      read: (p: string) => vault.read(p),
      write: (p: string, c: string) => vault.write(p, c),
      list: async () => [],
    } as unknown as FolderSource;
    expect((await readCompositionLog(blind)).records).toEqual([]);
    expect((await readCompositionLog(blind, [path])).records).toEqual([first]);
  });
});

describe('[D-395] resolveCompositionRecord: by id, exactly one, never by time', () => {
  const first = record();
  const grown = extension(first, 'composition-key1:c');

  it('resolves a first record and an extension each by its own id, and through it to the session', () => {
    const records = [first, grown];
    expect(resolveCompositionRecord(records, first.compositionId)).toEqual(first);
    const resolved = resolveCompositionRecord(records, grown.compositionId);
    expect(resolved).toEqual(grown);
    expect(resolved?.sessionId).toBe(first.sessionId);
  });

  it('does not resolve an unknown id, and does not resolve an id two records carry', () => {
    expect(resolveCompositionRecord([first, grown], 'composition-key1:unknown')).toBeNull();
    expect(resolveCompositionRecord([first, first], first.compositionId)).toBeNull();
  });
});
