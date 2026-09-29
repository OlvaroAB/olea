/**
 * Row 50 of the 2026-09-29 decision sheet (`ol-egov.141.89.6.69`), on top of
 * `[D-416]` and `[D-318]`: **whether she was shown the feedback for a question
 * is a recorded fact**, one of three, and an attempt whose exposure is not
 * confirmed earns no independent-performance credit.
 *
 * David's ruling, applied together:
 *
 * - A revision made after feedback was shown is assisted and cannot establish
 *   independent top-stage performance: `'shown'` records the rung `'guided'`.
 * - Where exposure cannot be confirmed, independent credit is withheld
 *   conservatively while the uncertainty is recorded: `'unknown'` records no
 *   rung at all, which `olea-core`'s stage fold reads as unknown and refuses
 *   for the top growth stage (`[D-281]`, `ADMITTED_SUPPORT_LEVELS`).
 * - Confirmed assistance is never claimed when exposure is unknown:
 *   `'unknown'` never yields `'guided'` by itself.
 * - A growth label already earned is never lowered by any of this: the stage
 *   is a high-water mark (`rollup.ts`), and a guided or rungless review only
 *   adds no qualifying evidence.
 *
 * **Where the fact lives.** In memory, on the sealed support and on each entry
 * of the attempt sequence (`./attempt-sequence.ts`); on her log it is carried
 * by the rung the record already has (`guided`, or absent), so **no record
 * shape changes** and nothing here needs `packages/contracts`.
 *
 * **Where it is read from.** Three places, in order of confidence:
 *
 * 1. the attempts she set aside in this view (`./attempt-sequence.ts`);
 * 2. {@link FeedbackExposureLedger}, a session note the view writes the moment
 *    a graded result is shown, so a view opened again after she read the
 *    feedback and closed it, or after the set-aside write was lost, still
 *    knows;
 * 3. her log (`./set-aside-record.ts`'s `createReadLoggedAttemptState`),
 *    read through {@link classifyLoggedFeedbackExposure}: a graded attempt she
 *    set aside and never followed to acceptance is a shown exposure, which is
 *    how a later session knows.
 *
 * **What nothing available can recover**, and is filed as an open question on
 * the bead: feedback shown in a view that was lost before she chose Try again
 * or accepted, with the session gone (a reload). Neither her log nor the
 * session holds anything, so it reads as a first attempt. Closing that needs a
 * fact written when the feedback is displayed, which is a review-log shape
 * decision, not something to invent here.
 *
 * **No content (D-005).** Ids and three-value facts only.
 */
import type { ReviewLogEntry, SupportLevel } from 'olea-contracts';

/** Whether she was shown the graded result of an earlier attempt at this question. */
export type FeedbackExposure = 'shown' | 'not-shown' | 'unknown';

/**
 * What is known about the earlier attempts at one question, before the one
 * she is about to make: the exposure, and the attempt a new one follows.
 */
export interface PriorAttemptState {
  readonly exposure: FeedbackExposure;
  /** The latest earlier attempt in the open exchange, or `null` when there is none to follow. */
  readonly lastAttemptId: string | null;
}

/** A question with no earlier attempt anyone can see: not shown, nothing to follow. */
export const NO_PRIOR_ATTEMPT: PriorAttemptState = { exposure: 'not-shown', lastAttemptId: null };

/**
 * The rung an attempt is sealed at, from its exposure and what the answering
 * phase itself showed (`own`).
 *
 * `'shown'` is `'guided'`, whatever else was on screen: it is the top of the
 * ladder, so nothing can raise it. `'unknown'` records no rung, which
 * withholds independent credit without asserting assistance, except where the
 * answering phase itself confirmed `'guided'` (the source open beside her): a
 * confirmed fact stands. `'not-shown'` leaves the answering phase's reading
 * exactly as it was, unknown included.
 */
export function supportLevelForExposure(
  exposure: FeedbackExposure,
  own: SupportLevel | undefined,
): SupportLevel | undefined {
  if (exposure === 'shown') return 'guided';
  if (own === 'guided') return 'guided';
  if (exposure === 'unknown') return undefined;
  return own;
}

