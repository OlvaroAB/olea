/**
 * The drain half of `[D-360]`'s queued regrading workflow — the `JobRunner`
 * a `contest-regrade` job's queue engine calls at most once per tick.
 *
 * **The activation gate is the whole point of this file.** `[D-360]`
 * (David, 2026-09-25): "paid activation stays OFF... enabling it needs a
 * ruling that names the model, allowance and retry limit, made after the
 * integrated practice run (`ol-egov.141.6.15`) measures real per-call
 * costs." `runner.test.ts` proves the shape of that guarantee: with
 * `activation.enabled` false, `createContestRegradeJobRunner`'s returned
 * function returns before touching `deps.judge`, `deps.port`,
 * `deps.loadDispute` or `deps.loadRecords` — no network call, paid or
 * otherwise, is reachable from that branch at all, not merely unexercised
 * by today's callers.
 *
 * **What runs once activation IS on, and what still does not exist yet.**
 * `deps.judge` is the seam a later bead wires to a real, heavier Worker
 * judge call (`ol-egov.141.89.38`'s `workerJudgeCaller.ts` family is the
 * natural home) — it returns the re-derivation's own verdict
 * (`GradeContestOutcome`), which this runner then hands to
 * `resolveContestedGradeAndRegrade` (`../review/contest.js:225`) exactly as
 * that function already expects: unchanged, reused, not a second
 * mechanism. This module does not decide upheld/corrected itself and does
 * not itself compose "run the heavier judge, compare its verdict to the
 * original's" — `[D-360]`'s own bead (`ol-egov.141.89.9.33`) left HOW that
 * heavier judge is invoked and compared unresolved pending the
 * model/allowance/retry-limit ruling this file's activation gate is
 * already waiting on, so `deps.judge` is deliberately the whole of that
 * question, named rather than guessed at.
 */

import type { JobRunner, JobRunnerView, JobRunOutcome } from 'olea-core';
import type { ReviewLogEntry } from 'olea-contracts';
import type { DisputeLogRecord } from 'olea-core';
import { type GradeContestOutcome, type GradeContestPort, resolveContestedGradeAndRegrade } from '../review/contest.js';
import { type ContestRegradeActivation, type ContestRegradeJobPayload, isContestRegradeJobPayload } from './types.js';

/** The re-derivation itself — supplied once a real, heavier Worker judge caller is wired (`ol-egov.141.89.38`); absent today. */
export interface ContestRegradeJudge {
  regrade(payload: ContestRegradeJobPayload): Promise<{ readonly outcome: GradeContestOutcome }>;
}

export interface ContestRegradeRunnerDeps {
  readonly activation: ContestRegradeActivation;
  /** Absent until a real judge is wired — see this module's doc. */
  readonly judge?: ContestRegradeJudge;
  readonly port: GradeContestPort;
  /** Reconstructs the full `DisputeLogRecord` this job's `disputeEventId` names — the payload itself carries only the id, matching `PersistedJob.payload`'s "small, opaque" contract. `null` if it can no longer be found (e.g. an impossible log rewrite). */
  readonly loadDispute: (disputeEventId: string) => Promise<DisputeLogRecord | null>;
  /** A fresh read of every record her review log carries, at drain time — `resolveContestedGradeAndRegrade`'s own `records` parameter. */
  readonly loadRecords: () => Promise<readonly (ReviewLogEntry | DisputeLogRecord)[]>;
  /** Forwarded verbatim to `resolveContestedGradeAndRegrade` — see that function's own doc for the exact shape a real caller supplies. */
  readonly appendCorrectiveRegrade: (revisionOf: string) => Promise<void>;
}

/**
 * Builds the `JobRunner` a `contest-regrade` queue's engine calls. Every
 * branch below is total and never throws for an input this queue itself
 * could produce — the one exception, an unwired judge, is reported through
 * `JobRunOutcome` (deferred) rather than left to reject the promise, so a
 * host that ticks this queue before that follow-up lands sees an honest
 * "not yet" rather than an unhandled rejection.
 */
export function createContestRegradeJobRunner(deps: ContestRegradeRunnerDeps): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    // The activation gate. Nothing below this line runs while it is false —
    // deliberately the FIRST check, before the payload is even inspected,
    // so "no paid call while off" holds regardless of what a malformed or
    // future payload shape might otherwise trigger.
    if (!deps.activation.enabled) {
      return { ok: false, retryable: true };
    }

    if (!isContestRegradeJobPayload(job.payload)) {
      return { ok: false, retryable: false, reason: 'contest-regrade job payload is malformed' };
    }
    const payload = job.payload;

    if (deps.judge === undefined) {
      // Activation is on but the real judge caller (`ol-egov.141.89.38`)
      // is not wired yet. Deferred, not failed: the job stays queued for
      // the drain that runs once it is.
      return { ok: false, retryable: true };
    }

    const dispute = await deps.loadDispute(payload.disputeEventId);
    if (dispute === null) {
      return { ok: false, retryable: false, reason: 'contest-regrade: dispute record not found' };
    }

    const { outcome } = await deps.judge.regrade(payload);
    const records = await deps.loadRecords();

    await resolveContestedGradeAndRegrade({
      port: deps.port,
      dispute,
      outcome,
      records,
      appendCorrectiveRegrade: deps.appendCorrectiveRegrade,
    });

    return { ok: true };
  };
}
