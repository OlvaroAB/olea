/**
 * `[D-477]` through the plugin's resolve step (`resolveOutcomeCandidates`, shared by
 * `runOutcomesExtract` and the production trigger): several outcomes the Worker anchors to one
 * passage each become their own record, a rereading returns the same records, and outcomes reworded
 * beyond the near rule mint new ones. Built under `ol-egov.141.89.7.43`.
 *
 * Every fixture string is invented (INV-3).
 */
import {
  listOutcomeRecords,
  type OutcomeProvenance,
  type OutcomeSourceReference,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildOutcomesExtractWiring, runOutcomesExtract } from '../../src/ingestion/wiring.js';
import {
  type PersistedWorkerConfig,
  WORKER_CONFIG_STORAGE_KEY,
} from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';
import { memoryVault } from '../review/memory-vault.js';

const PROVENANCE: OutcomeProvenance = { promptVersion: 'v-test', modelVersion: 'm-test' };
const DOC = 'Objectives/gadget objectives.pdf';

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

interface ScriptedOutcome {
  readonly label: string;
  readonly confidence: number;
  readonly anchorIndex: number;
}

/** A Worker that answers every `outcomes.extract.v1` call with `outcomes`, numbering the chunks it was sent. */
async function readerAnswering(outcomes: () => readonly ScriptedOutcome[]) {
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
      return {
        ok: true,
        result: {
          outcomes: outcomes(),
          paperStructure: { sections: [] },
          numbering: {
            chunks: chunks.map((chunk, i) => ({ sentIndex: i + 1, length: chunk.length })),
          },
        },
      };
    },
  };
  const { reader } = await buildOutcomesExtractWiring({
    dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
    createTransport: (_config: WorkerConfig) => transport,
  });
  if (reader === null) throw new Error('expected a configured reader');
  return reader;
}

const PAGE_ONE: OutcomeSourceReference = { path: DOC, blockIndex: 0 };
const PAGE_TWO: OutcomeSourceReference = { path: DOC, blockIndex: 1 };
const PASSAGES = [
  {
    text: 'Invented page one: the widget crank, the gadget lid and the sprocket hinge.',
    anchor: PAGE_ONE,
  },
  { text: 'Invented page two: the lever spring and the gear housing.', anchor: PAGE_TWO },
];
const OPTIONS = {
  documentKind: 'objectives' as const,
  courses: ['TESTC101'],
  provenance: PROVENANCE,
};

const STATED: readonly ScriptedOutcome[] = [
  { label: 'Explain the widget crank', confidence: 0.9, anchorIndex: 1 },
  { label: 'Describe the gadget lid', confidence: 0.8, anchorIndex: 1 },
  { label: 'Compare the sprocket hinge', confidence: 0.7, anchorIndex: 1 },
  { label: 'Outline the lever spring', confidence: 0.9, anchorIndex: 2 },
  { label: 'Identify the gear housing', confidence: 0.6, anchorIndex: 2 },
];

describe('outcome identity through the plugin resolve step ([D-477], ol-egov.141.89.7.43)', () => {
  it('mints one record per outcome when three share one page, and a rereading returns the same five', async () => {
    const reader = await readerAnswering(() => STATED);
    const vault = memoryVault();

    const first = await runOutcomesExtract(vault, reader, PASSAGES, OPTIONS);
    expect(first.outcomes.map((outcome) => outcome.label)).toEqual(
      STATED.map((outcome) => outcome.label),
    );
    expect(new Set(first.outcomes.map((outcome) => outcome.id)).size).toBe(5);
    expect(await listOutcomeRecords(vault)).toHaveLength(5);
    expect(first.outcomes.every((outcome) => outcome.source.labelDigest?.startsWith('v1:'))).toBe(
      true,
    );

    const writes = vault.writes.length;
    const again = await runOutcomesExtract(vault, reader, PASSAGES, OPTIONS);
    expect(again.outcomes.map((outcome) => outcome.id)).toEqual(
      first.outcomes.map((outcome) => outcome.id),
    );
    expect(vault.writes.length).toBe(writes);
  });

  it('keeps an id through punctuation and case drift, and mints a new record for a reworded outcome', async () => {
    let answer: readonly ScriptedOutcome[] = STATED;
    const reader = await readerAnswering(() => answer);
    const vault = memoryVault();
    const first = await runOutcomesExtract(vault, reader, PASSAGES, OPTIONS);

    answer = [
      { label: 'Explain the Widget Crank.', confidence: 0.95, anchorIndex: 1 },
      { label: 'Describe the gadget lid', confidence: 0.8, anchorIndex: 1 },
      { label: 'Evaluate the sprocket hinge tolerances', confidence: 0.7, anchorIndex: 1 },
    ];
    const revised = await runOutcomesExtract(vault, reader, PASSAGES, OPTIONS);

    expect(revised.outcomes[0]?.id).toBe(first.outcomes[0]?.id);
    // A match returns the record as stored: the first self-rating is kept.
    expect(revised.outcomes[0]?.extractorSelfRating).toBe(0.9);
    expect(revised.outcomes[1]?.id).toBe(first.outcomes[1]?.id);
    expect(first.outcomes.map((outcome) => outcome.id)).not.toContain(revised.outcomes[2]?.id);
    expect(await listOutcomeRecords(vault)).toHaveLength(6);
  });
});