// ---------------------------------------------------------------------------
// The session note
// ---------------------------------------------------------------------------

/**
 * The graded results this plugin session has shown her and not yet closed
 * with an accepted attempt. Ids only (D-005), never persisted, never sent
 * anywhere: it exists so exposure survives a closed view, which `modal.ts`
 * resets on every new question.
 */
export interface FeedbackExposureLedger {
  /** A graded result for `attemptId` was shown to her at this question. */
  noteShown(instrumentId: string, attemptId: string): void;
  /** An attempt at this question was accepted: the exchange ended. */
  settle(instrumentId: string): void;
  /** The latest attempt shown at this question in the open exchange, if any. */
  shown(instrumentId: string): { readonly attemptId: string } | undefined;
}

/**
 * Bound on the questions one session note holds. A freeform topic mints a
 * fresh id every time, so a session that abandons many graded topics would
 * otherwise grow the note without ever reading them back; the oldest is
 * dropped first.
 */
export const FEEDBACK_EXPOSURE_LEDGER_CAPACITY = 500;

export function createFeedbackExposureLedger(
  capacity: number = FEEDBACK_EXPOSURE_LEDGER_CAPACITY,
): FeedbackExposureLedger {
  const shownAttempt = new Map<string, string>();
  return {
    noteShown(instrumentId, attemptId) {
      // Re-insert so the map's order is most-recently-noted last.
      shownAttempt.delete(instrumentId);
      shownAttempt.set(instrumentId, attemptId);
      while (shownAttempt.size > capacity) {
        const oldest = shownAttempt.keys().next();
        if (oldest.done === true) break;
        shownAttempt.delete(oldest.value);
      }
    },
    settle(instrumentId) {
      shownAttempt.delete(instrumentId);
    },
    shown(instrumentId) {
      const attemptId = shownAttempt.get(instrumentId);
      return attemptId === undefined ? undefined : { attemptId };
    },
  };
}

/**
 * The note every view shares unless a caller injects its own, so it outlives
 * the view that wrote it (the plugin session's lifetime, no longer).
 */
export const sessionFeedbackExposureLedger: FeedbackExposureLedger = createFeedbackExposureLedger();

// ---------------------------------------------------------------------------
// Reading her log
// ---------------------------------------------------------------------------

/** The slice of a whole-log read this classification needs (`olea-core`'s `readReviewLogHistory`). */
export interface LoggedAttemptHistory {
  readonly entries: readonly ReviewLogEntry[];
  readonly invalidLines: readonly { readonly line: { readonly raw: string } }[];
}

const TIMESTAMP_IN_RAW_LINE = /"timestamp"\s*:\s*"([^"]+)"/u;

