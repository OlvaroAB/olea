/**
 * `[D-378]`'s canonical lookup in the outcome reconciliation's composition root
 * (`runOutcomesExtractAndReconcile`, `ol-egov.141.89.9.56`): a concept held by two same-anchor key
 * records is attached to its outcome once, under the canonical key; two concepts that share only an
 * introducing passage are attached as two. The concept key records themselves are not rewritten.
 *
 * Every fixture string is invented (INV-3).
 */
import {
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  type OutcomeProvenance,
  type OutcomeSourceReference,
  type TopicAnchor,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildOutcomesExtractWiring,
  runOutcomesExtractAndReconcile,
} from '../../src/ingestion/wiring.js';
import {
  type PersistedWorkerConfig,
  WORKER_CONFIG_STORAGE_KEY,
} from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';
import { memoryVault } from '../review/memory-vault.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';

const SHARED_INTRODUCING_NOTE = ['01 Courses/TESTC101/Week one.md'];
const PROVENANCE: OutcomeProvenance = { promptVersion: 'v-test', modelVersion: 'm-test' };

function topic(name: string, introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'TESTC101',
    name,
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

function conceptRecord(key: string, anchor: TopicAnchor, mintedAt: string): ConceptKeyRecord {
  return { key, tier: 2, anchor, aliases: [], mintedAt, schemaVersion: 1 };
}

const CONCEPT_RECORDS: readonly ConceptKeyRecord[] = [
  conceptRecord(CANONICAL, topic('Cell biology'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Cell biology'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Membrane transport', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Membrane Transport', SHARED_INTRODUCING_NOTE), '2026-09-03'),
];

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

describe('runOutcomesExtractAndReconcile resolves concept keys through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  it('attaches a same-anchor pair once under its canonical key, and a shared-passage pair as two concepts', async () => {
    const transport = {
      send: async (_request: WorkerTaskRequest) => ({
        ok: true,
        result: {
          outcomes: [
            { label: 'Cell biology', confidence: 0.9, anchorIndex: 1 },
            { label: 'Membrane transport', confidence: 0.8, anchorIndex: 1 },
          ],
          paperStructure: { sections: [] },
        },
      }),
    };
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const files: Record<string, string> = {};
    for (const record of CONCEPT_RECORDS) {
      files[conceptKeyRecordPath(record.key)] = `${JSON.stringify(record, null, 2)}\n`;
    }
    const vault = memoryVault(files);
    const anchor: OutcomeSourceReference = { path: 'Objectives/week one.md', blockIndex: 0 };

    const result = await runOutcomesExtractAndReconcile(
      vault,
      reader,
      [{ text: 'Cell biology and membrane transport, with invented examples.', anchor }],
      { documentKind: 'objectives', courses: ['TESTC101'], provenance: PROVENANCE },
    );

    const cell = result.outcomes.find((outcome) => outcome.label === 'Cell biology');
    const membrane = result.outcomes.find((outcome) => outcome.label === 'Membrane transport');
    expect(cell?.conceptKeys).toEqual([CANONICAL]);
    expect([...(membrane?.conceptKeys ?? [])].sort()).toEqual([PASSAGE_A, PASSAGE_B]);
    expect(
      result.reconciliation.attached
        .filter((attachment) => attachment.outcomeId === cell?.id)
        .map((attachment) => attachment.conceptKey),
    ).toEqual([CANONICAL]);
    // No concept key record was written to.
    expect(vault.writes.filter((path) => path.startsWith('.olea/concepts/'))).toEqual([]);
  });
});
