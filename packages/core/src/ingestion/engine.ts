/**
 * `IngestionQueueEngine` — the client-side ingestion queue itself (D-002,
 * P3-T03). See `types.ts` for the domain model and `budget.ts` for the pure
 * scheduling policy this class applies; this file is the stateful glue.
 *
 * **Execution model.** One job in flight at a time. `tick()` is the only
 * thing that starts work, and the host (the plugin) decides when to call
 * it — on an interval, on Obsidian's `active-leaf-change`, on demand from a
 * "check for updates" command, whatever fits. The engine never schedules
 * its own timers and never calls `setTimeout`: every "wait until later"
 * decision is expressed as an instant (`resumeNotBefore`, `pacingUntil`)
 * compared against the injected `Clock` on the *next* `tick()`, which is
 * what makes the daily-budget-reset and 24-lecture-burst tests able to
 * simulate days passing without a single real timer running.
 *
 * **Persist-before-await.** Every state transition — enqueue, moving a job
 * to `in-flight`, recording its outcome — is written through `QueueStore`
 * *before* `tick()` returns, and the `in-flight` transition specifically is
 * persisted before the `JobRunner` promise is awaited. That ordering is the
 * entire mechanism behind "backgrounding pauses without job loss": if the
 * process dies while a submission is outstanding, the persisted queue is
 * left with that job at `in-flight`; `IngestionQueueEngine.create` (below)
 * requeues any such job back to `queued` on the next load rather than
 * leaving it stranded. Content-hash idempotency (`enqueue`'s dedup check)
 * is what makes that requeue-and-retry safe rather than a double-charge
 * risk on the client's own bookkeeping.
 *
 * **Residual risk, named rather than hidden (flagged for the orchestrator):**
 * the Worker is a stateless calculator with no request-idempotency key
 * (D-005) — it cannot itself detect "you already asked me this." If the
 * process is killed at the exact instant between the Worker finishing a
 * real submission and the client receiving/persisting that response, a
 * resumed retry genuinely re-submits and genuinely re-spends neurons
 * server-side; nothing client-side can close that window without a
 * server-side idempotency key, which is out of this task's scope (and
 * would require touching the frozen `packages/contracts`). What this
 * engine guarantees is narrower and still the thing D-002 asks for: the
 * *client's own accounting* never double-records a completion, a job is
 * never silently dropped, and the ordinary case — a crash with no
 * in-flight call, or backgrounding between jobs rather than mid-call — has
 * zero risk at all.
 */

import { backoffDelayMs, classifyHeadroom, nextUtcMidnightMs, pacingDelayMs } from './budget.js';
import type {
  Clock,
  DeviceCapability,
  DrainBlockedReason,
  EnqueueInput,
  EnqueueResult,
  JobRunner,
  PersistedJob,
  PersistedQueue,
  QueueSnapshot,
  QueueStore,
  RandomSource,
} from './types.js';

const defaultClock: Clock = { now: () => Date.now() };
const defaultRandom: RandomSource = { next: () => Math.random() };

/** What happened on one `tick()` call — useful for tests and for a host that wants to log activity, not required for UI (use `snapshot()` for that). */
export type TickResult =
  | { readonly kind: 'blocked'; readonly reason: DrainBlockedReason }
  | { readonly kind: 'idle'; readonly reason: 'nothing-eligible' | 'pacing' | 'budget-exhausted' }
  | {
      readonly kind: 'ran';
      readonly contentHash: string;
      readonly outcome: 'done' | 'deferred' | 'failed';
    };

export interface EngineDeps {
  readonly store: QueueStore;
  readonly capability: DeviceCapability;
  readonly runner: JobRunner;
  /** Defaults to the real wall clock. Override in tests. */
  readonly clock?: Clock;
  /** Defaults to `Math.random`. Override in tests for determinism. */
  readonly random?: RandomSource;
}

/** Any job left `in-flight` belongs to a session that died before recording an outcome — requeue it (see the module doc's "persist-before-await" note). Returns the corrected array and whether anything changed. */
function requeueStaleInFlight(jobs: readonly PersistedJob[]): {
  jobs: readonly PersistedJob[];
  changed: boolean;
} {
  let changed = false;
  const next = jobs.map((job) => {
    if (job.status !== 'in-flight') return job;
    changed = true;
    return { ...job, status: 'queued' as const };
  });
  return { jobs: changed ? next : jobs, changed };
}

/** Drops the `deferReason`/`resumeNotBefore` keys entirely (never sets them to `undefined` — `exactOptionalPropertyTypes`). */
function clearDefer(job: PersistedJob): PersistedJob {
  const { deferReason: _deferReason, resumeNotBefore: _resumeNotBefore, ...rest } = job;
  return rest;
}

