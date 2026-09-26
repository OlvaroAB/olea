/**
 * `[D-378]`'s canonical lookup in the edge-disposition read (`ol-egov.141.89.9.56`, round 2): a
 * disposition recorded against a proposition keyed by a superseded same-anchor duplicate counts
 * for the canonical proposition; one recorded for a concept that shares only an introducing
 * passage does not; and where one identity's proposition has logs under more than one key, the
 * latest disposition across them is the current one. Every fixture string is invented (INV-3).
 */

import { describe, expect, it } from 'vitest';
import {
  type EdgeDispositionKind,
  type EdgeDispositionLog,
  excludeDisposedRelationCacheRecords,
  excludedPropositionKeys,
} from './disposition.js';
import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  type TopicAnchor,
} from './key-store.js';
import { propositionKey, type RelationCacheRecord } from './relation-cache.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';
const OTHER = 'concept-key1:xxxx';

const SHARED_INTRODUCING_NOTE = ['01 Courses/TESTC1/Week one.md'];

function topic(name: string, introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'TESTC1',
    name,
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

function conceptRecord(key: string, anchor: TopicAnchor, mintedAt: string): ConceptKeyRecord {
  return { key, tier: 2, anchor, aliases: [], mintedAt, schemaVersion: 1 };
}

const INDEX = buildConceptKeyCanonicalIndex([
  conceptRecord(CANONICAL, topic('Widget theory'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Widget theory'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Gadget theory', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Sprocket theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
  conceptRecord(OTHER, topic('Flange theory'), '2026-09-04'),
]);

function log(
  fromKey: string,
  events: readonly (readonly [EdgeDispositionKind, string])[],
): EdgeDispositionLog {
  return {
    propositionKey: propositionKey('prerequisite', fromKey, OTHER),
    events: events.map(([kind, at]) => ({ kind, at })),
    schemaVersion: 1,
  };
}

function record(fromKey: string): RelationCacheRecord {
  return {
    propositionKey: propositionKey('prerequisite', fromKey, OTHER),
    type: 'prerequisite',
    fromKey,
    toKey: OTHER,
    attestations: [
      {
        provenance: 'model-proposed',
        confidence: 0.6,
        introducingPassages: {
          from: { sourcePath: 'Notes/from.md', location: { page: 1 } },
          to: { sourcePath: 'Notes/to.md', location: { page: 1 } },
        },
        fromName: 'From',
        toName: 'To',
        recordedAt: '2026-09-06T00:00:00.000Z',
      },
    ],
    mintedAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    schemaVersion: 1,
  };
}

describe('edge dispositions read through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  it('excludedPropositionKeys: a decline under a superseded key excludes the canonical proposition; one under a shared-passage partner does not', () => {
    const excluded = excludedPropositionKeys(
      [
        log(DUPLICATE, [['declined', '2026-09-06T00:00:00.000Z']]),
        log(PASSAGE_B, [['declined', '2026-09-06T00:00:00.000Z']]),
      ],
      INDEX,
    );

    expect(excluded.has(propositionKey('prerequisite', CANONICAL, OTHER))).toBe(true);
    expect(excluded.has(propositionKey('prerequisite', PASSAGE_B, OTHER))).toBe(true);
    expect(excluded.has(propositionKey('prerequisite', PASSAGE_A, OTHER))).toBe(false);
  });

  it('the latest disposition across one identity’s logs is the current one, whichever key it was recorded under', () => {
    const laterAccept = excludedPropositionKeys(
      [
        log(DUPLICATE, [['declined', '2026-09-06T00:00:00.000Z']]),
        log(CANONICAL, [['accepted', '2026-09-08T00:00:00.000Z']]),
      ],
      INDEX,
    );
    expect(laterAccept.has(propositionKey('prerequisite', CANONICAL, OTHER))).toBe(false);

    const laterDecline = excludedPropositionKeys(
      [
        log(CANONICAL, [['accepted', '2026-09-06T00:00:00.000Z']]),
        log(DUPLICATE, [['declined', '2026-09-08T00:00:00.000Z']]),
      ],
      INDEX,
    );
    expect(laterDecline.has(propositionKey('prerequisite', CANONICAL, OTHER))).toBe(true);
  });

  it('excludeDisposedRelationCacheRecords: the canonical edge goes when its duplicate was declined; a shared-passage partner’s edge stays', () => {
    const served = excludeDisposedRelationCacheRecords(
      [record(CANONICAL), record(PASSAGE_A)],
      [
        log(DUPLICATE, [['declined', '2026-09-06T00:00:00.000Z']]),
        log(PASSAGE_B, [['declined', '2026-09-06T00:00:00.000Z']]),
      ],
      INDEX,
    );

    expect(served.map((entry) => entry.fromKey)).toEqual([PASSAGE_A]);
  });

  it('with no index given, every log reads by its own key exactly as before', () => {
    const logs = [
      log(DUPLICATE, [['declined', '2026-09-06T00:00:00.000Z']]),
      log(CANONICAL, [['accepted', '2026-09-08T00:00:00.000Z']]),
    ];
    expect([...excludedPropositionKeys(logs)]).toEqual([
      propositionKey('prerequisite', DUPLICATE, OTHER),
    ]);
    expect(
      excludeDisposedRelationCacheRecords([record(CANONICAL), record(DUPLICATE)], logs).map(
        (entry) => entry.fromKey,
      ),
    ).toEqual([CANONICAL]);
  });
});
