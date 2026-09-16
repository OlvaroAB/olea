import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { listRelationCacheRecords, writeRelationCache } from './relation-cache.js';
import {
  confirmSameAsLink,
  edgesEligibleForSplitMigration,
  isSameAsLinkRecord,
  listSameAsLinkRecords,
  proposeSameAsLink,
  remapIncidentRelationCacheRecords,
  sameAsLinkRecordPath,
  severSameAsLink,
} from './same-as.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "Same-as link: a normalisation
// collision proposes, never merges (ONT-R1)", tagged `@auto:core/concept/same-as.spec`.

describe('proposeSameAsLink — a collision proposes, it never merges (ONT-R1)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a proposed record when none exists', async () => {
    const record = await proposeSameAsLink(source, 'key-b', 'key-a', { now: () => '2026-09-16' });
    expect(record.status).toBe('proposed');
    // Canonical sorted order, regardless of call order.
    expect(record.keyA).toBe('key-a');
    expect(record.keyB).toBe('key-b');

    const records = await listSameAsLinkRecords(source);
    expect(records).toHaveLength(1);
    expect(isSameAsLinkRecord(records[0]?.record)).toBe(true);
  });

  it('is idempotent — proposing an already-proposed pair writes nothing new and does not change proposedAt', async () => {
    const first = await proposeSameAsLink(source, 'key-a', 'key-b', { now: () => '2026-09-16' });
    const second = await proposeSameAsLink(source, 'key-a', 'key-b', { now: () => '2026-09-17' });
    expect(second).toEqual(first);
  });

  it('bias to splits: a CONFIRMED pair is left untouched, never re-proposed', async () => {
    await proposeSameAsLink(source, 'key-a', 'key-b');
    const confirmed = await confirmSameAsLink(source, 'key-a', 'key-b');
    const reproposed = await proposeSameAsLink(source, 'key-a', 'key-b');
    expect(reproposed).toEqual(confirmed);
    expect(reproposed.status).toBe('confirmed');
  });

  it('bias to splits: a SEVERED pair — an ambiguous/rejected case — is left severed, never automatically re-proposed or re-linked', async () => {
    await proposeSameAsLink(source, 'key-a', 'key-b');
    await confirmSameAsLink(source, 'key-a', 'key-b');
    const severed = await severSameAsLink(source, 'key-a', 'key-b');

    const resolvedAgain = await proposeSameAsLink(source, 'key-a', 'key-b');
    expect(resolvedAgain.status).toBe('severed');
    expect(resolvedAgain).toEqual(severed);
  });

  it('the automatic path never produces a confirmed link — proposeSameAsLink cannot write status "confirmed"', async () => {
    const record = await proposeSameAsLink(source, 'x', 'y');
    expect(record.status).not.toBe('confirmed');
  });
});

describe('confirmSameAsLink / severSameAsLink — explicit, never automatic', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-confirm-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('throws confirming a pair with no proposal — a confirm must follow a proposal', async () => {
    await expect(confirmSameAsLink(source, 'a', 'b')).rejects.toThrow(/no proposed same-as link/);
  });

  it('throws severing a pair that was never confirmed', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    await expect(severSameAsLink(source, 'a', 'b')).rejects.toThrow(/no confirmed same-as link/);
  });

  it('confirming keeps both keys — nothing is unioned', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    const confirmed = await confirmSameAsLink(source, 'a', 'b', { now: () => '2026-09-16' });
    expect(confirmed.keyA).toBe('a');
    expect(confirmed.keyB).toBe('b');
    expect(confirmed.confirmedAt).toBe('2026-09-16');
  });

  it('severing keeps confirmedAt AND sets severedAt — both facts persist ([D-097]\'s "distinct facts" discipline)', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    await confirmSameAsLink(source, 'a', 'b', { now: () => '2026-09-16' });
    const severed = await severSameAsLink(source, 'a', 'b', { now: () => '2026-09-17' });
    expect(severed.confirmedAt).toBe('2026-09-16');
    expect(severed.severedAt).toBe('2026-09-17');
  });

  it('the link record path is stable regardless of key order', () => {
    expect(sameAsLinkRecordPath('a', 'b')).toBe(sameAsLinkRecordPath('b', 'a'));
  });
});

describe('remapIncidentRelationCacheRecords / edgesEligibleForSplitMigration', () => {
  let root: string;
  let source: FolderSource;

  const introducingPassages = {
    from: { sourcePath: 'A.md', location: { page: 1 } },
    to: { sourcePath: 'B.md', location: { page: 1 } },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-remap-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('remaps an incident edge from the losing key onto the surviving key on confirm', async () => {
    await writeRelationCache(source, [
      {
        type: 'prerequisite',
        from: 'Old wording',
        to: 'Concept C',
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages,
        fromKey: 'losing-key',
        toKey: 'key-c',
      },
    ]);

    await proposeSameAsLink(source, 'surviving-key', 'losing-key');
    await confirmSameAsLink(source, 'surviving-key', 'losing-key');
    const result = await remapIncidentRelationCacheRecords(source, 'surviving-key', 'losing-key');
    expect(result).toEqual({ remapped: 1, collided: 0 });

    const records = await listRelationCacheRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.fromKey).toBe('surviving-key');
    expect(records[0]?.record.remappedFrom?.key).toBe('losing-key');
  });

  it('never auto-reverses a remap on sever — the remapped record surfaces as a migration candidate instead', async () => {
    await writeRelationCache(source, [
      {
        type: 'prerequisite',
        from: 'Old wording',
        to: 'Concept C',
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages,
        fromKey: 'losing-key',
        toKey: 'key-c',
      },
    ]);
    await proposeSameAsLink(source, 'surviving-key', 'losing-key');
    await confirmSameAsLink(source, 'surviving-key', 'losing-key');
    await remapIncidentRelationCacheRecords(source, 'surviving-key', 'losing-key');
    await severSameAsLink(source, 'surviving-key', 'losing-key');

    const candidates = await edgesEligibleForSplitMigration(source, 'surviving-key', 'losing-key');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.fromKey).toBe('surviving-key'); // still remapped — sever does not undo it
  });

  it('a would-be colliding remap is left unremapped and counted, never merged silently', async () => {
    await writeRelationCache(source, [
      {
        type: 'prerequisite',
        from: 'Wording B',
        to: 'Concept C',
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages,
        fromKey: 'losing-key',
        toKey: 'key-c',
      },
      {
        type: 'prerequisite',
        from: 'Wording A',
        to: 'Concept C',
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages,
        fromKey: 'surviving-key',
        toKey: 'key-c',
      },
    ]);

    const result = await remapIncidentRelationCacheRecords(source, 'surviving-key', 'losing-key');
    expect(result).toEqual({ remapped: 0, collided: 1 });
  });
});
