/**
 * `IngestionQueueEngine` unit tests. `burst-simulation.spec.ts` alongside
 * this file is the headline 24-lecture-burst test (P3-T03 acceptance); this
 * file exercises each acceptance clause in isolation so a failure here
 * points at the specific mechanism rather than the whole simulation.
 */
import { describe, expect, it } from 'vitest';
import { EXHAUSTED_HEADROOM_THRESHOLD, PACING_HEADROOM_THRESHOLD } from './budget.js';
import { IngestionQueueEngine } from './engine.js';
import type {
  Clock,
  DeviceCapability,
  JobRunner,
  JobRunOutcome,
  PersistedQueue,
  QueueStore,
  RandomSource,
} from './types.js';

/** In-memory `QueueStore` — the same role `ObsidianQueueStore` plays in the plugin, minus Obsidian. */
class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;
  saveCount = 0;

  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }

  async save(queue: PersistedQueue): Promise<void> {
    this.saveCount++;
    // Defensive deep-ish copy: proves the engine doesn't rely on the store
    // holding a live reference back into its own array.
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }

  /** What a second device's `store.load()` would see after a sync — the exact same persisted bytes. */
  snapshot(): PersistedQueue | null {
    return this.state ? { ...this.state, jobs: this.state.jobs.map((j) => ({ ...j })) } : null;
  }
}

class ManualClock implements Clock {
  constructor(private ms: number) {}
  now(): number {
    return this.ms;
  }
  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

const fixedRandom = (value = 0.5): RandomSource => ({ next: () => value });
const desktop: DeviceCapability = { canDrain: true };
const mobile: DeviceCapability = { canDrain: false };

const alwaysSucceeds: JobRunner = async () => ({ ok: true });

function succeedsWithHeadroom(headroom: number): JobRunner {
  return async () => ({ ok: true, budgetHeadroom: headroom });
}

describe('enqueue — idempotent by content hash', () => {
  it('queues a genuinely new content hash', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
    });
    const result = await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    expect(result).toEqual({ status: 'queued' });
    expect(engine.snapshot().queued).toBe(1);
  });

  it('a second enqueue of the same hash is a no-op — never double-queued', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
    });
    await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    const second = await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    expect(second).toEqual({ status: 'duplicate', existingStatus: 'queued' });
    expect(engine.snapshot().queued).toBe(1);
  });

  it('re-enqueueing an already-DONE hash never re-runs the job — the double-charge case D-002 names explicitly', async () => {
    let runCount = 0;
    const runner: JobRunner = async () => {
      runCount++;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
    });
    await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    await engine.tick();
    expect(engine.snapshot().done).toBe(1);
    expect(runCount).toBe(1);

    const result = await engine.enqueue({ contentHash: 'abc123', label: 'Lecture 1', payload: {} });
    expect(result).toEqual({ status: 'duplicate', existingStatus: 'done' });
    await engine.tick(); // nothing eligible — the "duplicate" is done, not queued
    expect(runCount).toBe(1);
  });

  it("a synced duplicate — the same content hash arriving via a second device's persisted queue — never re-runs", async () => {
    let runCount = 0;
    const runner: JobRunner = async () => {
      runCount++;
      return { ok: true };
    };

    // Device A: enqueues and drains to completion.
    const storeA = new MemoryStore();
    const deviceA = await IngestionQueueEngine.create({
      store: storeA,
      capability: desktop,
      runner,
    });
    await deviceA.enqueue({
      contentHash: 'shared-hash',
      label: 'Sonatina in D deck',
      payload: {},
    });
    await deviceA.tick();
    expect(deviceA.snapshot().done).toBe(1);
    expect(runCount).toBe(1);

    // "Sync": device B loads the exact bytes device A persisted.
    const storeB = new MemoryStore();
    await storeB.save(storeA.snapshot() as PersistedQueue);
    const deviceB = await IngestionQueueEngine.create({
      store: storeB,
      capability: desktop,
      runner,
    });

    // Device B's own scan independently rediscovers the same lecture and
    // tries to enqueue it — this is the scenario D-002 names.
    const result = await deviceB.enqueue({
      contentHash: 'shared-hash',
      label: 'Sonatina in D deck',
      payload: {},
    });
    expect(result).toEqual({ status: 'duplicate', existingStatus: 'done' });
    await deviceB.tick();

    // The runner (standing in for a real Worker submission) was never
    // called a second time — no double charge.
    expect(runCount).toBe(1);
    expect(deviceB.snapshot().done).toBe(1);
  });
});

