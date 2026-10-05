/**
 * T12 (`ol-egov.141.89.104.2`): an authoritative store file that does not read as a record — torn
 * JSON, or a newer build's shape with a value this build does not know — is never written over.
 * Its bytes stay byte-identical: the write is refused with a reported error, and a batch that meets
 * one skips that record and carries on with the rest. A rebuildable cache may still rebuild.
 *
 * Every key, course and wording here is invented.
 */

import { describe, expect, it, vi } from 'vitest';
import { OverlapVault } from '../../test/support/overlap-vault.js';
import { appendEdgeDisposition, edgeDispositionLogPath } from '../concept/disposition.js';
import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  type TopicAnchor,
} from '../concept/key-store.js';
import {
  confirmMergeAuditProposalRecord,
  mergeAuditProposalRecordPath,
  proposeAndPersistMergeAudits,
} from '../concept/merge-audit-store.js';
import {
  listRelationCacheRecords,
  propositionKey,
  relationCacheRecordPath,
  writeRelationCache,
} from '../concept/relation-cache.js';
import {
  confirmSameAsLink,
  proposeSameAsFromMintCollisions,
  proposeSameAsLink,
  sameAsLinkRecordPath,
} from '../concept/same-as.js';
import {
  outcomeConceptNearMatchRecordPath,
  proposeOutcomeConceptNearMatch,
} from '../outcome/near-match.js';
import { UnreadableStoreRecordError } from './store-record.js';

const EMPTY_INDEX = buildConceptKeyCanonicalIndex([]);
const TORN = '{"keyA":"concept-key1:a","keyB":"concept-key1:b","status":"confi';

/** A record from a newer build: readable JSON, but a status this build's guard does not know. */
const NEWER_SAME_AS = `${JSON.stringify(
  {
    keyA: 'concept-key1:a',
    keyB: 'concept-key1:b',
    status: 'merged-elsewhere',
    reason: 'normalisation-collision',
    proposedAt: '2026-10-01T00:00:00.000Z',
    schemaVersion: 2,
  },
  null,
  2,
)}\n`;

function quiet(): () => void {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return () => spy.mockRestore();
}

describe('T12: dispositions — an unreadable log is never written over', () => {
  const key = propositionKey('prerequisite', 'concept-key1:a', 'concept-key1:b');

  for (const [label, bytes] of [
    ['torn JSON', '{"propositionKey":"x","events":[{"kind":"declined","at":"2026'],
    [
      "a newer build's event kind",
      `${JSON.stringify({ propositionKey: key, events: [{ kind: 'withdrawn', at: '2026-10-01' }], schemaVersion: 2 })}\n`,
    ],
  ] as const) {
    it(`${label}: the append is refused and the bytes are kept`, async () => {
      const path = edgeDispositionLogPath(key);
      const vault = new OverlapVault({ [path]: bytes });
      await expect(appendEdgeDisposition(vault, key, 'accepted')).rejects.toThrow(
        UnreadableStoreRecordError,
      );
      expect(vault.raw(path)).toBe(bytes);
      expect(vault.landed).toEqual([]);
    });
  }
});

describe('T12: same-as links — an unreadable record is never written over', () => {
  const path = sameAsLinkRecordPath('concept-key1:a', 'concept-key1:b');

  for (const [label, bytes] of [
    ['torn JSON', TORN],
    ["a newer build's status", NEWER_SAME_AS],
  ] as const) {
    it(`${label}: a proposal is refused and the bytes are kept`, async () => {
      const vault = new OverlapVault({ [path]: bytes });
      await expect(
        proposeSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
          canonicalKeys: EMPTY_INDEX,
        }),
      ).rejects.toThrow(UnreadableStoreRecordError);
      expect(vault.raw(path)).toBe(bytes);
      expect(vault.landed).toEqual([]);
    });

    it(`${label}: a confirm is refused and the bytes are kept`, async () => {
      const vault = new OverlapVault({ [path]: bytes });
      await expect(
        confirmSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
          canonicalKeys: EMPTY_INDEX,
        }),
      ).rejects.toThrow(UnreadableStoreRecordError);
      expect(vault.raw(path)).toBe(bytes);
    });
  }

  it('the mint-collision batch skips the unreadable pair, keeps its bytes, and proposes the rest', async () => {
    const restore = quiet();
    try {
      const vault = new OverlapVault({ [path]: NEWER_SAME_AS });
      const record = (key: string, collision: string): { record: ConceptKeyRecord } => ({
        record: {
          key,
          tier: 2,
          anchor: { kind: 'topic', course: 'COURSEA', name: key, aliases: [] },
          normalizationCollisions: [collision],
          mintedAt: '2026-09-01',
          schemaVersion: 1,
        },
      });
      const proposed = await proposeSameAsFromMintCollisions(
        vault,
        [record('concept-key1:a', 'concept-key1:b'), record('concept-key1:c', 'concept-key1:d')],
        { canonicalKeys: EMPTY_INDEX },
      );
      expect(vault.raw(path)).toBe(NEWER_SAME_AS);
      expect(proposed.map((link) => [link.keyA, link.keyB])).toEqual([
        ['concept-key1:c', 'concept-key1:d'],
      ]);
    } finally {
      restore();
    }
  });
});

