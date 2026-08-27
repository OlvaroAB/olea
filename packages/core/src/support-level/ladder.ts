/**
 * Component register row 3.9's state machine: given the current support
 * level and one session's outcome for a concept × instrument-tier cell,
 * decide the level for next time. `[D-094]`'s ruling text, turned into a
 * pure reducer:
 *
 * > *"Transitions only at session boundaries ... escalation fast (one
 * > session with a blank or wrong-concept failure), recession slow (two
 * > consecutive clean unhinted sessions), fast readmission on immediate
 * > failure after a recession, with the re-recession requirement doubled
 * > after a snap-back."*
 *
 * ## The two register-named constants, and why there are only two
 *
 * Row 3.9: *"Constants: a thinness threshold at which support is offered and
 * a performance threshold at which it recedes — asymmetric ... So err
 * toward offering."* `[D-094]`'s own spans cash these two out exactly:
 * **thinness** is "how little evidence is required before support returns"
 * — as little as {@link ESCALATION_FAILURE_COUNT} single failure, because
 * the register's failure ranking puts premature withdrawal worst, so waiting
 * for a pattern before restoring support is the wrong direction to err in.
 * **Performance** is "how much clean evidence is required before support
 * recedes" — {@link RECESSION_CLEAN_STREAK_THRESHOLD}, `[D-094]`'s own
 * two-session span. Both are DECLARED, never fitted: `[D-094]` states them
 * as ruled spans, not as values swept against a corpus, and row 3.9's own
 * *Tuning* line is explicit that none exists or should: *"letting a learner
 * request less support is unstudied ... pre-registered defaults, changed by
 * decision."*
 *
 * ## The hint-uptake ratchet
 *
 * `[D-094]`: *"uptake may hold a level, never raise it — escalation needs a
 * failure shape."* A session where she used an offered hint but still
 * passed is not a failure, so it never escalates — but it is not
 * *unhinted* either, so it cannot count toward the clean streak that would
 * recede her out of the level that offered the hint in the first place.
 * Net effect: hint uptake freezes the level exactly where it is. This is
 * the one behaviour in this module a naive "count clean sessions" reducer
 * would get wrong, which is why {@link SessionSupportOutcome} carries
 * `hintUptake` as a field independent of `failureShape` rather than folding
 * it into a single tri-state outcome.
 *
 * ## The snap-back doubling
 *
 * `[D-094]`'s "fast readmission on immediate failure after a recession"
 * needs no special escalation path of its own — it is the SAME
 * escalation-trigger rule, applied with no grace period after a recession.
 * What is genuinely new is the *consequence*: {@link SupportLevelState}
 * tracks whether the state just came from a recession
 * (`justRecessioned`), and an escalation while that flag is set doubles
 * `requiredCleanStreak` for the recession that follows it — the ladder does
 * not let her recede at the ordinary pace immediately after having snapped
 * back once. The doubling applies to exactly the one recession that follows
 * the snap-back; once that recession completes, the requirement returns to
 * the ordinary span. `[D-094]`'s text does not state whether the doubling
 * is meant to persist across more than one recession cycle, and reading it
 * as applying once — rather than compounding or lasting indefinitely — is
 * this module's own judgement call (Class B), stated here rather than left
 * implicit in the arithmetic.
 */
import {
  ESCALATION_FAILURE_SHAPES,
  isEscalationTrigger,
  lowerSupportLevel,
  raiseSupportLevel,
  type SessionSupportOutcome,
  type SupportLevel,
} from './types.js';

/** DECLARED (never fitted). `[D-094]`'s own escalation span: one session with an escalation-triggering failure is enough. See module doc, "thinness threshold". */
export const ESCALATION_FAILURE_COUNT = 1;

/** DECLARED (never fitted). `[D-094]`'s own recession span: two consecutive clean, unhinted sessions. See module doc, "performance threshold". */
export const RECESSION_CLEAN_STREAK_THRESHOLD = 2;

/** DECLARED (never fitted). `[D-094]`'s own doubling rule after a snap-back — plain arithmetic on the recession span above, not a second independently-chosen number. */
export const SNAPBACK_RECESSION_MULTIPLIER = 2;

export { ESCALATION_FAILURE_SHAPES };

export interface SupportLevelState {
  readonly level: SupportLevel;
  /** Consecutive clean, unhinted sessions at the current level. */
  readonly cleanUnhintedStreak: number;
  /** How long that streak must reach before the level recedes — `RECESSION_CLEAN_STREAK_THRESHOLD`, or its snap-back double. */
  readonly requiredCleanStreak: number;
  /** True for exactly the one evaluation immediately following a recession — the window "fast readmission on immediate failure" applies to. */
  readonly justRecessioned: boolean;
}

/**
 * `[D-094]`: *"Cold start for a fresh recall cell: prompted."* Not a
 * numeric constant — a declared starting point, stated in the ruling's own
 * words. `'guided'` is deliberately never a cold start: nothing has yet
 * shown that more scaffolding than the middle tier is warranted, and
 * `'independent'` is deliberately never a cold start either: nothing has yet
 * shown a fresh cell does NOT need support, and this component errs toward
 * offering.
 */
export function initialSupportLevelState(): SupportLevelState {
  return {
    level: 'prompted',
    cleanUnhintedStreak: 0,
    requiredCleanStreak: RECESSION_CLEAN_STREAK_THRESHOLD,
    justRecessioned: false,
  };
}

/**
 * One session boundary's worth of evolution (`[D-094]`: "transitions only
 * at session boundaries" — a caller must not call this mid-session, and
 * this module has no way to enforce that itself since it holds no clock and
 * sees no session identity, only whatever outcome the caller hands it).
 *
 * Precedence, in the order `[D-094]` states them:
 * 1. An escalation-triggering failure shape (`'blank'`/`'wrong-concept'`)
 *    raises the level immediately, regardless of the current streak.
 * 2. A clean, unhinted session advances the recession streak, and recedes
 *    the level once the streak reaches `requiredCleanStreak`.
 * 3. Anything else (a minor slip, or a clean session where a hint WAS used)
 *    breaks the streak without moving the level — the ratchet.
 */
export function advanceSupportLevel(
  state: SupportLevelState,
  outcome: SessionSupportOutcome,
): SupportLevelState {
  if (isEscalationTrigger(outcome.failureShape)) {
    const isSnapBack = state.justRecessioned;
    return {
      level: raiseSupportLevel(state.level),
      cleanUnhintedStreak: 0,
      requiredCleanStreak: isSnapBack
        ? RECESSION_CLEAN_STREAK_THRESHOLD * SNAPBACK_RECESSION_MULTIPLIER
        : RECESSION_CLEAN_STREAK_THRESHOLD,
      justRecessioned: false,
    };
  }

  const isCleanUnhinted = outcome.failureShape === 'none' && !outcome.hintUptake;
  if (isCleanUnhinted) {
    const streak = state.cleanUnhintedStreak + 1;
    if (streak >= state.requiredCleanStreak && state.level !== 'independent') {
      return {
        level: lowerSupportLevel(state.level),
        cleanUnhintedStreak: 0,
        requiredCleanStreak: RECESSION_CLEAN_STREAK_THRESHOLD,
        justRecessioned: true,
      };
    }
    return { ...state, cleanUnhintedStreak: streak, justRecessioned: false };
  }

  // A minor slip, or a clean-but-hinted session: the ratchet holds the
  // level and breaks the streak, but neither escalates nor recedes.
  return { ...state, cleanUnhintedStreak: 0, justRecessioned: false };
}
