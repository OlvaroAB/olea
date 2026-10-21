// `ol-egov.141.89.5.98` (D-465): the production construction (`buildIngestionRunner`) passes the transcript
// payload test to the queue engine, so a transcript job an older build failed with the unrecognised-payload
// reason is put back to `queued` once on start and read; a job of another kind with that reason stays failed.
// Every string is invented (INV-3).

import type { PersistedJob, PersistedQueue, QueueStore } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const PLAIN = '01 Courses/CRS-A/Lectures/week 1 transcript.txt';
const SPOKEN = 'Today we cover the idea of a river delta and how sediment settles.\n\nNext, tides.';

class SeededQueueStore implements QueueStore {
  saved: PersistedQueue | null;
  constructor(jobs: PersistedJob[]) {
    this.saved = { version: 1, jobs } as unknown as PersistedQueue;
  }
  async load(): Promise<PersistedQueue | null> {
    return this.saved;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.saved = queue;
  }
}

function failedJob(contentHash: string, payload: unknown): PersistedJob {
  return {
    contentHash,
    label: contentHash,
    payload,
    enqueuedAt: 0,
    status: 'failed',
    attempts: 1,
    failedReason: `unrecognised ingestion job payload for ${contentHash}`,
  } as PersistedJob;
}

describe('the ingestion runner re-arms a transcript job an older build failed', () => {
  it('a failed transcript job with the unrecognised-payload reason is queued on start and read once', async () => {
    const store = new SeededQueueStore([
      failedJob('hash-plain', {
        kind: 'transcript',
        sourcePath: PLAIN,
        transcriptFormat: 'plain-text',
      }),
    ]);
    const landed: string[] = [];
    const { engine } = await buildIngestionRunner({
      vault: memoryVault({ [PLAIN]: SPOKEN }),
      queueStore: store,
      capability: { canDrain: true },
      onUnitsLanded: (units) => {
        for (const unit of units) landed.push(unit.provenance.sourcePath);
      },
    });
    expect(engine.list()[0]?.status).toBe('queued');
    expect(await engine.tick()).toEqual({
      kind: 'ran',
      contentHash: 'hash-plain',
      outcome: 'done',
    });
    expect(landed).toContain(PLAIN);
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(store.saved?.jobs[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('a failed job of another kind with that reason stays failed and nothing runs', async () => {
    const store = new SeededQueueStore([
      failedJob('hash-other', { kind: 'unknown-future-kind', sourcePath: PLAIN }),
    ]);
    const { engine } = await buildIngestionRunner({
      vault: memoryVault({ [PLAIN]: SPOKEN }),
      queueStore: store,
      capability: { canDrain: true },
    });
    expect(engine.list()[0]?.status).toBe('failed');
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(store.saved?.jobs[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });
});
