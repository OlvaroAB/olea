/**
 * `[D-183]`'s rank-gated rename proposal — the second half of the naming
 * rule (knowledge model §3, `ol-2zfj.58`, discovered from `[D-183]`/
 * `ol-egov.70`). The first half (`[D-088]`) already lets her rename a
 * concept from the registry, demoting the old wording to a permanent alias
 * (`./overrides.ts`'s `renameConcept`). This file adds the missing other
 * direction: **a later-arriving source never overwrites a display name
 * silently just because it outranks the source that set it** — it raises a
 * proposal, through the same accept/decline shape F8.4a's note-offer already
 * established (`./types.ts`'s `RegistryConceptEntry.noteOffer`,
 * `../concept/note-offer.ts`).
 *
 * ## The rank rule, exactly as ruled
 *
 * Knowledge model §3's provenance tiers are already the rank: 1 (her own
 * concept note) outranks 2 (her `topic` property) outranks 3 (extracted from
 * her material alone) — lower number, higher rank, `../concept/types.ts`'s
 * `ConceptTier`. A proposal fires only when a candidate's tier is STRICTLY
 * higher-ranked than the tier that set the concept's current display name,
 * and only when the wording actually differs — a same-tier edit, or a
 * higher tier proposing the SAME wording that is already showing, is not a
 * rename and raises nothing. A **manual override already active** (she
 * renamed it herself, whether directly or by accepting an earlier proposal)
 * outranks every tier by construction — nothing here may propose over her
 * own word, ever, matching R1/R2 and the knowledge model's "hers wins"
 * throughout. `gateRenameCandidate` below reads that fact off the one
 * signal already available with no new field: `entry.displayName !==
 * entry.originalName` means an override exists.
 *
 * ## Accept reuses `renameConcept`; nothing new is persisted for it
 *
 * Accepting a proposal is architecturally identical to a manual rename: it
 * mutates the same `RegistryOverrides.renames` entry, through the same
 * writer, with the frozen-out `currentDisplayName` handed in as the wording
 * to demote — see `acceptRenameProposal` below. `RegistryRenameOverride`
 * needs no new field for this half of the mechanism.
 *
 * ## The CLASS C gap `ol-2zfj.58`'s tripwire stopped on — CLOSED by `[D-206]` (`ol-2zfj.59`)
 *
 * Detecting that a higher-ranked source has ARRIVED — as opposed to having
 * always been there — needs memory of what tier/wording was showing on the
 * PREVIOUS read, because `../concept/extract.js` always mints a fresh
 * `ConceptRecord` at whatever is the single highest tier currently
 * available; there is no second, lower-ranked candidate surviving in its
 * output to compare against. That memory was session-scoped only through
 * `ol-2zfj.58`: `packages/plugin/src/registry/provider.ts` kept it in an
 * in-memory `Map`/`Set`, alive only as long as the plugin stayed loaded.
 *
 * `[D-206]` adds the two additive, non-migrating fields this file's own
 * doc named as the fix: `./types.ts`'s `RegistryRenameOverride.sourceTier`
 * (the tier that set the current wording, when it came from ACCEPTING a
 * proposal) and `RegistryOverrides.declinedRenameSignatures` (every
 * declined `(tier, wording)` pair, global rather than per-key — the same
 * unit `declineSignature` already used for the session `Set`). Two readers
 * below turn those persisted fields back into `gateRenameCandidate`'s
 * existing parameter shapes, so the pure gate function itself needed no
 * signature change: `renameProposalMemoryFrom` reconstructs a
 * `RenameProposalMemory` baseline for a key that has an accepted override,
 * and `declinedRenameSignaturesFrom` reconstructs the whole declined `Set`.
 * A caller (`provider.ts`'s `load()`) seeds its per-session memory from
 * these on first sight of a key each session, then keeps advancing it in
 * memory exactly as before — durable data supplies the STARTING point,
 * session memory still carries a genuinely PENDING (not yet accepted or
 * declined) proposal through the rest of that one session, which remains a
 * real, named, and much narrower gap than the one this closes: a proposal
 * that is live but undecided when Obsidian restarts is re-derived fresh on
 * the next load rather than staying frozen, because nothing about a merely
 * PENDING candidate is written anywhere until she acts.
 *
 * ## A second, deeper reachability gap — independent of the persistence one
 *
 * Even with that field, `../concept/extract.ts`'s tier-1/tier-3 note
 * binding is always an EXACT title match against the name already in hand
 * (see that file's own doc) — nothing in today's real extraction pipeline
 * ever hands the SAME key a NEW, different name at a higher tier. A vault
 * change that would genuinely trigger this rule (she writes a differently-
 * worded note about a concept the system only knew from a slide deck) mints
 * a DIFFERENT key today, not a rename candidate for the existing one — see
 * `packages/plugin/test/registry/provider.spec.ts`'s "[D-183]" describe
 * block for where this is proven un-fixturable. Closing this needs the
 * still-provisional stable-key work (`../concept/types.ts`'s own doc on
 * `ConceptRecord.key`), not anything in `ol-2zfj.58`'s `owns`.
 *
 * ## `packages/plugin/src/registry/provider.ts` cannot import this file
 *
 * `packages/core/src/index.ts` is `olea-core`'s only public surface, and it
 * sits outside `ol-2zfj.58`'s `owns` (a shared file, edited by whichever
 * lane is live on it — see this repo's own file-ownership rule). So
 * `gateRenameCandidate`/`declineSignature`/`RenameProposalMemory`/
 * `renameProposalMemoryFrom`/`declinedRenameSignaturesFrom` are not
 * exported there, and cannot be imported cross-package today.
 * `provider.ts`'s module doc carries a small, function-for-function mirror
 * of this file's decision logic for exactly that reason, with a comment
 * pointing back here — collapse that duplication into a real import the
 * moment whoever owns `index.ts` next touches it and can add the two-line
 * export; this file is the tested, canonical version in the meantime. This
 * is the same shape `packages/plugin/src/registry/copy.ts`'s own doc
 * already documents for a type it could not import for the identical
 * reason (`RegistryExplainBackHistoryRow`, `ol-2zfj.25`/`ol-l5og.14`-era).
 */

