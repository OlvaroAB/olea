/**
 * The absence signal component register row 3.8 names and `./reentry.ts`
 * consumes: "days since her last review" (F6.6; `ol-v7r5.18`, discovered from
 * `ol-blwb` / `[BKLG-1]`).
 *
 * `./reentry.ts`'s own module doc is explicit that this is the one new fact
 * the rest of the system has no notion of — "no such notion exists anywhere;
 * the only lateness in the system is per-card" — and names the shape it
 * wants: "a plain day count ... a caller has already derived (e.g. via
 * `../dates.js`'s `daysBetween` over the review log's own latest timestamp
 * and `asOf`) rather than this module reading the log itself." This is that
 * derivation, kept separate from `reentry.ts` for the same reason
 * `duration.ts` and `instrument-index.ts` are their own files rather than
 * folded into the composer that consumes them: it is a fact about the review
 * log, provable on its own, independent of the budget arithmetic that reads
 * it.
 *
 * ## Which entries count as "a review"
 *
 * Only `kind: 'review'` entries — the same line `today/streak.ts`'s
 * `studyDays` already draws, for the same reason its own doc states: a
 * suspend/unsuspend event is a decision about her deck, not a study session,
 * and counting one would let tidying up reset the absence clock the way it
 * would let it extend a streak. `retrospective-offered`/`-opened`/
 * `-dismissed` and `succession`/`dispute`/`verdict` records are, likewise,
 * not her reviewing something.
 *
 * ## Never reviewed at all is not an absence
 *
 * A vault with no `'review'` entry anywhere has no "last review" to be far
 * from, so `daysSinceLastReview` returns `0` rather than a sentinel or
 * `Infinity` — the same convention `provider.ts`'s `arrivalDaysByConceptKey`
 * already holds for the pre-ARRIVE-1 case ("never Infinity"). Reading a fresh
 * install as an enormous absence would trigger F6.6's small, shrunk session on
 * a student who has not yet had a first one, which is exactly backwards: there
 * is nothing to "come back" to yet.
 *
 * ## UTC-normalised days, deliberately not her local calendar day
 *
 * `today/calendar-day.ts`'s module doc draws a real line: a streak asks "did
 * she study on Tuesday", which is a fact about her evening and must be read in
 * her local zone. This module feeds `composeReentrySession`, which feeds
 * `buildComposedStudySession` — the FSRS/allocation layer that already
 * measures every other lateness (`dates.ts`'s own `daysBetween`) in
 * UTC-normalised calendar days, on purpose, so that "how many days apart" does
 * not depend on which machine asks. An absence threshold that fed the
 * scheduling layer a local-zone count while every other lateness in the same
 * composition used a UTC one would make two numbers with the same name mean
 * different things one call apart. So this module reuses `dates.ts`'s
 * `daysBetween` directly, exactly as `reentry.ts`'s own doc names.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { daysBetween } from '../dates.js';

/**
 * The most recent instant a `kind: 'review'` entry's `timestamp` names, or
 * `null` when `entries` holds none. A record whose `timestamp` does not parse
 * is skipped rather than thrown on — the same per-line tolerance
 * `today/streak.ts`'s `studyDays` and `review-log/parse.ts` already hold, so
 * one odd record never costs the ones around it.
 */
function mostRecentReviewInstant(entries: readonly ReviewLogEntry[]): Date | null {
  let latest: Date | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    const parsed = new Date(entry.timestamp);
    if (Number.isNaN(parsed.getTime())) continue;
    if (latest === null || parsed.getTime() > latest.getTime()) latest = parsed;
  }
  return latest;
}

/**
 * Days since her last review, as of `now` — the one new fact component
 * register row 3.8 adds. Pure and total: never throws, because there is no
 * caller input here that can be malformed in a way worth failing on (an
 * unparseable timestamp is simply skipped, per this module's doc), and no
 * negative result is possible (a review logged after `now` — clock skew, or a
 * caller passing a stale `now` — floors at `0` rather than reporting a
 * negative absence).
 *
 * `entries` should be the WHOLE review log, not a trailing window —
 * `session/history.ts`'s `readReviewLogHistory` already reads it that way for
 * every production caller of this function, and a windowed read would
 * silently misreport a real absence longer than the window as "never
 * reviewed", which this module's own "never reviewed is not an absence"
 * branch would then read as "no absence at all" instead of a long one.
 */
export function daysSinceLastReview(entries: readonly ReviewLogEntry[], now: Date): number {
  const latest = mostRecentReviewInstant(entries);
  if (latest === null) return 0;
  return Math.max(0, daysBetween(latest, now));
}
