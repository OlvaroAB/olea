/**
 * The ingestion queue's domain types (D-002, P3-T03).
 *
 * Everything in `packages/core/src/ingestion/` implements the execution model
 * plan §7.1 sets out — an authoritative local event log, with the Worker as a
 * calculator that keeps no state — applied to
 * the one piece of client state the Worker cannot hold: *work not yet done*.
 * The Worker computes and forgets (D-005); it never queues, so the queue
 * lives here, on-device, and survives restarts only because this module
 * persists it through a port the plugin implements — never by talking to a
 * filesystem or to Obsidian directly (INV-1, A2.2).
 *
 * Three seams are deliberately explicit rather than reached for globally,
 * because a queue is exactly the kind of code that becomes untestable if it
 * isn't:
 *
 * - **`Clock`** — no direct `Date.now()`. Budget-reset timing (daily neuron
 *   cap, cost model §4) and backoff scheduling are both time-driven, and the
 *   headline 24-lecture-burst test (P3-T03 acceptance) has to fast-forward
 *   through simulated days without a real `setTimeout` in sight.
 * - **`RandomSource`** — no direct `Math.random()`. Pacing and retry backoff
 *   both carry jitter (so many queued jobs don't retry in lockstep), and
 *   jitter has to be reproducible in a test.
 * - **`DeviceCapability`** — no `Platform.isMobile` sniffing inside core
 *   (that's an Obsidian API and belongs nowhere near this package). The
 *   plugin decides what the device can do and hands core a plain flag.
 *
 * The queue never computes cost. `budgetHeadroom` (packages/contracts'
 * `successResponse`) is the *only* signal this module reacts to — the
 * Worker is the one place that knows the real neuron accounting, and it is
 * stateless by design (D-005). Estimating cost client-side to schedule
 * "smarter" would be inventing a second, unsynchronised source of truth
 * about the same budget; reacting to what the Worker actually reports is
 * the only version of this that can't drift.
 */

/** Injectable wall clock. Production default: `{ now: () => Date.now() }`. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** Injectable source of randomness for jitter. Production default: `{ next: () => Math.random() }`. */
export interface RandomSource {
  /** A float in `[0, 1)`, same contract as `Math.random()`. */
  next(): number;
}

/**
 * Can this device drain the queue? D-002 answers no for mobile, and its
 * reason is the platform: a backgrounded app gets suspended there, so any
 * drain long enough to be useful is one the OS will not let the plugin
 * finish. Mobile enqueues; only desktop drains. The plugin supplies this from
 * `Platform.isMobile`; core never asks how it was decided.
 */
export interface DeviceCapability {
  readonly canDrain: boolean;
}

/**
 * A job's lifecycle. Exactly one of these at any time, persisted after every
 * transition (`IngestionQueueEngine` calls `QueueStore.save` on every
 * mutation) so a killed process loses at most the transition in flight when
 * it died, never the job itself.
 *
 * - `queued` — waiting for a drain tick to pick it up.
 * - `in-flight` — a submission is (or, if the process died mid-call, *was*)
 *   outstanding. A job found `in-flight` at load time belongs to a session
 *   that never got to record its outcome; `IngestionQueueEngine.create`
 *   requeues it to `queued` rather than leaving it stuck (the "resume, not
 *   vanish" half of the backgrounding acceptance clause). See the module
 *   doc on `engine.ts` for the residual double-submission risk this
 *   accepts.
 * - `done` — completed successfully. Kept in the queue (not pruned) so a
 *   duplicate `enqueue` of the same content hash — including one arriving
 *   from a synced queue on a second device — recognises the work as already
 *   done rather than repeating it.
 * - `deferred` — not attempted right now, on purpose, with a reason a UI
 *   can show honestly (`DeferReason`) and a `resumeNotBefore` the engine
 *   itself honours on later ticks.
 * - `failed` — a non-retryable outcome (e.g. the Worker's `invalid-request`).
 *   Distinct from `deferred` because a UI owes her a different sentence:
 *   "this one didn't work" versus "still coming, just not yet."
 */
export type JobStatus = 'queued' | 'in-flight' | 'done' | 'deferred' | 'failed';