export class IngestionQueueEngine {
  private readonly store: QueueStore;
  private readonly capability: DeviceCapability;
  private readonly runner: JobRunner;
  private readonly clock: Clock;
  private readonly random: RandomSource;

  private jobs: PersistedJob[];
  private headroom: number | null;
  /** Set once headroom is observed `'exhausted'`; cleared once `clock.now()` passes it and jobs are requeued. */
  private budgetResumeAt: number | null = null;
  /** Session-level pacing gate — no job starts before this instant while headroom is `'low'`. */
  private pacingUntil: number | null = null;
  private paused = false;

  private constructor(
    deps: EngineDeps,
    jobs: readonly PersistedJob[],
    headroom: number | null,
    budgetResumeAt: number | null,
  ) {
    this.store = deps.store;
    this.capability = deps.capability;
    this.runner = deps.runner;
    this.clock = deps.clock ?? defaultClock;
    this.random = deps.random ?? defaultRandom;
    this.jobs = [...jobs];
    this.headroom = headroom;
    this.budgetResumeAt = budgetResumeAt;
  }

  /**
   * Loads persisted state (if any) and constructs the engine. Requeues any
   * stale `in-flight` job (see the module doc) and persists that correction
   * immediately, so a second `create` in a row — simulating two crashes
   * back to back — is idempotent and never re-derives a different result.
   */
  static async create(deps: EngineDeps): Promise<IngestionQueueEngine> {
    const loaded = await deps.store.load();
    const { jobs, changed } = requeueStaleInFlight(loaded?.jobs ?? []);
    const headroom = loaded?.headroom ?? null;
    // A queue can only ever have been persisted as 'exhausted' if some prior
    // session observed it; reconstruct budgetResumeAt from whatever
    // 'budget-exhausted' deferred jobs are on record so a restart mid-day
    // still honours the same reset instant rather than re-deriving a new
    // (later, wrong) one from "now".
    const budgetResumeAt =
      jobs.find((j) => j.status === 'deferred' && j.deferReason === 'budget-exhausted')
        ?.resumeNotBefore ?? null;

    const engine = new IngestionQueueEngine(deps, jobs, headroom, budgetResumeAt);
    if (changed) await engine.persist();
    return engine;
  }

  private async persist(): Promise<void> {
    const queue: PersistedQueue = { version: 1, jobs: this.jobs, headroom: this.headroom };
    await this.store.save(queue);
  }

  private replace(job: PersistedJob): void {
    this.jobs = this.jobs.map((j) => (j.contentHash === job.contentHash ? job : j));
  }

  /** Idempotent by content hash (D-002): a hash already on record — in *any* status — is never added or re-run. */
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const existing = this.jobs.find((j) => j.contentHash === input.contentHash);
    if (existing) return { status: 'duplicate', existingStatus: existing.status };

