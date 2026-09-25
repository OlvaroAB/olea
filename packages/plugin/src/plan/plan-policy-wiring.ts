/**
 * `buildPlanPolicyWiring` — the plugin-side composition root for `[D-167]`'s
 * fingerprint-gated recompute (`ol-v7r5.25`, follow-up to `ol-v7r5.23`).
 *
 * Follows `rank/wiring.ts`'s own precedent — load the persisted Worker
 * config, build a real reader when it is usable, hand back `null`
 * otherwise (F7.8) — with one addition that module does not need: `[D-167]`
 * says "only a changed fingerprint triggers the remote recompute," so this
 * wiring ALSO owns the one piece of state that makes that gate real —
 * `ObsidianPlanPolicyCacheStore`, the last fingerprint sent and the result
 * it got back — and decides, on every call, whether the fingerprint moved
 * before ever touching the network.
 *
 * **Where the gate is, and why it is here rather than in `provider.ts`.**
 * `plan-policy-fingerprint.ts`'s own module doc is explicit that it "decides
 * nothing about WHEN to check" and "does not call the Worker" — it is only
 * the pure predicate. Something has to hold the previous fingerprint to
 * compare against, and that is persisted state, which belongs in a wiring
 * module (same reasoning `rank/wiring.ts` gives for holding
 * `ObsidianWorkerConfigStore`), not inside `fetchPlan` itself. This keeps
 * `provider.ts` able to say "ask for the allocation policy" without knowing
 * HOW the gate decided whether to actually call out.
 *
 * **An unchanged fingerprint reuses the cached result, not `undefined`.**
 * "The standing plan stands" (A2.5) means the allocation the plan already
 * carries is still current, not that this refresh should silently drop it —
 * dropping it on every unchanged-fingerprint refresh would make the
 * degrade-on-absence path (`plan-policy-provider.ts`'s own doc) fire on the
 * ordinary, expected case instead of on an actual failure, and would look
 * indistinguishable from "the Worker never answered" in the plan she reads.
 *
 * **A failed fetch on a CHANGED fingerprint falls back to the cache too**
 * (`ol-egov.141.89.10.44`, discovered from `ol-egov.141.89.10.16` making
 * `plan/provider.ts` throw on an attempted-and-failed allocation fetch
 * rather than reading it as "no policy applies"). This module's own doc
 * already promised "a failed call leaves the previous cache entry
 * standing" — but until this fix that was only true of the PERSISTED
 * entry; the return value handed back to the caller was `undefined`,
 * which is exactly the throw-worthy failure `provider.ts` now checks for,
 * so a transient hiccup lost the fresher parts of the plan a working
 * fetch had already produced. **The fallback is the single most-recent
 * cache entry, not a same-fingerprint lookup**: this store keeps only one
 * entry ever (see `ObsidianPlanPolicyCacheStore` below — no per-fingerprint
 * history), and the fallback is only ever reached after the fingerprint
 * has already changed (an unchanged one returns early above, before the
 * network call) — a same-fingerprint requirement on the fallback would
 * therefore never fire. "The standing plan stands" (A2.5) reads the same
 * way here: whatever plan last stood is what keeps standing when the
 * attempt to refresh it fails, not a plan pinned to the exact input that
 * failed to refresh it. With no cache entry at all, the failure still
 * propagates as `undefined`, unchanged from before.
 */

import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { planPolicyFingerprint, planPolicyFingerprintChanged } from './plan-policy-fingerprint.js';
import {
  fetchPlanPolicy,
  type PlanPolicyHttpPost,
  type PlanPolicyRequest,
  type PlanPolicyResult,
} from './plan-policy-provider.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other wiring module in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const PLAN_POLICY_CACHE_STORAGE_KEY = 'planPolicyCache';

interface PersistedPlanPolicyCache {
  readonly version: 1;
  readonly fingerprint: string;
  readonly result: PlanPolicyResult;
}

function isPersistedPlanPolicyCache(value: unknown): value is PersistedPlanPolicyCache {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.fingerprint === 'string' &&
    typeof candidate.result === 'object' &&
    candidate.result !== null
  );
}

/**
 * Reads and writes `[D-167]`'s "last fingerprint sent, last result got
 * back" pair. Deliberately not `readArtifactEnvelope`/`StudyPlanStore`
 * shaped: `plan-policy-provider.ts`'s own module doc explains why this
 * response is never cached under a versioned-artifact kind — this is a
 * plain gate memo, not a persisted contract artifact.
 */
export class ObsidianPlanPolicyCacheStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedPlanPolicyCache | null> {
    const data = await this.host.loadData();
    if (typeof data !== 'object' || data === null) return null;
    const candidate = (data as Record<string, unknown>)[PLAN_POLICY_CACHE_STORAGE_KEY];
    return isPersistedPlanPolicyCache(candidate) ? candidate : null;
  }

  async save(entry: PersistedPlanPolicyCache): Promise<void> {
    const data = await this.host.loadData();
    const base = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    await this.host.saveData({ ...base, [PLAN_POLICY_CACHE_STORAGE_KEY]: entry });
  }
}

export interface PlanPolicyWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly httpPost: PlanPolicyHttpPost;
}

export interface PlanPolicyWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — a caller checks
   * this once. When present, calling it fingerprints `request`, reuses the
   * cached result on no change, and otherwise calls the Worker: a
   * successful call caches and returns the fresh result; a failed call
   * never overwrites the cache, and returns the last-known-good cached
   * result when one exists (undefined only propagates when there is no
   * cache yet to fall back to — the first-ever call, still failing).
   */
  readonly readPlanPolicy:
    | ((request: PlanPolicyRequest) => Promise<PlanPolicyResult | undefined>)
    | null;
}

export async function buildPlanPolicyWiring(deps: PlanPolicyWiringDeps): Promise<PlanPolicyWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { readPlanPolicy: null };

  const workerConfig: WorkerConfig = { baseUrl: config.baseUrl, token: config.token };
  const cacheStore = new ObsidianPlanPolicyCacheStore(deps.dataHost);

  return {
    readPlanPolicy: async (request) => {
      const fingerprint = await planPolicyFingerprint(request);
      const cached = await cacheStore.load();
      if (cached !== null && !planPolicyFingerprintChanged(fingerprint, cached.fingerprint)) {
        return cached.result;
      }
      const result = await fetchPlanPolicy(deps.httpPost, workerConfig, request);
      if (result !== undefined) {
        await cacheStore.save({ version: 1, fingerprint, result });
        return result;
      }
      // The fetch failed. Never overwrite the cache. Fall back to the
      // last-known-good cached result when one exists (the standing plan
      // stands — A2.5); with none, the failure propagates as before.
      return cached?.result;
    },
  };
}
