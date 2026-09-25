/**
 * `ts-fsrs`-backed `Scheduler` (C5.1, P2-T02).
 *
 * **Library choice.** Evaluated against the field at build time (npm,
 * 2026-08): `ts-fsrs` 5.4.1, published 2026-05-22, MIT, zero runtime
 * dependencies, ~154k weekly downloads, native TypeScript, implements
 * FSRS-6 (backward-compatible with the FSRS-4.5/5 weights an older review
 * history would carry). Runner-up considered: `@squeakyrobot/fsrs` 1.0.0
 * (MIT, zero deps, FSRS-4.5 with optional v6) — functionally adequate but
 * ~1500x fewer weekly downloads and a single-maintainer project, i.e. far
 * less evidence of production hardening for the algorithm this product's
 * entire daily loop depends on. `ts-fsrs` is maintained by
 * open-spaced-repetition, the same group that publishes the FSRS spec
 * itself, which is the strongest available signal that it stays correct as
 * the algorithm evolves. Recorded as a decision per plan §1.2 / this bead's
 * acceptance criteria.
 *
 * **Everything library-shaped stops at this file's boundary.** `types.ts`
 * (this module's public surface) never imports `ts-fsrs`; only this file
 * does. `toCardInput`/`fromCard` below are the only two functions that know
 * the library's `Card` shape exists — see `surface.spec.ts` for the
 * standing proof.
 *
 * **Short-term (re)learning steps are disabled** (`enable_short_term:
 * false`). `ts-fsrs` defaults to Anki-style same-session steps (e.g. "again"
 * on a new card comes back in 1 minute, not tomorrow) — sensible for an app
 * used in one sitting, wrong for Olea's daily-cadence habit loop (F2: she
 * opens the app once a day; "come back in 10 minutes" is not a state this
 * product's queue has anywhere to put her). Disabling it makes every
 * interval, including a brand-new item's, resolve on the whole-day scale
 * `dates.ts` and the rest of this package already assume. Revisit only via
 * a decision bead if same-session re-presentation is ever wanted (that
 * would be queue composition's concern, P2-T07, not this module's).
 *
 * **Fuzz is left at its default (off).** `ts-fsrs` can jitter intervals
 * (`enable_fuzz`) to spread review load across days; Olea's alpha has one
 * user with a small deck, so that load-spreading problem doesn't exist yet,
 * and determinism (this bead's own requirement) is worth more than it right
 * now. Revisit if the queue ever needs to break up same-day pile-ups.
 *
 * **The configuration is declared, versioned and carried on every scheduler
 * (`ol-egov.141.89.9.4`).** `DECLARED_SCHEDULER_CONFIGURATION` below names
 * every value the engine runs on — the library's published FSRS-6 weights,
 * retention 0.90 (identity with the holding cut, `[D-115]`), the default
 * maximum interval, same-day steps and fuzz off — rather than inheriting
 * them silently from whatever `ts-fsrs` version is installed. It schedules
 * byte-identically to the library-default engine this file built before
 * (`configuration.spec.ts` proves it), and a library upgrade that moves the
 * defaults fails that spec instead of quietly re-deriving every schedule.
 * **The cold start is that declared set**: nothing is cached, nothing waits on
 * the service, and `resolveSchedulerConfiguration` records whether a reading
 * came from the declared set, a delivered one, or the declared set after an
 * unreadable delivery. A Class B reading of boundary row 3.2 and C5.4's tuning
 * sentence under `[D-191]`, flagged for review in the chain spec.
 */

import type { Rating } from 'olea-contracts';
import {
  type Card,
  type CardInput,
  createEmptyCard,
  Rating as FsrsRating,
  State as FsrsState,
  fsrs,
  type Grade,
} from 'ts-fsrs';
import type {
  RetrievabilityInput,
  RetrievabilityOutput,
  ScheduleInput,
  ScheduleOutput,
  Scheduler,
  SchedulerConfiguration,
  SchedulerConfigurationSource,
  SchedulerState,
} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The version of {@link DECLARED_SCHEDULER_CONFIGURATION}. Bumped whenever any
 * declared value changes — including a library upgrade that changes its
 * published defaults, which `configuration.spec.ts` catches.
 */
