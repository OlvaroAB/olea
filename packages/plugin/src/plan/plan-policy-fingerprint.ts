/**
 * A2.5's remote plan-recompute trigger — `[D-167]` / `ol-v7r5.20` [RECOMP-1]:
 * "the clock schedules the check, the input delta gates the recompute."
 *
 * The ruling is explicit that fingerprint field selection, hashing and
 * stamping mechanics are ordinary implementation (Class A/B) — this module
 * is that mechanics. A caller on a timer (F6's own refresh cadence) computes
 * this fingerprint from the SAME numeric facts it is about to send to
 * `POST /v1/plan-policy` (`plan-policy-provider.ts`'s `PlanPolicyRequest`),
 * compares it against the fingerprint stored alongside the last plan it
 * actually recomputed remotely, and only calls the Worker when they differ.
 * An unchanged fingerprint means the standing plan stands: zero spend, zero
 * churn — exactly the property `[D-167]`'s close evidence names.
 *
 * **Nothing here decides WHEN to check** (that is the clock, i.e. F6's own
 * refresh cadence, unrelated to this module) **and nothing here calls the
 * Worker** (that is `plan-policy-provider.ts`) — this is only the "did the
 * input change" predicate, kept small and pure so it is trivially testable
 * and so the honesty property (the recompute trigger, restated: never a
 * blind timer) has exactly one place it could go wrong.
 *
 * Uses `hashText` (`olea-core`'s `ingestion/hash.ts`) — the same
 * `SubtleCrypto`-backed hash `plan/build.ts`'s own `studyPlanVersion` already
 * uses for the identical "same inputs, same identity, on any device"
 * property (INV-1: no Node built-ins, since this runs in the plugin bundle
 * too).
 */

import { hashText } from 'olea-core';
import type { PlanPolicyRequest } from './plan-policy-provider.js';

/**
 * Deterministic serialisation for hashing: object keys sorted, so the
 * fingerprint cannot move because a caller happened to build the request
 * object with its fields in a different order. Mirrors `plan/build.ts`'s own
 * `canonicalise` — same property, same reason, kept local rather than
 * imported because that function is not exported from `olea-core`'s public
 * surface and this lane does not touch `packages/core` (`ol-v7r5.23`'s
 * granted ownership is client caller wiring, not core internals).
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalise(v)]));
  }
  return value;
}

/**
 * The plan-policy input's fingerprint — a hash over exactly the fields that
 * are sent to `POST /v1/plan-policy`, nothing more (D-167 fires ONLY on a
 * change to what the recompute would actually see; a caller must not fold
 * in an unrelated field — the day, a UI setting, a random nonce — or the
 * fingerprint stops meaning "the input changed").
 */
export async function planPolicyFingerprint(request: PlanPolicyRequest): Promise<string> {
  return hashText(JSON.stringify(canonicalise(request)));
}

/**
 * `true` when a remote recompute is warranted — the input fingerprint moved
 * since the last one actually sent. `previous === undefined` (no plan has
 * ever been remotely computed on this device) always recomputes, since
 * there is nothing yet to compare against and no standing plan to keep
 * standing.
 */
export function planPolicyFingerprintChanged(
  current: string,
  previous: string | undefined,
): boolean {
  return previous === undefined || current !== previous;
}
