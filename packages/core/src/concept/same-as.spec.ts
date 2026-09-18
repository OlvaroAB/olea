import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { listRelationCacheRecords, writeRelationCache } from './relation-cache.js';
import {
  confirmSameAsLink,
  declineSameAsLink,
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

  it('bias to splits: a DECLINED pair with no evidence fingerprint given is left declined, never automatically re-proposed', async () => {
    await proposeSameAsLink(source, 'key-a', 'key-b');
    const declined = await declineSameAsLink(source, 'key-a', 'key-b');

    const resolvedAgain = await proposeSameAsLink(source, 'key-a', 'key-b');
    expect(resolvedAgain.status).toBe('declined');
    expect(resolvedAgain).toEqual(declined);
  });

  it('a DECLINED pair re-proposed on the SAME evidence fingerprint stays declined ([D-257] ruling 3: "not re-proposed on the evidence it was declined from")', async () => {
    await proposeSameAsLink(source, 'key-a', 'key-b', { evidenceFingerprint: 'fp-1' });
    const declined = await declineSameAsLink(source, 'key-a', 'key-b', { now: () => '2026-09-17' });

    const resolvedAgain = await proposeSameAsLink(source, 'key-a', 'key-b', {
      evidenceFingerprint: 'fp-1',
    });
    expect(resolvedAgain.status).toBe('declined');
    expect(resolvedAgain).toEqual(declined);
  });

  it('a DECLINED pair re-proposed with a CHANGED evidence fingerprint reopens ([D-093] event, [D-257] ruling 3), keeping decline history', async () => {
    await proposeSameAsLink(source, 'key-a', 'key-b', {
      now: () => '2026-09-15',
      evidenceFingerprint: 'fp-1',
    });
    await declineSameAsLink(source, 'key-a', 'key-b', { now: () => '2026-09-16' });

    const reopened = await proposeSameAsLink(source, 'key-a', 'key-b', {
      now: () => '2026-09-18',
      evidenceFingerprint: 'fp-2',
    });
    expect(reopened.status).toBe('proposed');
    expect(reopened.proposedAt).toBe('2026-09-18');
    expect(reopened.evidenceFingerprint).toBe('fp-2');
    // Decline history kept — the record still shows it was declined once.
    expect(reopened.declinedAt).toBe('2026-09-16');
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

describe('isSameAsLinkRecord — the declined shape validates', () => {
  it('accepts a declined record with declinedAt and evidenceFingerprint set', () => {
    expect(
      isSameAsLinkRecord({
        keyA: 'a',
        keyB: 'b',
        status: 'declined',
        reason: 'normalisation-collision',
        proposedAt: '2026-09-15T00:00:00.000Z',
        declinedAt: '2026-09-16T00:00:00.000Z',
        evidenceFingerprint: 'fp-1',
        schemaVersion: 1,
      }),
    ).toBe(true);
  });

  it('rejects a status outside the four-member union', () => {
    expect(
      isSameAsLinkRecord({
        keyA: 'a',
        keyB: 'b',
        status: 'rejected',
        reason: 'normalisation-collision',
        proposedAt: '2026-09-15T00:00:00.000Z',
        schemaVersion: 1,
      }),
    ).toBe(false);
  });
});

describe('declineSameAsLink — the F8.4a triage "no" ([D-257] ruling 3)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-decline-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('throws declining a pair with no proposal — a decline must follow a proposal', async () => {
    await expect(declineSameAsLink(source, 'a', 'b')).rejects.toThrow(/no proposed same-as link/);
  });

  it('declining records a hard labelled negative, never a claim the two concepts differ', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    const declined = await declineSameAsLink(source, 'a', 'b', { now: () => '2026-09-16' });
    expect(declined.status).toBe('declined');
    expect(declined.declinedAt).toBe('2026-09-16');
    expect(declined.keyA).toBe('a');
    expect(declined.keyB).toBe('b');
  });

  it('is idempotent — declining an already-declined pair writes nothing new', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    const first = await declineSameAsLink(source, 'a', 'b', { now: () => '2026-09-16' });
    const second = await declineSameAsLink(source, 'a', 'b', { now: () => '2026-09-17' });
    expect(second).toEqual(first);
  });

  it('a decline never blocks a future confirm — confirmSameAsLink on a declined record moves it to confirmed', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    await declineSameAsLink(source, 'a', 'b', { now: () => '2026-09-16' });
    const confirmed = await confirmSameAsLink(source, 'a', 'b', { now: () => '2026-09-17' });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBe('2026-09-17');
    // Decline history kept alongside the confirm.
    expect(confirmed.declinedAt).toBe('2026-09-16');
  });

  it('declining a CONFIRMED link is rejected — that is a sever, not a decline', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    await confirmSameAsLink(source, 'a', 'b');
    await expect(declineSameAsLink(source, 'a', 'b')).rejects.toThrow(/severSameAsLink instead/);
  });

  it('declining a SEVERED link is rejected — no pending proposal left to decline', async () => {
    await proposeSameAsLink(source, 'a', 'b');
    await confirmSameAsLink(source, 'a', 'b');
    await severSameAsLink(source, 'a', 'b');
    await expect(declineSameAsLink(source, 'a', 'b')).rejects.toThrow(/no pending proposal/);
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