describe('T12: the other decision records — never written over', () => {
  it('near match: a proposal over an unreadable record is refused and the bytes are kept', async () => {
    const path = outcomeConceptNearMatchRecordPath('outcome-1', 'concept-key1:a');
    const vault = new OverlapVault({ [path]: TORN });
    await expect(
      proposeOutcomeConceptNearMatch(vault, 'outcome-1', 'concept-key1:a', {
        canonicalKeys: EMPTY_INDEX,
      }),
    ).rejects.toThrow(UnreadableStoreRecordError);
    expect(vault.raw(path)).toBe(TORN);
  });

  function crossCourse(key: string): { record: ConceptKeyRecord } {
    const anchor: TopicAnchor = {
      kind: 'topic',
      course: 'COURSEA',
      name: `wording ${key}`,
      aliases: [],
      introducingPaths: [
        '01 Courses/COURSEA/Week 1/Lecture.md',
        '01 Courses/COURSEB/Week 3/Lecture.md',
      ],
    };
    return { record: { key, tier: 2, anchor, mintedAt: '2026-09-01', schemaVersion: 1 } };
  }

  it('merge audit: the batch skips an unreadable record, keeps its bytes, and proposes the rest', async () => {
    const restore = quiet();
    try {
      const path = mergeAuditProposalRecordPath('concept-key1:a');
      const vault = new OverlapVault({ [path]: TORN });
      const written = await proposeAndPersistMergeAudits(vault, [
        crossCourse('concept-key1:a'),
        crossCourse('concept-key1:b'),
      ]);
      expect(vault.raw(path)).toBe(TORN);
      expect(written.map((record) => record.key)).toEqual(['concept-key1:b']);
    } finally {
      restore();
    }
  });

  it('merge audit: a confirm over an unreadable record is refused and the bytes are kept', async () => {
    const path = mergeAuditProposalRecordPath('concept-key1:a');
    const vault = new OverlapVault({ [path]: TORN });
    await expect(confirmMergeAuditProposalRecord(vault, 'concept-key1:a')).rejects.toThrow(
      UnreadableStoreRecordError,
    );
    expect(vault.raw(path)).toBe(TORN);
  });
});

describe('T12: a rebuildable cache may rebuild', () => {
  it('the relation cache rebuilds an unreadable record from the edges it is given', async () => {
    const key = propositionKey('prerequisite', 'concept-key1:a', 'concept-key1:b');
    const path = relationCacheRecordPath(key);
    const vault = new OverlapVault({ [path]: '{"torn":' });
    const result = await writeRelationCache(
      vault,
      [
        {
          from: 'Widget',
          to: 'Gadget',
          type: 'prerequisite',
          provenance: 'model-proposed',
          confidence: 0.9,
          introducingPassages: {
            from: { sourcePath: 'Notes/one.md', location: { blockIndex: 0 } },
            to: { sourcePath: 'Notes/one.md', location: { blockIndex: 1 } },
          },
          fromKey: 'concept-key1:a',
          toKey: 'concept-key1:b',
        },
      ] as never,
      { canonicalKeys: EMPTY_INDEX },
    );
    expect(result.written).toBe(1);
    expect(await listRelationCacheRecords(vault)).toHaveLength(1);
  });
});
