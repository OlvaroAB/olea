/**
 * `ObsidianStudyPlanStore` — `StudyPlanStore` (`olea-core`'s `plan/types.ts`)
 * over Obsidian's `loadData`/`saveData` (A2.5, D-006, P5-T07).
 *
 * Modelled exactly on `../ingestion/queue-store.ts`'s `ObsidianQueueStore` and
 * `../worker/config-store.ts`'s `ObsidianWorkerConfigStore` — same reasons,
 * restated here for this port specifically: a narrow `ObsidianDataHost` (so
 * this file loads and is tested in plain Vitest, unlike anything that imports
 * `obsidian` itself), one owned top-level key inside the plugin's single
 * `data.json`, and read-modify-write on every `save()` so this store never
 * clobbers whatever `deviceId`, `keywordIndex`, `ingestionQueue` or
 * `workerConfig` already hold in the same blob.
 *
 * **Deliberately no shape validation here.** `StudyPlanStore.load()` returns
 * `unknown` by contract (`plan/types.ts`'s own doc: "what comes off disk is
 * not a plan until the contract schema says it is") precisely so that check
 * happens once, in `core/plan/cache.ts`'s `loadCachedStudyPlan`, rather than
 * being re-implemented — possibly differently — in every host. This class's
 * only job is namespacing inside `data.json`; validating the blob it hands
 * back is the caller's.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import type { StudyPlanStore } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const STUDY_PLAN_STORAGE_KEY = 'studyPlan';

export class ObsidianStudyPlanStore implements StudyPlanStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Whatever is under this store's key, or `null` if there is nothing — schema validation is `loadCachedStudyPlan`'s job, not this class's. */
  async load(): Promise<unknown> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    return (blob as Record<string, unknown>)[STUDY_PLAN_STORAGE_KEY] ?? null;
  }

  async save(plan: StudyPlanEnvelope): Promise<void> {
    // Read-modify-write: every other store sharing this blob (queue,
    // keyword index, worker config, device id) must survive this write.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[STUDY_PLAN_STORAGE_KEY] = plan;
    await this.host.saveData(blob);
  }
}
