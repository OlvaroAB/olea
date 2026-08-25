/**
 * The `Scheduler` port (C5.1, P2-T02).
 *
 * **R3 is the whole reason this file exists as a seam rather than a direct
 * call into a spaced-repetition library from wherever review results land.**
 * FSRS is validated against items carrying their own review history, not
 * against concepts (knowledge model §6, R3), and R3 therefore rules out
 * running it at concept level: doing so would mean inventing a scheduler
 * nobody has validated. Concept mastery is a rollup computed *elsewhere*
 * (C5.4) over however many instruments feed it — this module has no idea
 * that concepts exist, and that is the property under test, not an
 * incidental fact about it. Every shape below is keyed by `instrumentId`
 * because R3 requires scheduling state to live on the instrument; nothing
 * here accepts, returns, or stores anything shaped like a concept. See
 * `surface.spec.ts` for the standing proof — a type-level assertion that
 * fails to compile the day a concept-shaped field is added here, the same
 * "fitness function" technique `scripts/check-inv1.mjs` uses for INV-1.
 *
 * **The second reason this is a seam:** the library underneath is
 * swappable. `fsrs-scheduler.ts` wraps `ts-fsrs` (evaluated at P2-T02,
 * recorded in DECISIONS), but nothing in this file imports it, names one of
 * its types, or exposes one of its enums. A caller sees `SchedulerState`,
 * `ScheduleInput`, `ScheduleOutput` — plain, JSON-serialisable shapes we
 * own — never a `ts-fsrs` `Card` or `Rating`. Swapping the library later
 * means rewriting `fsrs-scheduler.ts` and nothing that calls `Scheduler`.
 */

import type { Rating } from 'olea-contracts';

/**
 * One instrument's persisted scheduling state — everything FSRS needs to
 * compute the *next* state, and nothing else. This is what gets written to
 * her vault (plan §7.1: local event-sourced state) and read back before the
 * next review, so it is a plain data shape by design: no class instance, no
 * method, nothing that JSON can't carry byte-for-byte.
 *
 * Field-by-field this mirrors `ts-fsrs`'s `Card`, but every name and shape
 * is ours: dates are ISO-8601 strings (not `Date` objects — a `Date` is not
 * JSON-serialisable without an out-of-band convention, and frontmatter/vault
 * code throughout this package already standardises on ISO strings for the
 * same reason), and `learningState` is a string union rather than the
 * library's numeric `State` enum, so a persisted record is self-describing
 * without importing the library to decode it.
 */
export interface SchedulerState {
  /** Schema version, so a later change to this shape is a migration decision, not a silent break — same discipline as `ReviewLogRecord.schemaVersion` and `PersistedQueue.version`. */
  readonly schemaVersion: 1;
  /** ISO-8601 instant this instrument is next due. */
  readonly due: string;
  /** FSRS stability: days until recall probability decays to the request-retention target. */
  readonly stability: number;
  /** FSRS difficulty, on the library's native 1–10 scale. */
  readonly difficulty: number;
  /** The interval, in whole days, that produced `due` from `lastReview`. Carried alongside `due` because it is what the "ordered sensibly" scenario tests assert on, and because `ts-fsrs` itself treats it as part of a card's identity, not a derived value. */
  readonly scheduledDays: number;
  /**
   * Position within the library's (re)learning step sequence. Olea disables
   * short-term stepping (see `fsrs-scheduler.ts`), so in v0.9 this is always
   * `0` — kept here rather than dropped so a state written today still
   * round-trips correctly if short-term stepping is ever turned on later.
   */
  readonly learningStepIndex: number;
  /** Total reviews this instrument has ever received. */
  readonly reps: number;
  /** Total times this instrument has been rated `again` from a `review` state — i.e. total lapses. */
  readonly lapses: number;
  /**
   * FSRS's card-lifecycle stage. `'new'` never appears in a persisted
   * `SchedulerState` — a state only exists once an instrument has been
   * reviewed at least once; the pre-review case is `state: null` in
   * `ScheduleInput`. `'learning'`/`'relearning'` are reachable in
   * principle but not in v0.9's configuration: `fsrs-scheduler.ts` disables
   * short-term (Anki-style) stepping, under which a lapse is modelled
   * through `lapses` and the stability/difficulty move alone, so a
   * `ts-fsrs`-backed `Scheduler` in this app currently only ever produces
   * `'review'`. The full union is kept — rather than narrowed to the one
   * reachable value — because narrowing it would silently break the day
   * short-term stepping is turned back on, and because a `Scheduler` is a
   * port other implementations could satisfy differently.
   */
  readonly learningState: 'new' | 'learning' | 'review' | 'relearning';
  /** ISO-8601 instant of the review that produced this state. */
  readonly lastReview: string;
}

