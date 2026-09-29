/**
 * `[D-416]` (`ol-egov.141.89.6.63`), carrying `[D-318]`'s "any answer after
 * feedback is recorded as a separate supported attempt": the attempts she has
 * made at ONE explain-back question inside one view, in order, and the support
 * rung each new attempt is recorded at.
 *
 * **Why an answer after feedback is guided.** The graded result shows her the
 * feedback, the missed points and the cited source (`modal.ts`'s
 * `renderGradedPhase`). An answer written after reading that had the source
 * in front of her, which is exactly the rung `[D-094]`'s ladder names
 * `'guided'` and which `ADMITTED_SUPPORT_LEVELS` (`olea-core`'s
 * `mastery/rollup.ts`) refuses for the top growth stage. `'prompted'` would
 * admit the top stage, against `[D-318]`'s intent; a new rung would be a
 * contract change. `[D-416]` ruled `'guided'`.
 *
 * **Sealed at submit, never at accept.** The rung describes what she had seen
 * BEFORE she wrote the answer being graded. Her first answer's own graded
 * result is read after that answer was written, so accepting it still records
 * the unaided rung; only a later answer is after feedback.
 *
 * **Append-only.** Try again adds the attempt she set aside to the sequence;
 * nothing here removes, reorders or rewrites an entry, so the order of her
 * attempts survives any number of retries. An entry holds ids and a
 * three-value verdict only (D-005): never her answer text, the feedback, or a
 * cited passage.
 *
 * **Held in the view and written to her log.** Each entry `discardGrading`
 * appends is also written as its own `explain-back-set-aside` review-log
 * record (`./set-aside-record.ts`), and the accepted retry's review carries
 * `followsAttemptId`, so the sequence reads back from the log alone. The rule
 * for WHICH attempt a retry follows, and at what rung it was answered, has its
 * one home here; the writers only persist what this module decided.
 *
 * **Exposure to feedback is a recorded fact** (row 50, `ol-egov.141.89.6.69`,
 * `./feedback-exposure.ts`): each attempt is sealed with whether she had been
 * shown the feedback for this question, one of shown, not shown or unknown,
 * and the rung follows from it. The fact is read from this sequence first, and
 * for the first attempt in a view from what is known about the question
 * beforehand (an earlier view this session, or her log), so a revision in a
 * later view is no longer sealed as unaided just because the sequence started
 * empty.
 */
import type { ExplainBackCorrectnessVerdict, SupportLevel } from 'olea-contracts';
import {
  type FeedbackExposure,
  NO_PRIOR_ATTEMPT,
  type PriorAttemptState,
  supportLevelForExposure,
} from './feedback-exposure.js';
import type { ExplainBackSupportShown } from './solo-review.js';
import { supportLevelShownForExplainBack } from './solo-review.js';

/**
 * What the check returned for an attempt she set aside. `'graded'` means she
 * was shown a verdict, feedback and the cited source; `'unable-to-assess'`
 * (`[D-321]`) means she was shown none of those, only that it could not tell.
 */
export type SetAsideAttemptOutcome =
  | { readonly kind: 'graded'; readonly verdict: ExplainBackCorrectnessVerdict }
  | { readonly kind: 'unable-to-assess' };

/** One attempt she chose Try again on. Always `acceptance: 'not-accepted'` — an accepted attempt ends the exchange. */
export interface SetAsideAttempt {
  readonly attemptId: string;
  readonly outcome: SetAsideAttemptOutcome;
  readonly acceptance: 'not-accepted';
  /** The rung sealed when this attempt was submitted (`undefined` = unknown, never unaided). */
  readonly supportLevelShown: SupportLevel | undefined;
  /** The attempt this one followed, or `null` for the first attempt at the question. */
  readonly followsAttemptId: string | null;
  /**
   * Whether she had been shown the feedback for this question when this attempt
   * was submitted (row 50). Held in the view only: on her log the fact is the
   * rung above (`guided` for shown, absent for unknown).
   */
  readonly feedbackExposure: FeedbackExposure;
}

