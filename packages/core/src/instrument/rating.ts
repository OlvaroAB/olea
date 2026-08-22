/**
 * Rating mapping, one pure function per instrument type (F2.16, P2-T06).
 *
 * F2.16 is three sentences long and every one of them is a different *shape*,
 * not a different branch:
 *
 *   - *Q&A / cloze:* native four-way rating, unchanged. She picks the rating;
 *     the mapping carries it through untouched, over the full `Rating`.
 *   - *MCQ:* a wrong answer gives Again; a correct one gives Good, or Hard when
 *     she tapped "wasn't sure / guessed". **Easy is unreachable for MCQ.**
 *   - *Explain-back:* no FSRS rating. Its results are evidence into mastery
 *     (C5.4) and misconception records (F5.6), never a scheduling signal.
 *
 * ## Why "never yields Easy" is a type and not an `if`
 *
 * The obvious implementation of "MCQ never yields Easy" is a runtime clamp:
 * accept a `Rating`, and return `'good'` where `'easy'` was asked for. That
 * implementation is wrong in a way that only shows up months later. A clamp
 * means an `easy` MCQ rating is a *constructible value* that the system
 * quietly disagrees with — so the day some caller (a plugin keybinding, a
 * bulk re-rate, a replay) hands one over, nothing fails, nothing is logged,
 * and the FSRS state moves under a rating she never gave. R7's whole ordering
 * (recognition < recall < explanation) is built on top of this number.
 *
 * So `McqRating` is `Exclude<Rating, 'easy'>`: there is no Easy to pass in and
 * no Easy to come out, and the compiler is the thing that says so. Derived by
 * exclusion from the frozen contract enum rather than re-listed, so a future
 * fifth rating in `olea-contracts` flows here instead of silently disagreeing
 * with it.
 *
 * The *log* keeps the full four-way enum on purpose — `olea-contracts`'
 * `rating` doc states it: "a schema that made the invalid state
 * unrepresentable would also make a real bug unloggable and therefore
 * invisible." The narrowing belongs at the mapping, which is a decision, not
 * at the record, which is a fact.
 *
 * ## Why explain-back is an absence and not a value
 *
 * There is no `mapExplainBackRating`. `RATING_MAPPERS` has no `explain-back`
 * key. `RatingMapping`'s unrated branch has no `rating` field to read. Three
 * expressions of the same fact, none of them a sentinel.
 *
 * The temptation is a neutral default — `'good'`, or a fifth `'none'` rating,
 * or `easy`-shaped nullability smeared across the four-way type. Each one
 * turns "this instrument is not FSRS-scheduled" into "this instrument was
 * scheduled, with a rating that means nothing", and downstream cannot tell
 * them apart. `ol-djq5` already ran into the downstream half of this: the
 * frozen `selectionContext.dueState` enum has no value meaning "not
 * FSRS-scheduled", precisely because nothing that is not FSRS-scheduled should
 * ever reach a field that describes FSRS scheduling. The absence is real, and
 * it is modelled as one.
 *
 * Exactly one site converts the absence into the log's `rating: null` —
 * `loggedRating` below — because the frozen record *is* nullable there and a
 * writer needs some value to write. That is a boundary, and it is one line
 * long so it can be pointed at.
 *
 * ## Purity
 *
 * Every function here is a pure function of its argument: no clock, no
 * `Scheduler`, no `SchedulerState`, no I/O, no module-level mutable state.
 * That is what P2-T06's acceptance criterion asks for — purity, one function
 * per instrument type — and it is also what makes a review-log replay
 * trustworthy: replaying a two-month-old outcome must produce the rating it
 * produced then, not the rating today's scheduler state would suggest.
 */

import type { InstrumentType, Rating } from 'olea-contracts';

/**
 * The three instrument types the queue schedules (F2.14), derived by exclusion
 * from the frozen log enum rather than re-listed.
 *
 * Explain-back is in `InstrumentType` because D7.1 logs it — every attempt is
 * recorded whether or not it produced a rating — and out of this type because
 * it is not scheduled. Deriving rather than re-listing is what keeps those two
 * facts from drifting apart.
 */
export type SchedulableInstrumentType = Exclude<InstrumentType, 'explain-back'>;

/**
 * MCQ's rating range: the four-way rating minus Easy (F2.16).
 *
 * `Exclude<Rating, 'easy'>`, not a hand-written `'again' | 'hard' | 'good'`.
 * The difference matters the day `Rating` changes: an exclusion re-derives, a
 * re-listed union silently stops matching.
 */
export type McqRating = Exclude<Rating, 'easy'>;

/**
 * What she did with a Q&A or cloze card.
 *
 * The rating is hers directly: F2.16 leaves the four-way rating untouched for
 * recall instruments, so this shape carries a `Rating`, not a correctness flag. Recall instruments
 * have no notion of "correct": she is the judge of whether she produced the
 * answer, and Easy is available to her because producing an answer unprompted
 * and effortlessly is exactly the evidence Easy is supposed to mean.
 */
export interface CardReviewOutcome {
  readonly type: 'qa' | 'cloze';
  /** Her own four-way choice. All four values are reachable here. */
  readonly rating: Rating;
}

/**
 * What she did with an MCQ.
 *
 * Note what is *not* here: a rating. A recognition instrument grades itself —
 * the option she chose was the answer or it was not — so the caller reports
 * facts and this module decides the rating. That is the point of the
 * amendment: "a correct answer she guessed is not the same evidence as a
 * correct answer she knew", and the only way to keep those apart is for the
 * two facts to travel separately as far as the mapping.
 */
