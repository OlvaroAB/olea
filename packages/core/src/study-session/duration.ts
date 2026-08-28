/**
 * How long one instrument takes her (F4.6; P5-T06b, `ol-p5t06b`).
 *
 * A time-bounded session is arithmetic over durations, so the honesty of
 * "build me a 20-minute session" rests entirely on where the per-instrument
 * number came from. This module has exactly two sources for it and **says
 * which one it used, in a field on the result rather than in a comment**, so
 * the surface can tell her whether the twenty minutes is measured from her own
 * reviews or Olea's guess.
 *
 * ## The measured half — the reason `durationMs` was recorded at all
 *
 * `reviewLogRecordV1` has carried `durationMs` since the first schema version
 * ("Milliseconds from presentation to answer; null if not measured"), the
 * plugin has written it on every review since `review/session.ts` landed, and
 * **nothing in core has ever read it.** That is INV-4 working exactly as
 * designed and then being left on the shelf: the discipline went in ahead of
 * the feature, so the history exists to be read the first time something needs
 * it. This is that reader.
 *
 * The statistic is the **median**, not the mean, and that is the one modelling
 * choice here worth arguing. A review-log duration is presentation-to-answer
 * wall time, which means a card left open while she made tea is in the data
 * and is unbounded. A mean is dragged arbitrarily far by one such event; a
 * median is not moved by any number of them short of half the sample. Choosing
 * the median is what lets this module apply **no outlier filter at all** —
 * every non-null sample counts, and there is no threshold anybody had to pick.
 *
 * ## The assumed half — and it is an assumption, not a measurement
 *
 * {@link ASSUMED_INSTRUMENT_SECONDS} is **three guesses with an argument, and
 * nothing more.** No study, no measurement, no eval set; they are not derived
 * from her review log, from the fixture vault, or from anything else in this
 * repo, and per `eval/CLAUDE.md` they may never be tuned on synthetic data.
 * The argument for their relative order — cloze under MCQ under Q&A — is that
 * a cloze deletion is a single word recalled in context, an MCQ is a stem plus
 * four options to read before answering, and a Q&A card is free recall of a
 * whole answer. The argument for their absolute magnitude is that they are the
 * order of magnitude a spaced-repetition review takes, which is a statement
 * about flashcards in general and not about her.
 *
 * **What would replace them:** her own review log. Every one of them is
 * superseded, per instrument type and independently, the moment
 * {@link DEFAULT_MIN_MEASURED_REVIEWS} of her reviews of that type carry a
 * non-null `durationMs` — which is a few days of ordinary use. They are a
 * cold-start default with an expiry date built in, not a parameter of the
 * model, and they are never used to justify a threshold anywhere else.
 *
 * The floor is deliberately not a fourth guess: {@link MINIMUM_ESTIMATE_SECONDS}
 * exists so a degenerate median of 0 cannot make an instrument read as free,
 * and it is a termination guard on the greedy fill, not a claim about how long
 * anything takes.
 *
 * ## Why per instrument TYPE and not per instrument
 *
 * Per-instrument medians would be better and are not available: R3 puts
 * scheduling state per instrument, but a specific card typically has a handful
 * of reviews at most, and a median over three samples is noise. Type is the
 * coarsest grouping that still distinguishes the three genuinely different
 * shapes of work above. Nothing here forecloses a finer model later — the
 * result is a lookup, and a caller cannot tell how the number was grouped.
 *
 * ## The fourth type — accepted explain-back (`[D-126]`, F2.14a)
 *
 * Explain-back stays excluded from {@link SESSION_INSTRUMENT_TYPES}: that
 * list names the FSRS-schedulable, gap-row-ranked candidates
 * `study-session/build.ts`'s greedy fill chooses from, and F2.14/F2.21 keep
 * explain-back out of exactly that selection — it is never FSRS-scheduled and
 * never a rankable candidate. **What changed under F2.14a is not that list;
 * it is that an ACCEPTED explain-back now has a price at all.** Once she
 * accepts one and produces it, {@link EXPLAIN_BACK_ASSUMED_SECONDS} prices
 * the act the same way `secondsFor`/`sourceFor` price every other type — via
 * the widened `InstrumentType` parameter below — and it is superseded by the
 * median of her own measured `durationMs` on explain-back reviews through
 * the identical mechanism, once {@link DEFAULT_MIN_MEASURED_REVIEWS} of them
 * exist. See {@link DurationModel.explainBack}. A *proposed* explanation
 * (F2.21) never reaches this module at all — it produces no review, so it
 * has no `durationMs` and nothing to price.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no I/O, no clock; the history is an
 * argument, never a read.
 */

