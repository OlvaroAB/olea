/**
 * The vitality reading (knowledge model R3, F2.11, `[D-087]`; `VIT-1` /
 * `ol-1bjz`, the accessor half of `MAT-2` / `ol-95vv`).
 *
 * Vitality is the second of F2.11's two axes and the only one that moves both
 * ways. Growth stage is a high-water mark over the whole evidence log and
 * never falls; vitality is a *current reading* and carries decay. R3 fixes
 * three things about it and deliberately leaves a fourth open, and this
 * module implements exactly that split.
 *
 * **Fixed by R3, and implemented here:**
 *
 *   1. **The fold is a MINIMUM, not a mean, a median or a max.** R3 rejects
 *      each of the alternatives by name and says why: max "hides faded
 *      instruments behind one fresh one — silent decay", mean and median
 *      "explain nothing". Minimum is the only fold that cannot hide decay,
 *      and it is the only one that leaves the reading explainable — when a
 *      concept needs tending, exactly one instrument is the reason, and this
 *      module returns which (`VitalityReading.weakest`).
 *   2. **Evidence tier is a FILTER, never a weight.** Recognition-tier
 *      instruments do not enter the fold at all — not down-weighted, not
 *      discounted, absent. They still schedule normally and still contribute
 *      their scoring evidence under R7; they simply say nothing about how
 *      recall is holding, because recognising an answer among four options is
 *      not recall. A weighting scheme would import certification into what is
 *      only a freshness reading.
 *   3. **The sufficiency floor is evidential, not temporal.** *Too early to
 *      say* holds exactly when the concept has no recall-tier instrument with
 *      at least one completed review — one trigger covering no-instruments,
 *      recognition-only and never-practised alike. R3 adds no recency window
 *      on top, and neither does this module: retrievability is a modelled
 *      now-value that already carries the whole history, and a window would be
 *      a second mechanism doing the same job worse.
 *
 * **Left open by R3, and therefore a REQUIRED PARAMETER here with no
 * default:** the retrievability level at which the reading turns over from
 * `holding` to `tending`. R3 fixes the aggregation and the three values and
 * the floor; it never fixes the cut. `VIT-1` / `ol-1bjz` closed 2026-08-25:
 * `[D-115]` ratified 0.90, provisional, as identity with the scheduler's own
 * request_retention, and the component register (row 3.1) reclassified that
 * level from derived to **declared** in the amending commit. Declaring the
 * exported constant and wiring it into this module's caller is MAT-2's
 * (`ol-95vv`) to do, not this file's: this module still holds no cut, exports
 * no cut, and has no default cut — `holdingCut` arrives as a handed parameter
 * (component register 3.2's phrase for the same arrangement on the
 * scheduler), and passing a nonsensical one throws rather than quietly
 * producing a reading.
 *
 * **Why no default is worth a throw.** A default would be the fastest way to
 * harden an undecided number: every call site would inherit it, every
 * downstream figure would quote it, and the value would acquire the authority
 * of ubiquity without ever having been decided. That risk is now historical —
 * `[D-115]` settled the value — but the shape it protected against is why this
 * module still takes the cut as a required parameter rather than a default.
 * The ratification and what is and is not measurable about the cut before a
 * real term of review history exists are in the private repo at
 * `findings/VIT-1-holding-cut.md`.
 *
 * **This module holds no display strings.** `./display.ts` is the one place
 * mastery vocabulary becomes words on a screen, and that property is worth
 * more than the convenience of putting the three labels next to the arithmetic
 * that produces them. `Vitality`'s three values are the vocabulary registry's
 * own internal names (`holding` / `tending` / `early`, §1 axis 2), so the
 * display map that will eventually join them in `display.ts` has a key set to
 * match rather than a translation to perform.
 *
 * **Nothing here is persisted.** The reading is recomputed from scheduler
 * state and a clock instant every time it is asked for. Whether a vitality
 * value is ever *stamped* onto a review record — D7.1 says both axes are, as
 * beliefs at the moment of the act, with the arithmetic version — is the
 * schema half of `MAT-2`, gated on `D-048`, and is not this module's to
 * decide.
 */

import type { InstrumentType } from 'olea-contracts';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';

/**
 * The three vitality values (F2.11, vocabulary registry §1 axis 2).
 *
 * **Three, not two.** `early` is a first-class state, not an absence and not a
 * null: it is what a concept with no spaced evidence honestly reads as, and
 * most of week one is made of it. F2.11 says outright that a schema modelling
 * vitality as a boolean, or as nullable retrievability with the display
 * inferring "unknown" from null, is wrong — it makes the commonest early state
 * indistinguishable from a missing value.
 *
 * The names are the registry's internal names, not its display words. The
 * student sees *holding*, *needs tending* and *too early to say*; rendering
 * those is `./display.ts`'s job and no other file's.
 */
export type Vitality = 'holding' | 'tending' | 'early';

/**
 * The instrument types whose retrievability enters the vitality fold.
 *
 * Derived by exclusion from the frozen contract enum rather than re-listed —
 * the same technique `instrument/rating.ts` uses for
 * `SchedulableInstrumentType`, and for the same reason: a fifth instrument
 * type added to `olea-contracts` later flows here and forces a decision,
 * instead of silently disagreeing with the enum it was meant to track.
 *
 * `mcq` is out because it is recognition-tier (R3's filter). `explain-back` is
 * out for a different and stronger reason: it is deliberately never
 * FSRS-scheduled (`olea-contracts`' own note on `instrumentType`), so it has no
 * scheduling state and no retrievability to contribute. Two exclusions, two
 * unrelated arguments, and neither is a weighting.
 */
