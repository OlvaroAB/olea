/**
 * D-238/F3.7's four named further-call triggers, pure. Each takes signals
 * some OTHER, unowned part of the client already computes (the cached study
 * plan's ranking for top-band, D7.1's log for format-ask, the scheduler for
 * deck-served-out/lapsed, the review log for repeated-rejection) — this
 * module only decides what a trigger firing MEANS for the queue, never how
 * the trigger is detected. Wiring each real signal source in is named,
 * unbuilt follow-up work (see this bead's close evidence); building it here
 * would mean this bead reaching into `plan/`, `review-log/`, `scheduler/`
 * and `mastery/`, none of which are its owned paths.
 *
 * **Every trigger asks for "the other kind," never re-requests the primary.**
 * D-238: "the unit is the call... a second trigger asking for the same
 * (concept, kind) a call already covers is not a second call." `otherKindToDraft`
 * is the one place that rule lives — every trigger function below calls
 * through it rather than repeating the not-already-built check.
 */

import type { GenerationTrigger, SchedulableInstrumentType } from './types.js';

export interface OtherKindInput {
  /** Every kind this concept already has at least one instrument built for (queued or drafted — this module does not care which; a caller passes whichever reading it has). */
  readonly builtKinds: readonly SchedulableInstrumentType[];
  /** Which kind a further call should prefer, most-preferred first. */
  readonly preferredOrder: readonly SchedulableInstrumentType[];
}

/** The next preferred kind not yet built, or `null` when every preferred kind already is. */
export function otherKindToDraft(input: OtherKindInput): SchedulableInstrumentType | null {
  for (const kind of input.preferredOrder) {
    if (!input.builtKinds.includes(kind)) return kind;
  }
  return null;
}

export interface TopBandTriggerInput {
  /** F4.2: whether this concept has just entered its course's top band. */
  readonly enteredTopBand: boolean;
  readonly other: OtherKindInput;
}

/** F3.7: "when it enters its course's top band (F4.2)." */
export function topBandTrigger(input: TopBandTriggerInput): GenerationTrigger | null {
  if (!input.enteredTopBand) return null;
  const instrumentKind = otherKindToDraft(input.other);
  return instrumentKind === null ? null : { kind: 'top-band', instrumentKind };
}

export interface FormatAskTriggerInput {
  /** F4.8/D7.1: the kind the format match or her instrument-type log now asks for, or `null` if neither asks for a kind this concept lacks. */
  readonly requestedKind: SchedulableInstrumentType | null;
  readonly builtKinds: readonly SchedulableInstrumentType[];
}

/** F3.7: "when the format match or her instrument-type log (D7.1) asks for the other kind." */
export function formatAskTrigger(input: FormatAskTriggerInput): GenerationTrigger | null {
  if (input.requestedKind === null) return null;
  if (input.builtKinds.includes(input.requestedKind)) return null;
  return { kind: 'format-ask', instrumentKind: input.requestedKind };
}

export interface DeckServedOutOrLapsedTriggerInput {
  /** Every built instrument for this concept has been served at least once. */
  readonly deckServedOut: boolean;
  /** The concept (or its recall-tier instrument) has lapsed per F2.12's evidence. */
  readonly lapsed: boolean;
  readonly other: OtherKindInput;
}

/** F3.7: "when its deck has been served out or it has lapsed (F2.12)." */
export function deckServedOutOrLapsedTrigger(
  input: DeckServedOutOrLapsedTriggerInput,
): GenerationTrigger | null {
  if (!input.deckServedOut && !input.lapsed) return null;
  const instrumentKind = otherKindToDraft(input.other);
  return instrumentKind === null ? null : { kind: 'deck-served-out-or-lapsed', instrumentKind };
}

export interface RepeatedRejectionTriggerInput {
  readonly rejectionCount: number;
  /**
   * Class C: an adopted threshold, never chosen by this function. No default
   * is declared here — a caller that has not been given one from a closed
   * decision bead has not been authorised to fire this trigger yet. See this
   * bead's close evidence for the proposed number and its argument, parked
   * for David.
   */
  readonly threshold: number;
  readonly other: OtherKindInput;
}

/** F3.7: "when a kind has been repeatedly rejected" (F3.3). */
export function repeatedRejectionTrigger(
  input: RepeatedRejectionTriggerInput,
): GenerationTrigger | null {
  if (input.rejectionCount < input.threshold) return null;
  const instrumentKind = otherKindToDraft(input.other);
  return instrumentKind === null ? null : { kind: 'repeated-rejection', instrumentKind };
}

export interface GenerationTriggerSignals {
  readonly topBand: TopBandTriggerInput;
  readonly formatAsk: FormatAskTriggerInput;
  readonly deckServedOutOrLapsed: DeckServedOutOrLapsedTriggerInput;
  readonly repeatedRejection: RepeatedRejectionTriggerInput;
}

/**
 * Every trigger that fires this evaluation, deduplicated by `instrumentKind`
 * — D-238's "the unit is the call" means two triggers both asking for the
 * same kind is still one call, not two. Order: top-band, format-ask,
 * deck-served-out-or-lapsed, repeated-rejection (the order F3.7's own prose
 * lists them in); the first trigger to name a kind keeps credit for it.
 */
export function evaluateGenerationTriggers(
  signals: GenerationTriggerSignals,
): readonly GenerationTrigger[] {
  const candidates = [
    topBandTrigger(signals.topBand),
    formatAskTrigger(signals.formatAsk),
    deckServedOutOrLapsedTrigger(signals.deckServedOutOrLapsed),
    repeatedRejectionTrigger(signals.repeatedRejection),
  ];
  const seen = new Set<SchedulableInstrumentType>();
  const fired: GenerationTrigger[] = [];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (seen.has(candidate.instrumentKind)) continue;
    seen.add(candidate.instrumentKind);
    fired.push(candidate);
  }
  return fired;
}
