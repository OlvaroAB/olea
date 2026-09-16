import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  appendEdgeDisposition,
  currentDisposition,
  EDGE_DISPOSITION_FOLDER,
  excludeDisposedRelationCacheRecords,
  excludedPropositionKeys,
  isExcludedAtReadTime,
  listEdgeDispositionLogs,
} from './disposition.js';
import {
  listRelationCacheRecords,
  propositionKey,
  type RelationCacheRecord,
  relationCacheRecordsAsConceptRelations,
  writeRelationCache,
} from './relation-cache.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "Disposition events, keyed to the
// proposition identity ([D-097], ONT-R8)", tagged `@auto:core/concept/disposition.spec`.

describe('appendEdgeDisposition — append-only, keyed to the proposition identity', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-disposition-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const key = propositionKey('prerequisite', 'key-a', 'key-b');

  it('creates a log on the first event, under .olea/relation-dispositions/ (INV-6)', async () => {
    const log = await appendEdgeDisposition(source, key, 'accepted', { now: () => '2026-09-16' });
    expect(log.events).toEqual([{ kind: 'accepted', at: '2026-09-16' }]);
    expect(EDGE_DISPOSITION_FOLDER.startsWith('.olea/')).toBe(true);

    const logs = await listEdgeDispositionLogs(source);
    expect(logs).toHaveLength(1);
  });

  it('never rewrites or drops an earlier event — declined and expired are distinct, kept facts', async () => {
    await appendEdgeDisposition(source, key, 'accepted', { now: () => '2026-09-01' });
    await appendEdgeDisposition(source, key, 'declined', { now: () => '2026-09-05' });
    const log = await appendEdgeDisposition(source, key, 'accepted', { now: () => '2026-09-10' });

    expect(log.events).toEqual([
      { kind: 'accepted', at: '2026-09-01' },
      { kind: 'declined', at: '2026-09-05' },
      { kind: 'accepted', at: '2026-09-10' },
    ]);
    expect(currentDisposition(log)).toBe('accepted');
  });

  it('repeating the same kind consecutively is idempotent — no duplicate event', async () => {
    await appendEdgeDisposition(source, key, 'declined', { now: () => '2026-09-01' });
    const log = await appendEdgeDisposition(source, key, 'declined', { now: () => '2026-09-02' });
    expect(log.events).toHaveLength(1);
    expect(log.events[0]?.at).toBe('2026-09-01');
  });

  it('INV-2: byte-identical round trip — the written file reparses to the exact log', async () => {
    await appendEdgeDisposition(source, key, 'accepted', { now: () => '2026-09-16' });
    const [entry] = await listEdgeDispositionLogs(source);
    if (entry === undefined) throw new Error('expected one persisted disposition log');
    const raw = await source.read(entry.path);
    expect(`${JSON.stringify(entry.log, null, 2)}\n`).toBe(raw);
  });
});

describe('isExcludedAtReadTime / read-time exclusion on reject (INV-6)', () => {
  it('declined and expired are excluded; accepted and undefined are served', () => {
    expect(isExcludedAtReadTime('declined')).toBe(true);
    expect(isExcludedAtReadTime('expired')).toBe(true);
    expect(isExcludedAtReadTime('accepted')).toBe(false);
    expect(isExcludedAtReadTime(undefined)).toBe(false);
  });

  it('excludedPropositionKeys reads only the CURRENT (latest) disposition per proposition', () => {
    const keys = excludedPropositionKeys([
      {
        propositionKey: 'p1',
        events: [
          { kind: 'declined', at: '2026-09-01' },
          { kind: 'accepted', at: '2026-09-05' },
        ],
        schemaVersion: 1,
      },
      { propositionKey: 'p2', events: [{ kind: 'declined', at: '2026-09-01' }], schemaVersion: 1 },
    ]);
    // p1's latest disposition is 'accepted', so it is NOT excluded despite an earlier decline.
    expect(keys.has('p1')).toBe(false);
    expect(keys.has('p2')).toBe(true);
  });
});

describe('excludeDisposedRelationCacheRecords — the composable seam into relation-cache read-back', () => {
  let root: string;
  let source: FolderSource;

  const introducingPassages = {
    from: { sourcePath: 'A.md', location: { page: 1 } },
    to: { sourcePath: 'B.md', location: { page: 1 } },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-disposition-exclude-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a declined proposition never reaches deriveRelationSet via relationCacheRecordsAsConceptRelations', async () => {
    await writeRelationCache(source, [
      {
        type: 'prerequisite',
        from: 'Concept A',
        to: 'Concept B',
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages,
        fromKey: 'key-a',
        toKey: 'key-b',
      },
    ]);
    const key = propositionKey('prerequisite', 'key-a', 'key-b');
    const log = await appendEdgeDisposition(source, key, 'declined');

    const records: readonly RelationCacheRecord[] = (await listRelationCacheRecords(source)).map(
      (entry) => entry.record,
    );
    const filtered = excludeDisposedRelationCacheRecords(records, [log]);
    expect(filtered).toHaveLength(0);

    const served = await relationCacheRecordsAsConceptRelations(source, {
      excludePropositionKeys: excludedPropositionKeys([log]),
    });
    expect(served).toHaveLength(0);
  });
});
