/**
 * Merges review-log records from any number of sources — typically one file
 * per device for the same day (C5.2) — into one deduplicated,
 * deterministically ordered list, **without any coordination** between the
 * devices that produced them (this bead's own acceptance clause).
 *
 * `eventId` is the merge key (contracts' review-log.ts doc): two records
 * that share an `eventId` are the same event, however many times, in
 * whatever file, in whatever order they were seen — every occurrence after
 * the first is dropped. Sorting the surviving records by `(instant,
 * deviceId, eventId)` rather than by input order is what makes the merge
 * order-independent: `merge(a, b)`, `merge(b, a)`, and
 * `merge(a, b, a, b)` all produce the exact same array. That is the concrete
 * property the "two-device same-day merge" acceptance criterion tests —
 * idempotent and commutative with zero coordination between devices.
 *
 * **The total order, ruled 2026-08-26 (`ol-egov.20`, no `[D-*]` alias
 * assigned).** `(instant, deviceId, eventId)`, all three ascending:
 *
 * 1. **`instant`** — `Date.parse(timestamp)`. Does almost all the work: two
 *    events far enough apart in wall-clock time never reach the tiebreak.
 * 2. **`deviceId`** — a stable per-device id, ascending lexicographically.
 *    Only reached when two records share an instant exactly.
 * 3. **`eventId`** — ascending lexicographically, same as before this
 *    ruling. Only reached when two records from the *same* device (or two
 *    untagged sources) share an instant, which the deviceId step cannot
 *    break.
 *
 * **Where the device id comes from, and why this is not a schema change.**
 * C5.2 already puts one device's day in its own file, named
 * `<date>.<deviceId>.jsonl` (`./path.ts`). The device id therefore already
 * exists, in the file name — nothing is added to the persisted event, and
 * `ReviewLogEntry` is untouched. `{@link TaggedMergeSource}` is the shape a
 * caller uses to carry that filename-derived id the short distance from "the
 * path I read" to "the source I am merging"; a caller that does not have (or
 * does not care about) a device id may still pass a bare
 * `readonly ReviewLogEntry[]`, exactly as before this ruling — it is treated
 * as carrying the empty string, which reproduces the pre-ruling
 * `(instant, eventId)` order exactly. **Wiring real per-file device ids from
 * `./path.ts`/`read.ts` into every production caller is separate work**,
 * gated on `ol-yk1c` (multi-device *discovery* — which files exist to read —
 * is still open); this module accepting the tag is what makes that wiring
 * possible without a second signature change later.
 *
 * A duplicated `eventId` that reaches this function tagged with two
 * *different* device ids (the same event content already synced onto more
 * than one device's own file) is tagged, for tiebreak purposes, with the
 * **lexicographically smallest** of the device ids it was seen under —
 * computed independently of which source happened to be read first, so that
 * edge case cannot reintroduce the input-order-dependence this whole ruling
 * exists to remove.
 *
 * **Clock skew.** This function has no clock and does no correction — it
 * sorts the `timestamp` each record already carries, and a device whose
 * clock runs minutes fast or slow shifts **every one of that device's
 * events by the same wholesale offset**, not selectively. That can genuinely
 * interleave a skewed device's events with another device's around the
 * boundary of what a later consumer treats as one sitting (a burst of
 * reviews close together in time) — sorting by wall-clock instant cannot
 * distinguish "actually interleaved in time" from "looks interleaved because
 * one clock is wrong", and nothing in this module tries to. What the
 * deviceId tiebreak *does* guarantee, skew or no skew: for a **fixed** set of
 * timestamps, the fold is the same array every time, regardless of which
 * device's file was read first. A sitting-clustering consumer reading the
 * folded order therefore sees one deterministic clustering per set of
 * events, never a clustering that flips depending on file read order — see
 * `merge.spec.ts`'s clock-skew describe block for the test that pins this
 * down.
 *
 * A duplicate `eventId` whose *content* differs between occurrences is not
 * silently resolved by "first wins" — that would hide a real correctness
 * bug (an id collision, or two distinct events wrongly sharing an id) behind
 * an unrecoverable record, which INV-4 rules out. It throws instead.
 *
 * **Every kind of entry merges the same way (D-020).** Suspend and unsuspend
 * events are merged alongside review events with no special case: `eventId`
 * idempotency applies identically, so two devices that saw the same suspension
 * collapse it to one event, while a suspend on one device and an unsuspend on
 * another are two distinct events and both survive. Deciding which of those
 * *won* is not the merger's job — that is the projection's
 * (`./suspension.ts`), over a list this function has already put in
 * chronological order.
 */

