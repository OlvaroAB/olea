/**
 * Component register row 3.9's CHOOSER, wired into composition ([SUPP-2],
 * `ol-95vv.4`): `./build.ts`'s fill loop is its production caller, invoking
 * {@link chooseSupportLevel} once per eligible item in the same step that
 * composes the session's contents (see that module's `SupportLevelHistoryLookup`
 * doc). `../support-level/` (round 19/20) built the ladder's rules
 * ({@link advanceSupportLevel}), the self-assessment adjustment
 * ({@link applySelfAssessment}) and the review-log write shape
 * (`supportLevelReviewFields`), but nothing turns a concept's actual review
 * evidence into "the level to show right now" — this module is that seam.
 *
 * ## What a chooser is, mechanically
 *
 * `advanceSupportLevel` is a one-step reducer: current state plus one
 * session's outcome, next state. Nothing before this module ever *folds*
 * it over a concept × instrument-tier's real review history to answer "so
 * what level is she at, today?" — {@link supportLevelStateFromHistory} is
 * that fold, starting from `initialSupportLevelState()` (`[D-094]`'s
 * `'prompted'` cold start) and replaying every past session's outcome in
 * order.
 *
 * {@link chooseSupportLevel} is the row's whole output in one call: fold the
 * history, then apply the transient self-assessment
 * ({@link applySelfAssessment}) to the resulting level for *this session's
 * offer only* — never touching the folded state itself, the same
 * non-recorded-state discipline `self-assessment.ts`'s own doc states.
 *
 * ## The ordering rule, stated as part of THIS component's contract
 *
 * F2.20: *"Fixed at composition. The support level shown on a review is
 * fixed when the session containing it is composed, and reads only sessions
 * closed before then — never the session in progress."* (Amended Sep 2026 —
 * `[D-186]`.) The register's "one real cycle" section states the same rule
 * coarser than a per-review reading, and says why the coarser form is the
 * one that binds: *"the level shown on every review in a session is folded
 * from sessions that closed before this one was composed, is fixed at
 * composition alongside the queue, and never reads the session in
 * progress. This is stricter than 'read as of the instant before the new
 * review is written': that per-review framing would let the level move
 * INSIDE one open session on a mid-session miss, which the freeze already
 * forbids."* This is that statement, at this module's level: `priorOutcomes`
 * passed to either function below must be every outcome from a SESSION that
 * closed **strictly before** the composition instant of the session now
 * being built — never anything from that session itself, even a single item
 * of it. Composing a session needs to know the level BEFORE any review in it
 * has happened, so nothing from the session whose items are being scored can
 * be in its own input; a caller that accidentally includes it has broken the
 * one cycle this component sits on, and both this module and `./build.ts`'s
 * fill loop would return a plausible, silently-wrong answer — the register's
 * own warning. Neither function here can detect that mistake (no clock, no
 * session identity, only what is handed in), so the discipline is on the
 * caller, stated here rather than left implicit. A test proves the level
 * cannot move mid-session: see this module's own spec, describe block "the
 * ordering rule ([D-186]: fixed at composition, never inside a session)".
 *
 * ## Never a stage label, never elapsed time
 *
 * Every input here is `SessionSupportOutcome` (failure shape and recovery
 * behaviour) or `SelfAssessmentFeeling` (two values, neither a growth-stage
 * word) — nothing here takes a mastery stage, a vitality reading, or a
 * timestamp of any kind. That is not an oversight to double-check; it is
 * structurally impossible to violate, because neither type has anywhere to
 * put one.
 */
import {
  advanceSupportLevel,
  initialSupportLevelState,
  type SupportLevelState,
} from '../support-level/ladder.js';
import {
  applySelfAssessment,
  type SelfAssessmentFeeling,
} from '../support-level/self-assessment.js';
import type { SessionSupportOutcome, SupportLevel } from '../support-level/types.js';

/**
 * Row 3.9's stated output shape: *"an ordinal level plus a provenance flag
 * separating 'offered because evidence was thin' from 'she asked'."*
 *
 * `'not-offered'` is a third value this module adds to the row's two named
 * ones, for the level `'independent'` itself: when nothing is being shown
 * above the floor of the ladder, neither "offered because evidence was
 * thin" nor "she asked" describes anything, and forcing one of those two
 * flags onto a no-support case would claim a reason for something that did
 * not happen. This does not add a value to `SupportLevel` (`[D-094]`'s
 * frozen three-tier ladder is untouched); it only says why THIS field's
 * value is what it is.
 *
 * Never persisted verbatim — `../support-level/record.ts`'s
 * `SupportLevelReviewFields` carries only `level` into the review log
 * (`supportLevelShown`, `[D-117]`), because the frozen v5 schema has no
 * provenance field. This shape is for the OTHER consumer row 3.9 names:
 * session composition, which the row says renders the item at the level —
 * and is free to also use provenance, once it exists, to say WHY.
 */
export interface SupportLevelPresentation {
  readonly level: SupportLevel;
  readonly provenance: 'evidence-thin' | 'self-requested' | 'not-offered';
}

/**
 * Fold a concept × instrument-tier cell's past session outcomes, oldest
 * first, into the `SupportLevelState` they produce — `[D-094]`'s cold start
 * for anything with no history at all. See module doc for the ordering
 * rule `priorOutcomes` must satisfy.
 */
export function supportLevelStateFromHistory(
  priorOutcomes: readonly SessionSupportOutcome[],
): SupportLevelState {
  return priorOutcomes.reduce(advanceSupportLevel, initialSupportLevelState());
}

/**
 * The chooser: fold `priorOutcomes` into the evidence-derived level, then
 * apply the transient self-assessment to THIS offer only — the fold's
 * result is never written back, so the next call from unchanged history
 * (a fresh call next session, self-assessment or not) starts from the same
 * evidence-derived level every time. See module doc for why
 * `selfAssessment` can only ever raise the level, never lower it.
 */
export function chooseSupportLevel(
  priorOutcomes: readonly SessionSupportOutcome[],
  selfAssessment: SelfAssessmentFeeling = null,
): SupportLevelPresentation {
  const evidenceLevel = supportLevelStateFromHistory(priorOutcomes).level;
  const offeredLevel = applySelfAssessment(evidenceLevel, selfAssessment);

  if (offeredLevel === 'independent') {
    return { level: offeredLevel, provenance: 'not-offered' };
  }
  return {
    level: offeredLevel,
    provenance: offeredLevel === evidenceLevel ? 'evidence-thin' : 'self-requested',
  };
}
