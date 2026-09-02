/**
 * `ObsidianGrovePriorDenominatorStore` — persists F8.1's scope-correction
 * receipt inputs, per course, across desktop sessions (`[D-184]`,
 * `ol-v7r5.32`, follow-on from `ol-v7r5.29`).
 *
 * `groveScopeCorrectionReceiptLine` (`./copy.ts`) is pure — it renders
 * whatever `reclassifiedDocumentPath`/`priorDenominatorCount`/
 * `newDenominatorCount` it is handed, and decides nothing about WHEN a
 * shrink happened. `olea-core#buildGroveModel` (`../../../core/src/scope/
 * grove.ts`) is equally pure and holds no memory of a previous read — every
 * call recomputes `GroveCourseSummary` fresh from whatever `sources`/
 * `citations` it is handed (that module's own doc: "this module holds no
 * memory of a previous read"). Something has to hold the PRIOR
 * `denominatorCount`/`denominatorSourcePaths` between two separate reads so
 * `./provider.ts` can tell "the count fell" from "the count has always been
 * this" — this store is that missing persistence, the same role
 * `./ground-streak-store.ts` fills for F4.5's stall flag and for the
 * identical reason: `olea-core` has no event-sourced home for this, and
 * this bead owns none of `packages/contracts` or `packages/core/src/
 * review-log/`.
 *
 * Same deliberate `data.json` read-modify-write shape `./ground-streak-
 * store.ts`, `../registry/overrides-store.ts` and `../plan/settings-
 * store.ts` already use: one top-level key, versioned, loaded and saved
 * whole.
 *
 * **Keyed by course name, not concept key.** F8.1's denominator is a
 * per-COURSE reading (`GroveCourseSummary`) — there is no per-concept prior
 * to track here, unlike the ground-streak store next to this one.
 *
 * **Replace, not merge, on every save** — same reasoning `./ground-streak-
 * store.ts`'s module doc states for its own store. `./provider.ts` only
 * ever computes a real `GroveCourseSummary` for a `'declared'` course (the
 * other two statuses carry no `summary` at the TYPE level — see `../../../
 * core/src/scope/grove.ts`), so a course that stops being `'declared'`
 * between two reads has nothing current to report and must not linger here
 * either: `save` replaces the whole stored map with exactly the courses the
 * caller hands in.
 *
 * **Never her content (INV-6, D-005).** The `denominatorSourcePaths` stored
 * here are vault PATHS to documents she already registered herself
 * (F1.5) — not anything Olea derived from what those documents say, and no
 * concept name, note title or prose ever passes through this store.
 * `data.json` is plugin configuration under `.obsidian/plugins/<id>/`,
 * never a vault note.
 */

import type { VaultPath } from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';

export const GROVE_PRIOR_DENOMINATORS_STORAGE_KEY = 'grovePriorDenominators';

/** One course's last-computed `GroveCourseSummary`, minus `builtCount` — the two facts the scope-correction receipt needs (`./copy.ts#groveScopeCorrectionReceiptLine`). */
export interface GrovePriorDenominatorEntry {
  readonly denominatorCount: number;
  readonly denominatorSourcePaths: readonly VaultPath[];
}

export interface GrovePriorDenominators {
  readonly version: 1;
  /** Course name -> its last-computed denominator snapshot. Never holds a course that is not currently `'declared'` — see module doc. */
  readonly courses: Readonly<Record<string, GrovePriorDenominatorEntry>>;
}

export const EMPTY_GROVE_PRIOR_DENOMINATORS: GrovePriorDenominators = { version: 1, courses: {} };

function isGrovePriorDenominatorEntry(value: unknown): value is GrovePriorDenominatorEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.denominatorCount !== 'number') return false;
  if (!Number.isInteger(candidate.denominatorCount) || candidate.denominatorCount < 0) return false;
  if (!Array.isArray(candidate.denominatorSourcePaths)) return false;
  return candidate.denominatorSourcePaths.every((path) => typeof path === 'string');
}

function isGrovePriorDenominators(value: unknown): value is GrovePriorDenominators {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.courses !== 'object' || candidate.courses === null) return false;
  return Object.values(candidate.courses as Record<string, unknown>).every(
    isGrovePriorDenominatorEntry,
  );
}

export class ObsidianGrovePriorDenominatorStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns an empty map — never throws — when nothing usable is stored. */
  async load(): Promise<ReadonlyMap<string, GrovePriorDenominatorEntry>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[GROVE_PRIOR_DENOMINATORS_STORAGE_KEY];
    if (!isGrovePriorDenominators(candidate)) return new Map();
    return new Map(Object.entries(candidate.courses));
  }

  /** REPLACES the whole stored map — see module doc for why a course absent from the new save must disappear rather than linger. */
  async save(entries: ReadonlyMap<string, GrovePriorDenominatorEntry>): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const value: GrovePriorDenominators = { version: 1, courses: Object.fromEntries(entries) };
    blob[GROVE_PRIOR_DENOMINATORS_STORAGE_KEY] = value;
    await this.host.saveData(blob);
  }
}
