/**
 * F2.12 — confusion routing (`ol-p4t05`).
 *
 * "When a card is failed repeatedly (threshold tuned, ~4 lapses), do not
 * simply reschedule it harder — surface the option to explain the concept
 * back instead." The clause's own worked example:
 *
 *   "You've missed this four times. That's usually not forgetting — want to
 *   explain it back?"
 *
 * — cited by the vocabulary registry (V3) as "the streak case done right:
 * fact, evidence-grounded reinterpretation, one action." This module is the
 * one place that sentence, and the decision behind it, get built — the same
 * "framing is centralised, never inlined at a call site" discipline
 * `./framing.ts` (M3) already applies to a `MisconceptionRecord`'s status
 * line. `FORBIDDEN_VERDICT_PHRASES` from that module is the same mechanical
 * floor reused here (`confusion-routing.spec.ts`), because principle 12
 * binds this sentence exactly as it binds that one: a repeated failure is
 * described as evidence and reframed, never read back to her as a verdict on
 * her effort.
 *
 * **Scope, deliberately narrow.** This module decides WHETHER to offer —
 * given the rating just recorded and the resulting FSRS lapse count — and
 * what the offer says. It does not decide WHERE that offer is shown, does
 * not persist anything, and does not call the grading pipeline
 * (`../grading/gradingPipeline.js`'s `gradeExplainBack`) itself: routing an
 * instrument's repeated failure INTO the explain-back surface is one step;
 * grading whatever she then writes is a separate, already-built step
 * (`ol-drfy`) this module hands nothing to directly. See
 * `packages/plugin/src/grading/wiring.ts`'s module doc for the composition
 * that ties the two together, and its own doc for why the review-rating call
 * site that would invoke this function is a separate, concurrently-owned
 * lane's work (`packages/plugin/src/review/**`) rather than this bead's.
 *
 * **The threshold is DECLARED, not derived** (component register's
 * declared/derived line): the clause's own words are "threshold tuned, ~4
 * lapses" — an intentionally round, defensible-in-plain-English number, not
 * one fitted against a corpus or eval set. `CONFUSION_ROUTING_LAPSE_THRESHOLD`
 * is exported so a future derivation (were one ever run) has one named
 * constant to replace, per the register's constants-inventory discipline.
 *
 * **Only `SchedulerState.lapses` after `rating === 'again'` can trigger
 * this** — never a raw occurrence count, never elapsed time. F2.14 keeps
 * explain-back itself off FSRS scheduling entirely, so an explain-back
 * attempt never has a `lapses` count of its own to feed back in here; the
 * loop this module closes is strictly "a scheduled instrument's repeated
 * `again` ratings route to the on-demand surface," never the reverse. F2.15
 * additionally routes a repeated wrong MCQ pick through the same clause —
 * this function does not care which instrument type produced the rating,
 * only that scheduling is what handed it a `SchedulerState` to read.
 */

/**
 * Declared (see module doc), not persisted. A Class B tunable default: raising
 * or lowering it changes only which future review outcomes route, never a
 * past event.
 */
export const CONFUSION_ROUTING_LAPSE_THRESHOLD = 4;

/**
 * The narrow slice of a just-completed review this module needs. `rating` is
 * the four-way `olea-contracts` rating (mirroring `ScheduleInput.rating` in
 * `../scheduler/types.js`) — deliberately typed as `string` rather than
 * importing `Rating` from `olea-contracts`, because the only value this
 * function ever branches on is the literal `'again'`; narrowing to that one
 * comparison keeps this module free of a contracts dependency for a single
 * string check. A caller already holds a real `Rating` and passes it through
 * unchanged.
 */
export interface ConfusionRoutingInput {
  /** The rating just recorded for this instrument, e.g. from `ScheduleInput.rating`. */
  readonly rating: string;
  /**
   * This instrument's lapse count AFTER the rating above was applied — e.g.
   * `ScheduleOutput.state.lapses`. Total times ever rated `again` from a
   * `review` state (`../scheduler/types.js`'s `SchedulerState.lapses` doc).
   */
  readonly lapses: number;
}

export interface ConfusionRoutingOffer {
  readonly shouldOffer: true;
  /** Echoes `ConfusionRoutingInput.lapses` — the count the prompt text is built from. */
  readonly lapses: number;
  /** F2.12's offer sentence, built by `confusionRoutingPromptLine` below. */
  readonly promptText: string;
}

export interface ConfusionRoutingNoOffer {
  readonly shouldOffer: false;
}

export type ConfusionRoutingDecision = ConfusionRoutingOffer | ConfusionRoutingNoOffer;

const NO_OFFER: ConfusionRoutingNoOffer = { shouldOffer: false };

/**
 * Spelled out for the counts this clause actually reaches in v0.9 (a session
 * caps effort, so an instrument realistically racks up single digits of
 * lapses before other clauses intervene); a numeral is the honest fallback
 * past that rather than inventing more words. Index 0/1 are never reached by
 * `evaluateConfusionRouting` (the threshold is 4) but are kept so this
 * function is total over any non-negative input, including direct tests of
 * `confusionRoutingPromptLine`.
 */
const SMALL_NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

function spellLapseCount(lapses: number): string {
  if (Number.isInteger(lapses) && lapses >= 0 && lapses < SMALL_NUMBER_WORDS.length) {
    const word = SMALL_NUMBER_WORDS[lapses];
    if (word !== undefined) return word;
  }
  return String(lapses);
}

/**
 * F2.12's offer sentence, generalised over the lapse count that triggered it.
 * At `lapses === 4` this is the clause's own worked example, verbatim.
 *
 * Shape mirrors V3 exactly, in order: fact ("you've missed this N times"),
 * evidence-grounded reinterpretation ("that's usually not forgetting"), one
 * available action ("want to explain it back?"). Nothing here is a verdict on
 * her effort or discipline (principle 12) — `confusion-routing.spec.ts`
 * checks every generated line against `FORBIDDEN_VERDICT_PHRASES`
 * (`./framing.js`) as the same mechanical floor `framing.spec.ts` applies to
 * misconception-record framing.
 */
export function confusionRoutingPromptLine(lapses: number): string {
  return `You've missed this ${spellLapseCount(lapses)} times. That's usually not forgetting — want to explain it back?`;
}

/**
 * F2.12's whole decision, in one pure function: does this just-recorded
 * outcome cross the repeated-failure line, and if so, what does the offer
 * say?
 *
 * Fires on `rating === 'again'` at or past
 * `CONFUSION_ROUTING_LAPSE_THRESHOLD` — every subsequent failure past the
 * threshold re-offers, not just the first crossing, matching the clause's
 * "when a card is failed repeatedly" rather than a one-shot notice. A rating
 * other than `'again'` (the instrument was NOT just failed) never offers,
 * regardless of `lapses` — a correct answer after a rough patch is progress,
 * not a fresh trigger.
 */
export function evaluateConfusionRouting(input: ConfusionRoutingInput): ConfusionRoutingDecision {
  if (input.rating !== 'again') return NO_OFFER;
  if (input.lapses < CONFUSION_ROUTING_LAPSE_THRESHOLD) return NO_OFFER;
  return {
    shouldOffer: true,
    lapses: input.lapses,
    promptText: confusionRoutingPromptLine(input.lapses),
  };
}
