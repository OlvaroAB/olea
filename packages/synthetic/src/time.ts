/**
 * Local-time arithmetic for the generator.
 *
 * D7.1's timestamp is "ISO-8601 **with offset**. The offset matters: 'when did
 * she study' is local" (contracts). Two consequences this module exists to
 * honour:
 *
 *  - Every emitted timestamp carries the persona's UTC offset explicitly, and
 *    the wall-clock part is genuinely local — so `timestamp.slice(0, 10)` is
 *    the local calendar day, which is exactly what `olea-core`'s writer uses to
 *    choose the day's log file (`localDateOf` in `review-log/write.ts`). The
 *    generator's day grouping and core's file-per-day grouping agree by
 *    construction rather than by coincidence.
 *  - Nothing here reads the ambient timezone. `Date`'s local getters are never
 *    used; the offset is shifted into the instant and read back with the UTC
 *    getters, so a stream generated in Europe and in the Pacific is the same
 *    bytes.
 */

const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `'+01:00'` → `60`. Throws on anything else — a malformed offset is a bug at the call site. */
export function parseUtcOffset(offset: string): number {
  const m = OFFSET_RE.exec(offset);
  if (!m) {
    throw new Error(`parseUtcOffset: expected ±HH:MM, got ${JSON.stringify(offset)}`);
  }
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  return sign * (hours * 60 + minutes);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** UTC instant of local midnight on `date` for a persona at `offsetMinutes`. */
export function localMidnightUtcMs(date: string, offsetMinutes: number): number {
  if (!DATE_RE.test(date)) {
    throw new Error(`localMidnightUtcMs: expected YYYY-MM-DD, got ${JSON.stringify(date)}`);
  }
  return Date.parse(`${date}T00:00:00.000Z`) - offsetMinutes * MS_PER_MINUTE;
}

/** The local calendar day (`YYYY-MM-DD`) an instant falls on for a persona at `offsetMinutes`. */
export function localDate(utcMs: number, offsetMinutes: number): string {
  const shifted = new Date(utcMs + offsetMinutes * MS_PER_MINUTE);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** `YYYY-MM-DD` plus `n` days, staying on calendar days rather than instants. */
export function addDays(date: string, n: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  const shifted = new Date(base + n * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` precedes `from`. */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY,
  );
}

/**
 * An instant as an ISO-8601 string with an explicit offset, e.g.
 * `2027-02-11T19:04:31.500+01:00` — the shape `z.string().datetime({ offset:
 * true })` requires and the shape whose first ten characters are the local day.
 */
export function isoWithOffset(utcMs: number, offsetMinutes: number): string {
  const shifted = new Date(utcMs + offsetMinutes * MS_PER_MINUTE);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `.${pad(shifted.getUTCMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
