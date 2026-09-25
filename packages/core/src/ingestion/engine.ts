/**
 * `IngestionQueueEngine` — the client-side ingestion queue itself (D-002,
 * P3-T03). See `types.ts` for the domain model and `budget.ts` for the pure
 * DRAIN scheduling policy this class applies; this file is the stateful
 * glue. `enqueue-debounce.ts` is the pure ENQUEUE-side policy — a settle
 * delay before a changed path becomes a job at all, opt-in via `EngineDeps
 * .enqueueDebounce` (`ol-84my` `[TRG-1]`) — see that module's doc for why
 * ENQUEUE and DRAIN are two separate knobs, not one.
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
 *
 * **Priority seam (`ol-2zfj.168`, F3.7).** F3.7 says pending generation jobs
 * should drain in "coverage-first" order — mastery and yield decide what is
 * built FIRST, never what is skipped (`[D-063]`, `[D-238]`) — but the clause
 * does not pin which mastery reading, which yield, or how ties break, and
 * `packages/core/src/generation/types.ts`'s own doc names the same gap.
 * Deciding that key is a Class C question (it changes drain order, which is
 * what she experiences — F3.7's own words: "order is the whole of the
 * difference"); the options this bead wrote up rather than guessed at are in
 * `ol-2zfj.168`'s close evidence in the service repo's backlog (`bd show
 * ol-2zfj.168`), not a new rationale document (`contract-docs.md`'s
 * two-hop rule). Until it is ruled, `EngineDeps.priority` is an inert, optional seam:
 * omitted (every current production caller), `nextEligibleIndex` behaves
 * exactly as it always has — `Array.prototype.findIndex`, first eligible job
 * in arrival order, no behaviour change for any job kind sharing this queue
 * (extraction, generation, instrument-revision alike — `wiring.ts`'s single
 * `IngestionQueueEngine.create` call composes all three through one opaque
 * `payload`, which this file still never inspects; see `types.ts`'s
 * `PersistedJob.payload` doc). Supplied, it only ever REORDERS which already-
 * eligible job runs next — it can never make a queued job ineligible — so
 * "nothing is ever skipped because of priority" holds structurally: a job a
 * comparator ranks last still runs, just not first. Two jobs the comparator
 * ranks equal keep arrival order (a stable pick, first-encountered wins) —
 * the seam's own declared tie-break, so a future comparator never has to
 * reinvent one just to be deterministic.
 */

import {
  backoffDelayMs,
  classifyHeadroom,
  MAX_ATTEMPTS,
  nextUtcMidnightMs,
  pacingDelayMs,
} from './budget.js';
import type { EnqueueDebouncePolicy } from './enqueue-debounce.js';
import { evaluateEnqueueDebounce } from './enqueue-debounce.js';
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

/**
 * Orders two currently-ELIGIBLE jobs — never decides eligibility itself
 * (that stays `nextEligibleIndex`'s job, unchanged). Same contract as
 * `Array.prototype.sort`'s comparator: negative if `a` should drain before
 * `b`, positive for the reverse, `0` for "no opinion" (then arrival order
 * decides — see `EngineDeps.priority`'s doc). Deliberately payload-typed as
 * `PersistedJob`, not narrowed to any one job kind: the engine stays
 * agnostic about what `payload` contains (`types.ts`'s own doc), so a
 * comparator that only cares about `'generation'`-kind jobs is the caller's
 * concern, not this seam's.
 */
export type JobPriorityComparator = (a: PersistedJob, b: PersistedJob) => number;

/**
 * `PersistedJob` plus the same optional `sourceUnitId` `EnqueueInput` now
 * declares (`types.ts`) — this engine persists it internally when a caller
 * supplies one, so a later `enqueue` for the same unit can find the stale
 * job again after a restart. Not folded into `types.ts`'s own `PersistedJob`
 * (a persisted-schema addition — Class C, proposed rather than built here;
 * see this bead's report): `QueueStore.save` still receives plain
 * `PersistedJob[]` structurally, since the extra field is optional and
 * additive, so nothing downstream that only knows `PersistedJob` breaks.
 *
 * **`workflowVersion` (D-381, `ol-egov.141.89.5.18`).** The task prompt/
 * contract version this job's `payload` was queued under — same convention
 * as `sourceUnitId` just above (optional, additive, not folded into
 * `types.ts`'s `PersistedJob`; see this bead's report for why a persisted-
 * schema addition stays proposed rather than built here). Read by
 * `enqueue`'s dedup check below ("Version-aware dedup") and by `replace`, so
 * that a version-bumped re-`enqueue` of unchanged content is never mistaken
 * for — or confused with, when recording an outcome — the job already on
 * record for an earlier version of the same content.
 */
