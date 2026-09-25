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
 *
 * ## The processing-pass identity, a second and separate map (`ol-egov.141.89.11.14`)
 *
 * `../../core/src/scope/coverage.ts`'s `classifyDeclaredConcept` advanced
 * `groundStreak` on EVERY call — a grove read/render, not a processing
 * pass — the "opening the grove more often makes a course look stalled
 * sooner" defect the standing-views trace found (review 4.7). That module's
 * fix is `processingPassId`/`priorProcessingPassId`: an opaque per-pass
 * token the streak now only advances across, when a caller supplies one.
 * `loadProcessingPasses`/`saveProcessingPasses` below are this token's
 * durable half, mirroring `load`/`save` exactly — same read-modify-write
 * shape, same replace-not-merge contract, same absent-means-reset reading —
 * but under a SEPARATE storage key (`GROVE_GROUND_STREAK_PASS_STORAGE_KEY`),
 * never folded into {@link GroveGroundStreaks}'s own `streaks` map: an
 * install's already-stored streak NUMBERS keep reading exactly as `load()`
 * already reads them today (INV-2: no rewrite of existing data —
 * `isGroveGroundStreaks` below is unchanged and still rejects anything but a
 * plain integer count per concept).
 *
 * **No production caller wires this pair yet.** `./provider.ts` still calls
 * only `load`/`save`, unchanged, and `../../core/src/scope/grove.ts` still
 * calls `classifyDeclaredConcept` without `processingPassId` — both files
 * are `ol-egov.141.89.7.4`'s (sequenced after this bead), not this bead's to
 * edit. Wiring these two new methods into that call, minting a real
 * per-sweep token from the generation/ingestion queue, is that bead's work;
 * this store only makes the durable half ready for it to call.
 */

import type { ObsidianDataHost } from '../plan/settings-store.js';
import { hasReadModifyWrite } from '../retrieval/serializing-data-host.js';

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

/** `ol-egov.141.89.11.14`: the durable half of `coverage.ts`'s `processingPassId` — see module doc. A SEPARATE key from {@link GROVE_GROUND_STREAKS_STORAGE_KEY}, never merged into it. */
export const GROVE_GROUND_STREAK_PASS_STORAGE_KEY = 'groveGroundStreakProcessingPasses';

export interface GroveGroundStreakProcessingPasses {
  readonly version: 1;
  /** Concept KEY -> the processing-pass token its ground-streak was last advanced against (`../../core/src/scope/coverage.ts`'s `ProcessingPassToken`). Never holds a concept absent from the sibling {@link GroveGroundStreaks.streaks} map — see `saveProcessingPasses`'s own doc. */
  readonly passes: Readonly<Record<string, string>>;
}

export const EMPTY_GROVE_GROUND_STREAK_PROCESSING_PASSES: GroveGroundStreakProcessingPasses = {
  version: 1,
  passes: {},
};

function isGroveGroundStreakProcessingPasses(
  value: unknown,
): value is GroveGroundStreakProcessingPasses {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.passes !== 'object' || candidate.passes === null) return false;
  return Object.values(candidate.passes as Record<string, unknown>).every(
    (token) => typeof token === 'string',
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

  /**
   * REPLACES the whole stored map — see module doc for why "absent means
   * reset" requires this rather than a merge. Atomic (`readModifyWrite`)
   * when `this.host` supports it — see `../retrieval/serializing-data-
   * host.ts`'s module doc for why a plain `loadData()`-then-`saveData()`
   * pair is not enough — falling back to that honest, non-atomic pair for a
   * bare `ObsidianDataHost` (every existing test here).
   */
  async save(streaks: ReadonlyMap<string, number>): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const value: GroveGroundStreaks = { version: 1, streaks: Object.fromEntries(streaks) };
      blob[GROVE_GROUND_STREAKS_STORAGE_KEY] = value;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }

  /**
   * `ol-egov.141.89.11.14`: the durable half of `coverage.ts`'s
   * `priorProcessingPassId` — see module doc. Returns an empty map — never
   * throws — when nothing usable is stored, exactly mirroring `load`.
   */
  async loadProcessingPasses(): Promise<ReadonlyMap<string, string>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[GROVE_GROUND_STREAK_PASS_STORAGE_KEY];
    if (!isGroveGroundStreakProcessingPasses(candidate)) return new Map();
    return new Map(Object.entries(candidate.passes));
  }

  /**
   * REPLACES the whole stored map, exactly mirroring `save`'s own
   * "absent means reset" contract — a concept no longer `ground` has no
   * processing-pass identity left to carry either. Stored under a SEPARATE
   * key from `save`'s (see module doc) — this call never touches the streak
   * numbers `load`/`save` already round-trip.
   */
  async saveProcessingPasses(passes: ReadonlyMap<string, string>): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const value: GroveGroundStreakProcessingPasses = {
        version: 1,
        passes: Object.fromEntries(passes),
      };
      blob[GROVE_GROUND_STREAK_PASS_STORAGE_KEY] = value;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }
}