import type { InstrumentType, ReviewLogEntry } from 'olea-contracts';
import type { SchedulableInstrumentType } from '../instrument/rating.js';

/**
 * The FSRS-schedulable, gap-row-ranked candidates `build.ts`'s greedy fill
 * selects from. **Not** "every instrument type a session can contain" any
 * more — `'explain-back'` can now appear in a composed session too (F2.14a,
 * `[D-126]`), just never as a member of this list: it is priced, not
 * scheduled, and it is never chosen by the fill's ranking (F2.14, F2.21). See
 * this module's doc, "The fourth type".
 */
export const SESSION_INSTRUMENT_TYPES: readonly SchedulableInstrumentType[] = [
  'qa',
  'cloze',
  'mcq',
];

/**
 * Where one estimate came from. **A field, not a comment** — the surface has
 * to be able to say "measured from your reviews" or "Olea's estimate" and be
 * telling the truth, which it cannot do if this distinction only lives in a
 * docblock.
 */
export type DurationEstimateSource = 'measured' | 'assumed';

/**
 * The cold-start estimates, in seconds. **Assumptions, not measurements** —
 * see this module's doc for the full statement of what they are, what argues
 * for them, and what replaces them.
 */
export const ASSUMED_INSTRUMENT_SECONDS: Readonly<Record<SchedulableInstrumentType, number>> = {
  qa: 45,
  cloze: 30,
  mcq: 40,
};

/**
 * The cold-start estimate for an ACCEPTED explain-back, in seconds.
 * **Declared, not derived** (`[D-126]`, contract clause F2.14a,
 * `docs/Olea_alpha_functional_scope.md`) — same posture as
 * {@link ASSUMED_INSTRUMENT_SECONDS}, kept as its own named export because it
 * prices a type outside that record's `SchedulableInstrumentType` domain.
 *
 * A *proposed* explanation is never priced at all — F2.21 keeps it outside
 * the session's time budget entirely, and it produces no review, so it never
 * reaches this module. Only the accepted case — she produced the explanation
 * (F5.1) — is priced.
 *
 * Plain-English defence, extending this module's own effort ordering one
 * step further: cloze 30s < mcq 40s < qa 45s < explain-back 90s. F5.1 bounds
 * the act itself to "a few sentences," not an essay, but composing and
 * stating a multi-sentence explanation is more demanding than recalling one
 * fact (qa) or picking one option (mcq) — heavier than every existing card
 * type, without claiming any precision beyond "meaningfully longer than a
 * card, not an order of magnitude longer."
 *
 * Superseded by the same rule the other three already run: once
 * {@link DEFAULT_MIN_MEASURED_REVIEWS} of her explain-back reviews carry a
 * non-null `durationMs`, {@link estimateInstrumentDurations} reports their
 * median instead (`DurationModel.explainBack`) — the field is already
 * written on every review (`duration.ts`'s own doc on the measured half),
 * so no new logging is needed for this revisit condition to fire.
 */
export const EXPLAIN_BACK_ASSUMED_SECONDS = 90;

/**
 * How many of her reviews of one type must carry a non-null `durationMs`
 * before the median of them is preferred to the assumption above.
 *
 * Five is small on purpose. It is not a significance threshold and does not
 * pretend to be one: the alternative it is competing against is a number
 * nobody measured, so the bar for beating it is "enough samples that one
 * unusual review does not decide the median", which is what an odd handful
 * buys. Overridable per call ({@link EstimateDurationsOptions}), so a caller
 * that wants the assumption held longer never needs a code change.
 */
