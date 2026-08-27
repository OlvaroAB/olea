/**
 * Component register row 3.9: *"the level actually shown is recorded on
 * every review. Record what was shown, never what she said."* Principle 16
 * / F2.20 repeat it: the support level presented is an objective fact for
 * the review log; her own rating of how she felt is separate, transient
 * input (`self-assessment.ts`) that never substitutes for it.
 *
 * `SupportLevelReviewFields` is the shape a review-log writer merges into
 * its record (`olea-contracts`' `reviewLogRecordV5.supportLevelShown`,
 * `[D-117]`, `ol-tka5` — the persisted slot already exists; nothing writes
 * it yet, per that schema's own doc). It carries exactly one field, and
 * {@link supportLevelReviewFields} takes exactly one argument — the level
 * that was actually shown — so there is no parameter a caller could pass a
 * self-assessment feeling into even by mistake. That is this module's whole
 * contribution: not a persistence mechanism (the writer is
 * `../review-log/write.ts`'s `appendReviewLogRecord`, which this module
 * does not call — see this component's reachability note in the
 * `support-level` directory's callers), but a shape that makes "never her
 * self-rating" a structural fact about the type rather than a discipline a
 * future caller has to remember.
 */
import type { SupportLevel } from './types.js';

export interface SupportLevelReviewFields {
  readonly supportLevelShown: SupportLevel;
}

export function supportLevelReviewFields(shownLevel: SupportLevel): SupportLevelReviewFields {
  return { supportLevelShown: shownLevel };
}