/**
 * Why a `deferred` job isn't running right now — the substance of "honest
 * progress reporting" (P3-T03 acceptance). Session-level reasons the *whole
 * queue* isn't draining (device capability, an explicit pause) are reported
 * separately by `QueueSnapshot.drainBlocked`; this is only for reasons tied
 * to one job's own schedule.
 *
 * - `budget-exhausted` — the last reported `budgetHeadroom` crossed
 *   `EXHAUSTED_HEADROOM_THRESHOLD` (see `budget.ts`). The queue stopped
 *   cleanly rather than attempting a call that would almost certainly fail:
 *   once the day's allocation is spent, the inference platform rejects
 *   further calls outright instead of serving something reduced, so there is
 *   nothing to be gained by trying. That failure mode is a property of the
 *   platform recorded in the cost model, not an assumption made here — see
 *   `olea-service/docs/Olea_ai_workload_and_cost_model.md` §4, cited by path
 *   because it is private-classified. `resumeNotBefore` is the next UTC
 *   daily reset.
 * - `transient-error` — the job runner reported a retryable failure (e.g.
 *   the Worker's `upstream-error`). `resumeNotBefore` is a backoff instant.
 */
export type DeferReason = 'budget-exhausted' | 'transient-error';

/** Why the queue isn't draining at all right now, independent of any one job's state. */
export type DrainBlockedReason = 'device-cannot-drain' | 'paused';

/**
 * The persisted shape of one job. Everything here round-trips through
 * `QueueStore` untouched by core except via `IngestionQueueEngine`'s own
 * transitions — this is deliberately a plain, JSON-serialisable record (D-003
 * keeps the client cache as JSON in the plugin data folder), not a class.
 */
export interface PersistedJob {
  /**
   * SHA-256 of the source content, hex-encoded (see `hash.ts`). This is the
   * job's identity: `IngestionQueueEngine.enqueue` treats two calls with the
   * same `contentHash` as the same job, regardless of how many times or
   * from which device's queue state it's called — the entire idempotency
   * guarantee D-002 demands, under which a queue arriving over vault sync
   * can never be charged for twice, lives in that one
   * dedup check.
   */
  readonly contentHash: string;
  /** Human-readable label for UI display only (e.g. a vault-relative path or lecture title). Never interpreted by the engine. */
  readonly label: string;
  /** Opaque payload forwarded verbatim to the `JobRunner`. What it contains is a later task's concern (P3-T04 routing and beyond); the engine never inspects it. */
  readonly payload: unknown;
  readonly enqueuedAt: number;
  readonly status: JobStatus;
  /** Number of times a submission has been attempted (0 before the first attempt). */
  readonly attempts: number;
  /** Present only when `status` is `'deferred'`. */
  readonly deferReason?: DeferReason;
  /** Present only when `status` is `'deferred'`: the engine will not reconsider this job before this instant. */
  readonly resumeNotBefore?: number;
  /** Present only when `status` is `'done'`. */
  readonly doneAt?: number;
  /** Present only when `status` is `'failed'`: the job runner's reason string. */
  readonly failedReason?: string;
}

/** The whole persisted queue — the unit `QueueStore.save`/`load` moves. */
export interface PersistedQueue {
  /** Schema version tag, so a later shape change is a migration decision rather than a silent break — following D-003, where the knowledge model fixes the shape whatever engine stores it, leaving any change of engine mechanical rather than a redesign. */
  readonly version: 1;
  readonly jobs: readonly PersistedJob[];
  /** Last `budgetHeadroom` the Worker reported, or `null` before any submission has completed this queue's lifetime (or since the last daily reset). */
  readonly headroom: number | null;
}

/**
 * The persistence port (P3-T03's ARCHITECTURE note). Core depends only on
 * this; the plugin implements it over Obsidian's `loadData`/`saveData` in
 * `packages/plugin/src/ingestion/`. A test implements it in memory.
 *
 * `load` returning `null` means "nothing persisted yet" (first run), not an
 * empty queue — `IngestionQueueEngine.create` treats both the same way in
 * practice, but the distinction is real for an implementation to preserve.
 */