/**
 * What `Scheduler.schedule` needs to compute the next state.
 *
 * `state: null` is the first-exposure case — an instrument with no review
 * history yet. There is deliberately no separate "create a new item" method:
 * a `null` prior state is a normal input, not a special mode, which is what
 * keeps this interface to one method (`ScheduleInput` in, `ScheduleOutput`
 * out) instead of growing a "before the first review" special case that
 * calls in `packages/plugin` would need to branch on.
 */
export interface ScheduleInput {
  /** The instrument being scheduled. R3: never a concept id. */
  readonly instrumentId: string;
  /** This instrument's prior scheduling state, or `null` before its first review. */
  readonly state: SchedulerState | null;
  /**
   * The four-way rating from the frozen review-log contract
   * (`olea-contracts`' `rating`). `easy` being absent for MCQ (F2.16) is a
   * rating-*mapping* rule owned by P2-T06, applied before a rating ever
   * reaches this interface — `Scheduler` accepts the full four-way type on
   * purpose, so that constraint has somewhere to route a rating *to* rather
   * than this interface making the excluded case unrepresentable.
   */
  readonly rating: Rating;
  /**
   * The instant this review happened. Never read from `Date.now()` inside
   * this module — always the caller's value, so scheduling tests (and any
   * future replay of a review log) are deterministic. See `dates.ts` for
   * the same discipline applied to calendar-day arithmetic elsewhere in
   * this package.
   */
  readonly now: Date;
}

/** What `Scheduler.schedule` returns: the instrument's next state plus the interval that produced it. */
export interface ScheduleOutput {
  /** Echoes `ScheduleInput.instrumentId` — R3: never a concept id. */
  readonly instrumentId: string;
  readonly state: SchedulerState;
  /** Whole days from `now` to `state.due`. Equal to `state.scheduledDays`; exposed directly so callers comparing outcomes across ratings don't have to re-derive it from two ISO strings. */
  readonly intervalDays: number;
}

/**
 * What `Scheduler.retrievability` needs to compute a point-in-time recall
 * probability.
 *
 * `state` is **not nullable here**, unlike `ScheduleInput.state`. An
 * instrument with no review history has no recall probability to report —
 * not `1` (she has never seen it, so there is nothing to have retained) and
 * not `0` (absence of evidence isn't evidence of forgetting either).
 * Making the pre-review case unrepresentable forces every caller to handle
 * "no reading yet" as its own branch rather than silently reading a
 * fabricated `1.0` off a `null` state. This is not hypothetical: the
 * modelling harness hit exactly this by reading retrievability immediately
 * after a review, which reports `1.0` for everything and quietly turned a
 * difficulty proxy into a constant. Callers with a `SchedulerState | null`
 * (e.g. anything holding a `ScheduleOutput.state` or a freshly-loaded
 * instrument) must narrow out `null` themselves before calling this method.
 */
export interface RetrievabilityInput {
  /** The instrument being read. R3: never a concept id. */
  readonly instrumentId: string;
  /** This instrument's current scheduling state. Non-nullable, deliberately: see above. */
  readonly state: SchedulerState;
  /**
   * The instant to evaluate recall probability at. Never read from
   * `Date.now()` inside this module — always the caller's value, same
   * determinism discipline as `ScheduleInput.now`, so replaying a review log
   * (or any later instant a caller wants to ask about) is trustworthy.
   */
  readonly now: Date;
}

/** What `Scheduler.retrievability` returns: a single point-in-time recall estimate. */
export interface RetrievabilityOutput {
  /** Echoes `RetrievabilityInput.instrumentId`. R3: never a concept id. */
  readonly instrumentId: string;
  /** Probability in `[0, 1]` that this instrument would be recalled at `now`. */
  readonly recallProbability: number;
}

/**
 * The scheduling port. `schedule` and `retrievability` are the only two
 * methods, deliberately: everything queue composition (P2-T07), rating
 * mapping (P2-T06), and any product surface reading a recall estimate needs
 * reduces to one of "given this instrument's prior state and a rating at
 * this instant, what's next" or "given this instrument's current state, how
 * likely is recall right now."
 *
 * Implementations must be pure functions of their input — same
 * `(instrumentId, state, rating, now)` always yields the same
 * `ScheduleOutput`, and same `(instrumentId, state, now)` always yields the
 * same `RetrievabilityOutput` — so that scheduling tests, and later a full
 * replay of a review log to rebuild state from scratch, are trustworthy.
 */
export interface Scheduler {
  schedule(input: ScheduleInput): ScheduleOutput;
  retrievability(input: RetrievabilityInput): RetrievabilityOutput;
}
