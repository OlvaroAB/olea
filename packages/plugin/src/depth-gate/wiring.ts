/**
 * `buildDepthGateWiring` — the plugin-side composition root for component
 * 3.1's delivered growth-stage depth gate (`[D-352]`, `ol-egov.141.89.9.55`).
 *
 * Follows exactly the pattern `rank/wiring.ts`'s `buildRankWeightsWiring`
 * establishes for component 3.3: load the persisted Worker config, build a
 * real reader when (and only when) it is usable, and hand back `null`
 * otherwise — F7.8's grey-out, the same shape `main.ts` already uses for
 * `this.retrieval`/`this.grading`/`this.concept`/`this.rankWeights`.
 *
 * **Like `readRankWeights`, `readDepthGate` is re-invoked on every call
 * rather than resolved once at wiring time.** A depth-gate fetch has no
 * request shape at all, and re-fetching lets a re-tuned server-side cut
 * reach her without a restart. This module still degrades to `null` at
 * wiring time when the Worker was never configured, so a caller checks
 * exactly once for "is there anything to call" and then calls it as often
 * as it likes.
 */

import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { type DepthGateHttpGet, fetchDepthGateOptions } from './depth-gate-provider.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern `rank/wiring.ts` uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface DepthGateWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly httpGet: DepthGateHttpGet;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now?: () => Date;
}

export interface DepthGateWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — a caller checks
   * this once. When present, calling it fetches fresh every time; see the
   * module doc for why this shape mirrors `RankWeightsWiring.readRankWeights`.
   */
  readonly readDepthGate: (() => ReturnType<typeof fetchDepthGateOptions>) | null;
}

export async function buildDepthGateWiring(deps: DepthGateWiringDeps): Promise<DepthGateWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { readDepthGate: null };

  const workerConfig: WorkerConfig = { baseUrl: config.baseUrl, token: config.token };
  const now = deps.now ?? (() => new Date());
  return {
    readDepthGate: () => fetchDepthGateOptions(deps.httpGet, workerConfig, now()),
  };
}