export interface QueueStore {
  load(): Promise<PersistedQueue | null>;
  save(queue: PersistedQueue): Promise<void>;
}

/** What `IngestionQueueEngine.enqueue` needs to create a job. */
export interface EnqueueInput {
  readonly contentHash: string;
  readonly label: string;
  readonly payload: unknown;
  /**
   * Opt-in hook for the ENQUEUE debounce (`enqueue-debounce.ts`, `ol-84my`
   * `[TRG-1]`) — when the path this content came from was last observed
   * changing, or `null` for a first sighting. Omitted (`undefined`, the
   * default for every existing caller) means "this caller doesn't debounce
   * enqueues" and `enqueue` behaves exactly as before, unconditionally. Only
   * consulted when the engine was also constructed with `EngineDeps
   * .enqueueDebounce` — both sides must opt in before a job can come back
   * `'debounced'` instead of `'queued'`.
   */
  readonly lastChangedAt?: number | null;
}

export type EnqueueResult =
  | { readonly status: 'queued' }
  /** Already known under this content hash — nothing was added or re-run. */
  | { readonly status: 'duplicate'; readonly existingStatus: JobStatus }
  /**
   * The ENQUEUE debounce declined this attempt — the path settled too
   * recently. Returned only when both the caller supplied `EnqueueInput
   * .lastChangedAt` and the engine was constructed with `EngineDeps
   * .enqueueDebounce`; see `enqueue-debounce.ts`. Nothing was queued —
   * the caller owns retrying (typically by re-evaluating on the next vault
   * event for the same path, the same shape `MaterialityTrigger`'s
   * `'debounced'` outcome already uses one layer up).
   */
  | { readonly status: 'debounced'; readonly resumeNotBefore: number };

/** The subset of a job a `JobRunner` needs — never the engine's own bookkeeping fields. */
export interface JobRunnerView {
  readonly contentHash: string;
  readonly label: string;
  readonly payload: unknown;
  readonly attempts: number;
}

/**
 * The outcome of one submission attempt. `JobRunner` implementations
 * (supplied by the plugin, ultimately calling the Worker per P3-T02/P3-T04)
 * translate a `WorkerResponse` into one of these three shapes:
 *
 * - `ok: true` — succeeded; `budgetHeadroom` carries the Worker's signal
 *   when present (`successResponse.budgetHeadroom` is `optional`).
 * - `ok: false, retryable: true` — a transient failure (network, the
 *   Worker's `upstream-error`/`internal-error`) worth retrying later.
 * - `ok: false, retryable: false` — a permanent failure (e.g.
 *   `invalid-request`, or `grounding-refused` if a caller ever routes that
 *   through this path) that a retry cannot fix.
 */
export type JobRunOutcome =
  | { readonly ok: true; readonly budgetHeadroom?: number }
  | { readonly ok: false; readonly retryable: true; readonly budgetHeadroom?: number }
  | { readonly ok: false; readonly retryable: false; readonly reason: string };

/** Attempts one submission for `job`. Supplied by the host; the engine calls it at most once per tick. */
export type JobRunner = (job: JobRunnerView) => Promise<JobRunOutcome>;

/**
 * Honest, real-time counts for a UI — no derived "percent complete" that
 * hides what's actually happening (P3-T03 acceptance: "no spinner-theatre").
 */
export interface QueueSnapshot {
  readonly queued: number;
  readonly inFlight: number;
  readonly done: number;
  readonly deferred: number;
  readonly failed: number;
  /** `deferred`'s breakdown by reason; the two counts sum to `deferred`. */
  readonly deferredReasons: {
    readonly 'budget-exhausted': number;
    readonly 'transient-error': number;
  };
  /** Last known `budgetHeadroom`, or `null` if unknown (optimistic — not yet learned, or reset since). */
  readonly headroom: number | null;
  /** Why the queue isn't draining at the session level right now, or `null` if it is (or would be, given something queued). */
  readonly drainBlocked: DrainBlockedReason | null;
  /** Set while the queue is pacing itself against a low (but not exhausted) budget: the engine will not start another job before this instant. `null` when not currently pacing. */
  readonly pacingUntil: number | null;
}