export const DEFAULT_MIN_MEASURED_REVIEWS = 5;

/**
 * The floor under any estimate, in seconds.
 *
 * Not a claim that no review takes less than a second — a claim that an
 * estimate of zero is never a useful answer. A zero-second estimate would let
 * the greedy fill admit instruments at no cost, so a log full of zeroed
 * `durationMs` values (a host that recorded the field without measuring it)
 * would produce a "20-minute session" of unbounded length. One second is the
 * smallest value that cannot do that.
 */
export const MINIMUM_ESTIMATE_SECONDS = 1;

/**
 * One instrument type's estimate, with the evidence behind it kept
 * inspectable rather than folded away.
 *
 * `instrumentType` is the full `InstrumentType`, not `SchedulableInstrumentType`
 * — {@link DurationModel.explainBack} is one of these too (F2.14a, `[D-126]`),
 * and it is priced, never scheduled.
 */
export interface InstrumentDurationEstimate {
  readonly instrumentType: InstrumentType;
  /** Seconds per instrument. Never below {@link MINIMUM_ESTIMATE_SECONDS}. */
  readonly seconds: number;
  readonly source: DurationEstimateSource;
  /** Reviews of this type in the supplied history whose `durationMs` was non-null. Non-zero is possible with `source: 'assumed'` — that is the "she has some history, just not enough yet" case, and it is worth being able to see. */
  readonly sampleCount: number;
}

/**
 * Whether the model as a whole rests on her history or on Olea's assumptions.
 *
 * Three values because two would force a lie in the common case: early on she
 * has enough MCQ reviews and not enough Q&A ones, and calling that either
 * "measured" or "assumed" misstates half of it.
 */
export type DurationModelBasis = 'measured' | 'assumed' | 'mixed';

export interface DurationModel {
  /** One entry per {@link SESSION_INSTRUMENT_TYPES} member, in that order. Every type is always present — an absent entry would be a third state nothing needs. Deliberately excludes explain-back — see {@link explainBack}. */
  readonly estimates: readonly InstrumentDurationEstimate[];
  /**
   * `basis`/`totalSampleCount` describe {@link estimates} only — the
   * FSRS-schedulable candidates a session's greedy fill selects from. They do
   * not fold in {@link explainBack}: whether an accepted explain-back's price
   * rests on measurement is a fact about that one instance, surfaced on
   * {@link explainBack} itself, not blended into a scalar that pre-dates
   * F2.14a and describes a different set of types.
   */
  readonly basis: DurationModelBasis;
  /** How many reviews across all types contributed a duration. Zero means she has no measured history at all, which is a different sentence from "not enough of it". */
  readonly totalSampleCount: number;
  /**
   * The accepted-explain-back estimate (F2.14a, `[D-126]`) — optional so a
   * hand-built `DurationModel` fixture predating this field remains valid;
   * the real {@link estimateInstrumentDurations} always sets it. Priced by
   * the identical measured-median-supersedes-declared-assumption mechanism
   * as {@link estimates}, kept as its own field rather than a fourth member
   * of that array because it is never a member of
   * {@link SESSION_INSTRUMENT_TYPES} — it is not a candidate the fill ranks.
   */
  readonly explainBack?: InstrumentDurationEstimate;
  /** `instrumentType` is the full `InstrumentType` — pricing covers explain-back too (F2.14a), even though it is never in {@link SESSION_INSTRUMENT_TYPES}. */
  secondsFor(instrumentType: InstrumentType): number;
  sourceFor(instrumentType: InstrumentType): DurationEstimateSource;
}

export interface EstimateDurationsOptions {
  /** See {@link DEFAULT_MIN_MEASURED_REVIEWS}. Must be a positive integer. */
  readonly minMeasuredReviews?: number;
}

/** The median of a non-empty numeric list. Even-length takes the mean of the two middle values, the ordinary convention. */
function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * One type's estimate: the declared assumption, or the measured median once
 * enough samples exist. The single mechanism `[D-126]`/F2.14a requires
 * explain-back to share with `qa`/`cloze`/`mcq` — extracted so there is
 * exactly one place it is implemented, per this module's own "the same
 * mechanism" claim.
 */
