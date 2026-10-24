/**
 * The paper-origin side record for a handed-off flashcard (`[D-407]`, `ol-egov.141.89.7.114`;
 * David's ruling on decision sheet v87, row 5, 2026-10-24: "Add flashcards with their
 * paper-and-slot origin in the side record").
 *
 * **Why a side record, and only for a card.** A quiz item handed off from a practice paper carries
 * its paper and slot on its own block, in the `paper-origin:` field (`./mcq-format.ts`,
 * `McqInstrument.paperOrigin`). A Q&A card has no such line: its format is the spaced-repetition
 * plugin's plain text (`./card-format.ts`'s module doc, C5.3), which has no field mechanism, and a
 * line added to the card would become part of its front or back. So a card's origin is kept here,
 * under `.olea`, keyed by the card's instrument id, the way its passage citation already is
 * (`./citation-store.ts`, `[D-181]`): never as text written into her notes (INV-6). A quiz block
 * keeps its own field and never gets a record here.
 *
 * **Shape and addressing mirror `./citation-store.ts`:** one schema-versioned JSON file per
 * instrument, named by the percent-encoded instrument id, read and written through `VaultSource`,
 * with a hand-rolled runtime guard. The record holds the two ids and nothing of her content.
 *
 * **Write-once.** An origin is fixed at the hand-off and never changes. A second write of the same
 * origin for the same id is a no-op, so a retried hand-off converges; a write naming a different
 * paper or slot for an id that already has a record throws, and the file is left as it was.
 *
 * **Removed only by the hand-off that wrote it** (`removeInstrumentPaperOrigin`): a hand-off that
 * fails after writing the record and before its card reaches the note takes the record back out, so
 * a failed add leaves no orphan origin record (the ruling's own words). The full delete (F7.4)
 * removes the folder with the rest of Olea's layer (`packages/plugin/src/privacy/log-discovery.ts`).
 *
 * **Reachability (`[D-072]`).** Written by `../oracle/paper-store.ts`'s `handOffPaperItem` for a
 * `cards.generate.v1` item, from the paper view's per-item control. `readInstrumentPaperOrigin`
 * has no production reader yet, and neither does the quiz block's own field: the review record's
 * `origin` (`[D-367]`) is not yet threaded from an entered instrument (see
 * `../review-log/write.ts`'s "Reachability of the origin").
 */

import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, a sibling of `.olea/citations/`. */
export const PAPER_ORIGIN_STORE_FOLDER: VaultPath = '.olea/paper-origins';

/** Bumped only on a breaking change to the record shape. */
export const PAPER_ORIGIN_RECORD_SCHEMA_VERSION = 1;

/** The paper (`PaperRecord.id`) and slot (`PaperGeneratedItem.slotId`) a handed-off card came from. */
export interface InstrumentPaperOrigin {
  readonly paperId: string;
  readonly slotId: string;
}

/** One record under `.olea/paper-origins/`. */
export interface PaperOriginRecord extends InstrumentPaperOrigin {
  readonly schemaVersion: number;
  readonly instrumentId: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation, in `./citation-store.ts`'s hand-rolled-guard style. */
export function isPaperOriginRecord(value: unknown): value is PaperOriginRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    isNonEmptyString(v.instrumentId) &&
    isNonEmptyString(v.paperId) &&
    isNonEmptyString(v.slotId)
  );
}

/** The vault path for one instrument's origin record (percent-encoded, as `citationStorePath`). */
export function paperOriginStorePath(instrumentId: string): VaultPath {
  return `${PAPER_ORIGIN_STORE_FOLDER}/${encodeURIComponent(instrumentId)}.json`;
}

function serialize(record: PaperOriginRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Reads one instrument's origin by id. Never throws: an absent, unreadable or malformed file, and a
 * file whose `instrumentId` is not the one asked for, all read `undefined` (the posture
 * `readInstrumentCitation` takes, so one corrupt file never stops a reader of the others).
 */
export async function readInstrumentPaperOrigin(
  vault: VaultSource,
  instrumentId: string,
): Promise<InstrumentPaperOrigin | undefined> {
  if (instrumentId.length === 0) return undefined;
  const path = paperOriginStorePath(instrumentId);
  try {
    if (!(await vault.exists(path))) return undefined;
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isPaperOriginRecord(parsed) && parsed.instrumentId === instrumentId) {
      return { paperId: parsed.paperId, slotId: parsed.slotId };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes one instrument's origin, write-once (module doc). Returns `true` when this call wrote the
 * file and `false` when a record of the same origin was already there. Throws, writing nothing,
 * when the origin's ids are blank or carry whitespace, or when a file already sits at the path that
 * is not a record of this same origin.
 */
export async function writeInstrumentPaperOrigin(
  vault: VaultSource,
  instrumentId: string,
  origin: InstrumentPaperOrigin,
): Promise<boolean> {
  for (const [name, id] of [
    ['instrumentId', instrumentId],
    ['paperId', origin.paperId],
    ['slotId', origin.slotId],
  ] as const) {
    if (id === '' || (name !== 'instrumentId' && /\s/.test(id))) {
      throw new Error(
        `writeInstrumentPaperOrigin: ${name} must be non-empty${name === 'instrumentId' ? '' : ' and contain no whitespace'}`,
      );
    }
  }
  const path = paperOriginStorePath(instrumentId);
  if (await vault.exists(path)) {
    const existing = await readInstrumentPaperOrigin(vault, instrumentId);
    if (existing?.paperId === origin.paperId && existing.slotId === origin.slotId) return false;
    throw new Error(
      `writeInstrumentPaperOrigin: instrument id ${JSON.stringify(instrumentId)} already has a different or unreadable origin record — refusing to overwrite it`,
    );
  }
  const record: PaperOriginRecord = {
    schemaVersion: PAPER_ORIGIN_RECORD_SCHEMA_VERSION,
    instrumentId,
    paperId: origin.paperId,
    slotId: origin.slotId,
  };
  await vault.write(path, serialize(record));
  return true;
}

/**
 * Takes back one instrument's origin record: called only by the hand-off that wrote it, when that
 * hand-off fails before its card reaches the note (module doc). Removes the file only when it is a
 * record of this same origin, so a record some other call wrote is never touched. Throws when the
 * host cannot delete (`VaultSource.delete` is optional; a missing delete must not be skipped
 * silently, `../vault/types.ts`).
 */
export async function removeInstrumentPaperOrigin(
  vault: VaultSource,
  instrumentId: string,
  origin: InstrumentPaperOrigin,
): Promise<void> {
  if (vault.delete === undefined) {
    throw new Error('removeInstrumentPaperOrigin: this vault cannot delete files');
  }
  const existing = await readInstrumentPaperOrigin(vault, instrumentId);
  if (existing?.paperId !== origin.paperId || existing.slotId !== origin.slotId) return;
  await vault.delete(paperOriginStorePath(instrumentId));
}
