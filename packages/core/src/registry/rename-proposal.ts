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
 * ## The CLASS C gap this bead's tripwire stopped on, named exactly
 *
 * Detecting that a higher-ranked source has ARRIVED — as opposed to having
 * always been there — needs memory of what tier/wording was showing on the
 * PREVIOUS read, because `../concept/extract.js` always mints a fresh
 * `ConceptRecord` at whatever is the single highest tier currently
 * available; there is no second, lower-ranked candidate surviving in its
 * output to compare against. Today that memory is session-scoped only:
 * `packages/plugin/src/registry/provider.ts` keeps it in an in-memory `Map`/
 * `Set`, alive only as long as the plugin stays loaded, and its own module
 * doc says so. Making it durable — surviving a restart, the way `renames`
 * and `prunedConceptKeys` already do — needs a genuinely new persisted
 * field: concretely, `RegistryOverrides.renames[key]` would need to carry
 * the tier that set the CURRENT (possibly override-free) display name
 * whenever a candidate has been detected pending, plus a durable record of
 * declined `(tier, wording)` signatures per concept key so "a declined
 * proposal does not fire again" (`[D-183]`) survives more than one session.
 * That is a persisted-schema change — Class C by the run charter's own
 * ladder — and this bead's brief is explicit: stop and report it rather
 * than add it. This file and `provider.ts` are built so wiring that field
 * in later is a small, additive change: `gateRenameCandidate`'s `memory`
 * parameter already takes exactly the shape (`RenameProposalMemory`) such a
 * field would carry; nothing here would need to change shape, only where it
 * is read from and written to.
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
 * `gateRenameCandidate`/`declineSignature`/`RenameProposalMemory` are not
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
 * would (`./overrides.ts`'s `renameConcept`, unmodified — no new persisted
 * field needed for this half). `proposal.currentDisplayName` is handed in
 * as `renameConcept`'s `originalName` parameter — not `proposal.key`'s raw
 * extraction wording, which by construction already equals
 * `proposal.candidate.wording` and would make `renameConcept` see "renaming
 * to what's already current" and no-op. Passing the frozen OLD wording
 * instead is what makes `renameConcept` demote exactly that wording to an
 * alias, matching `[D-183]`'s "the old wording stays as a permanent alias
 * in every case."
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
  );
}

/**
 * Decline: a pure `Set` transform recording `(tier, wording)` so
 * `gateRenameCandidate` stops re-raising this exact candidate. Returns the
 * same reference when the signature is already present (matching this
 * package's own no-op-returns-same-reference convention, e.g.
 * `./overrides.ts`'s `renameConcept`). See this file's module doc: the
 * caller decides where this set lives, and today that is session-scoped
 * memory in `provider.ts`, not a persisted store.
 */
export function recordDeclinedRenameProposal(
  declined: ReadonlySet<string>,
  proposal: RenameProposal,
): ReadonlySet<string> {
  const signature = declineSignature(proposal.candidate);
  if (declined.has(signature)) return declined;
  return new Set([...declined, signature]);
}
