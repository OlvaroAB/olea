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
 *
 * **Renames and withdrawals by concept identity (`[D-378]`,
 * `ol-egov.141.89.9.56`).** Both are keyed by concept key, and a key stored
 * before two same-anchor `.olea/concepts/` records were read as one identity
 * may be the superseded duplicate's. `load({ canonicalKeys })` is the READ
 * view: each key resolved through `olea-core`'s canonical-key index
 * (`resolveRegistryOverridesThroughCanonicalKeys`), so a rename or withdrawal
 * made under a superseded key reads under the canonical key. `load()` with
 * no index is the AS-STORED view, and it is the one a read-modify-write must
 * use: `save()` writes whatever it is given, so saving a resolved view would
 * rewrite stored keys, which `[D-378]` forbids. A shared introducing passage
 * alone never makes two concepts one identity, so it never merges two
 * entries here.
 */

import {
  type ConceptKeyCanonicalIndex,
  EMPTY_REGISTRY_OVERRIDES,
  type RegistryOverrides,
} from 'olea-core';
import { hasReadModifyWrite } from '../retrieval/serializing-data-host.js';

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
  if (!candidate.prunedConceptKeys.every((key) => typeof key === 'string')) return false;
  // `[D-206]` (`ol-2zfj.59`): additive and OPTIONAL — a blob written before
  // this field existed simply omits it, and that still loads (the "existing
  // overrides without the new fields still load" scenario). Only reject
  // when the key is present but malformed; `renames[key].sourceTier` is not
  // deep-validated here for the same reason `renames` itself never was —
  // this guard checks the store's own top-level shape, not every nested
  // field `./types.ts` documents.
  if (candidate.declinedRenameSignatures !== undefined) {
    if (!Array.isArray(candidate.declinedRenameSignatures)) return false;
    if (!candidate.declinedRenameSignatures.every((signature) => typeof signature === 'string')) {
      return false;
    }
  }
  return true;
}

/**
 * The read view of `overrides` by concept identity (`[D-378]`, module doc). Each rename and each
 * withdrawal is filed under its key's canonical key. When one identity has renames under more than
 * one of its keys, the rename stored under the canonical key itself wins, else the one under the
 * code-unit-first key (a declared tie-break: any fixed order reads the same on every device).
 * Withdrawals union: an identity withdrawn under any of its keys reads as withdrawn.
 * `declinedRenameSignatures` is keyed by wording, never by concept, and passes through. Pure; the
 * same object when no stored key is a superseded duplicate.
 */
export function resolveRegistryOverridesThroughCanonicalKeys(
  overrides: RegistryOverrides,
  canonicalKeys: ConceptKeyCanonicalIndex,
): RegistryOverrides {
  const storedKeys = [...Object.keys(overrides.renames), ...overrides.prunedConceptKeys];
  if (!storedKeys.some((key) => canonicalKeys.canonicalOf(key) !== key)) return overrides;

  const renames: Record<string, RegistryOverrides['renames'][string]> = {};
  const renameKeys = Object.keys(overrides.renames).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of renameKeys) {
    const rename = overrides.renames[key];
    if (rename !== undefined && canonicalKeys.canonicalOf(key) === key) renames[key] = rename;
  }
  for (const key of renameKeys) {
    const canonical = canonicalKeys.canonicalOf(key);
    const rename = overrides.renames[key];
    if (rename !== undefined && !Object.hasOwn(renames, canonical)) renames[canonical] = rename;
  }
  const prunedConceptKeys = [
    ...new Set(overrides.prunedConceptKeys.map((key) => canonicalKeys.canonicalOf(key))),
  ].sort();
  return { ...overrides, renames, prunedConceptKeys };
}

export interface LoadRegistryOverridesOptions {
  /**
   * Given, `load` returns the read view by concept identity
   * (`resolveRegistryOverridesThroughCanonicalKeys`); omitted, the overrides exactly as stored —
   * the only view a read-modify-write may save back (module doc).
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

export class ObsidianRegistryOverridesStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EMPTY_REGISTRY_OVERRIDES` — never throws — when nothing usable is stored. */
  async load(options: LoadRegistryOverridesOptions = {}): Promise<RegistryOverrides> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_REGISTRY_OVERRIDES;
    const candidate = (blob as Record<string, unknown>)[REGISTRY_OVERRIDES_STORAGE_KEY];
    const stored = isRegistryOverrides(candidate) ? candidate : EMPTY_REGISTRY_OVERRIDES;
    return options.canonicalKeys === undefined
      ? stored
      : resolveRegistryOverridesThroughCanonicalKeys(stored, options.canonicalKeys);
  }

  /**
   * Atomic (`readModifyWrite`) when `this.host` supports it, falling back
   * to a plain, non-atomic pair otherwise — see `../retrieval/serializing-
   * data-host.ts`'s module doc.
   */
  async save(overrides: RegistryOverrides): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      blob[REGISTRY_OVERRIDES_STORAGE_KEY] = overrides;
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