export const SCHEDULER_CONFIGURATION_VERSION = 'fsrs6-declared-1';

/**
 * **THE DECLARED SCHEDULER CONFIGURATION** — every value the scheduler runs
 * on, named. Declared, never fitted: the weights are the FSRS-6 defaults
 * `ts-fsrs` 5.4.1 publishes (the population fit its maintainers ship, not a
 * fit to her data — no personalised set exists, R3's `[D-104]` sentence); the
 * retention target is 0.90, identity with `HOLDING_CUT` (`[D-115]`: "needs
 * tending" means exactly "past due"); the maximum interval is the library's
 * own; same-day steps and fuzz are off for the reasons the module doc gives.
 */
export const DECLARED_SCHEDULER_CONFIGURATION: SchedulerConfiguration = Object.freeze({
  version: SCHEDULER_CONFIGURATION_VERSION,
  weights: Object.freeze([
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ]),
  requestRetention: 0.9,
  maximumIntervalDays: 36500,
  sameDaySteps: false,
  fuzz: false,
});

/** A configuration and where it came from — what `createFsrsScheduler` is built from. */
export interface ResolvedSchedulerConfiguration {
  readonly configuration: SchedulerConfiguration;
  readonly source: SchedulerConfigurationSource;
}

/** FSRS-6's weight-vector length — the shape `DECLARED_SCHEDULER_CONFIGURATION.weights` has. */
const FSRS6_WEIGHT_COUNT = 21;

function isSchedulerConfiguration(value: unknown): value is SchedulerConfiguration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof SchedulerConfiguration, unknown>>;
  const { version, weights, requestRetention, maximumIntervalDays, sameDaySteps, fuzz } = candidate;
  return (
    typeof version === 'string' &&
    version.length > 0 &&
    Array.isArray(weights) &&
    weights.length === FSRS6_WEIGHT_COUNT &&
    weights.every((w) => typeof w === 'number' && Number.isFinite(w)) &&
    typeof requestRetention === 'number' &&
    requestRetention > 0 &&
    requestRetention < 1 &&
    typeof maximumIntervalDays === 'number' &&
    Number.isInteger(maximumIntervalDays) &&
    maximumIntervalDays > 0 &&
    typeof sameDaySteps === 'boolean' &&
    typeof fuzz === 'boolean'
  );
}

/**
 * The cold-start rule (the chain spec's section 2.2): **nothing delivered
 * reads the declared set**, the same as every other session, and says so.
 * Nothing delivers a set today; if one ever does, a missing one (`undefined`
 * or `null`) reads the declared set, and one that cannot be read falls back to
 * the declared set with `source: 'declared-fallback'` — never silently to
 * another set, and never an error that would stop her session.
 */
export function resolveSchedulerConfiguration(delivered?: unknown): ResolvedSchedulerConfiguration {
  if (delivered === undefined || delivered === null) {
    return { configuration: DECLARED_SCHEDULER_CONFIGURATION, source: 'declared' };
  }
  if (delivered === DECLARED_SCHEDULER_CONFIGURATION) {
    return { configuration: DECLARED_SCHEDULER_CONFIGURATION, source: 'declared' };
  }
  if (!isSchedulerConfiguration(delivered)) {
    return { configuration: DECLARED_SCHEDULER_CONFIGURATION, source: 'declared-fallback' };
  }
  return { configuration: delivered, source: 'delivered' };
}

/** The four-way rating (frozen contract) onto `ts-fsrs`'s `Grade`. A direct 1:1 map — MCQ's "never Easy" rule (F2.16) is P2-T06's rating-capping function, applied *before* a rating reaches this interface, never here. */
const RATING_TO_GRADE: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