type StoredJob = PersistedJob & { readonly sourceUnitId?: string; readonly workflowVersion?: string };

/**
 * `EnqueueInput` (`types.ts`) plus the same optional `workflowVersion` this
 * file's `StoredJob` carries — see that type's doc for why it isn't folded
 * into `types.ts` itself. Every current production caller omits it, so
 * `enqueue`'s behaviour is byte-identical to before this field existed until
 * a caller opts in.
 */
export type VersionedEnqueueInput = EnqueueInput & { readonly workflowVersion?: string };

/**
 * Two `StoredJob`s are "the same job" for `replace`'s purposes when they
 * share both `contentHash` AND `workflowVersion` (`undefined === undefined`
 * counts as a match — every job before this field existed, and every job a
 * version-blind caller still enqueues today). Kept as its own predicate
 * because two jobs CAN legitimately share one `contentHash` now: an older,
 * version-mismatched `done` job and a freshly re-`enqueue`d one for the
 * current version — see `enqueue`'s "Version-aware dedup" doc. Matching on
 * `contentHash` alone here would let recording the new job's outcome
 * silently overwrite the old one too, which is exactly the INV-2 rewrite
 * D-381's clarification forbids.
 */
function sameStoredJob(a: StoredJob, b: StoredJob): boolean {
  return a.contentHash === b.contentHash && a.workflowVersion === b.workflowVersion;
}

export interface EngineDeps {
  readonly store: QueueStore;
  readonly capability: DeviceCapability;
  readonly runner: JobRunner;
  /** Defaults to the real wall clock. Override in tests. */
  readonly clock?: Clock;
  /** Defaults to `Math.random`. Override in tests for determinism. */
  readonly random?: RandomSource;
  /**
   * Opt-in ENQUEUE debounce (`enqueue-debounce.ts`, `ol-84my` `[TRG-1]`) —
   * distinct from every DRAIN-side policy above. Omitted (the default):
   * `enqueue` behaves exactly as before this option existed. Supplied: an
   * `enqueue` call that also carries `EnqueueInput.lastChangedAt` may come
   * back `{ status: 'debounced', resumeNotBefore }` instead of `'queued'`
   * when the path settled too recently. A caller that never sets
   * `lastChangedAt` sees no change in behaviour even with this configured —
   * both sides must opt in.
   */
  readonly enqueueDebounce?: EnqueueDebouncePolicy;
  /**
   * Opt-in DRAIN-order seam for F3.7's "coverage-first" ordering
   * (`ol-2zfj.168`) — distinct from `enqueueDebounce` above, which gates
   * whether a job is admitted at all, never the order jobs already admitted
   * drain in. Omitted (every current production caller, `wiring.ts:508`):
   * `nextEligibleIndex` behaves exactly as before this option existed —
   * first eligible job in arrival order, for every job kind sharing this
   * queue alike. Supplied: among the jobs eligible to run *this* tick, the
   * one `priority` ranks first drains first; a job it ranks last still
   * drains once nothing ranked ahead of it remains eligible — priority only
   * ever reorders, never skips (module doc, "Priority seam"). No production
   * caller supplies this yet: the ordering key F3.7 leaves open
   * (which mastery reading, which yield, how ties break) is an unruled
   * Class C question, tracked in the service repo's proposed-decision doc
   * cited in the module doc above.
   */
  readonly priority?: JobPriorityComparator;
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
function clearDefer(job: StoredJob): StoredJob {
  const { deferReason: _deferReason, resumeNotBefore: _resumeNotBefore, ...rest } = job;
  return rest;
}

export class IngestionQueueEngine {
  private readonly store: QueueStore;
  private readonly capability: DeviceCapability;
  private readonly runner: JobRunner;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly enqueueDebounce: EnqueueDebouncePolicy | null;
  private readonly priority: JobPriorityComparator | null;