describe('persistence across restarts', () => {
  it('a fresh engine constructed from a persisted store continues where the last one left off', async () => {
    const store = new MemoryStore();
    const first = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner: alwaysSucceeds,
    });
    await first.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await first.enqueue({ contentHash: 'h2', label: 'L2', payload: {} });
    await first.tick(); // completes h1
    expect(first.snapshot()).toMatchObject({ done: 1, queued: 1 });

    // "App restart": discard the in-memory engine, construct a brand-new one
    // from whatever the store has on disk.
    const second = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner: alwaysSucceeds,
    });
    expect(second.snapshot()).toMatchObject({ done: 1, queued: 1 });
    await second.tick(); // completes h2
    expect(second.snapshot()).toMatchObject({ done: 2, queued: 0 });

    const third = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner: alwaysSucceeds,
    });
    expect(third.snapshot()).toMatchObject({ done: 2, queued: 0 });
  });

  it('load() returning null (first run, nothing persisted yet) starts an empty queue without error', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
    });
    expect(engine.snapshot()).toMatchObject({
      queued: 0,
      inFlight: 0,
      done: 0,
      deferred: 0,
      failed: 0,
    });
  });
});

describe('budget headroom scheduling', () => {
  it('drains normally while headroom stays ample', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: succeedsWithHeadroom(0.9),
      random: fixedRandom(),
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    const result = await engine.tick();
    expect(result).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
    expect(engine.snapshot().pacingUntil).toBeNull();
  });

  it('paces (does not stop) when headroom drops into the low band', async () => {
    const clock = new ManualClock(1_000_000);
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: succeedsWithHeadroom(PACING_HEADROOM_THRESHOLD - 0.01),
      clock,
      random: fixedRandom(),
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    const ran = await engine.tick();
    expect(ran).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
    expect(engine.snapshot().pacingUntil).not.toBeNull();

    // A second job is eligible but the pacing gate isn't due yet.
    await engine.enqueue({ contentHash: 'h2', label: 'L2', payload: {} });
    const idle = await engine.tick();
    expect(idle).toEqual({ kind: 'idle', reason: 'pacing' });
    expect(engine.snapshot().done).toBe(1);

    // Time passes the pacing gate — the queue resumes on its own, no restart needed.
    const pacingUntil = engine.snapshot().pacingUntil;
    expect(pacingUntil).not.toBeNull();
    clock.set((pacingUntil as number) + 1);
    const resumed = await engine.tick();
    expect(resumed).toEqual({ kind: 'ran', contentHash: 'h2', outcome: 'done' });
  });

  it('stops cleanly at exhaustion — the remaining queue is deferred, not attempted', async () => {
    const clock = new ManualClock(Date.UTC(2026, 7, 9, 12, 0, 0));
    let calls = 0;
    const runner: JobRunner = async () => {
      calls++;
      // First call reports exhaustion; nothing should call the runner again this session.
      return { ok: true, budgetHeadroom: EXHAUSTED_HEADROOM_THRESHOLD };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await engine.enqueue({ contentHash: 'h2', label: 'L2', payload: {} });
    await engine.enqueue({ contentHash: 'h3', label: 'L3', payload: {} });

    const first = await engine.tick(); // runs h1, observes exhaustion, defers h2 and h3 in one stroke
    expect(first).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });

    const snap = engine.snapshot();
    expect(snap.done).toBe(1);
    expect(snap.deferred).toBe(2);
    expect(snap.deferredReasons['budget-exhausted']).toBe(2);

    // Further ticks this "day" do not attempt anything — zero risk of the
    // failing call the guard exists to prevent.
    const second = await engine.tick();
    expect(second).toEqual({ kind: 'idle', reason: 'budget-exhausted' });
    expect(calls).toBe(1);
  });

  it('resumes automatically once the daily reset instant passes, without needing a restart', async () => {
    const clock = new ManualClock(Date.UTC(2026, 7, 9, 23, 0, 0));
    const runner: JobRunner = async () => ({
      ok: true,
      budgetHeadroom: EXHAUSTED_HEADROOM_THRESHOLD,
    });
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await engine.enqueue({ contentHash: 'h2', label: 'L2', payload: {} });
    await engine.tick(); // exhausts, defers h2
    expect(engine.snapshot().deferred).toBe(1);

    clock.set(Date.UTC(2026, 7, 10, 0, 0, 1)); // just past the UTC reset
    expect(await engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(engine.snapshot()).toMatchObject({ deferred: 0, done: 2 });
  });

  it('the exhaustion instant survives a restart — a fresh engine honours the same reset time rather than re-deriving one from "now"', async () => {
    const clock = new ManualClock(Date.UTC(2026, 7, 9, 12, 0, 0));
    const runner: JobRunner = async () => ({
      ok: true,
      budgetHeadroom: EXHAUSTED_HEADROOM_THRESHOLD,
    });
    const store = new MemoryStore();
    const first = await IngestionQueueEngine.create({ store, capability: desktop, runner, clock });
    await first.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await first.enqueue({ contentHash: 'h2', label: 'L2', payload: {} });
    await first.tick();
    expect(first.snapshot().deferred).toBe(1);

    // Restart mid-exhaustion, still the same day.
    const clock2 = new ManualClock(Date.UTC(2026, 7, 9, 18, 0, 0));
    const second = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner,
      clock: clock2,
    });
    expect(await second.tick()).toEqual({ kind: 'idle', reason: 'budget-exhausted' });

    // Past the *original* reset instant (2026-08-10T00:00:00Z) — resumes.
    clock2.set(Date.UTC(2026, 7, 10, 0, 0, 1));
    expect(await second.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
  });
});

