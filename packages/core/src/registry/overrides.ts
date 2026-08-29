/**
 * Pure transforms over `RegistryOverrides` (F8.4's rename, F8.5's prune) —
 * see `./types.ts`'s module doc for what this local, per-install state is
 * and honestly is not. Nothing here touches a vault or a clock; the plugin's
 * `ObsidianRegistryOverridesStore` is the only thing that persists the
 * result, exactly as `../retrospective/offer.ts` (pure) and
 * `../../packages/plugin/src/retrospective/offer-store.ts` (persistence)
 * split for the same reason.
 *
 * ## Rename semantics, and the two guards that keep it honest
 *
 * - **A rename to the concept's own current display name is a no-op.** Not
 *   an error — pressing "rename" without changing anything must not create
 *   a pointless alias entry or a lineage event (F8.4: "a lineage event
 *   records a rename only when it marks an actual reshaping of the concept
 *   ... not a retitled note" — an unchanged name is certainly not that).
 * - **A rename back to the concept's ORIGINAL name (the raw vault-derived
 *   one, never overridden) clears the override entirely**, rather than
 *   leaving an override whose `displayName` happens to equal the fallback.
 *   This is what keeps "no override" and "override that reads the same as
 *   no override" from being two representations of one state — a duplicate
 *   this module refuses to create so a later reader never has to ask which
 *   one it is looking at. The alias trail built up while she was using a
 *   different name is dropped along with the override in this one case —
 *   nothing about the concept's identity, evidence or history is lost by
 *   that (F8.5's "nothing is discarded" governs the concept, not a cosmetic
 *   local alias list), only the convenience of a "previously called X" note
 *   once she is back to the name her vault already carries.
 *
 * ## Prune semantics
 *
 * `pruneConcept`/`unpruneConcept` only ever add or remove a key from a set.
 * Pruning a concept a second time, or unpruning one that was never pruned,
 * is a no-op — never an error, and never a reason to invent a "delete" path
 * (F8.5's hard clamp: no surface may offer `Delete`, and none of these
 * functions do).
 */

import type { RegistryOverrides, RegistryRenameOverride } from './types.js';

export const EMPTY_REGISTRY_OVERRIDES: RegistryOverrides = {
  version: 1,
  renames: {},
  prunedConceptKeys: [],
};

function dedupeAliases(candidate: string, existing: readonly string[]): readonly string[] {
  // Most-recent-first, and the incoming name never appears twice even if she
  // renames back and forth between the same two words.
  return [candidate, ...existing.filter((alias) => alias !== candidate)];
}

/**
 * Applies a rename. `originalName` is the raw, never-overridden name this
 * concept's extraction currently produces (`ConceptRecord.name`) — the value
 * a rename back to it should clear the override against, per this module's
 * doc.
 *
 * Returns `overrides` unchanged (same reference) when `newDisplayName` is
 * blank or equal to the concept's current resolved display name — a no-op
 * guard the caller does not have to duplicate.
 */
export function renameConcept(
  overrides: RegistryOverrides,
  key: string,
  originalName: string,
  newDisplayName: string,
): RegistryOverrides {
  const trimmed = newDisplayName.trim();
  const currentOverride = overrides.renames[key];
  const currentDisplayName = currentOverride?.displayName ?? originalName;
  if (trimmed.length === 0 || trimmed === currentDisplayName) return overrides;

  if (trimmed === originalName) {
    // Renamed back to her vault's own wording — clear the override entirely
    // (see module doc: no representation of "no override" competes with
    // another that merely reads the same).
    const renames = Object.fromEntries(
      Object.entries(overrides.renames).filter(([existingKey]) => existingKey !== key),
    );
    return { ...overrides, renames };
  }

  const priorAliases = currentOverride?.aliases ?? [];
  const aliases = dedupeAliases(currentDisplayName, priorAliases);
  const nextOverride: RegistryRenameOverride = { displayName: trimmed, aliases };
  return { ...overrides, renames: { ...overrides.renames, [key]: nextOverride } };
}

export function pruneConcept(overrides: RegistryOverrides, key: string): RegistryOverrides {
  if (overrides.prunedConceptKeys.includes(key)) return overrides;
  return {
    ...overrides,
    prunedConceptKeys: [...overrides.prunedConceptKeys, key].sort(),
  };
}

export function unpruneConcept(overrides: RegistryOverrides, key: string): RegistryOverrides {
  if (!overrides.prunedConceptKeys.includes(key)) return overrides;
  return {
    ...overrides,
    prunedConceptKeys: overrides.prunedConceptKeys.filter((k) => k !== key),
  };
}

export function isConceptPruned(overrides: RegistryOverrides, key: string): boolean {
  return overrides.prunedConceptKeys.includes(key);
}

/** `originalName` (`ConceptRecord.name`) when no override exists, her chosen wording otherwise. Always hers (C7.4) either way. */
export function resolvedDisplayName(
  overrides: RegistryOverrides,
  key: string,
  originalName: string,
): string {
  return overrides.renames[key]?.displayName ?? originalName;
}

/** Prior display names, most recent first. Empty until the first rename, and empty again once she renames back to her vault's own original wording (see this module's doc). */
export function aliasesFor(overrides: RegistryOverrides, key: string): readonly string[] {
  return overrides.renames[key]?.aliases ?? [];
}

/**
 * Every name a renamed concept has ever carried — current `displayName` plus
 * every demoted `aliases` entry (which, per `renameConcept`, already includes
 * the concept's original vault-derived name once a rename has happened) —
 * grouped so a caller can go from ANY one of those names to the whole set.
 *
 * Read by `../retrieval/aliasExpansion.ts` to wire F8.4/`[D-088]`'s "retrieval
 * keeps matching material written before the rename" clause
 * (`features/F8-concepts-scope.md`'s "her old wording still resolves after
 * the rename" scenario) — this function only ever equates names THIS run's
 * `overrides` blob already says are the same concept's history, never a
 * `key`. That matters because C7.11's key is still provisional
 * (`../concept/types.ts`'s own doc): it is stable within one extraction run
 * but not across one, so nothing downstream of this function may cache its
 * result across runs or assume a group survives a re-extraction — recompute
 * it fresh from that run's own `overrides` every time, exactly as this
 * module's other reads already do.
 *
 * A concept with no rename override contributes nothing — there is only ever
 * one name to group, and grouping a singleton would just be `resolvedDisplayName`
 * again under a different name.
 */
export function aliasEquivalenceGroups(
  overrides: RegistryOverrides,
): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, readonly string[]>();
  for (const override of Object.values(overrides.renames)) {
    const names = [override.displayName, ...override.aliases];
    for (const name of names) groups.set(name, names);
  }
  return groups;
}
