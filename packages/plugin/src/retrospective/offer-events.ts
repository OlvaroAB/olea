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

/**
 * Records a `retrospective-offered` event for each of `assessmentPaths` —
 * `./offer-card.ts`'s `unrecordedOfferedAssessmentPaths` counterpart, and
 * the D7.1 writer `ol-0r92.26` found missing (the kind was written only by
 * tests). `[D-178]` authorises the kind at the clause level; this is the
 * production wiring. Fired at the offer card's RENDER, not at a gesture of
 * hers — "offered" is a fact about what the card showed her, the same way
 * `./provider.ts`'s `markOpened`/`markDismissed` record facts about what
 * she did next. D-005: no content crosses this boundary, only the opaque
 * assessment path every other offer event already carries.
 *
 * Sequential, not `Promise.all`: these can land in the same day's log file
 * (C5.2), and `appendRetrospectiveOfferRecord`'s read-modify-write over one
 * file is not safe to run concurrently against itself.
 *
 * Callers pass only paths `unrecordedOfferedAssessmentPaths` says are
 * unlogged, so an unchanged card does not re-log itself on every render;
 * this still does not guard against two hosts (Home and grove) racing the
 * same first render against independently-loaded `offerEvents` snapshots —
 * an occasional duplicate `retrospective-offered` line is possible and is
 * harmless (`resolveRetrospectiveOfferStatus` never reads this kind at
 * all), so no lock is added here for it.
 */
export async function recordOfferedEvents(
  log: RetrospectiveOfferEventLog,
  assessmentPaths: readonly VaultPath[],
  now: () => Date,
): Promise<void> {
  for (const assessmentPath of assessmentPaths) {
    await log.append({
      kind: 'retrospective-offered',
      assessmentPath,
      timestamp: now().toISOString(),
    });
  }
}