import type { ReviewLogEntry } from 'olea-contracts';

export interface MergeReviewLogResult {
  /** Deduplicated entries, sorted by `(timestamp instant, deviceId, eventId)` — see the module doc. */
  readonly records: readonly ReviewLogEntry[];
  /** `eventId`s that appeared more than once across the merged inputs — detected, not swallowed. */
  readonly duplicateEventIds: readonly string[];
}

/**
 * One source's records, tagged with the stable id of the device that wrote
 * them. See the module doc: the id lives in the C5.2 file name, never in the
 * persisted event, so tagging a source costs no schema change.
 */
export interface TaggedMergeSource {
  readonly deviceId: string;
  readonly records: readonly ReviewLogEntry[];
}

/**
 * What one call to {@link mergeReviewLogRecords} accepts for a single source:
 * either a bare record array (no known device id — the pre-ruling shape,
 * still fully supported) or a {@link TaggedMergeSource}.
 */
export type MergeSource = readonly ReviewLogEntry[] | TaggedMergeSource;

function isTaggedSource(source: MergeSource): source is TaggedMergeSource {
  return !Array.isArray(source);
}

function recordsOf(source: MergeSource): readonly ReviewLogEntry[] {
  return isTaggedSource(source) ? source.records : source;
}

function deviceIdOf(source: MergeSource): string {
  return isTaggedSource(source) ? source.deviceId : '';
}

function sameContent(a: ReviewLogEntry, b: ReviewLogEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The single-device projection of the ruled total order `(instant, deviceId,
 * eventId)` — compares by `(instant, eventId)` only, dropping the middle
 * term. That is a sound projection, not an approximation, whenever every
 * record being compared shares one deviceId: the deviceId step in the full
 * comparator only ever *breaks a tie*, so for two records tagged with the
 * same id (including the implicit `''` every bare-array source carries,
 * see the module doc) it can never distinguish them and dropping it changes
 * nothing about the result.
 *
 * Exported so a caller that genuinely has no device id to sort by — a
 * single-device array, or an array already merged elsewhere so any distinct
 * device identity has already been folded away — shares this module's ruled
 * order instead of keeping a private copy that silently falls one step
 * behind the next time the order itself moves (`ol-2jod.15`: exactly that
 * had already happened once, when `ol-egov.20` added the `deviceId` term
 * here and `session/replay.ts` kept its own pre-ruling `(instant, eventId)`
 * comparator).
 */
export function compareByInstantThenEventId(a: ReviewLogEntry, b: ReviewLogEntry): number {
  const instantA = Date.parse(a.timestamp);
  const instantB = Date.parse(b.timestamp);
  if (instantA !== instantB) return instantA - instantB;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

export function mergeReviewLogRecords(...sources: readonly MergeSource[]): MergeReviewLogResult {
  const byEventId = new Map<string, ReviewLogEntry>();
  // The smallest deviceId this eventId has been seen tagged with, across all
  // sources — see the module doc on why "smallest" rather than "first seen".
  const deviceIdByEventId = new Map<string, string>();
  const duplicateEventIds = new Set<string>();

  for (const source of sources) {
    const deviceId = deviceIdOf(source);
    for (const record of recordsOf(source)) {
      const prior = byEventId.get(record.eventId);
      if (prior !== undefined) {
        if (!sameContent(prior, record)) {
          throw new Error(
            `mergeReviewLogRecords: eventId ${JSON.stringify(record.eventId)} appears twice ` +
              'with different content — an eventId must uniquely identify one event.',
          );
        }
        duplicateEventIds.add(record.eventId);
      } else {
        byEventId.set(record.eventId, record);
      }
      const priorDevice = deviceIdByEventId.get(record.eventId);
      if (priorDevice === undefined || deviceId < priorDevice) {
        deviceIdByEventId.set(record.eventId, deviceId);
      }
    }
  }

  const records = [...byEventId.values()].sort((a, b) => {
    const instantA = Date.parse(a.timestamp);
    const instantB = Date.parse(b.timestamp);
    if (instantA !== instantB) return instantA - instantB;
    const deviceA = deviceIdByEventId.get(a.eventId) ?? '';
    const deviceB = deviceIdByEventId.get(b.eventId) ?? '';
    if (deviceA !== deviceB) return deviceA < deviceB ? -1 : 1;
    // deviceId ties (including both '') fall through to the shared
    // (instant, eventId) projection — see compareByInstantThenEventId.
    return compareByInstantThenEventId(a, b);
  });

  return { records, duplicateEventIds: [...duplicateEventIds].sort() };
}
