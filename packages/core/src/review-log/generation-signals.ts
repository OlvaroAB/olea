/**
 * F3.7/D-238's format-ask trigger signal — GEN-3.5 (`ol-2zfj.136`).
 *
 * `generation/triggers.ts`'s `formatAskTrigger` takes an opaque
 * `requestedKind: SchedulableInstrumentType | null`; this module computes
 * the D7.1 half of it — her OBSERVED instrument-type order, read off the
 * review log's own `instrumentType` field. Pure over entries someone else
 * read (INV-1/§7.1, the identical "no vault I/O, no clock" split
 * `session/replay.ts` and `session/history.ts` already draw): a caller
 * supplies already-merged `ReviewLogEntry[]`, typically
 * `readReviewLogHistory`'s own `.entries`.
 *
 * ## Vault-wide, not per-course — a named, honest limitation
 *
 * `generation-queue.ts`'s `GenerationArrivalDeps.recordedPreferenceFor` is
 * typed `(courseCode) => ...`, but a `ReviewLogRecord` carries `conceptIds`
 * (verbatim concept names) and no course field at all — joining an
 * instrument's concepts to a course needs the concept registry
 * (`packages/core/src/concept/`, `registry/`), which is outside this bead's
 * owned paths (`plan/`, `scheduler/`, `review-log/`, `mastery/`, plus the
 * plugin's `ingestion/`). So `observedInstrumentTypeOrder` below reads the
 * WHOLE vault's review history regardless of which course asks, and every
 * course is handed the same order until a concurrent/later lane threads a
 * course-scoped join through. Named here rather than silently degrading,
 * per this repo's own "reachability sits outside this bead's owned paths"
 * precedent (`ol-2zfj.63`'s close evidence uses the identical phrase for
 * `deps.vision`).
 *
 * F2.14's fallback order is "most-preferred first", read here as "most
 * frequently rated first" among the three schedulable kinds
 * (`'explain-back'` excluded — F2.14: not FSRS-scheduled, `session/replay.ts`
 * skips it for the identical reason). A tie keeps `SchedulableInstrumentType`'s
 * own F2.14-listed order (`'qa'` first — `generation/primary-kind.ts`'s own
 * doc: "F2.14 lists Q&A first"), so the result is deterministic over the same
 * entries.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { SchedulableInstrumentType } from '../instrument/rating.js';

/** F2.14's own listed order, used only as this module's tie-break — never a re-declaration of the primary-kind floor (`generation/primary-kind.ts`'s `DEFAULT_PRIMARY_KIND_FLOOR` stays `'mcq'` and is untouched by this file). */
const F214_LISTED_ORDER: readonly SchedulableInstrumentType[] = ['qa', 'cloze', 'mcq'];

/**
 * Every rated review's `instrumentType`, most-frequent first, ties broken by
 * F2.14's own listed order. Empty when nothing has been reviewed yet — the
 * honest "nothing observed" state `primary-kind.ts`'s own doc names for
 * `PrimaryKindInput.recordedPreference`.
 */
export function observedInstrumentTypeOrder(
  entries: readonly ReviewLogEntry[],
): readonly SchedulableInstrumentType[] {
  const counts = new Map<SchedulableInstrumentType, number>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.instrumentType === 'explain-back') continue;
    counts.set(entry.instrumentType, (counts.get(entry.instrumentType) ?? 0) + 1);
  }
  return F214_LISTED_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0).sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
  );
}

/**
 * F3.7's "the format match or her instrument-type log (D7.1) asks for the
 * other kind" — the whole of `formatAskTrigger`'s `requestedKind`. One
 * fallback order, restated from `generation/primary-kind.ts#primaryKindFor`
 * (F4.8's format match wins when known, else F2.14's observed order), but
 * returning `null` rather than flooring to `DEFAULT_PRIMARY_KIND_FLOOR` when
 * neither names a kind — an "asks for" question, unlike the arrival call's
 * "which kind do we build regardless," must not manufacture an ask nothing
 * made.
 */
export function requestedKindFor(
  formatMatch: SchedulableInstrumentType | null,
  recordedPreference: readonly SchedulableInstrumentType[],
): SchedulableInstrumentType | null {
  if (formatMatch !== null) return formatMatch;
  return recordedPreference[0] ?? null;
}