  private jobs: StoredJob[];
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
    this.enqueueDebounce = deps.enqueueDebounce ?? null;
    this.priority = deps.priority ?? null;
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

  private replace(job: StoredJob): void {
    this.jobs = this.jobs.map((j) => (sameStoredJob(j, job) ? job : j));
  }

  /**
   * Idempotent by content hash (D-002): a hash already on record — in *any*
   * status — is never added or re-run. Checked before the ENQUEUE debounce
   * below so a duplicate of an already-settled job is never held up by a
   * gate meant for genuinely new churn.
   *
   * The ENQUEUE debounce itself (`enqueue-debounce.ts`) only ever fires when
   * BOTH `EngineDeps.enqueueDebounce` was supplied at construction AND this
   * call's `input.lastChangedAt` is not `undefined` — see `EnqueueInput`'s
   * own doc. Every existing caller supplies neither, so this is purely
   * additive: unchanged behaviour until a caller opts in on both sides.
   *
   * **Supersede (item 3, `ol-egov.141.89.10.25`; wired to its three
   * production callers by `ol-egov.141.89.10.49`).** When `input.sourceUnitId`
   * is supplied, any still-pending job (`'queued'`, or `'deferred'` with
   * `'transient-error'`) sharing that same `sourceUnitId` but a DIFFERENT
   * `contentHash` is for a stale revision of the same source: this enqueue is
   * the newer content, so the stale job is retired to `'failed'` with an
   * honest `failedReason` rather than left to eventually run on content she
   * has already moved past. Never a silent drop — the record survives, it
   * simply stops being eligible (see `EnqueueInput.sourceUnitId`'s own doc,
   * `types.ts`, for why `label` can't serve as the unit key and what each
   * caller uses).
   *
   * **Version-aware dedup (D-381, `ol-egov.141.89.5.18`; chg.md §11's
   * cache-key audit).** `input.workflowVersion` is opt-in, same posture as
   * `enqueueDebounce` above: omitted (every current production caller —
   * embedded-source extraction via `process-now.ts`/`arrival-watch.ts`, and
   * the generation path via `job.ts`/`generation-queue.ts`), the dedup check
   * is exactly `contentHash` alone, unchanged from before this field
   * existed. Supplied: a job already on record under the same `contentHash`
   * only counts as "duplicate" when its own recorded `workflowVersion` is
   * the SAME string — a job recorded under a DIFFERENT version, or with no
   * version recorded at all (a legacy job from before a caller started
   * versioning this content), is not a duplicate. The old job is never
   * rewritten or removed (INV-2; D-381's clarification: "never retroactively
   * rewrite ... an artifact already accepted") — it is simply no longer what
   * a version-aware `enqueue` call for this content matches, so a fresh job
   * is queued for the current version instead. Nothing here re-runs
   * anything eagerly: this only changes what the NEXT `enqueue` call for
   * that content is allowed to do; the actual (re)run still waits for a
   * `tick()` a host schedules on its own terms, and only within whatever
   * budget/headroom gate is already in force then (`classifyHeadroom`,
   * unchanged) — i.e. "redo it lazily, only within spend already
   * authorised," never a batch re-run triggered by the version bump itself.
   */
  async enqueue(input: VersionedEnqueueInput): Promise<EnqueueResult> {
    const existing = this.jobs.find(
      (j) =>
        j.contentHash === input.contentHash &&
        (input.workflowVersion === undefined || j.workflowVersion === input.workflowVersion),
    );
    if (existing) return { status: 'duplicate', existingStatus: existing.status };

    if (this.enqueueDebounce !== null && input.lastChangedAt !== undefined) {
      const decision = evaluateEnqueueDebounce({
        lastChangedAt: input.lastChangedAt,
        now: this.clock.now(),
        policy: this.enqueueDebounce,
      });
      if (decision.kind === 'debounced') {
        return { status: 'debounced', resumeNotBefore: decision.resumeNotBefore };
      }
    }

    if (input.sourceUnitId !== undefined) {
      const sourceUnitId = input.sourceUnitId;
      this.jobs = this.jobs.map((j) => {
        const stillPending =
          j.status === 'queued' || (j.status === 'deferred' && j.deferReason === 'transient-error');
        if (j.sourceUnitId !== sourceUnitId || !stillPending) return j;
        return {
          ...clearDefer(j),
          status: 'failed' as const,
          failedReason: `superseded — a newer revision of this source was enqueued (content hash ${input.contentHash})`,
        };
      });
    }

    const job: StoredJob = {
      contentHash: input.contentHash,
      label: input.label,
      payload: input.payload,
      enqueuedAt: this.clock.now(),
      status: 'queued',
      attempts: 0,
      ...(input.sourceUnitId !== undefined ? { sourceUnitId: input.sourceUnitId } : {}),
      ...(input.workflowVersion !== undefined ? { workflowVersion: input.workflowVersion } : {}),
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

  private static isEligible(job: PersistedJob, now: number): boolean {
    if (job.status === 'queued') return true;
    if (job.status === 'deferred' && job.deferReason === 'transient-error') {
      return (job.resumeNotBefore ?? 0) <= now;
    }
    return false;
  }

  /**
   * The next job `tick()` should run, by index into `this.jobs`, or `-1` if
   * none is eligible. With no `priority` comparator (every current
   * production caller) this is exactly `findIndex` over eligibility, same
   * as before this seam existed — first eligible job in arrival order. With
   * one supplied, it scans every eligible job and keeps the one `priority`
   * ranks ahead, breaking a `0` (or otherwise-unresolved) comparison in
   * favour of whichever was found first — i.e. arrival order, the seam's
   * declared tie-break (module doc, "Priority seam"). A job never skips: an
   * eligible job that loses every comparison this tick is still eligible
   * next tick, and the tick after that, until it wins one.
   */
  private nextEligibleIndex(now: number): number {
    if (this.priority === null) {
      return this.jobs.findIndex((job) => IngestionQueueEngine.isEligible(job, now));
    }

    let bestIndex = -1;
    for (let index = 0; index < this.jobs.length; index++) {
      // biome-ignore lint/style/noNonNullAssertion: index is in-bounds by the loop condition.
      const job = this.jobs[index]!;
      if (!IngestionQueueEngine.isEligible(job, now)) continue;
      if (bestIndex === -1) {
        bestIndex = index;
        continue;
      }
      // biome-ignore lint/style/noNonNullAssertion: bestIndex was set to an in-bounds index above.
      const comparison = this.priority(job, this.jobs[bestIndex]!);
      if (comparison < 0) bestIndex = index;
    }
    return bestIndex;
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
    const inFlight: StoredJob = { ...clearDefer(eligible), status: 'in-flight', attempts };
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
    job: StoredJob,
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
      // Attempt cap (item 1, `ol-egov.141.89.10.25`): `job.attempts` is this
      // attempt's own count (incremented before the run — see `tick()`). A
      // job PAST `MAX_ATTEMPTS` failed attempts is parked as `'failed'`
      // instead of scheduled for another backoff — i.e. attempts
      // `1..MAX_ATTEMPTS` each still get the normal backoff-and-retry
      // treatment (a genuinely transient fault gets the full geometric
      // series to clear), and only the `(MAX_ATTEMPTS + 1)`th failure is the
      // one that stops it, so a persistently-broken job stops consuming
      // drain slots forever rather than retrying across weeks (`budget.ts`'s
      // `MAX_ATTEMPTS` doc has the sensitivity reasoning).
      if (job.attempts > MAX_ATTEMPTS) {
        this.replace({
          ...clearDefer(job),
          status: 'failed',
          failedReason: `attempt cap reached (${MAX_ATTEMPTS} attempts)`,
        });
        this.applyHeadroom(outcome.budgetHeadroom, now);
        await this.persist();
        return { kind: 'ran', contentHash: job.contentHash, outcome: 'failed' };
      }

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
