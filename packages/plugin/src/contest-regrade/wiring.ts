/**
 * Composes this queue's pieces into what a host (`main.ts`) needs to run
 * `IngestionQueueEngine.create` (`olea-core`) for the contest-regrade job
 * kind — the SAME engine class the ingestion/generation queues already run,
 * a separate instance, over its own `ContestRegradeQueueStore` key so the
 * two queues never share state.
 *
 * **Now wired from production** (round 2, same bead): `main.ts` calls
 * `createContestRegradeEngine` at plugin startup (judge omitted — the real
 * Worker judge caller, `ol-egov.141.89.38`, does not exist yet),
 * `enqueueContestRegradeJobOnDispute` from `review/session.ts`'s
 * `contestGrade` (via `main.ts`'s `enqueueContestRegradeJobOnDisputeBest
 * Effort`), and `drainContestRegradeQueue` alongside the plugin's other
 * reconnect drains. **One wire still does not reach `ReviewSession` in
 * production**: `review/open-session.ts`'s `ReviewSessionPorts` (outside
 * this bead's `owns`) does not yet carry a `contestRegradeEnqueuer` field,
 * so `main.ts`'s `this.review.ports` cannot name it — see this bead's
 * report for the exact two-line addition that file needs.
 */

import { IngestionQueueEngine } from 'olea-core';
import type { EngineDeps, TickResult } from 'olea-core';
import type { ObsidianDataHost } from '../ingestion/queue-store.js';
import { ContestRegradeQueueStore } from './queue-store.js';
import { createContestRegradeJobRunner, type ContestRegradeRunnerDeps } from './runner.js';
import type { ContestRegradeActivation } from './types.js';

/**
 * `[D-360]`'s ruling, restated as code: OFF, unconditionally, until a later
 * ruling names the model, spend allowance and retry limit. There is no
 * build flag, environment variable or settings toggle that changes this
 * value — flipping it is itself the ruling this constant is waiting on,
 * landed as an edit to this file once that ruling closes, never a runtime
 * config a device could set differently from another.
 */
export const DEFAULT_CONTEST_REGRADE_ACTIVATION: ContestRegradeActivation = {
  enabled: false,
};

/**
 * Builds the `EngineDeps` a host passes to `IngestionQueueEngine.create`
 * for the contest-regrade queue. `capability` is the same
 * `DeviceCapability` (`../ingestion/device-capability.js`) every other
 * queue on this device already shares — D-002's "mobile enqueues, only
 * desktop drains" applies identically here, nothing about this job kind is
 * exempt.
 */
export function buildContestRegradeEngineDeps(
  host: ObsidianDataHost,
  runnerDeps: Omit<ContestRegradeRunnerDeps, 'activation'>,
  capability: EngineDeps['capability'],
): EngineDeps {
  return {
    store: new ContestRegradeQueueStore(host),
    capability,
    runner: createContestRegradeJobRunner({
      ...runnerDeps,
      activation: DEFAULT_CONTEST_REGRADE_ACTIVATION,
    }),
  };
}

/**
 * The drain call a host makes on reconnect — `engine.tick()` gated on
 * activation, called instead of `engine.tick()` directly.
 *
 * **Why this exists as well as `runner.ts`'s own gate.** The runner's
 * check alone is a correct "no paid call while off," but it is not enough
 * to satisfy "persists durably... drains next time she reconnects"
 * indefinitely: `IngestionQueueEngine.tick()` counts every call into the
 * runner as an attempt, and a runner outcome of `{ ok: false, retryable:
 * true }` — exactly what the gated runner returns while activation is off
 * — is `MAX_ATTEMPTS`-limited like any other transient failure
 * (`engine.ts`'s own `recordOutcome`); enough reconnects while activation
 * stays off for long enough would eventually park the job `'failed'` by
 * attempt-cap alone, which is not what `[D-360]` asks for ("hold... until
 * named", not "give up after enough tries"). Gating the CALL to `tick()`
 * itself — never invoking it while activation is off — means no attempt is
 * ever recorded for this reason, so the job waits, unconsumed, for however
 * long the ruling takes.
 */
/**
 * Builds and constructs the real engine — `IngestionQueueEngine.create`
 * over `buildContestRegradeEngineDeps`'s result — so `main.ts` never needs
 * to import `IngestionQueueEngine` itself just to call `.create()` once at
 * startup. Safe to call the instant `onload` has a `vault`/`deviceId`; the
 * engine loads whatever this device already persisted (D-002) and requeues
 * any job stranded `in-flight` by an earlier crash, exactly as every other
 * `IngestionQueueEngine.create` caller in this plugin already relies on.
 */
export async function createContestRegradeEngine(
  host: ObsidianDataHost,
  runnerDeps: Omit<ContestRegradeRunnerDeps, 'activation'>,
  capability: EngineDeps['capability'],
): Promise<IngestionQueueEngine> {
  return IngestionQueueEngine.create(buildContestRegradeEngineDeps(host, runnerDeps, capability));
}

export async function drainContestRegradeQueue(
  engine: { tick(): Promise<TickResult> },
  activation: ContestRegradeActivation = DEFAULT_CONTEST_REGRADE_ACTIVATION,
): Promise<TickResult | { readonly kind: 'blocked'; readonly reason: 'activation-off' }> {
  if (!activation.enabled) {
    return { kind: 'blocked', reason: 'activation-off' };
  }
  return engine.tick();
}
