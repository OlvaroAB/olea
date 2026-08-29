/**
 * `createRetrospectiveOfferEventLog` — the production reader/writer for
 * F8.8's offer/open/dismiss memory (`[D-134]` Q5, `ol-0r92.16`), replacing
 * `./offer-store.ts`'s interim `data.json` blob (deleted by this bead).
 *
 * **Reads and writes the review log, not a separate store.** `[D-134]` Q5's
 * own words — "ordinary events in the local event log... no new storage,
 * second device converges" — name the review log itself: the same
 * append-only, one-file-per-day-per-device JSONL family (C5.2) every other
 * kind in `packages/contracts/src/review-log.ts`'s `reviewLogEntryV5` union
 * already lives in. `retrospectiveOfferLogRecordV5` (contracts) is additive
 * to that union the same way `suspendLogRecordV5` is — one shape spanning
 * three `kind` literals — so a second device converges through the ordinary
 * merge-by-`eventId` discipline (`olea-core`'s `review-log/merge.ts`) every
 * other kind already gets, with no bespoke sync logic here.
 *
 * **Whole log, not windowed** — the same choice `registry/provider.ts` and
 * `grove/provider.ts` make for mastery and suspension: "offered, until
 * opened or dismissed" (D-134 Q1: "no expiry") is a high-water-mark
 * question over the entire history, and a windowed read would silently
 * un-offer (or re-offer) an assessment from outside the window. `additionalPaths`
 * is the same probe-days fallback those two providers use for hosts that
 * cannot list the dot-prefixed `.olea/` folder — `readReviewLogHistory`'s
 * own doc names the limitation; it is not new here.
 *
 * **`RetrospectiveOfferEvent` (`olea-core`) is the exact runtime shape of a
 * `retrospectiveOfferLogRecordV5` line**, minus the two persistence-only
 * fields (`schemaVersion`, `eventId`) `resolveRetrospectiveOfferStatus`
 * never reads — so entries read back off the log are handed to it verbatim,
 * no mapping step to get wrong.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  appendRetrospectiveOfferRecord,
  calendarDaysEndingOn,
  type RetrospectiveOfferEvent,
  readReviewLogHistory,
  reviewLogPath,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';

export interface RetrospectiveOfferEventLogDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
}

/** Same shape `./offer-store.ts`'s `ObsidianRetrospectiveOfferStore` exposed, so callers built against it need only swap the constructor. */
export interface RetrospectiveOfferEventLog {
  /** Every recorded offer/open/dismiss event, oldest first is not guaranteed — callers filter by `assessmentPath`, never by position. */
  load(): Promise<readonly RetrospectiveOfferEvent[]>;
  /** Appends one event to today's review-log file for this device. */
  append(event: RetrospectiveOfferEvent): Promise<void>;
}

/** Narrows a union member to the shared shape offer/open/dismiss lines take. */
function isRetrospectiveOfferEntry(
  entry: ReviewLogEntry,
): entry is Extract<ReviewLogEntry, { readonly kind: RetrospectiveOfferEvent['kind'] }> {
  return (
    entry.kind === 'retrospective-offered' ||
    entry.kind === 'retrospective-opened' ||
    entry.kind === 'retrospective-dismissed'
  );
}

export function createRetrospectiveOfferEventLog(
  deps: RetrospectiveOfferEventLogDeps,
): RetrospectiveOfferEventLog {
  return {
    async load() {
      const today = localToday(deps.now());
      const additionalPaths: readonly VaultPath[] = calendarDaysEndingOn(
        today,
        SCHEDULING_HISTORY_PROBE_DAYS,
      ).map((day) => reviewLogPath(day, deps.deviceId));
      const { entries } = await readReviewLogHistory(deps.vault, { additionalPaths });
      return entries.filter(isRetrospectiveOfferEntry);
    },

    async append(event) {
      await appendRetrospectiveOfferRecord(
        deps.vault,
        { kind: event.kind, assessmentPath: event.assessmentPath, timestamp: event.timestamp },
        { deviceId: deps.deviceId },
      );
    },
  };
}
