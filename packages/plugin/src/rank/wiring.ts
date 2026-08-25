/**
 * `buildRankWeightsWiring` — the plugin-side composition root for
 * component 3.3's delivered ranking weights (`[D-110]`, `ol-v7r5.3`).
 *
 * Follows exactly the pattern `concept/wiring.ts`, `grading/wiring.ts` and
 * `retrieval/wiring.ts` already establish: load the persisted Worker
 * config, build a real reader when (and only when) it is usable, and hand
 * back `null` otherwise — F7.8's grey-out, the same shape `main.ts` already
 * uses for `this.retrieval`/`this.grading`/`this.concept`.
 *
 * **Unlike those three, `readRankWeights` is re-invoked on every call
 * rather than resolved once at wiring time.** A `ConceptReaderPort` is
 * handed a request at the moment something needs it; a ranking-weights
 * fetch has no request shape at all; and re-fetching per plan refresh
 * (`plan/provider.ts`) is what makes a re-tuned server-side policy actually
 * reach her without a restart. This module still degrades to `null` at
 * wiring time when the Worker was never configured, so a caller checks
 * exactly once for "is there anything to call" and then calls it as often
 * as it likes.
 */

import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { fetchRankWeightsOptions, type RankWeightsHttpGet } from './rank-weights-provider.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other wiring module in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface RankWeightsWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly httpGet: RankWeightsHttpGet;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now?: () => Date;
}

export interface RankWeightsWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — a caller checks
   * this once. When present, calling it fetches fresh every time; see the
   * module doc for why this shape differs from the other `buildXWiring`
   * results in this plugin.
   */
  readonly readRankWeights: (() => ReturnType<typeof fetchRankWeightsOptions>) | null;
}

export async function buildRankWeightsWiring(
  deps: RankWeightsWiringDeps,
): Promise<RankWeightsWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { readRankWeights: null };

  const workerConfig: WorkerConfig = { baseUrl: config.baseUrl, token: config.token };
  const now = deps.now ?? (() => new Date());
  return {
    readRankWeights: () => fetchRankWeightsOptions(deps.httpGet, workerConfig, now()),
  };
}
