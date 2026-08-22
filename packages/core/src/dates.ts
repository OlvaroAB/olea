/**
 * Calendar-day arithmetic used throughout olea-core (FSRS due-dates, queue
 * ordering, streak calculation). Deliberately UTC-normalized so that two
 * `Date`s on the same *calendar* day — regardless of their time-of-day
 * component — are zero days apart, and so that callers get a stable answer
 * independent of the host machine's local timezone.
 */

/**
 * Returns the number of whole calendar days from `from` to `to`, normalized
 * to UTC midnight before differencing. Positive when `to` is after `from`,
 * negative when `to` is before `from`, zero when they fall on the same UTC
 * calendar day.
 */
export function daysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromUtcMidnight = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtcMidnight = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toUtcMidnight - fromUtcMidnight) / msPerDay);
}

/** Returns `date` shifted by `days` whole calendar days (UTC), same time-of-day. */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
