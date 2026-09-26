/**
 * `buildVisionRouteWiring` — the plugin-side composition root for
 * component 1.6's delivered vision-routing threshold (`[ILB-PER-4]`,
 * `docs/dev/intelligence-build/per.md` §8 item 2, this bead's own remaining
 * item: "compose the provider into the extraction options at the
 * composition root").
 *
 * Follows exactly the pattern `rank/wiring.ts`'s `buildRankWeightsWiring`
 * establishes for component 3.3's own delivered artifact: load the
 * persisted Worker config, build a real reader when (and only when) it is
 * usable, and hand back `null` otherwise — F7.8's grey-out, the same shape
 * `main.ts` already uses for `this.rankWeights`/`this.depthGate`.
 *
 * **Resolved once, at wiring time — unlike `buildRankWeightsWiring`, which
 * is re-invoked on every plan refresh.** A ranking-weights fetch has no
 * request shape of its own, so re-fetching per refresh is how a re-tuned
 * server-side policy reaches her without a restart. A vision-routing
 * threshold has nowhere comparable to re-fetch from: it feeds one
 * `ExtractOptions` value baked into `createExtractionJobRunner`'s single
 * construction in `./wiring.ts#buildIngestionRunner`, at the exact same
 * "resolve the persisted Worker config once at composition time" moment
 * `IngestionWiringDeps.vision`'s own `buildVisionRunner` already uses in
 * that file. `vision-route` is an OPERATING artifact, not a GOVERNING one
 * (`artifact-envelope.ts`'s classing): a threshold that goes a whole plugin
 * session without refetching costs at most an unnecessary vision upload or
 * an over-cautious text-layer read, never a false claim rendered to her —
 * the same staleness class `deps.vision`'s own once-per-session config read
 * already accepts without incident.
 */

import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { fetchVisionRouteOptions, type VisionRouteHttpGet } from './vision-route-provider.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other wiring module in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface VisionRouteWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly httpGet: VisionRouteHttpGet;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now?: () => Date;
}

export interface VisionRouteWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — a caller checks
   * this once. When present, calling it fetches and decodes the delivered
   * artifact, degrading to `undefined` on every failure (transport,
   * decode, or expired) — see `fetchVisionRouteOptions`'s own module doc.
   * `./wiring.ts#buildIngestionRunner` calls this at most once, at
   * composition time, and forwards whatever comes back (including
   * `undefined`) as `createExtractionJobRunner`'s `options`, so a degrade
   * here leaves `routePage`'s own `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`
   * (D-022) applying exactly as it does today (F7.8).
   */
  readonly readVisionRouteOptions: (() => ReturnType<typeof fetchVisionRouteOptions>) | null;
}

export async function buildVisionRouteWiring(
  deps: VisionRouteWiringDeps,
): Promise<VisionRouteWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { readVisionRouteOptions: null };

  const workerConfig: WorkerConfig = { baseUrl: config.baseUrl, token: config.token };
  const now = deps.now ?? (() => new Date());
  return {
    readVisionRouteOptions: () => fetchVisionRouteOptions(deps.httpGet, workerConfig, now()),
  };
}
