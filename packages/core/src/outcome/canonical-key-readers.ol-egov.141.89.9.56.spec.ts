/**
 * `[D-378]`'s canonical lookup, outcome side (`ol-egov.141.89.9.56`): the outcome store's read,
 * its attach, the outcome-to-concept reconciliation and its near-match proposal all resolve a
 * superseded same-anchor duplicate's key to its canonical key, rewrite no stored record, and never
 * join two concepts that share only an introducing passage.
 *
 * `CANONICAL` (minted first) and `DUPLICATE` share one anchor; `PASSAGE_A` and `PASSAGE_B` share
 * an introducing note and wordings that normalise alike, but not an anchor. Every fixture string is
 * invented (INV-3).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  type TopicAnchor,
} from '../concept/key-store.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  listOutcomeConceptNearMatchRecords,
  type OutcomeConceptNearMatchRecord,
  outcomeConceptNearMatchRecordPath,
  proposeOutcomeConceptNearMatch,
} from './near-match.js';
import { conceptRegistryEntryFromRecord, reconcileOutcomeConcepts } from './reconcile.js';
import { attachConceptToOutcome, listOutcomeRecords, outcomeRecordPath } from './store.js';
import type { OutcomeRecord } from './types.js';

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

const CONCEPT_RECORDS: readonly ConceptKeyRecord[] = [
  conceptRecord(CANONICAL, topic('Widget theory'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Widget theory'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Gadget theory', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Gadget Theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
  conceptRecord(OTHER, topic('Flange theory'), '2026-09-04'),
];

function outcome(id: string, label: string, conceptKeys: readonly string[]): OutcomeRecord {
  return {
    id,
    courses: ['TESTC1'],
    source: { path: 'Objectives/week one.md', blockIndex: 0 },
    label,
    conceptKeys,
    status: 'active',
    provenance: { promptVersion: 'v-test', modelVersion: 'm-test' },
    mintedAt: '2026-09-06',
    schemaVersion: 1,
  };
}

function nearMatch(
  outcomeId: string,
  conceptKey: string,
  status: OutcomeConceptNearMatchRecord['status'],
): OutcomeConceptNearMatchRecord {
  return {
    outcomeId,
    conceptKey,
    status,
    reason: 'token-set-containment',
    proposedAt: '2026-09-06T00:00:00.000Z',
    schemaVersion: 1,
  };
}

describe('outcome readers keyed on concept identity resolve through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  let root: string;
  let vault: FolderSource;

  async function seed(path: string, value: unknown): Promise<void> {
    await vault.write(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function raw(path: string): Promise<string> {
    return readFile(join(root, ...path.split('/')), 'utf8');
  }

  async function stored(id: string): Promise<OutcomeRecord> {
    return JSON.parse(await raw(outcomeRecordPath(id))) as OutcomeRecord;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-canonical-keys-'));
    vault = new FolderSource(root);
    for (const record of CONCEPT_RECORDS) await seed(conceptKeyRecordPath(record.key), record);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('listOutcomeRecords reads a superseded duplicate as its canonical key, keeps a shared-passage pair as two, and rewrites nothing', async () => {
    const record = outcome('outcome-key1:o1', 'Widget theory', [
      DUPLICATE,
      CANONICAL,
      PASSAGE_A,
      PASSAGE_B,
    ]);
    await seed(outcomeRecordPath(record.id), record);
    const before = await raw(outcomeRecordPath(record.id));

    const [read] = await listOutcomeRecords(vault);

    expect(read?.record.conceptKeys).toEqual([CANONICAL, PASSAGE_A, PASSAGE_B]);
    expect(await raw(outcomeRecordPath(record.id))).toBe(before);
  });

  it('attachConceptToOutcome treats the canonical key as already attached when its duplicate is, writes a fresh attachment under the canonical key, and attaches a shared-passage partner separately', async () => {
    await seed(outcomeRecordPath('outcome-key1:o1'), outcome('outcome-key1:o1', 'W', [DUPLICATE]));
    await seed(outcomeRecordPath('outcome-key1:o2'), outcome('outcome-key1:o2', 'G', [PASSAGE_A]));
    await seed(outcomeRecordPath('outcome-key1:o3'), outcome('outcome-key1:o3', 'X', []));
    const o1Before = await raw(outcomeRecordPath('outcome-key1:o1'));

    await attachConceptToOutcome(vault, 'outcome-key1:o1', CANONICAL);
    await attachConceptToOutcome(vault, 'outcome-key1:o2', PASSAGE_B);
    await attachConceptToOutcome(vault, 'outcome-key1:o3', DUPLICATE);

    expect(await raw(outcomeRecordPath('outcome-key1:o1'))).toBe(o1Before);
    expect((await stored('outcome-key1:o2')).conceptKeys).toEqual([PASSAGE_A, PASSAGE_B]);
    expect((await stored('outcome-key1:o3')).conceptKeys).toEqual([CANONICAL]);
  });

  it('reconcileOutcomeConcepts attaches a same-anchor pair once, under its canonical key, and a shared-passage pair as two concepts', async () => {
    const widget = outcome('outcome-key1:o1', 'Widget theory', []);
    const gadget = outcome('outcome-key1:o2', 'Gadget theory', []);
    await seed(outcomeRecordPath(widget.id), widget);
    await seed(outcomeRecordPath(gadget.id), gadget);

    const report = await reconcileOutcomeConcepts(
      vault,
      [widget, gadget],
      CONCEPT_RECORDS.map(conceptRegistryEntryFromRecord),
    );

    expect(
      report.attached.filter((a) => a.outcomeId === widget.id).map((a) => a.conceptKey),
    ).toEqual([CANONICAL]);
    expect(
      report.attached
        .filter((a) => a.outcomeId === gadget.id)
        .map((a) => a.conceptKey)
        .sort(),
    ).toEqual([PASSAGE_A, PASSAGE_B]);
    expect((await stored(widget.id)).conceptKeys).toEqual([CANONICAL]);
    expect((await stored(gadget.id)).conceptKeys).toEqual([PASSAGE_A, PASSAGE_B]);
  });

  it('proposeOutcomeConceptNearMatch finds a decision recorded under a superseded key and writes nothing; a shared-passage partner gets its own proposal', async () => {
    await seed(
      outcomeConceptNearMatchRecordPath('outcome-key1:o1', DUPLICATE),
      nearMatch('outcome-key1:o1', DUPLICATE, 'declined'),
    );
    await seed(
      outcomeConceptNearMatchRecordPath('outcome-key1:o1', PASSAGE_B),
      nearMatch('outcome-key1:o1', PASSAGE_B, 'declined'),
    );
    const declinedBytes = await raw(
      outcomeConceptNearMatchRecordPath('outcome-key1:o1', DUPLICATE),
    );

    const canonical = await proposeOutcomeConceptNearMatch(vault, 'outcome-key1:o1', CANONICAL);
    expect(canonical.status).toBe('declined');
    expect(await listOutcomeConceptNearMatchRecords(vault)).toHaveLength(2);
    expect(await raw(outcomeConceptNearMatchRecordPath('outcome-key1:o1', DUPLICATE))).toBe(
      declinedBytes,
    );

    const passage = await proposeOutcomeConceptNearMatch(vault, 'outcome-key1:o1', PASSAGE_A);
    expect(passage.status).toBe('proposed');
    expect(await listOutcomeConceptNearMatchRecords(vault)).toHaveLength(3);
  });
});
