/**
 * `[D-333]`/`[D-341]` (`ol-3ux7.103`, the client complement of the
 * harness-only `olea-service/src/harness/workflowBudget.ts`, `ol-3ux7.75`):
 * one spend allowance per background workflow (one queued job's whole
 * lifecycle). Exercises `EngineDeps.workflowAllowance` in isolation from
 * `engine.spec.ts`'s broader suite — see `engine.ts`'s module doc and
 * `budget.ts`'s `workflowAllowanceExhausted`/`spendFromWorkflowAllowance` doc.
 */
import { describe, expect, it, vi } from 'vitest';
import { IngestionQueueEngine } from './engine.js';
import type {
  Clock,
  DeviceCapability,
  JobRunner,
  PersistedJob,
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

const clock: Clock = { now: () => 1_000 };
const random: RandomSource = { next: () => 0.5 };
const desktop: DeviceCapability = { canDrain: true };
const alwaysSucceeds: JobRunner = async () => ({ ok: true });
const alwaysFailsRetryable: JobRunner = async () => ({ ok: false, retryable: true });

describe('EngineDeps.workflowAllowance — absent (every current production caller)', () => {
  it('never sets workflowAllowanceRemainingUsd on a job, and behaviour is unchanged', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
      clock,
      random,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    const job = engine.list()[0] as { workflowAllowanceRemainingUsd?: number };
    expect(job.workflowAllowanceRemainingUsd).toBeUndefined();

    const outcome = await engine.tick();
    expect(outcome).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });
});

describe('EngineDeps.workflowAllowance — configured', () => {
  it('a new job starts with the full allowance remaining', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
      clock,
      random,
      workflowAllowance: { allowanceUsd: 1, perAttemptCeilingUsd: 0.4 },
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    const job = engine.list()[0] as { workflowAllowanceRemainingUsd?: number };
    expect(job.workflowAllowanceRemainingUsd).toBe(1);
  });

  it('each attempt — success or failure alike — spends the ceiling from what remains ([D-333]: usage including failed calls)', async () => {
    const runner = vi.fn(alwaysFailsRetryable);
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
      random,
      workflowAllowance: { allowanceUsd: 1, perAttemptCeilingUsd: 0.3 },
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    await engine.tick(); // attempt 1: fails retryable, deferred (transient-error backoff)
    let job = engine.list()[0] as { workflowAllowanceRemainingUsd?: number };
    expect(job.workflowAllowanceRemainingUsd).toBeCloseTo(0.7, 10);

    // Force the backoff to have elapsed so the next tick actually attempts again.
    const laterClock: Clock = { now: () => 1_000_000_000 };
    const engine2 = await IngestionQueueEngine.create({
      store: {
        load: async () => ({ version: 1, jobs: engine.list(), headroom: null }),
        save: async () => {},
      },
      capability: desktop,
      runner,
      clock: laterClock,
      random,
      workflowAllowance: { allowanceUsd: 1, perAttemptCeilingUsd: 0.3 },
    });
    await engine2.tick(); // attempt 2: fails again
    job = engine2.list()[0] as { workflowAllowanceRemainingUsd?: number };
    expect(job.workflowAllowanceRemainingUsd).toBeCloseTo(0.4, 10);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('never overspends past what remains, even after several attempts (floors at zero, [D-341])', async () => {
    const runner = vi.fn(alwaysFailsRetryable);
    let stored: PersistedQueue = { version: 1, jobs: [], headroom: null };
    const store: QueueStore = {
      load: async () => stored,
      save: async (queue) => {
        stored = queue;
      },
    };
    let now = 1_000;
    const advancingClock: Clock = { now: () => now };

    const create = () =>
      IngestionQueueEngine.create({
        store,
        capability: desktop,
        runner,
        clock: advancingClock,
        random,
        workflowAllowance: { allowanceUsd: 0.5, perAttemptCeilingUsd: 0.3 },
      });

    const first = await create();
    await first.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await first.tick(); // attempt 1: spends 0.3, remaining floors nowhere near zero yet (0.2 left)

    for (let i = 0; i < 5; i++) {
      now += 60 * 60_000; // far past any backoff so the job is eligible again
      const engine = await create();
      await engine.tick();
    }

    const finalJob = stored.jobs[0] as { workflowAllowanceRemainingUsd?: number };
    // The allowance (0.5) can cover exactly one 0.3 attempt: after the first
    // spend, 0.2 remains — never negative, and never spent further, because
    // every attempt after the first was refused before running (allowance
    // exhausted).
    expect(finalJob.workflowAllowanceRemainingUsd).toBeCloseTo(0.2, 10);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('when what remains cannot cover one more attempt, the job is deferred — resumable, never dropped or failed — and the runner is never called', async () => {
    const runner = vi.fn(alwaysSucceeds);
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
      random,
      workflowAllowance: { allowanceUsd: 0.1, perAttemptCeilingUsd: 0.5 },
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    const outcome = await engine.tick();
    expect(outcome).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'deferred' });
    expect(runner).not.toHaveBeenCalled();

    const job = engine.list()[0];
    expect(job?.status).toBe('deferred');
    expect(job?.deferReason).toBe('transient-error');
    expect(job?.attempts).toBe(0); // no attempt was made — never consumed against MAX_ATTEMPTS
    expect(job?.resumeNotBefore).toBeGreaterThan(clock.now());
  });

  it('an exhausted job does not block a different, unexhausted job from draining on the same tick sequence', async () => {
    // Pre-seeded: one job already down to an allowance too small for another
    // attempt (0.05 remaining, needs 0.5) enqueued BEFORE it exhausted, at a
    // point in the queue's history that arrives first in arrival order —
    // exactly what a real, long-lived job looks like well into its retries.
    const store = new MemoryStore();
    const exhaustedJob: PersistedJob & { readonly workflowAllowanceRemainingUsd: number } = {
      contentHash: 'exhausted',
      label: 'Exhausted',
      payload: {},
      enqueuedAt: 0,
      status: 'queued',
      attempts: 3,
      workflowAllowanceRemainingUsd: 0.05,
    };
    await store.save({
      version: 1,
      jobs: [exhaustedJob],
      headroom: null,
    });

    const runner = vi.fn(alwaysSucceeds);
    const engine = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner,
      clock,
      random,
      workflowAllowance: { allowanceUsd: 1, perAttemptCeilingUsd: 0.5 },
    });

    // Deferred immediately (allowance can't cover one attempt) — nothing ran.
    const first = await engine.tick();
    expect(first).toEqual({ kind: 'ran', contentHash: 'exhausted', outcome: 'deferred' });

    // A second job enqueued fresh (full 1.0 allowance) still drains normally
    // on the very next tick — the first job's exhaustion is per-job, not a
    // whole-engine stall, and does not occupy the "first eligible" slot
    // forever (its own resumeNotBefore moved into the future).
    await engine.enqueue({ contentHash: 'fine', label: 'Fine', payload: {} });
    const second = await engine.tick();
    expect(second).toEqual({ kind: 'ran', contentHash: 'fine', outcome: 'done' });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ contentHash: 'fine' }));
  });

  it('carries workflowAllowanceRemainingUsd on the runner call as an additive extra field — a production JobRunner that ignores it is unaffected', async () => {
    let seen: unknown;
    const capturingRunner: JobRunner = async (view) => {
      seen = view;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: capturingRunner,
      clock,
      random,
      workflowAllowance: { allowanceUsd: 1, perAttemptCeilingUsd: 0.25 },
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await engine.tick();

    expect(seen).toMatchObject({ contentHash: 'h1', workflowAllowanceRemainingUsd: 1 });
  });
});
