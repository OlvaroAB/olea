/**
 * The instrument-eligibility half of C5.10 ruling 1's tiebreak producer
 * (`[D-265]`, `ol-egov.141.62`) — "a different eligible ordinary instrument
 * on the concept exists to resolve it."
 *
 * `./instrument-mix.ts` and `./practice-need.ts` answer a different
 * question (which FORMAT a concept's future generation should emphasise).
 * This module answers whether an ALREADY-EXISTING instrument is still
 * usable, from the one source `review-log/` and `routing/` can read without
 * stepping outside this bead's owned files: the review log itself.
 *
 * **What "ordinary" means, per the clause.** Excludes `explain-back` — the
 * clause's own next sentence routes a conflict that traces to the item
 * itself to F2.23 item validation, "never to more attempts," and
 * explain-back is never FSRS-scheduled in the first place
 * (`olea-contracts`' `instrumentType` doc). "Ordinary" is therefore exactly
 * `../review-log/tiebreak.ts`'s own recall-tier set: `qa`, `cloze`, `mcq`.
 *
 * **What "eligible" means here, and what it deliberately does not check.**
 * This module reads "eligible" as "the review log itself gives no reason to
 * distrust the instrument": it is not currently suspended
 * (`../review-log/suspension.ts`'s projection) and its most recent verdict,
 * if any, is not `rejected` (`../review-log/verdicts.ts`). This is
 * necessarily a PARTIAL reading — a fuller one (does the instrument still
 * exist in the vault at all, is it actually due today) needs a vault read
 * or `SchedulerState` this bead's owned files do not have. Recorded here as
 * a known gap, the same "reachability, nothing supplies this today" shape
 * `RankOracleInput.retrievability`'s own doc uses, never silently assumed
 * away.
 *
 * **Only instruments the review log has ever seen are visible here.** A
 * concept's OTHER instruments — ones that exist in the vault but have never
 * been reviewed — are invisible to this module, because nothing in
 * `review-log/` enumerates the vault (that is `session/enumerate.ts`'s job,
 * outside this bead's owned files). An instrument that has never been
 * reviewed has also never been suspended or rejected, so this is a
 * conservative UNDER-count of eligible instruments, never an over-count: a
 * concept this module reports as having no other eligible instrument may in
 * fact have one nobody has reviewed yet. Because the tiebreak only ever
 * SERVES a concept ahead of another already-tied one — never invents
 * evidence, never adds a review — under-counting eligibility only makes the
 * tiebreak fire less often than the clause would in principle allow, never
 * more, which matches C5.10's own "never a win without bound."
 */

import type { InstrumentType, ReviewLogEntry } from 'olea-contracts';
import { suspendedInstrumentIds } from '../review-log/suspension.js';
import { latestVerdictByInstrument } from '../review-log/verdicts.js';

/** C5.10's "ordinary" instrument — every schedulable type except `explain-back` (see module doc). Same set `../review-log/tiebreak.ts` filters recall observations to. */
export const ORDINARY_INSTRUMENT_TYPES: ReadonlySet<InstrumentType> = new Set([
  'qa',
  'cloze',
  'mcq',
]);

function knownOrdinaryInstrumentsForConcept(
  entries: readonly ReviewLogEntry[],
  conceptKey: string,
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!ORDINARY_INSTRUMENT_TYPES.has(entry.instrumentType)) continue;
    if (!entry.conceptIds.includes(conceptKey)) continue;
    found.add(entry.instrumentId);
  }
  return found;
}

/**
 * Whether `conceptKey` has an ordinary instrument, OTHER than one of
 * `excludeInstrumentIds` (the instrument id(s) whose observations
 * disagreed — `../review-log/tiebreak.ts`'s
 * `ComparableObservationDisagreement.disagreeingInstrumentIds`), that the
 * review log gives no reason to distrust. See this module's doc for exactly
 * what "eligible" checks and does not check.
 */
export function hasDifferentEligibleOrdinaryInstrument(
  entries: readonly ReviewLogEntry[],
  conceptKey: string,
  excludeInstrumentIds: ReadonlySet<string>,
): boolean {
  const known = knownOrdinaryInstrumentsForConcept(entries, conceptKey);
  if (known.size === 0) return false;

  const suspended = suspendedInstrumentIds(entries);
  const verdicts = latestVerdictByInstrument(entries);

  for (const instrumentId of known) {
    if (excludeInstrumentIds.has(instrumentId)) continue;
    if (suspended.has(instrumentId)) continue;
    if (verdicts.get(instrumentId)?.verdict === 'rejected') continue;
    return true;
  }
  return false;
}