export interface McqReviewOutcome {
  readonly type: 'mcq';
  /** Whether the option she selected was the correct one. */
  readonly correct: boolean;
  /**
   * The optional "wasn't sure / guessed" tap (F2.16).
   *
   * Optional and never blocking — the default path is answer → next, and an
   * untapped answer means `false`, not "unknown". The field is required in
   * *this* type for the same reason the log's `wasUnsure` is required and not
   * nullable: "she did not tap it" is a real, recorded observation, and making
   * it optional would let a caller omit it and have the absence read as either
   * answer.
   */
  readonly wasUnsure: boolean;
}

/**
 * What she did with an explain-back.
 *
 * It carries no rating in and produces none out. There is deliberately no
 * `correct` and no `grade` here either: explain-back grading (C5.4, F5.6) is
 * not a rating and does not belong in a module about FSRS ratings, so this
 * shape exists only so that the dispatcher below is *total* over
 * `InstrumentType` — every instrument type has an answer to "what rating does
 * this produce", and for exactly one of them the answer is "none".
 */
export interface ExplainBackOutcome {
  readonly type: 'explain-back';
}

/** Every outcome shape a reviewed instrument can produce. */
export type ReviewOutcome = CardReviewOutcome | McqReviewOutcome | ExplainBackOutcome;

/**
 * The result of mapping an outcome: either a rating, or no rating at all.
 *
 * **The unrated branch has no `rating` property.** Not `rating: null`, not
 * `rating: undefined` — no property. `mapping.rating` does not compile until
 * `mapping.fsrsScheduled` has been checked, which makes "I forgot explain-back
 * has no rating" a build failure instead of a `null` flowing into FSRS.
 */
export type RatingMapping =
  | { readonly fsrsScheduled: true; readonly rating: Rating }
  | { readonly fsrsScheduled: false };

/**
 * Q&A and cloze: her rating, unchanged (F2.16).
 *
 * An identity function with a type — which is the entire content of the
 * requirement. It exists as a named function rather than an inlined field read
 * so that "recall instruments keep the full four-way range" has one site to
 * point at, and so the mapper table below is uniform.
 */
export function mapCardRating(outcome: CardReviewOutcome): Rating {
  return outcome.rating;
}

/**
 * MCQ: wrong → Again · correct + "wasn't sure" → Hard · correct → Good.
 *
 * Wrong is Again whether or not she tapped, and that ordering is deliberate:
 * the tap reports her confidence, and confidence about a wrong answer changes
 * nothing about the evidence. "I was sure and wrong" is not better than "I
 * guessed and was wrong"; if anything it is worse, and F2.16 does not ask us
 * to model that.
 *
 * The return type is `McqRating`, so this function *cannot* return Easy even
 * if someone later adds a branch trying to.
 */
export function mapMcqRating(outcome: McqReviewOutcome): McqRating {
  if (!outcome.correct) return 'again';
  return outcome.wasUnsure ? 'hard' : 'good';
}

/**
 * The per-instrument-type mapping table (F2.16: "defined per instrument type").
 *
 * **There is no `explain-back` key, and that is the requirement.** A reader
 * asking "what does explain-back map to" finds no function, rather than
 * finding one that returns something harmless-looking.
 *
 * `qa` and `cloze` share `mapCardRating` deliberately: they differ in how they
 * are *presented* and parsed, not in what a rating from them means. F2.14's
 * extensibility test says adding a schedulable type must touch only rendering
 * and rating mapping — this object is that second half, and it is one line per
 * type.
 */
export const RATING_MAPPERS = {
  qa: mapCardRating,
  cloze: mapCardRating,
  mcq: mapMcqRating,
} as const;

/**
 * Total dispatch over every instrument type, for callers that hold a
 * `ReviewOutcome` and must write a log record (D7.1).
 *
 * This is where the per-type functions above meet an actual review session.
 * The explain-back branch returns a `RatingMapping` with no `rating` property
 * at all — the absence travels, rather than being resolved into a value here
 * and forgotten.
 */
export function mapReviewOutcome(outcome: ReviewOutcome): RatingMapping {
  switch (outcome.type) {
    case 'qa':
    case 'cloze':
      return { fsrsScheduled: true, rating: RATING_MAPPERS[outcome.type](outcome) };
    case 'mcq':
      return { fsrsScheduled: true, rating: RATING_MAPPERS.mcq(outcome) };
    case 'explain-back':
      return { fsrsScheduled: false };
  }
}

/**
 * The one site that turns "no rating" into the review log's `rating: null`.
 *
 * The frozen record has a nullable `rating` field and a writer must put
 * *something* there, so the absence has to become a value exactly once, at the
 * boundary between a decision (this instrument produces no rating) and a fact
 * (this logged event had none). Keeping it to one exported line is what makes
 * the conversion greppable: if a `null` ever reaches FSRS, it came through
 * here, and there is nowhere else to look.
 *
 * Note the asymmetry that makes this safe — this function is not reachable
 * from the four-way path. `mapCardRating` and `mapMcqRating` return a `Rating`
 * and an `McqRating`; neither can produce a mapping whose `fsrsScheduled` is
 * `false`, so no card or MCQ review can be logged with a null rating by
 * accident.
 */
export function loggedRating(mapping: RatingMapping): Rating | null {
  return mapping.fsrsScheduled ? mapping.rating : null;
}