import type { ConceptTier } from '../concept/types.js';
import { renameConcept } from './overrides.js';
import type {
  RegistryOverrides,
  RegistrySourceLocation,
  RenameProposal,
  RenameProposalCandidate,
} from './types.js';

/** `true` when `candidateTier` is strictly higher-ranked than `currentTier` — knowledge model §3's tier 1 > tier 2 > tier 3, so "outranks" means numerically LOWER. */
export function outranksCurrent(candidateTier: ConceptTier, currentTier: ConceptTier): boolean {
  return candidateTier < currentTier;
}

/**
 * A stable identity for "this exact source, proposing this exact wording" —
 * `[D-183]`'s own unit for "does not fire again": *the same source and the
 * same wording*, never the concept alone (a DIFFERENT higher-ranked source,
 * or the same source proposing DIFFERENT wording later, is a new proposal).
 */
export function declineSignature(
  candidate: Pick<RenameProposalCandidate, 'tier' | 'wording'>,
): string {
  return `${candidate.tier}:${candidate.wording}`;
}

/**
 * What must be remembered across reads to gate correctly next time — the
 * tier and wording currently being SHOWN (frozen, if a proposal is
 * pending), not necessarily whatever `../concept/extract.js` most recently
 * minted. See this file's module doc for why this is session-memory only
 * today and exactly what would make it durable.
 */
export interface RenameProposalMemory {
  readonly tier: ConceptTier;
  readonly displayName: string;
}

