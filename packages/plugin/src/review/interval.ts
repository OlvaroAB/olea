/**
 * Turns a real `Scheduler.schedule` call into what the rating row shows next
 * to each button — "today" / "in 6 days" (`ReviewStates.jsx`'s `PluginRating`
 * doc: "the intervals are the information"). These are the *actual* FSRS
 * intervals for this instrument's own history, computed read-only against
 * `olea-core`'s real, already-shipped `Scheduler` (`ol-p2t02`, closed) — this
 * file does not implement scheduling, mapping, or persistence; it only calls
 * the one pure method the port already exposes, once per candidate rating,
 * and throws every result away except the interval. Nothing here writes a
 * `SchedulerState` anywhere: per plan §7.1, that value is always a
 * recomputable projection of the review log, never a side effect of showing
 * a preview.
 *
 * **`QA_CLOZE_RATING_ORDER` lives here now, and it is not a rating mapping.**
 * It used to sit in `review/rating.ts`, beside a provisional duplicate of
 * F2.16's MCQ mapping. That duplicate is gone — `olea-core`'s
 * `instrument/rating.ts` is the canonical mapping and `session.ts` calls it
 * directly — and the ordering had nowhere left to live. It belongs here
 * because it is a *presentation* fact: the left-to-right order of the four
 * rating buttons, which is the order of the four previews below and the order
 * `keymap.ts` binds '1'-'4' to. It decides nothing about what a rating means,
 * which is exactly why keeping it did not mean keeping a second mapping.
 */

import type { Rating } from 'olea-contracts';
import type { Scheduler, SchedulerState } from 'olea-core';

/** The four Q&A/cloze ratings in the order the reveal screen shows them (F2.16 — recall instruments keep the full four-way range). '1' is Again, '4' is Easy. */
export const QA_CLOZE_RATING_ORDER: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

/** "today" / "tomorrow" / "in N days" — the same phrasing `ReviewStates.jsx` and `MobileStates.jsx` use in their sample copy, generalised to a real day count instead of a fixed string. */
export function describeInterval(intervalDays: number): string {
  if (intervalDays <= 0) return 'today';
  if (intervalDays === 1) return 'tomorrow';
  return `in ${intervalDays} days`;
}

export interface RatingPreview {
  readonly rating: Rating;
  readonly intervalDays: number;
  readonly label: string;
}

/** One preview per Q&A/cloze rating, in `QA_CLOZE_RATING_ORDER`'s order — what the four rating buttons show beneath their labels. */
export function previewQaClozeIntervals(
  scheduler: Scheduler,
  instrumentId: string,
  priorState: SchedulerState | null,
  now: Date,
): readonly RatingPreview[] {
  return QA_CLOZE_RATING_ORDER.map((rating) => {
    const output = scheduler.schedule({ instrumentId, state: priorState, rating, now });
    return {
      rating,
      intervalDays: output.intervalDays,
      label: describeInterval(output.intervalDays),
    };
  });
}

/** The single interval shown on the MCQ feedback line, for whichever rating her answer actually mapped to. */
export function previewSingleInterval(
  scheduler: Scheduler,
  instrumentId: string,
  priorState: SchedulerState | null,
  rating: Rating,
  now: Date,
): RatingPreview {
  const output = scheduler.schedule({ instrumentId, state: priorState, rating, now });
  return {
    rating,
    intervalDays: output.intervalDays,
    label: describeInterval(output.intervalDays),
  };
}
