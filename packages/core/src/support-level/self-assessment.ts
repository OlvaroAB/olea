/**
 * Component register row 3.9's transient input: *"her pre-session
 * self-assessment, which is transient, adjusts what she is offered, and
 * touches no recorded state."* F2.20 adds the wording constraint: it "must
 * not use the growth-stage words" (`seed`/`sprout`/`sapling`/`tree`), because
 * that would invite her to self-report the very thing the system establishes
 * from evidence.
 *
 * ## Never a recorded state, never a downgrade
 *
 * Two things this module is careful never to do, both load-bearing:
 *
 * - **It never touches {@link SupportLevelState}.** The evidence-derived
 *   ladder (`ladder.ts`) is computed and advanced with no knowledge that a
 *   self-assessment exists at all. This function takes the ladder's OUTPUT
 *   for one session and returns a possibly-different level for THAT
 *   session's offer only — the next call to `advanceSupportLevel` starts
 *   from the unmodified evidence-derived state, never from what this
 *   function returned. That is what "touches no recorded state" means
 *   structurally rather than by discipline.
 * - **It never lowers the offered level.** F2.20: *"Support recedes only on
 *   demonstrated performance — never on a stage label, never on elapsed
 *   time."* Letting a self-report of confidence reduce support would let
 *   exactly the channel that clause excludes reach the same outcome by a
 *   side door. Row 3.9's own asymmetry — "err toward offering" — points the
 *   same direction: a self-assessment may only ever ask for more support,
 *   never justify less.
 *
 * `SelfAssessmentFeeling` is deliberately two values, neither of them a
 * growth-stage word, and this is intentionally the whole vocabulary this
 * component recognises — designing a richer scale is not this seam's job,
 * and an unrecognised value passed in must fail loudly rather than be
 * silently ignored.
 */
import { raiseSupportLevel, type SupportLevel } from './types.js';

export type SelfAssessmentFeeling = 'confident' | 'unsure' | null;

/**
 * `feeling: 'unsure'` raises the offered level by one tier (capped at
 * `'guided'`); `'confident'` or `null` (no self-assessment given) leaves the
 * evidence-derived level exactly as computed.
 */
export function applySelfAssessment(
  computedLevel: SupportLevel,
  feeling: SelfAssessmentFeeling,
): SupportLevel {
  if (feeling === 'unsure') return raiseSupportLevel(computedLevel);
  return computedLevel;
}
