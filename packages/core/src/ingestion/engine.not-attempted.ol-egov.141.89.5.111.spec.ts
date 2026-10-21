/**
 * `ol-egov.141.89.5.111`: a retryable outcome marked `notAttempted` (the call the job exists for
 * could not be made: no Worker configured, or the Worker unreachable) defers the job without
 * counting the attempt, so an outage of any length never fails a job, and the job resumes once the
 * call can be made. Counted retries keep their cap, and nothing persisted changes shape.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, MAX_BACKOFF_MS, MIN_BACKOFF_MS } from './budget.js';
import { IngestionQueueEngine } from './engine.js';
import type {
  Clock,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  PersistedQueue,
  QueueStore,
} from './types.js';

class MemoryStore implements QueueStore {
  state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

class ManualClock implements Clock {
  constructor(private ms: number) {}
  now(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

const NOT_ATTEMPTED: JobRunOutcome = { ok: false, retryable: true, notAttempted: true };
const COUNTED: JobRunOutcome = { ok: false, retryable: true };

/** A runner that answers from a script, one outcome per call, recording the attempts it was shown. */
function scripted(outcomes: () => JobRunOutcome): { runner: JobRunner; seen: number[] } {
  const seen: number[] = [];
  return {
    seen,
    runner: async (job: JobRunnerView) => {
      seen.push(job.attempts);
      return outcomes();
    },
  };
}

async function engineWith(
  runner: JobRunner,
  store = new MemoryStore(),
  clock = new ManualClock(0),
) {
  const engine = await IngestionQueueEngine.create({
    store,
    capability: { canDrain: true },
    runner,
    clock,
    random: { next: () => 0.5 },
  });
  return { engine, store, clock };
}

/** Ticks once, then moves the clock just past the job's backoff. Returns the delay it was given. */
async function tickPastBackoff(
  engine: IngestionQueueEngine,
  clock: ManualClock,
): Promise<number | undefined> {
  const before = clock.now();
  await engine.tick();
  const resume = engine.list()[0]?.resumeNotBefore;
  if (resume !== undefined) clock.set(resume + 1);
  return resume === undefined ? undefined : resume - before;
}

describe('a notAttempted outcome is not counted (ol-egov.141.89.5.111)', () => {
  it('a job that cannot make its call for three times the cap is never failed, keeps zero attempts, and completes once it can', async () => {
    let reachable = false;
    const { runner, seen } = scripted(() => (reachable ? { ok: true } : NOT_ATTEMPTED));
    const { engine, store, clock } = await engineWith(runner);
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    for (let i = 0; i < 3 * MAX_ATTEMPTS; i += 1) {
      await tickPastBackoff(engine, clock);
      const job = engine.list()[0];
      expect(job?.status).toBe('deferred');
      expect(job?.deferReason).toBe('transient-error');
      expect(job?.attempts).toBe(0);
    }
    // Every outage attempt was shown to the runner as its first.
    expect(seen).toEqual(Array.from({ length: 3 * MAX_ATTEMPTS }, () => 1));
    expect(store.state?.jobs[0]?.attempts).toBe(0);

    reachable = true;
    expect(await engine.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
    expect(engine.list()[0]?.status).toBe('done');
  });

  it('counted retries keep their cap: waits in between never add to it or take from it', async () => {
    // Two counted failures, an outage of twenty waits, then counted failures until the cap.
    let call = 0;
    const { runner, seen } = scripted(() => {
      call += 1;
      return call > 2 && call <= 22 ? NOT_ATTEMPTED : COUNTED;
    });
    const { engine, clock } = await engineWith(runner);
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    while (engine.list()[0]?.status !== 'failed' && call < 100) {
      await tickPastBackoff(engine, clock);
    }
    const job = engine.list()[0];
    expect(job?.status).toBe('failed');
    expect(job?.failedReason).toBe(`attempt cap reached (${MAX_ATTEMPTS} attempts)`);
    // MAX_ATTEMPTS + 1 counted failures and the twenty waits, no more and no fewer.
    expect(call).toBe(MAX_ATTEMPTS + 1 + 20);
    expect(seen.slice(0, 2)).toEqual([1, 2]);
    expect(seen.slice(2, 22)).toEqual(Array.from({ length: 20 }, () => 3));
    expect(seen.slice(22)).toEqual(Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => i + 3));
  });

  it('the backoff widens with each wait in a row, as a counted retry does, and starts afresh after a counted outcome', async () => {
    let call = 0;
    const { runner } = scripted(() => {
      call += 1;
      return call === 10 ? COUNTED : NOT_ATTEMPTED;
    });
    const { engine, clock } = await engineWith(runner);
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });

    const delays: (number | undefined)[] = [];
    for (let i = 0; i < 11; i += 1) delays.push(await tickPastBackoff(engine, clock));
    const expected = (n: number): number =>
      Math.min(MIN_BACKOFF_MS * 2 ** (Math.min(n, 8) - 1), MAX_BACKOFF_MS);
    // Waits 1..9, then the counted failure (its first attempt's backoff), then wait 1 again.
    expect(delays).toEqual([
      ...Array.from({ length: 9 }, (_, i) => expected(i + 1)),
      expected(1),
      expected(1),
    ]);
    expect(engine.list()[0]?.attempts).toBe(1);
  });

  it('nothing persisted changes shape: a waiting job carries exactly the keys a deferred job always has, and survives a restart', async () => {
    const { runner } = scripted(() => NOT_ATTEMPTED);
    const store = new MemoryStore();
    const { engine, clock } = await engineWith(runner, store);
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: { kind: 'x' } });
    await tickPastBackoff(engine, clock);
    await tickPastBackoff(engine, clock);

    const persisted = store.state?.jobs[0];
    expect(Object.keys(persisted ?? {}).sort()).toEqual(
      [
        'attempts',
        'contentHash',
        'deferReason',
        'enqueuedAt',
        'label',
        'payload',
        'resumeNotBefore',
        'status',
      ].sort(),
    );
    expect(persisted?.attempts).toBe(0);

    // A restart: the waiting job is still there, uncounted, and runs when the call can be made.
    const after = await engineWith(async () => ({ ok: true }), store, clock);
    expect(after.engine.list()[0]?.status).toBe('deferred');
    expect(await after.engine.tick()).toEqual({ kind: 'ran', contentHash: 'h1', outcome: 'done' });
  });

  it('a permanent failure is recorded as before, whatever waits came first', async () => {
    let call = 0;
    const { runner } = scripted(() => {
      call += 1;
      return call <= 5 ? NOT_ATTEMPTED : { ok: false, retryable: false, reason: 'invented reason' };
    });
    const { engine, clock } = await engineWith(runner);
    await engine.enqueue({ contentHash: 'h1', label: 'L1', payload: {} });
    for (let i = 0; i < 6; i += 1) await tickPastBackoff(engine, clock);
    expect(engine.list()[0]).toMatchObject({
      status: 'failed',
      failedReason: 'invented reason',
      attempts: 1,
    });
  });
});
