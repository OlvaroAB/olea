/**
 * The accept/edit/reject verdict **projection** (`ol-548w`, INV-6, C5.4).
 *
 * INV-6 requires an accept step before anything AI-generated lands in her
 * vault; before this, the step left no trace once acted on. `VerdictLogRecord`
 * (`./write.ts`'s `appendVerdictRecord`) is the durable half — this module is
 * the read half, the same split `./suspension.ts` uses for suspend/unsuspend:
 * there is no stored "verdict summary" anywhere, only the append-only log and
 * a fold over it.
 */

import type { ReviewLogEntry, VerdictLogRecord } from 'olea-contracts';

/** Narrows a mixed `ReviewLogEntry[]` down to the verdict lines, in file order. */
export function reviewLogVerdicts(entries: readonly ReviewLogEntry[]): readonly VerdictLogRecord[] {
  return entries.filter((entry): entry is VerdictLogRecord => entry.kind === 'verdict');
}

/**
 * `instrumentId` -> its most recent verdict, resolved the same way
 * `./suspension.ts` resolves "most recent" — by `(timestamp instant,
 * eventId)`, never by array position, so the answer does not depend on which
 * device's file a caller happened to read first.
 *
 * An instrument re-drafted after a reject gets a **new** `instrumentId`
 * (`./write.ts`'s doc: re-drafting is a new instrument with its own future
 * verdict, never a revision of this one), so this map never has to choose
 * between two verdicts about "the same" artifact — there is no such case.
 */
export function latestVerdictByInstrument(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, VerdictLogRecord> {
  const latest = new Map<string, { instant: number; record: VerdictLogRecord }>();

  for (const record of reviewLogVerdicts(entries)) {
    const instant = Date.parse(record.timestamp);
    const prior = latest.get(record.instrumentId);
    const isLater =
      prior === undefined ||
      instant > prior.instant ||
      (instant === prior.instant && record.eventId > prior.record.eventId);
    if (!isLater) continue;
    latest.set(record.instrumentId, { instant, record });
  }

  const result = new Map<string, VerdictLogRecord>();
  for (const [instrumentId, { record }] of latest) result.set(instrumentId, record);
  return result;
}