export type RecallTierInstrumentType = Exclude<InstrumentType, 'mcq' | 'explain-back'>;

/**
 * R3's tier filter, as a predicate — the one named site that decides whether
 * an instrument's retrievability is allowed to speak about recall.
 */
export function isRecallTier(type: InstrumentType): type is RecallTierInstrumentType {
  return type !== 'mcq' && type !== 'explain-back';
}

/** One of a concept's instruments, as the fold needs to see it. */
export interface VitalityInstrument {
  readonly instrumentId: string;
  /** Decides whether this instrument enters the fold at all (R3's filter). */
  readonly instrumentType: InstrumentType;
  /**
   * This instrument's scheduling state, or `null` before its first completed
   * review. `null` is the *only* representation of "not reviewed yet" —
   * `SchedulerState` exists exactly when a review has happened (see the
   * scheduler port's own doc), which is what makes the sufficiency floor a
   * plain emptiness test rather than a second rule about review counts.
   */
  readonly state: SchedulerState | null;
}

/** The instrument that set the reading, and the probability it set it at. */
export interface VitalityWeakest {
  readonly instrumentId: string;
  /** Its recall probability at `now` — the minimum across the fold. */
  readonly recallProbability: number;
}

export interface VitalityReading {
  readonly value: Vitality;
  /**
   * The instrument whose recall probability was the minimum, and therefore
   * the single named reason the concept reads the way it does — R3: *"when a
   * concept needs tending, one named instrument is the reason."* `null`
   * exactly when `value` is `early`, because there was nothing to name.
   *
   * Reported for `holding` as well as `tending`, deliberately: the claim
   * "this is holding" rests on the weakest instrument too, and a surface that
   * can only explain the bad news is not explaining the reading.
   */
  readonly weakest: VitalityWeakest | null;
  /**
   * How many recall-tier instruments with a completed review actually entered
   * the fold. Zero exactly when `value` is `early`. Carried because a reading
   * folded over one instrument and a reading folded over five are differently
   * well-evidenced, and nothing else in the return value distinguishes them.
   */
  readonly instrumentsRead: number;
}

export interface ReadVitalityInput {
  /** Every instrument attached to the concept — recognition-tier ones included; the filter is applied here, not by the caller. */
  readonly instruments: readonly VitalityInstrument[];
  /** The port. Only `retrievability` is used; the fold never schedules anything. */
  readonly scheduler: Scheduler;
  /** Never read from `Date.now()` inside this module — the caller's instant, so a replay of a review log is deterministic. */
  readonly now: Date;
  /**
   * The recall probability at or above which the reading is `holding`
   * (inclusive). **Required, and there is deliberately no default** — see the
   * module doc. Must be a finite number in `(0, 1]`.
   */
  readonly holdingCut: number;
}

/**
 * Read a concept's vitality (R3's fold).
 *
 * Pure: same instruments, same `now`, same cut, same reading. Throws only on a
 * cut that could not be a probability — a programmer error, and the one error
 * worth being loud about, because the alternative is a plausible-looking
 * reading computed from a nonsense constant.
 */
export function readVitality(input: ReadVitalityInput): VitalityReading {
  const { instruments, scheduler, now, holdingCut } = input;

  if (!Number.isFinite(holdingCut) || holdingCut <= 0 || holdingCut > 1) {
    throw new RangeError(
      `readVitality: holdingCut must be a finite number in (0, 1]; received ${String(holdingCut)}. ` +
        'It is a derived constant handed to the fold, never defaulted here — see this module doc.',
    );
  }

  let weakest: VitalityWeakest | null = null;
  let instrumentsRead = 0;

  for (const instrument of instruments) {
    // R3's filter, in the only place it is applied. Recognition-tier
    // instruments and unscheduled ones are absent from the fold, not
    // down-weighted within it.
    if (!isRecallTier(instrument.instrumentType)) continue;
    // `null` state is "no completed review" — the sufficiency floor's whole
    // trigger, tested here as emptiness rather than as a separate rule.
    if (instrument.state === null) continue;

    instrumentsRead += 1;
    const { recallProbability } = scheduler.retrievability({
      instrumentId: instrument.instrumentId,
      state: instrument.state,
      now,
    });

    // Strict `<` keeps the fold stable under ties: the first instrument at the
    // minimum is the one named, so the reading does not change its explanation
    // when two instruments are equally faded and the caller reorders them.
    if (weakest === null || recallProbability < weakest.recallProbability) {
      weakest = { instrumentId: instrument.instrumentId, recallProbability };
    }
  }

  if (weakest === null) {
    // The sufficiency floor. Covers no instruments, recognition-only, and
    // never-practised alike — one trigger, as R3 requires, and never a null
    // standing in for a reading.
    return { value: 'early', weakest: null, instrumentsRead: 0 };
  }

  return {
    // `>=`, so a concept sitting exactly at the cut reads as holding. The cut
    // is the level at which recall is still considered to be landing, not the
    // first level below it.
    value: weakest.recallProbability >= holdingCut ? 'holding' : 'tending',
    weakest,
    instrumentsRead,
  };
}