/** Everything `gateRenameCandidate` reads about one concept's freshest extraction pass, gathered by the caller from fields `./types.ts`'s `RegistryConceptEntry` already carries — nothing new is computed to produce this. */
export interface GateRenameCandidateInput {
  readonly key: string;
  /** `RegistryConceptEntry.displayName` as `./build.ts` resolved it this read. */
  readonly displayName: string;
  /** `RegistryConceptEntry.originalName` — this read's raw, never-overridden extraction wording. */
  readonly originalName: string;
  /** `RegistryConceptEntry.tier` — this read's provenance tier. */
  readonly tier: ConceptTier;
  /** A representative location for the candidate's evidence — `RegistryConceptEntry.sourceLocations[0]` is the caller's honest default; `undefined` when the concept has none yet. */
  readonly sourceLocation?: RegistrySourceLocation;
}

export interface GateRenameCandidateResult {
  /** What should actually be shown as `displayName` this read — the frozen wording while a proposal is live or declined-but-unresolved, `input.originalName` otherwise. */
  readonly displayName: string;
  /** The proposal to render, or `null` when nothing is pending. */
  readonly renameProposal: RenameProposal | null;
  /** Pass this back in as `priorMemory` on the NEXT read for this key. */
  readonly memory: RenameProposalMemory;
}

/**
 * The whole of `[D-183]`'s detection-and-freeze mechanism, pure and
 * synchronous — no vault I/O, no clock (`../../CLAUDE.md`'s INV-1/§7.1
 * posture, matching `../concept/note-offer.ts`'s own `noteOfferEligible`).
 *
 * - An **active manual override** (`input.displayName !== input.originalName`)
 *   suppresses every candidate unconditionally — her own word already
 *   outranks any tier. Memory still advances to the fresh extraction so a
 *   later reversion (`renameConcept`'s "back to original clears the
 *   override" case) does not immediately read as a spurious improvement.
 * - **No prior memory** (first read this session for this key), **no rank
 *   improvement**, or **identical wording** all establish/confirm the
 *   baseline and propose nothing — this is the common case on every read
 *   where nothing has changed.
 * - Otherwise a genuine higher-ranked, differently-worded candidate has
 *   arrived: `displayName` freezes at the OLD wording (`priorMemory`,
 *   passed straight back out) and `memory` stays frozen too, so the same
 *   proposal re-derives identically on the next read until she acts —
 *   UNLESS this exact `(tier, wording)` pair is already in
 *   `declinedSignatures`, in which case the freeze stands but no proposal
 *   is (re-)raised (`[D-183]`: "a declined proposal does not fire again for
 *   the same source and wording").
 */
export function gateRenameCandidate(
  input: GateRenameCandidateInput,
  priorMemory: RenameProposalMemory | undefined,
  declinedSignatures: ReadonlySet<string>,
): GateRenameCandidateResult {
  const hasManualOverride = input.displayName !== input.originalName;
  if (hasManualOverride) {
    return {
      displayName: input.displayName,
      renameProposal: null,
      memory: { tier: input.tier, displayName: input.originalName },
    };
  }

  const noImprovement =
    priorMemory === undefined ||
    !outranksCurrent(input.tier, priorMemory.tier) ||
    input.originalName === priorMemory.displayName;
  if (noImprovement) {
    return {
      displayName: input.originalName,
      renameProposal: null,
      memory: { tier: input.tier, displayName: input.originalName },
    };
  }

  const candidate: RenameProposalCandidate = {
    tier: input.tier,
    wording: input.originalName,
    ...(input.sourceLocation !== undefined ? { sourceLocation: input.sourceLocation } : {}),
  };
  const frozenMemory: RenameProposalMemory = priorMemory;

  if (declinedSignatures.has(declineSignature(candidate))) {
    return { displayName: frozenMemory.displayName, renameProposal: null, memory: frozenMemory };
  }

  const proposal: RenameProposal = {
    key: input.key,
    currentDisplayName: frozenMemory.displayName,
    currentTier: frozenMemory.tier,
    candidate,
  };
  return { displayName: frozenMemory.displayName, renameProposal: proposal, memory: frozenMemory };
}

