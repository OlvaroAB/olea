/**
 * `[D-323]` (David, 2026-09-25, ruled on `ol-egov.141.89.6.4` and carried as acceptance onto this
 * bead, `ol-2zfj.143`) — the repeated-failure instrument-standing check.
 *
 * The ruling, restated exactly: *"Before offering explain-back after several failed reviews of a
 * card, read the card's own recorded standing (a changed source passage, flagged, contested or
 * rejected); if the card is suspect on any of those grounds, route it to item validation instead
 * of offering explain-back. Otherwise offer explain-back as usual, in neutral wording that never
 * asserts the failure is usually not forgetting or any other diagnosis."* Clarification, binding:
 * *"the standing check must explicitly include a card pending revalidation and one whose safety
 * information is currently unavailable — treat both as suspect, not as a clean pass. Never
 * trigger a model call merely because of a lapse. Repeated difficulty on a clean-standing card
 * must never be read, or coded, as an automatic diagnosis of her — it only ever triggers this
 * standing check and its routing decision."*
 *
 * **This rides the existing trigger; it does not add one.** Exactly the discipline
 * `../../misconception/confusion-routing.ts`'s own module doc states for `[D-265]`'s
 * prerequisite-aware offer ("rides F2.12's existing trigger and channel rather than adding a new
 * intervention with its own proposal path") — this module adds no new condition for WHETHER
 * repeated failure was detected. `evaluateRepeatedFailureStandingCheck` takes the
 * `ConfusionRoutingDecision` that module's own `evaluateConfusionRouting` already produced
 * (F2.12's rating/lapses gate, unchanged) and only interposes the standing check BEFORE that
 * decision is allowed to reach an offer. A `shouldOffer: false` input (repeated failure was never
 * even detected this time) short-circuits to `'not-repeated-failure'` without reading `standing`
 * at all — matching the ruling's "it only ever triggers this standing check," never the reverse.
 *
 * **No model call, ever, in this module.** Every function here is a pure, synchronous read of
 * already-computed inputs — `standing` arrives pre-read from wherever a caller keeps it recorded
 * (the citation store's freshness reading, `../../instrument/citation-store.ts`, is one concrete
 * source for `'changed-source-passage'`; a caller may have others for the remaining five
 * concerns), the same "narrow slice a caller already holds, none of it re-derived here" posture
 * `confusion-routing.ts`'s own `DirectPrerequisiteEvidence` doc states. This module never reads
 * the vault, never calls a judge, and never persists anything — see `[D-323]`'s own "never trigger
 * a model call merely because of a lapse," which this module keeps by construction rather than by
 * a runtime check: there is nothing async anywhere in this file.
 *
 * **Repeated difficulty never becomes a diagnosis of the learner.** A clean-standing card
 * (`concerns` empty) returns `'standing-clear'` carrying the SAME `ConfusionRoutingOffer` object
 * the caller passed in, verbatim — this module invents no new wording and reaches no new verdict
 * about her; it only decides whether that already-built offer is allowed to reach her, or gets
 * redirected to item validation first. Writing the offer's own wording (neutral, per the ruling)
 * is `ol-egov.141.89.6.4`'s job, not this module's (see this bead's brief: "do not write
 * student-facing wording").
 *
 * **Coordinates with, never collides with, the INTERV lineage.** `evaluateItemValidationTrigger`/
 * `checkItemValidation` (`../../concept/revision/item-validation.ts`, `[D-265]` ruling 3) decide a
 * DIFFERENT trigger for item validation — a same-day, same-claim harder/easier mismatch. This
 * module's `'route-to-item-repair'` outcome is a second, independent path into the same
 * destination (item validation/repair), reached from F2.12's repeated-failure trigger instead of
 * that mismatch trigger. Nothing here calls, imports from, or duplicates
 * `packages/core/src/concept/revision/`; a caller that receives `'route-to-item-repair'` routes to
 * whatever surface already consumes an item-validation proposal, exactly as it would for one
 * `checkItemValidation` produced.
 */

import type {
  ConfusionRoutingDecision,
  ConfusionRoutingOffer,
} from '../../misconception/confusion-routing.js';