describe('device capability — mobile enqueues but never drains (D-002)', () => {
  it('mobile can enqueue', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: mobile,
      runner: alwaysSucceeds,
    });
    const result = await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    expect(result).toEqual({ status: 'queued' });
  });

  it('mobile never drains — tick() is blocked, the job stays queued, the runner is never called', async () => {
    let called = false;
    const runner: JobRunner = async () => {
      called = true;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: mobile,
      runner,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    const result = await engine.tick();
    expect(result).toEqual({ kind: 'blocked', reason: 'device-cannot-drain' });
    expect(called).toBe(false);
    expect(engine.snapshot()).toMatchObject({ queued: 1, drainBlocked: 'device-cannot-drain' });
  });

  it('a job queued on mobile drains normally once picked up on a desktop device sharing the same store', async () => {
    const store = new MemoryStore();
    const onMobile = await IngestionQueueEngine.create({
      store,
      capability: mobile,
      runner: alwaysSucceeds,
    });
    await onMobile.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    await onMobile.tick(); // no-op, blocked

    const onDesktop = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner: alwaysSucceeds,
    });
    expect(await onDesktop.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });
});

describe('backgrounding and interrupted jobs — pause without job loss', () => {
  it('pause() blocks new work but does not touch what is already queued', async () => {
    let called = false;
    const runner: JobRunner = async () => {
      called = true;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    engine.pause();
    expect(await engine.tick()).toEqual({ kind: 'blocked', reason: 'paused' });
    expect(called).toBe(false);
    expect(engine.snapshot()).toMatchObject({ queued: 1, drainBlocked: 'paused' });

    engine.resume();
    expect(await engine.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });

  it('a job left in-flight by a session that never recorded an outcome is requeued, not lost, on the next load', async () => {
    const store = new MemoryStore();
    // Seed the store as if a prior session persisted the in-flight
    // transition (per the engine's persist-before-await ordering) and then
    // the process died before the runner's promise resolved.
    await store.save({
      version: 1,
      jobs: [
        {
          contentHash: 'h1',
          label: 'Interrupted lecture',
          payload: {},
          enqueuedAt: 0,
          status: 'in-flight',
          attempts: 1,
        },
      ],
      headroom: 0.8,
    });

    let calls = 0;
    const runner: JobRunner = async () => {
      calls++;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({ store, capability: desktop, runner });

    // Requeued, not vanished: visible as queued immediately after restart,
    // before any tick runs.
    expect(engine.snapshot()).toMatchObject({ queued: 1, inFlight: 0 });

    const result = await engine.tick();
    expect(result).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
    expect(engine.snapshot()).toMatchObject({ done: 1, queued: 0 });

    // Exactly one completion is ever recorded for this content hash — not
    // double-run from the resumer's point of view, whatever attempt count
    // the retry carries.
    expect(calls).toBe(1);
    expect(engine.list().filter((j) => j.contentHash === 'h1' && j.status === 'done')).toHaveLength(
      1,
    );
  });

  it('a second requeue-on-load (simulating two crashes in a row) is idempotent', async () => {
    const store = new MemoryStore();
    await store.save({
      version: 1,
      jobs: [
        {
          contentHash: 'h1',
          label: 'L1',
          payload: {},
          enqueuedAt: 0,
          status: 'in-flight',
          attempts: 2,
        },
      ],
      headroom: null,
    });

    await IngestionQueueEngine.create({ store, capability: desktop, runner: alwaysSucceeds });
    const afterFirstRestore = store.snapshot();
    await IngestionQueueEngine.create({ store, capability: desktop, runner: alwaysSucceeds });
    const afterSecondRestore = store.snapshot();

    expect(afterFirstRestore).toEqual(afterSecondRestore);
    expect(afterFirstRestore?.jobs).toEqual([
      { contentHash: 'h1', label: 'L1', payload: {}, enqueuedAt: 0, status: 'queued', attempts: 2 },
    ]);
  });
});

describe('transient failures', () => {
  it('a retryable failure defers the job with a resumeNotBefore, and it retries automatically once due', async () => {
    const clock = new ManualClock(0);
    let attempt = 0;
    const runner: JobRunner = async (): Promise<JobRunOutcome> => {
      attempt++;
      if (attempt === 1) return { ok: false, retryable: true };
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
      clock,
      random: fixedRandom(),
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    const first = await engine.tick();
    expect(first).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'deferred' });
    expect(engine.snapshot().deferredReasons['transient-error']).toBe(1);

    // Not due yet.
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });

    const resumeNotBefore = engine.list()[0]?.resumeNotBefore;
    expect(resumeNotBefore).toBeDefined();
    clock.set((resumeNotBefore as number) + 1);

    const second = await engine.tick();
    expect(second).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });

  it('a non-retryable failure marks the job failed, honestly, and never retries it', async () => {
    let calls = 0;
    const runner: JobRunner = async () => {
      calls++;
      return { ok: false, retryable: false, reason: 'invalid-request: unsupported file type' };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner,
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    expect(await engine.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'failed' });
    expect(engine.snapshot().failed).toBe(1);

    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(calls).toBe(1);
  });
});