function buildEstimate(
  instrumentType: InstrumentType,
  sortedValues: readonly number[],
  assumedSeconds: number,
  minMeasured: number,
): InstrumentDurationEstimate {
  if (sortedValues.length < minMeasured) {
    return {
      instrumentType,
      seconds: assumedSeconds,
      source: 'assumed',
      sampleCount: sortedValues.length,
    };
  }
  return {
    instrumentType,
    seconds: Math.max(MINIMUM_ESTIMATE_SECONDS, median(sortedValues) / 1000),
    source: 'measured',
    sampleCount: sortedValues.length,
  };
}

/**
 * Build the duration model from a review-log history.
 *
 * Only `kind: 'review'` records contribute. A suspend or unsuspend record
 * carries no `durationMs` **by schema** (`suspendLogRecordV2`'s own comment:
 * "a suspend is not a review"), and reading its absence as a zero-second
 * review is exactly the collapse the log's shape exists to prevent.
 *
 * An empty history is not an error and does not throw: it produces three
 * `'assumed'` estimates plus an `'assumed'` {@link DurationModel.explainBack},
 * and `basis: 'assumed'` — the honest reading of a vault nobody has reviewed
 * in yet.
 */
export function estimateInstrumentDurations(
  history: readonly ReviewLogEntry[],
  options: EstimateDurationsOptions = {},
): DurationModel {
  const minMeasured = options.minMeasuredReviews ?? DEFAULT_MIN_MEASURED_REVIEWS;
  if (!Number.isInteger(minMeasured) || minMeasured < 1) {
    throw new Error(
      `estimateInstrumentDurations: minMeasuredReviews must be a positive integer, got ${minMeasured}`,
    );
  }

  const samples = new Map<SchedulableInstrumentType, number[]>();
  for (const type of SESSION_INSTRUMENT_TYPES) samples.set(type, []);
  // Collected, never discarded — F2.14a's whole revisit condition rests on
  // this history existing already (the plugin has written `durationMs` on
  // every explain-back review since the field's first schema version) and
  // this loop is the first reader of it.
  const explainBackSamples: number[] = [];

  for (const entry of history) {
    if (entry.kind !== 'review') continue;
    if (entry.durationMs === null) continue;
    if (entry.instrumentType === 'explain-back') {
      explainBackSamples.push(entry.durationMs);
      continue;
    }
    const bucket = samples.get(entry.instrumentType);
    if (bucket === undefined) continue;
    bucket.push(entry.durationMs);
  }

  const estimates: InstrumentDurationEstimate[] = SESSION_INSTRUMENT_TYPES.map((instrumentType) =>
    buildEstimate(
      instrumentType,
      (samples.get(instrumentType) ?? []).slice().sort((a, b) => a - b),
      ASSUMED_INSTRUMENT_SECONDS[instrumentType],
      minMeasured,
    ),
  );

  const explainBack = buildEstimate(
    'explain-back',
    explainBackSamples.slice().sort((a, b) => a - b),
    EXPLAIN_BACK_ASSUMED_SECONDS,
    minMeasured,
  );

  const measuredCount = estimates.filter((e) => e.source === 'measured').length;
  const basis: DurationModelBasis =
    measuredCount === estimates.length ? 'measured' : measuredCount === 0 ? 'assumed' : 'mixed';

  const byType = new Map(estimates.map((e) => [e.instrumentType, e]));

  return {
    estimates,
    basis,
    totalSampleCount: estimates.reduce((total, e) => total + e.sampleCount, 0),
    explainBack,
    secondsFor(instrumentType: InstrumentType): number {
      if (instrumentType === 'explain-back') return explainBack.seconds;
      return byType.get(instrumentType)?.seconds ?? ASSUMED_INSTRUMENT_SECONDS[instrumentType];
    },
    sourceFor(instrumentType: InstrumentType): DurationEstimateSource {
      if (instrumentType === 'explain-back') return explainBack.source;
      return byType.get(instrumentType)?.source ?? 'assumed';
    },
  };
}