/**
 * `[D-323]`'s six named standing concerns, any one of which makes an instrument suspect. Kept as
 * six distinct literals, never collapsed to a boolean — the same "a caller and a test can see
 * WHICH reading applied" discipline `confusion-routing.ts`'s `PrerequisiteEvidenceReading` states
 * for its own six-way type — even though this module's routing itself only distinguishes "any
 * concern present" from "none."
 *
 * - `changed-source-passage`: the ruling's own first-named ground; the cited passage moved under
 *   the instrument (see `../../instrument/citation-store.ts`'s `'stale'` freshness reading for one
 *   concrete source of this concern).
 * - `flagged` / `contested` / `rejected`: the ruling's own remaining three named grounds.
 * - `pending-revalidation` / `safety-information-unavailable`: the clarification's two additions —
 *   "treat both as suspect, not as a clean pass."
 */
export type InstrumentStandingConcern =
  | 'changed-source-passage'
  | 'flagged'
  | 'contested'
  | 'rejected'
  | 'pending-revalidation'
  | 'safety-information-unavailable';

export const INSTRUMENT_STANDING_CONCERNS: readonly InstrumentStandingConcern[] = [
  'changed-source-passage',
  'flagged',
  'contested',
  'rejected',
  'pending-revalidation',
  'safety-information-unavailable',
];

/**
 * One instrument's recorded standing, as already read by the caller. Empty `concerns` is the
 * clean-standing reading; any non-empty set makes the instrument suspect. This module never
 * computes this value — see the module doc.
 */
export interface InstrumentStanding {
  readonly concerns: readonly InstrumentStandingConcern[];
}

/** The clean-standing constant a caller with nothing recorded can pass, rather than building `{ concerns: [] }` inline at every call site. */
export const CLEAN_INSTRUMENT_STANDING: InstrumentStanding = { concerns: [] };

export interface RepeatedFailureStandingCheckInput {
  /**
   * Whatever `evaluateConfusionRouting` (`../../misconception/confusion-routing.ts`) already
   * decided for the rating just recorded — F2.12's own rating/lapses gate, unchanged by this
   * module. `shouldOffer: false` means repeated failure was not even detected this time; this
   * module then does nothing further (see `standing` below).
   */
  readonly confusionRouting: ConfusionRoutingDecision;
  /**
   * The instrument's recorded standing. Read ONLY when `confusionRouting.shouldOffer` is true —
   * `evaluateRepeatedFailureStandingCheck` never inspects this field otherwise, matching `[D-323]`'s
   * "it only ever triggers this standing check" (repeated failure is the sole trigger for even
   * looking at standing).
   */
  readonly standing: InstrumentStanding;
}

/** Repeated failure was never detected this time (`confusionRouting.shouldOffer` was false) — nothing to check, nothing to offer, nothing routed. */
export interface NotRepeatedFailureOutcome {
  readonly kind: 'not-repeated-failure';
}

/**
 * The instrument is suspect on at least one of `[D-323]`'s six grounds. The ordinary explain-back
 * offer is withheld; a caller routes to item validation instead (see module doc — a second,
 * independent path into that surface, alongside the INTERV mismatch trigger).
 */
export interface RouteToItemRepairOutcome {
  readonly kind: 'route-to-item-repair';
  readonly concerns: readonly InstrumentStandingConcern[];
}

/**
 * Standing is clean. The already-built `offer` (F2.12's ordinary explain-back offer, or its
 * prerequisite-aware variant under `[D-265]`) stands unchanged — this module invents no wording
 * and adds no new verdict; it only clears the offer to proceed.
 */
export interface StandingClearOutcome {
  readonly kind: 'standing-clear';
  readonly offer: ConfusionRoutingOffer;
}

export type RepeatedFailureStandingOutcome =
  | NotRepeatedFailureOutcome
  | RouteToItemRepairOutcome
  | StandingClearOutcome;

/**
 * `[D-323]`'s whole decision, in one pure function — see the module doc. Never asynchronous, never
 * reads a clock, never calls a model: every branch below is a synchronous read of its inputs.
 */
export function evaluateRepeatedFailureStandingCheck(
  input: RepeatedFailureStandingCheckInput,
): RepeatedFailureStandingOutcome {
  if (!input.confusionRouting.shouldOffer) {
    return { kind: 'not-repeated-failure' };
  }
  if (input.standing.concerns.length > 0) {
    return { kind: 'route-to-item-repair', concerns: input.standing.concerns };
  }
  return { kind: 'standing-clear', offer: input.confusionRouting };
}
