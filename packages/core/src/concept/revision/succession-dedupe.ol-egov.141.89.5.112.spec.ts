/**
 * ol-egov.141.89.5.112: two questions citing one passage, rewritten by one change, each get a
 * successor job through the real queue's dedupe; the same change for the same predecessor is one
 * job. INV-3: every string here is coined.
 */

import { describe, expect, it } from 'vitest';
import { IngestionQueueEngine } from '../../ingestion/engine.js';
import type { PersistedQueue, QueueStore } from '../../ingestion/types.js';
import { buildSuccessorRevisionEnqueueInput } from './enqueue.js';
import type { RevisionEvent } from './types.js';

class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

const eventFor = (instrumentId: string): RevisionEvent => ({
  instrumentId,
  at: 1_000,
  oldContentHash: 'aaaa',
  newContentHash: 'bbbb',
  change: 'the claim changed',
});

async function engine(): Promise<IngestionQueueEngine> {
  return IngestionQueueEngine.create({
    store: new MemoryStore(),
    capability: { canDrain: true },
    runner: async () => ({ ok: true }),
  });
}

describe('successor revision jobs through the real queue dedupe (ol-egov.141.89.5.112)', () => {
  it('two predecessors sharing one rewritten passage each get a job', async () => {
    const q = await engine();
    const a = await q.enqueue(buildSuccessorRevisionEnqueueInput(eventFor('inst-a'), 'new text'));
    const b = await q.enqueue(buildSuccessorRevisionEnqueueInput(eventFor('inst-b'), 'new text'));
    expect(a).toEqual({ status: 'queued' });
    expect(b).toEqual({ status: 'queued' });
    expect(q.snapshot().queued).toBe(2);
  });

  it('the same change for the same predecessor, enqueued twice, is one job', async () => {
    const q = await engine();
    await q.enqueue(buildSuccessorRevisionEnqueueInput(eventFor('inst-a'), 'new text'));
    const again = await q.enqueue(
      buildSuccessorRevisionEnqueueInput(eventFor('inst-a'), 'new text'),
    );
    expect(again).toEqual({ status: 'duplicate', existingStatus: 'queued' });
    expect(q.snapshot().queued).toBe(1);
  });
});