    const job: PersistedJob = {
      contentHash: input.contentHash,
      label: input.label,
      payload: input.payload,
      enqueuedAt: this.clock.now(),
      status: 'queued',
      attempts: 0,
    };
    this.jobs.push(job);
    await this.persist();
    return { status: 'queued' };
  }

  /** Explicit pause (D-002: "backgrounding pauses"). Already-outstanding work (a job mid-`await` inside a `tick()` call already in progress) is unaffected — only *new* jobs starting is gated. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * Applies the daily reset once `clock.now()` has passed it: clears the
   * exhausted state and requeues every job deferred for
   * `'budget-exhausted'`. No-op if not currently exhausted or the reset
   * instant hasn't arrived. Returns whether *anything* changed — including
   * clearing `headroom`/`budgetResumeAt` alone, with no job to requeue
   * (possible if exhaustion was reached with nothing queued at the time) —
   * so the caller always persists a real reset rather than only persisting
   * when a job happened to move.
   */
  private applyResetIfDue(now: number): boolean {
    if (this.budgetResumeAt === null || now < this.budgetResumeAt) return false;
    this.headroom = null;
    this.budgetResumeAt = null;
    this.jobs = this.jobs.map((job) =>
      job.status === 'deferred' && job.deferReason === 'budget-exhausted'
        ? { ...clearDefer(job), status: 'queued' as const }
        : job,
    );
    return true;
  }

  private nextEligibleIndex(now: number): number {
    return this.jobs.findIndex((job) => {
      if (job.status === 'queued') return true;
      if (job.status === 'deferred' && job.deferReason === 'transient-error') {
        return (job.resumeNotBefore ?? 0) <= now;
      }
      return false;
    });
  }

  /**
   * Advances the queue by at most one job. See the module doc for the full
   * execution model; in short: honour pause/device capability first, apply
   * a due budget reset, honour the pacing gate, then run the next eligible
   * job (or report why nothing ran).
   */
  async tick(): Promise<TickResult> {
    if (this.paused) return { kind: 'blocked', reason: 'paused' };
    if (!this.capability.canDrain) return { kind: 'blocked', reason: 'device-cannot-drain' };

    const now = this.clock.now();
    if (this.applyResetIfDue(now)) await this.persist();

    if (classifyHeadroom(this.headroom) === 'exhausted') {
      return { kind: 'idle', reason: 'budget-exhausted' };
    }

    if (this.pacingUntil !== null && now < this.pacingUntil) {
      return { kind: 'idle', reason: 'pacing' };
    }
    if (this.pacingUntil !== null && now >= this.pacingUntil) {
      this.pacingUntil = null;
    }

    const index = this.nextEligibleIndex(now);
    if (index === -1) return { kind: 'idle', reason: 'nothing-eligible' };
    // biome-ignore lint/style/noNonNullAssertion: index came from findIndex above and is bounds-checked.
    const eligible = this.jobs[index]!;

    const attempts = eligible.attempts + 1;
    const inFlight: PersistedJob = { ...clearDefer(eligible), status: 'in-flight', attempts };
    this.replace(inFlight);
    await this.persist(); // persist-before-await — see the module doc.

    const outcome = await this.runner({
      contentHash: inFlight.contentHash,
      label: inFlight.label,
      payload: inFlight.payload,
      attempts: inFlight.attempts,
    });

    return this.recordOutcome(inFlight, outcome);
  }

  private async recordOutcome(
    job: PersistedJob,
    outcome: Awaited<ReturnType<JobRunner>>,
  ): Promise<TickResult> {
    const now = this.clock.now();

    if (outcome.ok) {
      this.replace({ ...job, status: 'done', doneAt: now });
      this.applyHeadroom(outcome.budgetHeadroom, now);
      await this.persist();
      return { kind: 'ran', contentHash: job.contentHash, outcome: 'done' };
    }

    if (outcome.retryable) {
      const resumeNotBefore = now + backoffDelayMs(job.attempts, this.random);
      this.replace({
        ...job,
        status: 'deferred',
        deferReason: 'transient-error',
        resumeNotBefore,
      });
      this.applyHeadroom(outcome.budgetHeadroom, now);
      await this.persist();
      return { kind: 'ran', contentHash: job.contentHash, outcome: 'deferred' };
    }

    this.replace({ ...job, status: 'failed', failedReason: outcome.reason });
    await this.persist();
    return { kind: 'ran', contentHash: job.contentHash, outcome: 'failed' };
  }

  /**
   * Reacts to a fresh headroom reading (or its absence — not every outcome
   * carries one, since `budgetHeadroom` is `optional` on `successResponse`).
   * On `'exhausted'`, defers every currently-`queued` job in one stroke
   * ("stops cleanly", D-002) rather than letting each discover it one tick
   * at a time.
   */
  private applyHeadroom(headroom: number | undefined, now: number): void {
    if (headroom === undefined) return;
    this.headroom = headroom;
    const band = classifyHeadroom(headroom);

    if (band === 'exhausted') {
      this.pacingUntil = null;
      this.budgetResumeAt = nextUtcMidnightMs(now);
      const resumeNotBefore = this.budgetResumeAt;
      this.jobs = this.jobs.map((j) =>
        j.status === 'queued'
          ? { ...j, status: 'deferred', deferReason: 'budget-exhausted', resumeNotBefore }
          : j,
      );
      return;
    }

    if (band === 'low') {
      this.pacingUntil = now + pacingDelayMs(headroom, this.random);
      return;
    }

    this.pacingUntil = null;
  }

  /** Defensive copy — callers may read but never mutate engine state through it. */
  list(): readonly PersistedJob[] {
    return [...this.jobs];
  }

  snapshot(): QueueSnapshot {
    let queued = 0;
    let inFlight = 0;
    let done = 0;
    let deferred = 0;
    let failed = 0;
    let deferredBudget = 0;
    let deferredTransient = 0;

    for (const job of this.jobs) {
      switch (job.status) {
        case 'queued':
          queued++;
          break;
        case 'in-flight':
          inFlight++;
          break;
        case 'done':
          done++;
          break;
        case 'failed':
          failed++;
          break;
        case 'deferred':
          deferred++;
          if (job.deferReason === 'budget-exhausted') deferredBudget++;
          else if (job.deferReason === 'transient-error') deferredTransient++;
          break;
      }
    }

    const drainBlocked: DrainBlockedReason | null = this.paused
      ? 'paused'
      : !this.capability.canDrain
        ? 'device-cannot-drain'
        : null;

    return {
      queued,
      inFlight,
      done,
      deferred,
      failed,
      deferredReasons: {
        'budget-exhausted': deferredBudget,
        'transient-error': deferredTransient,
      },
      headroom: this.headroom,
      drainBlocked,
      pacingUntil: this.pacingUntil,
    };
  }
}