function millisOf(timestamp: string): number | null {
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The prior state of one question from her log alone.
 *
 * **An exchange is the run of attempts she set aside and never followed to
 * acceptance.** `'explain-back-set-aside'` records are the attempts she chose
 * Try again on; an accepted attempt ends the exchange (the contract's own doc
 * for the record). A set-aside is therefore closed when an accepted review of
 * the same question names it or a later attempt of the same chain
 * (`followsAttemptId`), or when an accepted review of the same question is
 * timestamped later, which covers a retry written before views linked across
 * sessions. A later offer of the same question after the exchange ended is
 * not a revision, and is left exactly as it was.
 *
 * - Any graded set-aside in the open exchange: `'shown'`, with the latest open
 *   attempt as the one a new attempt follows.
 * - Otherwise a line that could not be parsed and names this question, and is
 *   not older than an accepted review of it: `'unknown'`. It may have been a
 *   set-aside; nothing can confirm it either way. A line with no readable
 *   timestamp is kept as unknown, conservatively.
 * - Otherwise `'not-shown'`. Attempts the check could not assess showed her no
 *   feedback (`[D-321]`), so they leave the exposure not shown, though the
 *   latest of them is still the attempt a new one follows.
 *
 * A confirmed graded attempt outranks an unreadable line: the confirmed fact
 * wins. A review that names an attempt whose record was lost (a dangling
 * link) opens nothing and is not unknown: it is a closed exchange.
 */
export function classifyLoggedFeedbackExposure(
  history: LoggedAttemptHistory,
  instrumentId: string,
): PriorAttemptState {
  const setAsides = history.entries.flatMap((entry) =>
    entry.kind === 'explain-back-set-aside' && entry.instrumentId === instrumentId ? [entry] : [],
  );
  const reviews = history.entries.flatMap((entry) =>
    entry.kind === 'review' && entry.instrumentId === instrumentId ? [entry] : [],
  );

  const byAttemptId = new Map(setAsides.map((entry) => [entry.attemptId, entry]));
  const closed = new Set<string>();
  for (const review of reviews) {
    let id = review.followsAttemptId;
    while (id !== undefined && !closed.has(id)) {
      closed.add(id);
      id = byAttemptId.get(id)?.followsAttemptId;
    }
  }
  let latestReviewMs: number | null = null;
  for (const review of reviews) {
    const ms = millisOf(review.timestamp);
    if (ms !== null && (latestReviewMs === null || ms > latestReviewMs)) latestReviewMs = ms;
  }
  const endedBefore = (timestamp: string | null): boolean => {
    if (latestReviewMs === null || timestamp === null) return false;
    const ms = millisOf(timestamp);
    return ms !== null && ms < latestReviewMs;
  };

  const open = setAsides.filter(
    (entry) => !closed.has(entry.attemptId) && !endedBefore(entry.timestamp),
  );
  let latestOpen: (typeof open)[number] | undefined;
  let latestOpenMs = Number.NEGATIVE_INFINITY;
  for (const entry of open) {
    const ms = millisOf(entry.timestamp) ?? Number.NEGATIVE_INFINITY;
    if (latestOpen === undefined || ms >= latestOpenMs) {
      latestOpen = entry;
      latestOpenMs = ms;
    }
  }
  const lastAttemptId = latestOpen === undefined ? null : latestOpen.attemptId;

  if (open.some((entry) => entry.outcome.kind === 'graded')) {
    return { exposure: 'shown', lastAttemptId };
  }

  const unreadableNamingIt = history.invalidLines.some(({ line }) => {
    if (!line.raw.includes(instrumentId)) return false;
    const stamp = TIMESTAMP_IN_RAW_LINE.exec(line.raw)?.[1];
    return !endedBefore(stamp ?? null);
  });
  if (unreadableNamingIt) return { exposure: 'unknown', lastAttemptId };

  return { exposure: 'not-shown', lastAttemptId };
}

/** The reader `ExplainBackModalDeps.readLoggedAttemptState` is: one question's prior state from her log. */
export type ReadLoggedAttemptState = (instrumentId: string) => Promise<PriorAttemptState>;

/**
 * The prior state the view seals its first attempt with, resolved once when
 * the question is resolved.
 *
 * The session note is confirmed fact and short-circuits the log read. Where
 * the note holds nothing the log answers; a log that cannot be read at all is
 * `'unknown'`, never `'not-shown'` and never `'guided'`. No reader wired reads
 * as {@link NO_PRIOR_ATTEMPT}, so a caller that does not wire one behaves
 * exactly as before.
 */
export async function resolvePriorAttemptState(params: {
  readonly instrumentId: string;
  readonly ledger: FeedbackExposureLedger;
  readonly readLogged?: ReadLoggedAttemptState | undefined;
}): Promise<PriorAttemptState> {
  const noted = params.ledger.shown(params.instrumentId);
  if (noted !== undefined) return { exposure: 'shown', lastAttemptId: noted.attemptId };
  if (params.readLogged === undefined) return NO_PRIOR_ATTEMPT;
  try {
    return await params.readLogged(params.instrumentId);
  } catch (error) {
    // Content-free (D-005): the fact that the log could not be read, never what was in it.
    console.error('Olea: earlier attempts at this question could not be read; exposure unknown', {
      error,
    });
    return { exposure: 'unknown', lastAttemptId: null };
  }
}