/**
 * Accept: mutates `RegistryOverrides.renames` exactly as a manual rename
 * would (`./overrides.ts`'s `renameConcept`), plus `[D-206]`'s addition —
 * `proposal.candidate.tier` is passed as the new `sourceTier`, so a LATER
 * proposal's rank gate has this acceptance's winning tier to compare
 * against even after an Obsidian restart wipes session memory (see
 * `renameProposalMemoryFrom` below). `proposal.currentDisplayName` is
 * handed in as `renameConcept`'s `originalName` parameter — not
 * `proposal.key`'s raw extraction wording, which by construction already
 * equals `proposal.candidate.wording` and would make `renameConcept` see
 * "renaming to what's already current" and no-op. Passing the frozen OLD
 * wording instead is what makes `renameConcept` demote exactly that wording
 * to an alias, matching `[D-183]`'s "the old wording stays as a permanent
 * alias in every case."
 */
export function acceptRenameProposal(
  overrides: RegistryOverrides,
  proposal: RenameProposal,
): RegistryOverrides {
  return renameConcept(
    overrides,
    proposal.key,
    proposal.currentDisplayName,
    proposal.candidate.wording,
    proposal.candidate.tier,
  );
}

/**
 * Reconstructs `gateRenameCandidate`'s `priorMemory` parameter from a
 * persisted override — `[D-206]`'s durable substitute for the provider's
 * session-scoped `Map`, read fresh on every load. `undefined` exactly when
 * `key` has no override yet, or has one with no `sourceTier` — a rename she
 * typed directly (INV-6: her own word, tier-less) already signals "manual
 * override" through `entry.displayName !== entry.originalName` on its own,
 * with no need for tier bookkeeping, so an absent `sourceTier` correctly
 * yields no reconstructed baseline here rather than a fabricated one.
 */
export function renameProposalMemoryFrom(
  overrides: RegistryOverrides,
  key: string,
): RenameProposalMemory | undefined {
  const override = overrides.renames[key];
  if (override === undefined || override.sourceTier === undefined) return undefined;
  return { tier: override.sourceTier, displayName: override.displayName };
}

/**
 * Reconstructs `gateRenameCandidate`'s `declinedSignatures` parameter from
 * `RegistryOverrides.declinedRenameSignatures` — `[D-206]`'s durable
 * substitute for the provider's session-scoped `Set`. Absent in the
 * persisted file (every overrides blob written before `[D-206]`) reads back
 * as an empty set, never an error — matching this module's own
 * "additive, no migration" convention.
 */
export function declinedRenameSignaturesFrom(overrides: RegistryOverrides): ReadonlySet<string> {
  return new Set(overrides.declinedRenameSignatures ?? []);
}

/**
 * Decline: a pure `RegistryOverrides` transform recording `(tier, wording)`
 * so `gateRenameCandidate` stops re-raising this exact candidate —
 * `[D-206]`'s persisted form of what was a bare `Set` transform under
 * `ol-2zfj.58`. Returns the same reference when the signature is already
 * present (matching this package's own no-op-returns-same-reference
 * convention, e.g. `./overrides.ts`'s `renameConcept`). The caller
 * (`provider.ts`'s `declineRenameProposal`) persists the result through the
 * same `ObsidianRegistryOverridesStore.save()` path `rename`/`withdraw`/
 * `restore` already use, so a decline now survives a restart the same way
 * they do.
 */
export function recordDeclinedRenameProposal(
  overrides: RegistryOverrides,
  proposal: RenameProposal,
): RegistryOverrides {
  const signature = declineSignature(proposal.candidate);
  const existing = overrides.declinedRenameSignatures ?? [];
  if (existing.includes(signature)) return overrides;
  return { ...overrides, declinedRenameSignatures: [...existing, signature] };
}
