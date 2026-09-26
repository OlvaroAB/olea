/**
 * `./relation-cache.ts`'s new Default-4 (per-endpoint freshness) and Default-3 (producer
 * provenance) surface — `docs/dev/intelligence-build/rel.md` §3, `[ILB-REL-4]`'s (`ol-egov.
 * 141.89.4.4`) acceptance criterion added from `ol-egov.141.89.4.11`: "applies rel.md's
 * per-endpoint freshness rule ... with a test of one stale endpoint beside one current."
 *
 * A dedicated file, not an edit to `./relation-cache.spec.ts` (LANE-RULES: a new test file named
 * for the change, so another lane's edits to that file are never touched).
 *
 * INV-3: every string here is coined. No course code, note title or wording comes from any real
 * vault.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  evaluateRelationCacheRecordFreshness,
  type KeyedConceptRelation,
  propositionKey,
  relationCacheRecordsWithFreshness,
  writeRelationCache,
} from './relation-cache.js';

const introducingPassages = {
  from: { sourcePath: 'A.md', location: { page: 1, section: 'H1' } },
  to: { sourcePath: 'B.md', location: { page: 1, section: 'H2' } },
};

const judgePolicy = {
  task: 'concepts.relations.v1',
  promptVersion: '1.2.0',
  modelIdentity: 'gemma-4-26b',
};

function edge(overrides: Partial<KeyedConceptRelation> = {}): KeyedConceptRelation {
  return {
    type: 'prerequisite',
    from: 'Concept A',
    to: 'Concept B',
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages,
    fromKey: 'ck-a',
    toKey: 'ck-b',
    judgePolicy,
    endpointRevisions: { from: 'rev-1', to: 'rev-1' },
    ...overrides,
  };
}

describe('writeRelationCache — producer provenance is additive and round-trips', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-relation-cache-freshness-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores judgePolicy and endpointRevisions on the attestation, and reads them back', async () => {
    await writeRelationCache(source, [edge()], { now: () => '2026-09-26T00:00:00.000Z' });
    const { all } = await relationCacheRecordsWithFreshness(source, () => 'rev-1');
    expect(all).toHaveLength(1);
    const attestation = all[0]?.record.attestations[0];
    expect(attestation?.judgePolicy).toEqual(judgePolicy);
    expect(attestation?.endpointRevisions).toEqual({ from: 'rev-1', to: 'rev-1' });
  });

  it('a record with no endpointRevisions (an older attestation) reads unverified on both ends', async () => {
    const { endpointRevisions: _omit, ...edgeWithoutRevisions } = edge();
    await writeRelationCache(source, [edgeWithoutRevisions], {
      now: () => '2026-09-26T00:00:00.000Z',
    });
    const { all, servable } = await relationCacheRecordsWithFreshness(source, () => 'rev-1');
    expect(all[0]?.freshness.from).toBe('unverified');
    expect(all[0]?.freshness.to).toBe('unverified');
    expect(all[0]?.freshness.evidenceState).toBe('stale'); // abstains, same as a true stale
    expect(servable).toHaveLength(0);
  });

  describe('one stale endpoint beside one current — the acceptance test', () => {
    it('serves nothing when one endpoint has moved, even though the other is still current', async () => {
      await writeRelationCache(
        source,
        [edge({ endpointRevisions: { from: 'rev-1', to: 'rev-1' } })],
        { now: () => '2026-09-26T00:00:00.000Z' },
      );
      // ck-a is still on rev-1 (current); ck-b has moved to rev-2 (stale).
      const lookup = (key: string): string | undefined => (key === 'ck-a' ? 'rev-1' : 'rev-2');
      const { all, servable } = await relationCacheRecordsWithFreshness(source, lookup);
      expect(all[0]?.freshness.from).toBe('current');
      expect(all[0]?.freshness.to).toBe('stale');
      expect(all[0]?.freshness.evidenceState).toBe('stale');
      expect(servable).toHaveLength(0);
    });

    it('serves the edge when both endpoints are current', async () => {
      await writeRelationCache(
        source,
        [edge({ endpointRevisions: { from: 'rev-1', to: 'rev-1' } })],
        { now: () => '2026-09-26T00:00:00.000Z' },
      );
      const { servable } = await relationCacheRecordsWithFreshness(source, () => 'rev-1');
      expect(servable).toHaveLength(1);
      expect(servable[0]).toMatchObject({ type: 'prerequisite', from: 'Concept A', to: 'Concept B' });
    });
  });

  it('an excluded proposition (a declined disposition) is never counted servable even if current', async () => {
    await writeRelationCache(source, [edge()], { now: () => '2026-09-26T00:00:00.000Z' });
    const { servable } = await relationCacheRecordsWithFreshness(source, () => 'rev-1', {
      excludePropositionKeys: new Set([propositionKey('prerequisite', 'ck-a', 'ck-b')]),
    });
    expect(servable).toHaveLength(0);
  });
});

describe('evaluateRelationCacheRecordFreshness', () => {
  it('reads a record\'s stored best attestation directly, without a vault', () => {
    const record = {
      propositionKey: 'prerequisite ck-a ck-b',
      type: 'prerequisite' as const,
      fromKey: 'ck-a',
      toKey: 'ck-b',
      attestations: [
        {
          provenance: 'model-proposed' as const,
          confidence: 0.7,
          introducingPassages,
          fromName: 'Concept A',
          toName: 'Concept B',
          recordedAt: '2026-09-26T00:00:00.000Z',
          endpointRevisions: { from: 'rev-1', to: 'rev-1' },
        },
      ],
      mintedAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z',
      schemaVersion: 1,
    };
    const lookup = (key: string): string | undefined => (key === 'ck-a' ? 'rev-1' : 'rev-9');
    const freshness = evaluateRelationCacheRecordFreshness(record, lookup);
    expect(freshness.from).toBe('current');
    expect(freshness.to).toBe('stale');
    expect(freshness.evidenceState).toBe('stale');
  });
});
