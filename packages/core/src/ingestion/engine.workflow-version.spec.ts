/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit) — version-aware
 * dedup for `IngestionQueueEngine.enqueue`. Exercises `workflowVersion` in
 * isolation from `engine.spec.ts`'s broader suite: an unchanged version
 * reuses the cache, a bumped version marks the older result stale without
 * re-running anything, and a later real need triggers exactly one lazy
 * re-run. See `engine.ts`'s "Version-aware dedup" doc.
 */
import { describe, expect, it, vi } from 'vitest';
import { IngestionQueueEngine } from './engine.js';
import type {
  Clock,
  DeviceCapability,
  JobRunner,
  PersistedQueue,
  QueueStore,
  RandomSource,
} from './types.js';

class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;

  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }

  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

const clock: Clock = { now: () => 1000 };
const random: RandomSource = { next: () => 0.5 };
const desktop: DeviceCapability = { canDrain: true };
const alwaysSucceeds: JobRunner = async () => ({ ok: true });

describe('enqueue — version-aware dedup (workflowVersion, D-381)', () => {
  it('an unchanged version reuses the cache: a second enqueue with the same contentHash and workflowVersion is a duplicate', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
      clock,
      random,
    });
    const first = await engine.enqueue({
      contentHash: 'abc123',
      label: 'Lecture 1',
      payload: {},
      workflowVersion: 'v1',
    });
    expect(first).toEqual({ status: 'queued' });

    const second = await engine.enqueue({
      contentHash: 'abc123',
      label: 'Lecture 1',
      payload: {},
      workflowVersion: 'v1',
    });
    expect(second).toEqual({ status: 'duplicate', existingStatus: 'queued' });
    expect(engine.list()).toHaveLength(1);
  });

  it('a bumped version marks the older result stale without re-running anything: re-enqueue under a new version is queued, not run, and the old job is untouched', async () => {
    const runner = vi.fn(alwaysSucceeds);
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
      random,
    });

    await engine.enqueue({
      contentHash: 'abc123',
      label: 'Lecture 1',
      payload: {},
      workflowVersion: 'v1',
    });
    await engine.tick(); // v1 job runs to 'done'
    expect(runner).toHaveBeenCalledTimes(1);

    const oldJob = engine.list().find((j) => j.contentHash === 'abc123');
    expect(oldJob?.status).toBe('done');

    // Same content, bumped workflow version — must not be treated as a
    // duplicate of the v1 job, and must not run anything by itself.
    const result = await engine.enqueue({
      contentHash: 'abc123',
      label: 'Lecture 1',
      payload: {},
      workflowVersion: 'v2',
    });
    expect(result).toEqual({ status: 'queued' });
    expect(runner).toHaveBeenCalledTimes(1); // enqueue alone never runs anything

    // The old, version-mismatched result is on the record exactly as before
    // — never rewritten (INV-2 / D-381's clarification).
    const jobs = engine.list();
    expect(jobs).toHaveLength(2);
    const stillOld = jobs.find(
      (j) =>
        j.contentHash === 'abc123' && (j as { workflowVersion?: string }).workflowVersion === 'v1',
    );
    expect(stillOld).toEqual(oldJob);
  });

  it('a later real need triggers exactly one lazy re-run, and only the new-version job runs', async () => {
    const runner = vi.fn(alwaysSucceeds);
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
      random,
    });

    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {}, workflowVersion: 'v1' });
    await engine.tick();
    expect(runner).toHaveBeenCalledTimes(1);

    // The version bump alone (enqueue for v2) never ran anything above.
    await engine.enqueue({
      contentHash: 'h1',
      label: 'L1',
      payload: { v: 2 },
      workflowVersion: 'v2',
    });
    expect(runner).toHaveBeenCalledTimes(1);

    // A real consumer needs it now — the next tick runs exactly one more
    // job (the new-version one), never re-running the old, already-done one.
    const outcome = await engine.tick();
    expect(outcome).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentHash: 'h1', payload: { v: 2 } }),
    );

    const idle = await engine.tick();
    expect(idle).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
  });

  it('omitting workflowVersion entirely leaves behaviour byte-identical to plain content-hash dedup (every current production caller)', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
      clock,
      random,
    });
    await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    const second = await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    expect(second).toEqual({ status: 'duplicate', existingStatus: 'queued' });
    expect(engine.list()).toHaveLength(1);
  });
});
