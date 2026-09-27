/**
 * `[D-397]` — the registry's suspect-instrument section (F2.23, amended Sep 2026). Ruling text
 * (David, 2026-09-27, closing `ol-egov.141.89.6.56`, brief 86 option B): one small section on
 * the registry screen, beside — never merged into — the withheld-items list, listing only
 * instruments whose standing reads pending revalidation or flagged, computed at read time from
 * the underlying records; a changed passage, a contest, a rejection or unavailable safety
 * information keep their own destinations and never appear here.
 *
 * ## What this module is
 *
 * `deriveRegistrySuspectSection` is the whole read-time derivation, in one pure function: given
 * each instrument's already-resolved evidence, it buckets ids into `pendingRevalidation` and
 * `flagged`. It computes nothing new, persists nothing, and maintains no second list or stored
 * referral queue — calling it twice on unchanged evidence returns an identical result
 * (`suspect-section.spec.ts`'s "restart/reopen/clock never clears" cases), because nothing here
 * reads a clock, a session or anything stored.
 *
 * ## Wiring status — read before assuming this is reachable
 *
 * This module is pure, unit-tested logic only; it is **not wired to any UI yet**. The registry
 * screen's rendering lives in `packages/plugin/src/registry/view.ts`, its data assembly in
 * `packages/plugin/src/registry/provider.ts`, and its student-facing sentence wording (one
 * plain sentence per row, per the vocabulary registry) in `packages/plugin/src/registry/copy.ts`
 * — all three held, at the time this module was written, by a live lane's declared `owns`
 * (`ol-v7r5.93`, in progress on the same three files). This bead (`ol-egov.141.89.6.55`) could
 * not add them to its own `owns` without two lanes holding one file, so the wiring step — reading
 * `deriveRegistrySuspectSection`'s output into `RegistryModel`/the provider and rendering the
 * section with copy sentences — is left for once those files are free. No production caller
 * exists yet; see this bead's notes for the exact blocker (D-072).
 *
 * ## Pending revalidation (`[D-351]`)
 *
 * Reuses `../instrument/citation-validity.js`'s existing `CitationValidityStatus` rather than
 * re-deriving any of its scoping: that function's `'pending'` status is ALREADY exactly "a
 * relevant source mismatch is recorded for this instrument's own current source revision, not
 * yet resolved" — see its own doc for why a revalidation recorded against an older or newer
 * revision never reaches `'pending'` there, and why it is pure (no clock, no session, so a
 * restart or a wait can never change its answer). This module never calls
 * `citationValidityStatus` itself; the caller has already resolved it per instrument, the same
 * "arrives here already resolved" posture `../study-session/compose.ts`'s own citation-validity
 * evidence takes. Every status OTHER than `'pending'` is excluded — including `'superseded'`,
 * which is F2.23's own "a changed passage": that concern keeps its already-ruled destination and
 * must never be duplicated into this section (`[D-397]`'s ruling text, this bead's acceptance).
 *
 * ## Flagged
 *
 * `[D-397]`'s own text: "flagged begins only when a concern is recorded against the instrument;
 * nothing infers a flag." No producer records that concern anywhere in this codebase yet (this
 * bead's notes, 2026-09-27) — a persisted flag record would be a new stored shape with no
 * ruling behind it, and this bead's brief says explicitly not to invent one.
 * {@link FlaggedConcernEvidence} is the shape a future producer would supply, not a store: an
 * unresolved concern flags the instrument, that SAME concern's own recorded resolution
 * (`resolved: true`) clears it, and no other route in or out exists — no field here can be
 * driven by a lapse, a failure count or a rating, because none of those has a field on this
 * type at all. Until a producer exists, every caller omits `flagConcern`, so `flagged` is
 * correctly always empty — never a stubbed placeholder row.
 *
 * ## What is deliberately NOT tested here
 *
 * `'contested'`, `'rejected'` and `'safety-information-unavailable'` (the other three of
 * `[D-323]`'s six standing concerns, `../generation/decision-records/instrument-standing.js`)
 * have no field on {@link RegistrySuspectSectionInstrumentEvidence} at all — they are excluded
 * by the type, not by a runtime branch, so there is no runtime case to exercise for them here.
 * The full six-way exclusion (`[D-397]`'s "a changed passage, a contest, a rejection or
 * unavailable safety information never appears in it") is a UI-integration property once
 * `registry/provider.ts` assembles real evidence; this module only guarantees its own two
 * inputs behave correctly.
 */

import type { CitationValidityStatus } from '../instrument/citation-validity.js';

/**
 * `[D-397]`'s flag-concern evidence — not a persisted record; see module doc. `resolved: false`
 * keeps the instrument flagged; `resolved: true` is that concern's own recorded resolution, the
 * only thing that clears it. Absence of this field entirely (the only shape any caller supplies
 * today) means no concern is recorded.
 */
export interface FlaggedConcernEvidence {
  readonly resolved: boolean;
}

/**
 * One instrument's evidence for `[D-397]`'s section — exactly as much as a caller already holds,
 * nothing this module re-derives. Both fields independently optional; an instrument with neither
 * present belongs in neither list.
 */
export interface RegistrySuspectSectionInstrumentEvidence {
  readonly instrumentId: string;
  /**
   * `../instrument/citation-validity.js#citationValidityStatus`'s own four-state read, already
   * computed by the caller. Only `'pending'` puts the instrument in `pendingRevalidation`.
   */
  readonly citationValidity?: CitationValidityStatus;
  /** See {@link FlaggedConcernEvidence}'s own doc. */
  readonly flagConcern?: FlaggedConcernEvidence;
}

export interface RegistrySuspectSectionRow {
  readonly instrumentId: string;
}

/**
 * `[D-397]`'s section: two id lists, in the order given — no sentence wording (that is
 * `packages/plugin/src/registry/copy.ts`'s job, per the vocabulary registry, once that file is
 * free to edit) and no action affordance invented here.
 */
export interface RegistrySuspectSection {
  readonly pendingRevalidation: readonly RegistrySuspectSectionRow[];
  readonly flagged: readonly RegistrySuspectSectionRow[];
}

/**
 * `[D-397]`'s whole derivation — see module doc. An instrument matching both criteria appears in
 * both lists; input order is preserved in each.
 */
export function deriveRegistrySuspectSection(
  instruments: readonly RegistrySuspectSectionInstrumentEvidence[],
): RegistrySuspectSection {
  const pendingRevalidation: RegistrySuspectSectionRow[] = [];
  const flagged: RegistrySuspectSectionRow[] = [];
  for (const instrument of instruments) {
    if (instrument.citationValidity === 'pending') {
      pendingRevalidation.push({ instrumentId: instrument.instrumentId });
    }
    if (instrument.flagConcern !== undefined && !instrument.flagConcern.resolved) {
      flagged.push({ instrumentId: instrument.instrumentId });
    }
  }
  return { pendingRevalidation, flagged };
}
