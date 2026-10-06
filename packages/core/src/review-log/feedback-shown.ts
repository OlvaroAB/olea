/**
 * Reading the **explain-back feedback exposure marker** back from her log
 * (`[D-460]`, ruled 2026-09-30; shape from `ol-egov.141.89.6.86`).
 *
 * The marker (`olea-contracts`' `explainBackFeedbackShownLogRecordV6`, written
 * by `./write.ts`'s `appendExplainBackFeedbackShownRecord`) records that one
 * explain-back attempt's graded result was displayed: the question, the
 * attempt and the time. The explain-back view writes it before the result
 * renders, so a later session can tell a revision made after feedback from a
 * first attempt even when the view that showed the feedback was lost.
 *
 * A projection folded from the log, never stored, like `./suspension.ts` and
 * `./verdicts.ts`: it takes entries a caller already holds (the plugin's one
 * whole-log read, `../session/history.ts`'s `readReviewLogHistory`) and does
 * no I/O of its own, so a reader that also needs the set-aside records and
 * reviews of the same question reads the log once.
 *
 * **Duplicates are one fact.** A marker may be written more than once for one
 * attempt (a retried write that had in fact landed); every marker for one
 * `attemptId` reads as one marked attempt, timed by the earliest of them.
 *
 * **What this does not decide.** Whether the exchange the attempt belonged to
 * has since ended (an accepted review), and so whether a new attempt is a
 * revision: that rule lives with the view's exposure reading
 * (`packages/plugin/src/explain-back/feedback-exposure.ts`'s
 * `classifyLoggedFeedbackExposure`), beside the set-aside records it already
 * reads. No fold that reports what she knows reads markers at all.
 */
import type { ReviewLogEntry } from 'olea-contracts';

/** One attempt at a question whose graded result her log says was displayed. */
export interface ExplainBackFeedbackShownAttempt {
  /** The attempt, as minted when she submitted it. */
  readonly attemptId: string;
  /** The earliest marker's timestamp for this attempt: when the result was first about to be shown. */
  readonly timestamp: string;
}

function isEarlier(candidate: string, than: string): boolean {
  return Date.parse(candidate) < Date.parse(than);
}

/**
 * Every attempt at `instrumentId` that a marker in `entries` names, one per
 * attempt however many markers name it, in the order each attempt first
 * appears in `entries`. Markers for other questions, and every other kind of
 * entry, are ignored.
 */
export function explainBackFeedbackShownAttempts(
  entries: readonly ReviewLogEntry[],
  instrumentId: string,
): readonly ExplainBackFeedbackShownAttempt[] {
  const byAttempt = new Map<string, ExplainBackFeedbackShownAttempt>();
  for (const entry of entries) {
    if (entry.kind !== 'explain-back-feedback-shown' || entry.instrumentId !== instrumentId) {
      continue;
    }
    const seen = byAttempt.get(entry.attemptId);
    if (seen === undefined || isEarlier(entry.timestamp, seen.timestamp)) {
      byAttempt.set(entry.attemptId, { attemptId: entry.attemptId, timestamp: entry.timestamp });
    }
  }
  return [...byAttempt.values()];
}
