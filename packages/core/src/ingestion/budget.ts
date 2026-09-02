/**
 * Pure budget-scheduling policy (D-002, cost model §4, P3-T03).
 *
 * Everything here is a pure function of its arguments — no `Clock`, no
 * `RandomSource` state, nothing hidden — so `engine.ts` (and this module's
 * own tests) can reason about scheduling decisions independently of the
 * stateful machinery that applies them. `IngestionQueueEngine` is the only
 * caller; nothing here touches a `PersistedJob`.
 *
 * **The thresholds below are this task's own engineering judgement, not a
 * contract number.** Nothing in the functional scope, the cost model, or
 * D-002 specifies a pacing curve or an exhaustion cutoff — the contract
 * requires only that the queue slow down or defer rather than hammer the
 * Worker as headroom drops, and that it stop cleanly at exhaustion. What the
 * cost model *does* supply is the shape of the risk: it gives a worst-case
 * ingestion burst and the share of a day's allocation a single large lecture
 * inside that burst can account for. `EXHAUSTED_HEADROOM_THRESHOLD` is set
 * comfortably above that share (5%) so that whenever the queue decides a job
 * is safe to attempt, the worst single job it might run cannot plausibly
 * overrun what's left — which is what lets the 24-lecture burst simulation
 * assert **zero failed jobs** as a real property of the guard, not a
 * coincidence of the simulation's numbers. The underlying figures live in
 * `olea-service/docs/Olea_ai_workload_and_cost_model.md` §4 and stay there;
 * that document is private-classified, so it is cited by path and neither
 * quoted nor restated. Revisit if real usage shows otherwise.
 */

import type { RandomSource } from './types.js';

/** At or below this headroom fraction, the queue treats the day's budget as exhausted and stops cleanly (D-002). */
export const EXHAUSTED_HEADROOM_THRESHOLD = 0.05;

/**
 * Above `EXHAUSTED_HEADROOM_THRESHOLD` but at or below this, the queue paces
 * itself rather than draining back-to-back. **Unclassified** (`ol-3ux7.56`)
 * — the role is stated but `0.25` itself is not argued or measured. The
 * pacer's own headroom semantics rule out a measurement too: per
 * `docs/Olea_component_register.md` 3.10, every production response site
 * still emits a stateless headroom of `1`, so this band has never yet been
 * exercised against a real reading to derive a number from.
 */
export const PACING_HEADROOM_THRESHOLD = 0.25;

/**
 * Pacing delay floor: even barely-low headroom buys some breathing room.
 * **Unclassified** (`ol-3ux7.56`) — no reason is given for 5 seconds over
 * another floor. Real call round trips against staging run 40-90s
 * (`ol-0dyo`), so this floor is far smaller than an actual call anyway; that
 * bounds its practical effect but is not an argument for 5,000 specifically.
 */
export const MIN_PACING_DELAY_MS = 5_000;
/**
 * Pacing delay ceiling: headroom right at the exhaustion edge paces this
 * hard before either recovering or tipping into `'exhausted'`. **Declared**
 * (`ol-3ux7.56`) — 90 seconds matches the slowest real call latency observed
 * against staging (`ol-0dyo`: 40-90s round trips), so the hardest pacing the
 * queue imposes waits about as long as one worst-case call actually takes,
 * not an arbitrary round number.
 */
export const MAX_PACING_DELAY_MS = 90_000;

/**
 * Retry backoff floor for a transient job failure. **Unclassified**
 * (`ol-3ux7.56`) — no reason is given for 30 seconds over another floor. If
 * anything, `ol-0dyo`'s retry-tax finding cuts the other way: real round
 * trips against staging ran 40-90s, longer than this floor, so a first retry
 * can still land while whatever the prior attempt stalled on may still be in
 * flight. Flagged, not resolved — not a case for the current value.
 */
