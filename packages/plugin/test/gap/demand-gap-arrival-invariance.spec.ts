/**
 * `ol-egov.141.89.9.70` item 3 ([D-414], `ol-egov.141.89.48`; moment F's claim G4, `findings/
 * moment-f-preregistration.md`): nothing she adds, and nothing Olea does about it, moves a reading
 * of her. `packages/core/src/mastery/attainment-corpus-invariance.spec.ts` proves it for a stand-in
 * event (a `source-registered` entry in a fold). This proves it on a REAL ARRIVAL PATH: the
 * processed-revision feed reports a new readable revision, the demand-grain re-ask runs over the
 * real evidence gate against a real vault, and afterwards
 *
 *  - the vault holds byte-for-byte what it held (the re-ask writes no review-log entry, no
 *    instrument, no note: `writes` is empty);
 *  - every readiness, vitality and need reading, read back from the review log by the real reader
 *    and folded by the real attainment fold, is bit-for-bit what it was;
 *  - the only thing that moved is the record of the sufficiency verdict, in the record store the
 *    re-ask was handed (an in-memory stand-in: the concrete store is not built,
 *    `ol-egov.141.89.5.26`).
 *
 * **What is not covered, and why.** Generation on arrival (a drafted instrument at the asked
 * demand) does not exist yet, so the "generation path" half of the bead's third item waits for it
 * (`ol-egov.141.89.9.70` stays open for exactly that).
 *
 * Every string here is invented (INV-3); no test calls a model.
 */

import type { ReviewLogRecord } from 'olea-contracts';
import {
  createFsrsScheduler,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  HOLDING_CUT,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  projectInstrumentValidity,
  readAllConceptReadiness,
  readAllEligibleConceptVitality,
  readNeed,
  readReviewLogHistory,
  type WorkerTaskRequest,
} from 'olea-core';
import type { SufficiencyRecord } from 'olea-core/src/gap/demand-gap.js';
import { describe, expect, it } from 'vitest';
import {
  createDemandGapReask,
  createRetrievalSufficiencyAsk,
} from '../../src/gap/demand-gap-reask.js';
import { createProcessedRevisionFeed } from '../../src/ingestion/processed-revisions/feed.js';
import { ObsidianProcessedRevisionStore } from '../../src/ingestion/processed-revisions/store.js';
import { memoryVault } from '../review/memory-vault.js';

const LOG_PATH = '.olea/reviews/2026-01-10.device-a.jsonl';
const CONCEPT_IDS = ['concept-a', 'concept-b'];
const T1 = '2026-01-10T09:00:00-04:00';
const NOW = new Date(Date.parse('2026-01-15T09:00:00-04:00'));

function recall(eventId: string, instrumentId: string, conceptId: string): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: T1,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    supportLevelShown: 'independent',
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  } as ReviewLogRecord;
}

const LOG = `${[recall('r-a1', 'qa:a:1', 'concept-a'), recall('r-b1', 'qa:b:1', 'concept-b')]
  .map((entry) => JSON.stringify(entry))
  .join('\n')}\n`;

/** Every reading of her the attainment chain makes, read back through the real log reader and folded by the real fold. */
async function readingsOfHer(vault: ReturnType<typeof memoryVault>) {
  const { entries } = await readReviewLogHistory(vault, { additionalPaths: [LOG_PATH] });
  const scheduler = createFsrsScheduler();
  const validity = projectInstrumentValidity(entries);
  const readiness = readAllConceptReadiness(entries, CONCEPT_IDS, scheduler, NOW, validity);
  const vitality = readAllEligibleConceptVitality(
    entries,
    CONCEPT_IDS,
    scheduler,
    NOW,
    HOLDING_CUT,
    validity,
  );
  const need = new Map(
    CONCEPT_IDS.map((id) => {
      const reading = readiness.get(id);
      if (reading === undefined) throw new Error(`no readiness reading for ${id}`);
      return [id, readNeed(reading)] as const;
    }),
  );
  return { entries, readiness, vitality, need };
}

