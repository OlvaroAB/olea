/**
 * `ObsidianHomeScopeGrowthStore` — persists F6.10's "scope grew" quiet-line
 * inputs, per course, across desktop sessions (`[D-223]`, `ol-l5og.21`
 * [HOME-2]).
 *
 * **The mirror image of `../grove/prior-denominator-store.ts`, not a second
 * copy of it.** That store exists to let `grove/provider.ts` tell a SHRINK
 * apart from "the count has always been this" (`[D-184]`'s scope-correction
 * receipt). F6.10 names the opposite direction as one of its five ratified
 * quiet-line states — "scope grew and by which document" — which needs the
 * identical missing piece (a prior read to compare against) but fires on the
 * opposite comparison and produces a different fact (which document was
 * ADDED, not which was reclassified away). `olea-core#buildGroveModel` holds
 * no memory of a previous read either way (see that module's own doc, quoted
 * again in the grove store above), and this bead owns `home/`, not
 * `grove/` — so this is its own store rather than a shared one, the same
 * "the two are not shared into one module because they differ in exactly one
 * comparison, and sharing would need a home neither bead more naturally owns
 * than the other" reasoning `grove/provider.ts`'s own module doc already
 * gives for `resolveOfferCards` vs. its own filtered read.
 *
 * Same deliberate `data.json` read-modify-write shape every other per-course
 * store in this plugin uses (`../grove/prior-denominator-store.ts`,
 * `../grove/ground-streak-store.ts`, `../registry/overrides-store.ts`,
 * `../plan/settings-store.ts`): one top-level key, versioned, loaded and
 * saved whole.
 *
 * **Keyed by course name.** Same reasoning as the grove store: F6.10's
 * scope-growth reading is per-course, not per-concept.
 *
 * **Replace, not merge, on every save.** `home/provider.ts` only ever
 * computes a real `denominatorCount`/`denominatorSourcePaths` pair for a
 * `'declared'` grove course; a course that stops being `'declared'` between
 * two reads has nothing current to report and must not linger here as a
 * stale prior either — identical reasoning to the grove store's own.
 *
 * **Never her content (INV-6, D-005).** The paths stored here are vault
 * PATHS to documents she registered herself (F1.5), never anything Olea
 * derived from what those documents say.
 */

import type { VaultPath } from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';

export const HOME_SCOPE_GROWTH_STORAGE_KEY = 'homeScopeGrowth';

/** One course's last-computed scope snapshot — the two facts a growth receipt needs. */
export interface HomeScopeSnapshot {
  readonly denominatorCount: number;
  readonly denominatorSourcePaths: readonly VaultPath[];
}

export interface HomeScopeGrowth {
  readonly version: 1;
  /** Course name -> its last-computed scope snapshot. Never holds a course that is not currently `'declared'` — see module doc. */
  readonly courses: Readonly<Record<string, HomeScopeSnapshot>>;
}

export const EMPTY_HOME_SCOPE_GROWTH: HomeScopeGrowth = { version: 1, courses: {} };

function isHomeScopeSnapshot(value: unknown): value is HomeScopeSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.denominatorCount !== 'number') return false;
  if (!Number.isInteger(candidate.denominatorCount) || candidate.denominatorCount < 0) return false;
  if (!Array.isArray(candidate.denominatorSourcePaths)) return false;
  return candidate.denominatorSourcePaths.every((path) => typeof path === 'string');
}

function isHomeScopeGrowth(value: unknown): value is HomeScopeGrowth {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.courses !== 'object' || candidate.courses === null) return false;
  return Object.values(candidate.courses as Record<string, unknown>).every(isHomeScopeSnapshot);
}

export class ObsidianHomeScopeGrowthStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns an empty map — never throws — when nothing usable is stored. */
  async load(): Promise<ReadonlyMap<string, HomeScopeSnapshot>> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return new Map();
    const candidate = (blob as Record<string, unknown>)[HOME_SCOPE_GROWTH_STORAGE_KEY];
    if (!isHomeScopeGrowth(candidate)) return new Map();
    return new Map(Object.entries(candidate.courses));
  }

  /** REPLACES the whole stored map — see module doc for why a course absent from the new save must disappear rather than linger. */
  async save(entries: ReadonlyMap<string, HomeScopeSnapshot>): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const value: HomeScopeGrowth = { version: 1, courses: Object.fromEntries(entries) };
    blob[HOME_SCOPE_GROWTH_STORAGE_KEY] = value;
    await this.host.saveData(blob);
  }
}

/** One course's F6.10 scope-growth receipt — the document that was added, and the count it grew from/to. */
export interface HomeScopeGrowthReceipt {
  readonly addedDocumentPath: VaultPath;
  readonly priorDenominatorCount: number;
  readonly newDenominatorCount: number;
}

/**
 * Fires ONLY on an actual growth (`current.denominatorCount >
 * prior.denominatorCount`) — the mirror of `../grove/provider.ts`'s
 * `scopeCorrectionReceiptFor`, which fires only on a fall. Names the
 * document present in the NEW `denominatorSourcePaths` and absent from the
 * prior — the one that supplied the added concepts — sorted for determinism
 * if more than one document was registered in the same read. Absent a
 * droppable — added — document to name, this returns `undefined` rather
 * than guessing, matching the grove store's own "state what you're given,
 * never invent" posture.
 */
export function homeScopeGrowthReceiptFor(
  prior: HomeScopeSnapshot | undefined,
  current: HomeScopeSnapshot,
): HomeScopeGrowthReceipt | undefined {
  if (prior === undefined || current.denominatorCount <= prior.denominatorCount) {
    return undefined;
  }
  const priorPaths = new Set(prior.denominatorSourcePaths);
  const added = current.denominatorSourcePaths.filter((path) => !priorPaths.has(path)).sort();
  const addedDocumentPath = added[0];
  if (addedDocumentPath === undefined) return undefined;
  return {
    addedDocumentPath,
    priorDenominatorCount: prior.denominatorCount,
    newDenominatorCount: current.denominatorCount,
  };
}