export const MIN_BACKOFF_MS = 30_000;
/**
 * Retry backoff ceiling — never wait longer than this for a retryable
 * failure, so a bad run doesn't strand a job until the next session.
 * **Unclassified** (`ol-3ux7.56`) — the purpose is stated, not the
 * magnitude. `[D-057]`'s accepted paid ceiling rules out a budget argument
 * for keeping this small (automatic generation isn't economizing against a
 * hard daily wall), which leaves only "within a session" — and no
 * session-length figure pins 30 minutes over another span short of one.
 */
export const MAX_BACKOFF_MS = 30 * 60_000;

export type HeadroomBand = 'ample' | 'low' | 'exhausted';

/**
 * Classifies a headroom reading. `null` (nothing reported yet, or reset
 * since the last exhaustion) is treated as `'ample'` — optimistic by
 * design: the very first submission of a session, or the first one after a
 * daily reset, always gets attempted rather than waiting on a signal that
 * doesn't exist yet. Every later submission is governed by whatever the
 * Worker actually reports.
 */
export function classifyHeadroom(headroom: number | null): HeadroomBand {
  if (headroom === null) return 'ample';
  if (headroom <= EXHAUSTED_HEADROOM_THRESHOLD) return 'exhausted';
  if (headroom <= PACING_HEADROOM_THRESHOLD) return 'low';
  return 'ample';
}

/**
 * How long to pace before starting another job, given a `'low'` headroom
 * reading. Ramps linearly from `MIN_PACING_DELAY_MS` at the pacing
 * threshold up to `MAX_PACING_DELAY_MS` at the exhaustion threshold — the
 * closer to exhausted, the more the queue backs off — with up to ±10%
 * jitter (via `random`) so multiple queued jobs (or, in principle, multiple
 * devices) don't all retry in lockstep.
 *
 * Caller's responsibility: only call this for `headroom` in the `'low'`
 * band (`classifyHeadroom(headroom) === 'low'`); behaviour outside that
 * band is unspecified (the function clamps defensively but that's a safety
 * net, not a contract).
 */
export function pacingDelayMs(headroom: number, random: RandomSource): number {
  const clamped = Math.min(
    Math.max(headroom, EXHAUSTED_HEADROOM_THRESHOLD),
    PACING_HEADROOM_THRESHOLD,
  );
  const span = PACING_HEADROOM_THRESHOLD - EXHAUSTED_HEADROOM_THRESHOLD;
  // 0 at the pacing edge (barely low) -> 1 at the exhaustion edge (about to stop entirely).
  const severity = span === 0 ? 1 : 1 - (clamped - EXHAUSTED_HEADROOM_THRESHOLD) / span;
  const base = MIN_PACING_DELAY_MS + severity * (MAX_PACING_DELAY_MS - MIN_PACING_DELAY_MS);
  const jitter = 1 + (random.next() - 0.5) * 0.2; // 0.9x - 1.1x
  return Math.round(base * jitter);
}

/**
 * Exponential backoff for a retryable job failure, with jitter (0.5x-1.5x)
 * so repeated failures across several jobs don't all wake up on the same
 * tick. `attempts` is the job's total attempt count *after* the failing
 * attempt (i.e. always >= 1 when this is called).
 */
export function backoffDelayMs(attempts: number, random: RandomSource): number {
  // Exponent capped at 7 (2^7 x MIN_BACKOFF_MS = 3,840,000ms) so the
  // Math.min below is what actually enforces MAX_BACKOFF_MS for any
  // attempt count from here on, rather than the exponent cap alone quietly
  // landing under it and leaving MAX_BACKOFF_MS unreachable.
  const exponent = Math.min(Math.max(attempts, 1), 8) - 1;
  const base = Math.min(MIN_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
  const jitter = 0.5 + random.next(); // 0.5x - 1.5x
  return Math.round(base * jitter);
}

/**
 * The next UTC daily reset instant strictly after `nowMs` — Workers AI's
 * free neuron allocation resets at 00:00 UTC (cost model §4), and this is
 * the instant `IngestionQueueEngine` uses as `resumeNotBefore` for jobs
 * deferred with `'budget-exhausted'`.
 */
export function nextUtcMidnightMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}