describe('a JobRunner that throws (DF-21 seam: what the engine does with a job that throws)', () => {
  // `IngestionQueueEngine` never wraps its call to `runner` in a try/catch —
  // see engine.ts's persist-before-await module doc. A throwing runner is
  // therefore handled exactly like a killed process mid-call: the job was
  // already persisted `in-flight` before the runner ran, `tick()`'s promise
  // rejects instead of resolving to a `TickResult`, and nothing ever calls
  // `recordOutcome`. This is deliberate, not a gap DF-21 introduces — it is
  // the same mechanism the crash half of `burst-simulation.spec.ts` relies
  // on — but the seam was never directly proven in isolation before, and
  // DF-21 is exactly the bead that wires a real runner capable of actually
  // throwing (a vault I/O failure, a malformed embed) into this path.
  it('tick() rejects, the job is left in-flight, and a fresh engine built from the store requeues it — recoverable on restart, not the same session', async () => {
    const store = new MemoryStore();
    const thrown = new Error('vault.readBinary blew up mid-call');
    const runner: JobRunner = async () => {
      throw thrown;
    };
    const engine = await IngestionQueueEngine.create({ store, capability: desktop, runner });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    await expect(engine.tick()).rejects.toBe(thrown);
    // The in-flight transition was persisted before the runner ran
    // (persist-before-await) — the throw happened *after* that write, so
    // the store — and this same engine instance — still show it stuck.
    expect(store.snapshot()?.jobs[0]?.status).toBe('in-flight');
    expect(engine.snapshot()).toMatchObject({ inFlight: 1, done: 0, failed: 0 });

    // No same-session recovery: ticking again re-derives the same
    // eligibility scan, finds nothing `queued` (the stuck job is
    // `in-flight`, not `queued`), and reports idle rather than retrying.
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });

    // "Restart": a fresh engine from the persisted bytes requeues the
    // stale in-flight job — the same mechanism a real killed process
    // recovers through.
    const workingRunner: JobRunner = async () => ({ ok: true });
    const restarted = await IngestionQueueEngine.create({
      store,
      capability: desktop,
      runner: workingRunner,
    });
    expect(restarted.snapshot()).toMatchObject({ queued: 1, inFlight: 0 });
    expect(await restarted.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });
});

describe('honest progress reporting', () => {
  it('snapshot counts reflect reality at every stage, including while a job is genuinely in-flight', async () => {
    // Synchronised on the runner actually being invoked, not on a guessed
    // number of microtask hops — the property under test is "the store was
    // saved as in-flight before the runner's promise resolves", so the test
    // waits for the runner call itself rather than for a fixed tick count.
    let resolveRunner: (outcome: JobRunOutcome) => void = () => {};
    let signalRunnerInvoked: () => void = () => {};
    const runnerInvoked = new Promise<void>((resolve) => {
      signalRunnerInvoked = resolve;
    });
    const runner: JobRunner = () => {
      signalRunnerInvoked();
      return new Promise((resolve) => {
        resolveRunner = resolve;
      });
    };
    const store = new MemoryStore();
    const engine = await IngestionQueueEngine.create({ store, capability: desktop, runner });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    const tickPromise = engine.tick();
    await runnerInvoked;
    // The job is genuinely mid-flight right now — persisted as such, per
    // the persist-before-await ordering — before the runner resolves.
    expect(store.snapshot()?.jobs[0]?.status).toBe('in-flight');
    expect(engine.snapshot()).toMatchObject({ inFlight: 1, done: 0 });

    resolveRunner({ ok: true });
    await tickPromise;
    expect(engine.snapshot()).toMatchObject({ inFlight: 0, done: 1 });
  });

  it('headroom is null (honestly "unknown") until a submission actually reports one', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds, // no budgetHeadroom on this outcome
    });
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    expect(engine.snapshot().headroom).toBeNull();
    await engine.tick();
    expect(engine.snapshot().headroom).toBeNull(); // still unknown — this outcome never reported one
  });
});