/** `SchedulerState.learningState` onto `ts-fsrs`'s numeric `State` enum, by name rather than by ordinal — resilient to the library ever renumbering its enum. */
const LEARNING_STATE_TO_FSRS: Record<SchedulerState['learningState'], FsrsState> = {
  new: FsrsState.New,
  learning: FsrsState.Learning,
  review: FsrsState.Review,
  relearning: FsrsState.Relearning,
};

const FSRS_STATE_TO_LEARNING_STATE: Record<FsrsState, SchedulerState['learningState']> = {
  [FsrsState.New]: 'new',
  [FsrsState.Learning]: 'learning',
  [FsrsState.Review]: 'review',
  [FsrsState.Relearning]: 'relearning',
};

/** Our persisted state -> the library's input shape. The only function allowed to know `CardInput` exists. */
function toCardInput(state: SchedulerState): CardInput {
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    // `CardInput.elapsed_days` is required by ts-fsrs's own type but
    // deprecated ("will be removed in version 6.0.0") and, per its
    // `AbstractScheduler.init`, never actually read from the input card —
    // it recomputes elapsed days itself from `last_review` and `now`. `0`
    // is a placeholder to satisfy the type; it has no effect on scheduling.
    elapsed_days: 0,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningStepIndex,
    reps: state.reps,
    lapses: state.lapses,
    state: LEARNING_STATE_TO_FSRS[state.learningState],
    last_review: state.lastReview,
  };
}

/** The library's post-review card -> our persisted state. The only function allowed to know `Card` exists. */
function fromCard(card: Card): SchedulerState {
  // `card.last_review` is only absent (per ts-fsrs's type) before any review
  // has ever happened. `engine.next(...)` always performs one, so it is
  // always set on its output — this is not a real branch, just satisfying
  // the library's wider type.
  const lastReview = card.last_review ?? card.due;
  return {
    schemaVersion: 1,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningStepIndex: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    learningState: FSRS_STATE_TO_LEARNING_STATE[card.state],
    lastReview: lastReview.toISOString(),
  };
}

/**
 * Builds a `Scheduler` backed by `ts-fsrs` from a resolved configuration —
 * by default the declared set (the cold start; no personalisation in v0.9,
 * nothing in the contract calls for it). The returned scheduler carries the
 * configuration's version and source, so every reading built over it can say
 * which configuration produced it.
 */
export function createFsrsScheduler(
  resolved: ResolvedSchedulerConfiguration = resolveSchedulerConfiguration(),
): Scheduler {
  const { configuration, source } = resolved;
  const engine = fsrs({
    w: [...configuration.weights],
    request_retention: configuration.requestRetention,
    maximum_interval: configuration.maximumIntervalDays,
    enable_short_term: configuration.sameDaySteps,
    enable_fuzz: configuration.fuzz,
  });

  return {
    configuration: { version: configuration.version, source },
    schedule(input: ScheduleInput): ScheduleOutput {
      const priorCard: CardInput | Card = input.state
        ? toCardInput(input.state)
        : createEmptyCard(input.now);
      const grade = RATING_TO_GRADE[input.rating];
      const { card } = engine.next(priorCard, input.now, grade);
      const nextState = fromCard(card);
      const intervalDays = Math.round((card.due.getTime() - input.now.getTime()) / MS_PER_DAY);

      return {
        instrumentId: input.instrumentId,
        state: nextState,
        intervalDays,
      };
    },

    retrievability(input: RetrievabilityInput): RetrievabilityOutput {
      // `format: false` selects the numeric overload of `get_retrievability`
      // rather than the formatted-percentage-string one — same boundary
      // discipline as `schedule`: only this file ever names a `ts-fsrs`
      // type or passes one of its literal option values. `input.state` is
      // non-nullable on `RetrievabilityInput` (see types.ts), so — unlike
      // `schedule` — there is no `createEmptyCard` branch to consider here:
      // a real prior card always exists to convert via `toCardInput`.
      const recallProbability = engine.get_retrievability(
        toCardInput(input.state),
        input.now,
        false,
      );

      return {
        instrumentId: input.instrumentId,
        recallProbability,
      };
    },
  };
}
