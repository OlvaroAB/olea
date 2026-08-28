/**
 * `ObsidianRegistryOverridesStore` — persists F8.4's rename and F8.5's
 * prune state (`[REG-1]`, `ol-4v2l`, amended acceptance `[D-135]`).
 *
 * Same deliberate deviation `retrospective/offer-store.ts` names for its own
 * state, and for the identical reason: `olea-core`'s
 * `RegistryOverrides` is local, per-install state with no event-sourced home
 * in this bead's owned paths. `packages/contracts` and
 * `packages/core/src/review-log/` both sit outside `ol-4v2l`'s ownership, so
 * rather than add a schema this bead does not own, this store follows the
 * exact `data.json` read-modify-write pattern `plan/settings-store.ts`,
 * `retrospective/offer-store.ts` and `today/term-window-store.ts` already
 * use: one top-level key, versioned, loaded and saved whole.
 *
 * **What this costs, honestly** — same trade `retrospective/offer-store.ts`
 * states for its own store: `data.json` lives under
 * `.obsidian/plugins/<id>/` inside her vault folder, so it travels with
 * whatever syncs the vault, but it is a plain JSON blob, not an append-only
 * mergeable log — two devices renaming or pruning the same concept between
 * syncs can clobber each other's edit. Nothing here blocks the honest fix
 * (a `RegistryOverrides`-shaped `EventKind` added to
 * `packages/contracts/src/review-log.ts`, a follow-up bead with contracts
 * ownership): `RegistryOverrides` is the same shape either persistence would
 * carry, so migrating the storage later does not touch the pure transforms
 * in `olea-core`'s `registry/overrides.ts`.
 *
 * **Never her authored content (INV-6).** `data.json` is plugin
 * configuration, not a vault note — renaming or pruning through this store
 * never writes a byte into anything she authored.
 */

import { EMPTY_REGISTRY_OVERRIDES, type RegistryOverrides } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export const REGISTRY_OVERRIDES_STORAGE_KEY = 'registryOverrides';

function isRegistryOverrides(value: unknown): value is RegistryOverrides {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.renames !== 'object' || candidate.renames === null) return false;
  if (!Array.isArray(candidate.prunedConceptKeys)) return false;
  return candidate.prunedConceptKeys.every((key) => typeof key === 'string');
}

export class ObsidianRegistryOverridesStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EMPTY_REGISTRY_OVERRIDES` — never throws — when nothing usable is stored. */
  async load(): Promise<RegistryOverrides> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_REGISTRY_OVERRIDES;
    const candidate = (blob as Record<string, unknown>)[REGISTRY_OVERRIDES_STORAGE_KEY];
    return isRegistryOverrides(candidate) ? candidate : EMPTY_REGISTRY_OVERRIDES;
  }

  async save(overrides: RegistryOverrides): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[REGISTRY_OVERRIDES_STORAGE_KEY] = overrides;
    await this.host.saveData(blob);
  }
}
