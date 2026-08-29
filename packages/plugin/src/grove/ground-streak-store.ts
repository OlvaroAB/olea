/**
 * `ObsidianGroveGroundStreakStore` — persists F8.2's ground-streak per
 * concept across desktop sessions (`ol-0r92.20`).
 *
 * Closes the gap `ol-o8eo` and `./provider.ts`'s own module doc named:
 * `classifyDeclaredConcept`'s stall flag (F4.5, `packages/core/src/scope/
 * coverage.ts`) is pure and tested, but with no durable store `./
 * provider.ts` always called `buildGroveModel` with an empty
 * `priorGroundStreaks` map — every session read every `ground` concept as
 * first-sight, so `stall` could never actually fire in production. This
 * store is the missing persistence; `./provider.ts` now loads it before
 * building each course and saves the result after.
 *
 * Same deliberate `data.json` read-modify-write shape `../registry/
 * overrides-store.ts` and `../plan/settings-store.ts` already use, for the
 * identical reason: `olea-core` has no event-sourced home for this, and this
 * bead owns none of `packages/contracts` or `packages/core/src/review-log/`.
 *
 * **Not a review-log event, and never her content (INV-6, D-005).** A
 * ground-streak is Olea's own evaluation cadence — a count of consecutive
 * times SHE read a concept as `ground` — not something she did, so it has no
 * home in the review log. It is keyed by concept KEY (C7.11's opaque join
 * key), never a display name or note title, and the value stored is an
 * integer count — nothing here is content. `data.json` is plugin
 * configuration under `.obsidian/plugins/<id>/`, never a vault note.
 *
 * **Replace, not merge, on every save.** `../../core/src/scope/grove.ts`'s
 * `BuildGroveModelResult.nextGroundStreaks` already only ever carries
 * concepts CURRENTLY reading `ground` — a concept that stopped is simply
 * absent, its streak reset, not zeroed. `save` mirrors that contract by
 * replacing the whole stored map rather than merging into it: a concept
 * missing from the map handed to `save` must disappear from storage too, or
 * a resolved `ground` cell would read as though it were still stalling next
 * session.
 */

import type { ObsidianDataHost } from '../plan/settings-store.js';

export const GROVE_GROUND_STREAKS_STORAGE_KEY = 'groveGroundStreaks';

export interface GroveGroundStreaks {
  readonly version: 1;
  /** Concept KEY -> its current ground-streak. Never holds a concept whose streak is 0 — see module doc. */
  readonly streaks: Readonly<Record<string, number>>;
}

export const EMPTY_GROVE_GROUND_STREAKS: GroveGroundStreaks = { version: 1, streaks: {} };

function isGroveGroundStreaks(value: unknown): value is GroveGroundStreaks {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.streaks !== 'object' || candidate.streaks === null) return false;
  return Object.values(candidate.streaks as Record<string, unknown>).every(
    (streak) => typeof streak === 'number' && Number.isInteger(streak) && streak >= 0,
  );
}

export class ObsidianGroveGroundStreakStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns an empty map — never throws — when nothing usable is stored. */
  async load(): Promise<ReadonlyMap<string, number>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[GROVE_GROUND_STREAKS_STORAGE_KEY];
    if (!isGroveGroundStreaks(candidate)) return new Map();
    return new Map(Object.entries(candidate.streaks));
  }

  /** REPLACES the whole stored map — see module doc for why "absent means reset" requires this rather than a merge. */
  async save(streaks: ReadonlyMap<string, number>): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const value: GroveGroundStreaks = { version: 1, streaks: Object.fromEntries(streaks) };
    blob[GROVE_GROUND_STREAKS_STORAGE_KEY] = value;
    await this.host.saveData(blob);
  }
}
