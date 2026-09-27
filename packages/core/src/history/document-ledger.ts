/**
 * Shape 2a — **what Olea did with this file** (`[D-102]`, `ol-0r92.53`).
 *
 * A pure fold over review-log entries, joined to the caller's
 * instrument-location index (`./types.ts`'s `InstrumentLocations`), because
 * the log itself names no document. Read-only: no I/O, no writes, no cache.
 *
 * ## What this shape can and cannot say, stated rather than implied
 *
 * Derivable from the log, and rendered by this fold: an instrument answered
 * (`review`), a drafted instrument accepted / edited / rejected (`verdict`),
 * an instrument replaced by a revised one with its history kept
 * (`succession`), an instrument suspended or unsuspended (`suspend`), a
 * reading contested (`dispute`), a misconception seen again
 * (`misconception-observed`), an explain-back offered or declined
 * (`explain-back-offered` / `explain-back-declined`), a retrospective offered
 * (`retrospective-*`).
 *
 * **Not derivable, and therefore not emitted:** the document being registered
 * under a course and week, concepts being found in it, drafts being generated
 * from it, a re-read after her edit, a link offered into one of her own notes.
 * Those are ingestion- and generation-time facts and there is no append-only
 * log carrying them — the ingestion queue (`../ingestion/types.ts`'s
 * `PersistedQueue`) is mutable working state, not history, and it is keyed by
 * content hash with a display-only label. A document with no instruments
 * therefore yields an **empty ledger**, which is the honest rendering of the
 * drawn shape's nothing-happened state and not the same sentence it draws.
 * Closing that gap is a schema question and sits on the ratifying decision
 * bead.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { DocumentLedger, DocumentLedgerRow, InstrumentLocations } from './types.js';

/**
 * The instrument an entry is about, or `null` for an entry that names none.
 *
 * `succession` names two: the row is attributed to the **successor**, because
 * that is the instrument that now lives in the note, and the predecessor's own
 * earlier rows already stand on their own dates.
 */
export function ledgerInstrumentId(entry: ReviewLogEntry): string | null {
  switch (entry.kind) {
    case 'review':
    case 'verdict':
    case 'misconception-observed':
    case 'suspend':
    case 'unsuspend':
      return entry.instrumentId;
    case 'succession':
      return entry.successorInstrumentId;
    case 'dispute':
    case 'explain-back-offered':
    case 'explain-back-declined':
      return entry.instrumentId ?? null;
    case 'retrospective-offered':
    case 'retrospective-opened':
    case 'retrospective-dismissed':
      // Named by `assessmentPath`, never by an instrument — attributed to its
      // document directly by `documentPathOf` below rather than through the
      // location index.
      return null;
    default:
      return null;
  }
}

/**
 * The note an entry belongs to, or `null` when the log cannot say.
 *
 * Two routes, and only two: an instrument, resolved through the caller's
 * location index; or a `retrospective-*` record's own `assessmentPath`, which
 * names a document in the log itself and needs no join. Nothing is inferred
 * from a concept id — a concept spans documents, so attributing a
 * concept-level event to one note would be a guess, and this fold does not
 * guess.
 */
export function documentPathOf(
  entry: ReviewLogEntry,
  locations: InstrumentLocations,
):
  | { readonly path: string; readonly instrumentId: string | null }
  | { readonly unlocated: string }
  | null {
  if (
    entry.kind === 'retrospective-offered' ||
    entry.kind === 'retrospective-opened' ||
    entry.kind === 'retrospective-dismissed'
  ) {
    return { path: entry.assessmentPath, instrumentId: null };
  }
  const instrumentId = ledgerInstrumentId(entry);
  if (instrumentId === null) return null;
  const located = locations.get(instrumentId);
  if (located === undefined) return { unlocated: instrumentId };
  return { path: located, instrumentId };
}

/**
 * A verdict row is a **deliberate restore** (`[D-396]`, `ol-v7r5.101` follow-up) when it is an
 * `accepted` verdict naming a prior rejection in `restores` — a fact this fold's own module doc
 * did not yet distinguish from a plain accept/edit when it was written. `foldDocumentLedger`
 * above does not itself render prose (this file has no production caller yet — `[D-072]`; see the
 * module doc's "not derivable" list), so there is nothing here to test against a rendered string;
 * this predicate exists so the FACT a future ledger view needs is derived once, in the one place
 * that already reads `ReviewLogEntry` shapes, rather than re-guessed per consumer.
 *
 * **Wording — Class B, proposed, not ratified (flag for David's review).** A future ledger row
 * for this case should read as a plain past-tense fact — for example "A rejection was lifted, and
 * this instrument returned to circulation" — never the bare noun *Restored* alone: that word is
 * already `[D-197]`'s ratified verb for F8.5's withdraw/restore PRUNING (a different mechanism —
 * circulation, not evidence validity), and reusing it bare for this different fact would be
 * exactly the "a listed word in another sense" conflict the vocabulary registry's authority order
 * flags (`docs/Olea_vocabulary_registry.md`'s own "Pruning" entry names `Restore` as pruning's
 * shown verb). `[D-396]`'s own registry §23 sibling entry is worded "restore it" for the LIVE
 * action (`./copy.ts`'s `WITHHELD_RESTORE_ACTION`, `ol-v7r5.93`) — the same verb is fine THERE
 * because it names the identical mechanism from its own live surface; a HISTORY row naming the
 * same fact after it happened is a different sentence shape and should not collapse to the same
 * bare word `[D-197]` already claims. `check:vocabulary`'s own word lists do not yet name a
 * conflict for this exact phrase, so it passes today; ratifying the exact sentence, whenever a
 * ledger view is built, is a copy pass's to make, not this fold's.
 */
export function isDocumentLedgerRestore(entry: ReviewLogEntry): boolean {
  return entry.kind === 'verdict' && entry.verdict === 'accepted' && entry.restores !== undefined;
}

/** Newest first, tie-broken by descending `eventId` so the order is device-independent. */
function byNewestFirst(a: DocumentLedgerRow, b: DocumentLedgerRow): number {
  const left = Date.parse(a.timestamp);
  const right = Date.parse(b.timestamp);
  if (left !== right) return right - left;
  return a.eventId < b.eventId ? 1 : a.eventId > b.eventId ? -1 : 0;
}

/**
 * Every log entry that belongs to `notePath`, newest first.
 *
 * `locations` maps `instrumentId` -> note path; build it from
 * `enumerateVaultInstruments`' `notePath`. An entry whose instrument is not in
 * the index contributes no row and is reported in `unlocated` — see
 * `./types.ts` for why that is reported rather than dropped.
 */
export function foldDocumentLedger(
  entries: readonly ReviewLogEntry[],
  notePath: string,
  locations: InstrumentLocations,
): DocumentLedger {
  const rows: DocumentLedgerRow[] = [];
  const instrumentIds = new Set<string>();
  const unlocated = new Set<string>();

  for (const entry of entries) {
    const resolved = documentPathOf(entry, locations);
    if (resolved === null) continue;
    if ('unlocated' in resolved) {
      unlocated.add(resolved.unlocated);
      continue;
    }
    if (resolved.path !== notePath) continue;
    if (resolved.instrumentId !== null) instrumentIds.add(resolved.instrumentId);
    rows.push({
      eventId: entry.eventId,
      timestamp: entry.timestamp,
      instrumentId: resolved.instrumentId,
      entry,
    });
  }

  rows.sort(byNewestFirst);
  return {
    notePath,
    rows,
    instrumentIds: [...instrumentIds].sort(),
    unlocated: [...unlocated].sort(),
  };
}