// ---- the real evidence gate, over a fake transport (no model is ever called) ----

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (!vector) throw new Error(`no vector registered for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

const FILLER = 100;
const DIM = 2 + FILLER;
const QUERY = 'mitochondria';
const TARGET = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';

async function gateDeps() {
  const provider = new LookupEmbeddingProvider();
  const unit = (position: number) => {
    const vector = new Array(DIM).fill(0);
    vector[position] = 1;
    return vector;
  };
  provider.register(TARGET, unit(0));
  provider.register(QUERY, unit(0));
  const documents: PersistedKeywordIndex['documents'][number][] = [
    {
      path: 'course/lecture.md',
      courses: [],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph' as const, text: TARGET }],
    },
  ];
  for (let i = 0; i < FILLER; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.register(text, unit(2 + i));
    documents.push({
      path: `filler/${i}.md`,
      courses: [],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph' as const, text }],
    });
  }
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return {
    keywordIndex: { version: 1, documents } satisfies PersistedKeywordIndex,
    embeddingCache,
    embeddingProvider: provider,
  };
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

describe('an arrival that re-asks the sufficiency question moves no reading of her (G4, on a real arrival path)', () => {
  it('clears the row on a sufficient verdict, writes nothing to the vault, and every readiness, vitality and need reading is bit-for-bit unchanged', async () => {
    const vault = memoryVault({ [LOG_PATH]: LOG });
    const before = await readingsOfHer(vault);
    // Sanity: the readings are real, so "unchanged" is a claim and not two nulls agreeing.
    expect(before.entries).toHaveLength(2);
    expect(before.readiness.get('concept-a')?.weakest?.instrumentId).toBe('qa:a:1');

    const calls: WorkerTaskRequest[] = [];
    const transport = {
      send: async (request: WorkerTaskRequest): Promise<unknown> => {
        calls.push(request);
        return {
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
          result: { supported: true, reason: 'covers it' },
        };
      },
    };

    const records = new Map<string, SufficiencyRecord>([
      [
        'concept-a',
        {
          conceptKey: 'concept-a',
          demand: 'calculate',
          verdict: 'insufficient',
          evidenceFingerprint: 'fingerprint-before-the-arrival',
        },
      ],
    ]);
    const reask = createDemandGapReask({
      listRecords: async () => [...records.values()],
      saveRecord: async (next) => {
        records.set(next.conceptKey, next);
      },
      resolveConcept: (conceptKey) => ({ conceptKey, conceptName: QUERY, course: 'CRS-A' }),
      ask: createRetrievalSufficiencyAsk({ retrieve: await gateDeps(), transport }),
    });

    const host = new FakeDataHost();
    const feed = createProcessedRevisionFeed({
      store: new ObsidianProcessedRevisionStore(host, () => new Date('2026-01-12T12:00:00')),
      vault,
      manifestsFor: async () => new Map(),
    });
    feed.subscribe(reask.onArrival);
    await feed.start();

    // The arrival: a new note for the course, cleared by the free checks.
    await feed.noteEvaluated('01 Courses/CRS-A/new week.md', 'Newly added invented lecture text.', {
      kind: 'verdict',
    });
    await reask.idle();

    // The re-ask really ran, through the evidence gate, and reached a verdict.
    expect(calls.map((call) => call.taskId)).toEqual(['grounding.judge.v1']);
    expect(records.get('concept-a')?.verdict).toBe('sufficient');
    expect(records.get('concept-a')?.evidenceFingerprint).not.toBe(
      'fingerprint-before-the-arrival',
    );

    // Nothing was written to her vault: no review-log entry, no instrument, no note.
    expect(vault.writes).toEqual([]);
    expect(vault.contentOf(LOG_PATH)).toBe(LOG);

    // No reading of her moved.
    const after = await readingsOfHer(vault);
    expect(after.entries).toEqual(before.entries);
    for (const id of CONCEPT_IDS) {
      expect(after.readiness.get(id)).toEqual(before.readiness.get(id));
      expect(after.vitality.get(id)).toEqual(before.vitality.get(id));
      expect(after.need.get(id)).toEqual(before.need.get(id));
    }
  });

  it('a re-check that cannot run leaves the record and every reading exactly as they were', async () => {
    const vault = memoryVault({ [LOG_PATH]: LOG });
    const before = await readingsOfHer(vault);

    const records = new Map<string, SufficiencyRecord>([
      [
        'concept-a',
        {
          conceptKey: 'concept-a',
          demand: 'calculate',
          verdict: 'partial',
          evidenceFingerprint: 'fp',
        },
      ],
    ]);
    const saves: SufficiencyRecord[] = [];
    const reask = createDemandGapReask({
      listRecords: async () => [...records.values()],
      saveRecord: async (next) => {
        saves.push(next);
      },
      resolveConcept: (conceptKey) => ({ conceptKey, conceptName: QUERY, course: 'CRS-A' }),
      ask: createRetrievalSufficiencyAsk({
        retrieve: await gateDeps(),
        transport: {
          send: async () => {
            throw new Error('network down');
          },
        },
      }),
    });
    const feed = createProcessedRevisionFeed({
      store: new ObsidianProcessedRevisionStore(
        new FakeDataHost(),
        () => new Date('2026-01-12T12:00:00'),
      ),
      vault,
      manifestsFor: async () => new Map(),
    });
    feed.subscribe(reask.onArrival);
    await feed.start();
    await feed.noteEvaluated('01 Courses/CRS-A/new week.md', 'Newly added invented lecture text.', {
      kind: 'verdict',
    });
    await reask.idle();

    expect(saves).toEqual([]);
    expect(records.get('concept-a')?.verdict).toBe('partial');
    expect(reask.notRunFor('concept-a', 'calculate')).toEqual({ reason: 'check-unavailable' });
    expect(vault.writes).toEqual([]);
    const after = await readingsOfHer(vault);
    for (const id of CONCEPT_IDS) {
      expect(after.readiness.get(id)).toEqual(before.readiness.get(id));
      expect(after.need.get(id)).toEqual(before.need.get(id));
    }
  });
});
