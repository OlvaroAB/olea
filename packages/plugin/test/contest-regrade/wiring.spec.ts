/**
 * `buildContestRegradeEngineDeps`/`drainContestRegradeQueue` — an end-to-end
 * proof that the composed queue runs on the real `IngestionQueueEngine`
 * (`olea-core`, the same class the ingestion/generation queues use) and,
 * wired with `DEFAULT_CONTEST_REGRADE_ACTIVATION`, drains repeatedly on
 * reconnect without ever calling anything paid AND without ever burning an
 * attempt against the job — see `wiring.ts`'s own doc for why the second
 * half matters (`MAX_ATTEMPTS` would otherwise eventually fail the job by
 * attempt-cap alone).
 */
import { IngestionQueueEngine } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { CONTEST_REGRADE_QUEUE_STORAGE_KEY } from '../../src/contest-regrade/queue-store.js';
import { CONTEST_REGRADE_JOB_KIND } from '../../src/contest-regrade/types.js';
import {
  buildContestRegradeEngineDeps,
  DEFAULT_CONTEST_REGRADE_ACTIVATION,
  drainContestRegradeQueue,
} from '../../src/contest-regrade/wiring.js';
import type { ObsidianDataHost } from '../../src/ingestion/queue-store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('DEFAULT_CONTEST_REGRADE_ACTIVATION', () => {
  it('is off — [D-360]: paid activation stays off until a later ruling', () => {
    expect(DEFAULT_CONTEST_REGRADE_ACTIVATION).toEqual({ enabled: false });
  });
});

describe('buildContestRegradeEngineDeps + drainContestRegradeQueue — end to end on the real IngestionQueueEngine', () => {
  it('enqueues and persists durably, and repeated reconnect-drains make no paid call and burn no attempt while activation is off', async () => {
    const host = new FakeDataHost();
    const judge = { regrade: vi.fn() };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must never be called while activation is off');
    });

    try {
      const deps = buildContestRegradeEngineDeps(
        host,
        {
          judge,
          port: { contestGrade: vi.fn(), resolveContestedGrade: vi.fn() },
          loadDispute: vi.fn(),
          loadRecords: vi.fn(),
          appendCorrectiveRegrade: vi.fn(),
        },
        { canDrain: true },
      );

      const engine = await IngestionQueueEngine.create(deps);
      const enqueueResult = await engine.enqueue({
        contentHash: 'hash-1',
        label: 'Regrade dispute · instrument-1',
        payload: {
          kind: CONTEST_REGRADE_JOB_KIND,
          disputeEventId: 'dispute-1',
          instrumentId: 'instrument-1',
          originalGradeEventId: 'eb-1',
          conceptIds: ['concept-a'],
        },
      });
      expect(enqueueResult).toEqual({ status: 'queued' });

      // Persisted durably, under this queue's own key — never the
      // ingestion queue's.
      expect(host.blob).toHaveProperty(CONTEST_REGRADE_QUEUE_STORAGE_KEY);

      // Simulate several reconnects while activation stays off.
      for (let i = 0; i < 5; i++) {
        const result = await drainContestRegradeQueue(engine, DEFAULT_CONTEST_REGRADE_ACTIVATION);
        expect(result).toEqual({ kind: 'blocked', reason: 'activation-off' });
      }

      expect(judge.regrade).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();

      // The job is still exactly as it was queued — no attempt was ever
      // recorded, because `drainContestRegradeQueue` never called
      // `engine.tick()` at all.
      const persisted = await deps.store.load();
      expect(persisted?.jobs).toEqual([
        expect.objectContaining({ contentHash: 'hash-1', status: 'queued', attempts: 0 }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('the runner itself is a backstop: a direct engine.tick() call while off still makes no paid call (though it does burn an attempt — see wiring.ts for why the drain wrapper, not the runner alone, is what production must call)', async () => {
    const host = new FakeDataHost();
    const judge = { regrade: vi.fn() };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must never be called while activation is off');
    });

    try {
      const deps = buildContestRegradeEngineDeps(
        host,
        {
          judge,
          port: { contestGrade: vi.fn(), resolveContestedGrade: vi.fn() },
          loadDispute: vi.fn(),
          loadRecords: vi.fn(),
          appendCorrectiveRegrade: vi.fn(),
        },
        { canDrain: true },
      );
      const engine = await IngestionQueueEngine.create(deps);
      await engine.enqueue({
        contentHash: 'hash-2',
        label: 'Regrade dispute · instrument-2',
        payload: {
          kind: CONTEST_REGRADE_JOB_KIND,
          disputeEventId: 'dispute-2',
          instrumentId: 'instrument-2',
          originalGradeEventId: 'eb-2',
          conceptIds: ['concept-a'],
        },
      });

      const tickResult = await engine.tick();

      expect(tickResult).toEqual({ kind: 'ran', contentHash: 'hash-2', outcome: 'deferred' });
      expect(judge.regrade).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