/** Oldest first. Only ever grown by {@link appendSetAsideAttempt}. */
export type ExplainBackAttemptSequence = readonly SetAsideAttempt[];

export const EMPTY_ATTEMPT_SEQUENCE: ExplainBackAttemptSequence = [];

/**
 * What a new attempt carries from the sequence, sealed at the moment she
 * submits it: the rung, and the attempt it follows.
 */
export interface SealedAttemptSupport {
  readonly supportLevelShown: SupportLevel | undefined;
  readonly followsAttemptId: string | null;
  /** The exposure the rung was derived from (row 50): shown, not shown or unknown. */
  readonly feedbackExposure: FeedbackExposure;
}

/** True when an earlier attempt in this sequence showed her a graded result. */
export function feedbackShownBefore(sequence: ExplainBackAttemptSequence): boolean {
  return sequence.some((attempt) => attempt.outcome.kind === 'graded');
}

/**
 * Whether she has been shown the feedback for this question at the point a new
 * attempt is sealed: a graded result in this view's own sequence is confirmed
 * and outranks whatever was known beforehand (`prior`); otherwise what was
 * known beforehand stands, unknown included. An attempt the check could not
 * assess showed her nothing, so it changes nothing.
 */
export function feedbackExposureAt(
  sequence: ExplainBackAttemptSequence,
  prior: FeedbackExposure,
): FeedbackExposure {
  return feedbackShownBefore(sequence) ? 'shown' : prior;
}

/**
 * The rung and link for the attempt she is submitting now. After feedback the
 * rung is `'guided'`, whatever the answering phase itself shows: it is the top
 * of the ladder, so no other affordance can raise it, and the fact that she
 * read a graded result is known even when the answering phase's own
 * presentation is not (`shown === null`). Where exposure cannot be confirmed
 * (`'unknown'`) no rung is recorded, which withholds independent credit
 * without claiming assistance nobody confirmed; see
 * `./feedback-exposure.ts`'s `supportLevelForExposure`. Otherwise the
 * answering phase's own reading stands, unknown included.
 *
 * `prior` is what was known about the question before this view's own
 * sequence: from an earlier view this session or from her log. It defaults to
 * nothing known, which is exactly the behaviour before it existed. The attempt
 * this one follows is the last one in this sequence, or else the last one in
 * `prior`'s open exchange.
 */
export function sealAttemptSupport(
  sequence: ExplainBackAttemptSequence,
  shown: ExplainBackSupportShown | null,
  prior: PriorAttemptState = NO_PRIOR_ATTEMPT,
): SealedAttemptSupport {
  const last = sequence[sequence.length - 1];
  const feedbackExposure = feedbackExposureAt(sequence, prior.exposure);
  return {
    supportLevelShown: supportLevelForExposure(
      feedbackExposure,
      supportLevelShownForExplainBack(shown),
    ),
    followsAttemptId: last === undefined ? prior.lastAttemptId : last.attemptId,
    feedbackExposure,
  };
}

/**
 * Try again: the attempt she set aside joins the end of the sequence. Returns
 * a new array; the one passed in is never mutated, so a caller still holding
 * it sees exactly what it saw before.
 */
export function appendSetAsideAttempt(
  sequence: ExplainBackAttemptSequence,
  attempt: {
    readonly attemptId: string;
    readonly outcome: SetAsideAttemptOutcome;
    readonly support: SealedAttemptSupport;
  },
): ExplainBackAttemptSequence {
  return [
    ...sequence,
    {
      attemptId: attempt.attemptId,
      outcome: attempt.outcome,
      acceptance: 'not-accepted',
      supportLevelShown: attempt.support.supportLevelShown,
      followsAttemptId: attempt.support.followsAttemptId,
      feedbackExposure: attempt.support.feedbackExposure,
    },
  ];
}
