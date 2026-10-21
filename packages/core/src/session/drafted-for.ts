/**
 * The concept an item Olea drafted into its own home note was drafted for (`[D-558]`,
 * `ol-egov.141.89.9.100`; built by `ol-egov.141.89.9.99`).
 *
 * ## Why a per-item record
 *
 * Olea's home note keeps ONE `topic:` list, grown by every concept drafted into it (the plugin's
 * `generation/home-note.ts`). Read the way her own notes are read (`./enumerate.ts`: every item in
 * a note takes all of the note's topics, the first as its scored concept per `[D-419]`, and the
 * union of their courses), an item drafted for a concept only course A holds was scored on the
 * note's first topic and served as another course's item whenever the note also listed a concept
 * that course shares. `[D-558]` ruled that each item records the concept it was drafted for, and
 * that enumeration gives the item that concept as its scored concept and that concept's courses as
 * its courses (knowledge model: concept to instrument 1:N, concept to course M:N). An item drafted
 * for a concept A and D share may serve both; one drafted for an A-only concept serves A only.
 *
 * ## The record
 *
 * One frontmatter key on the home note, `olea-drafted-for`, holding a block map from the item's own
 * identity to the drafted-for concept's key (`ConceptRecord.key`, the opaque join key, `[D-088]`):
 *
 * ```
 * olea-drafted-for:
 *   mcq-0123456789abcdef: concept-key1:...
 *   k3x9qa: concept-key1:...
 * ```
 *
 * The map key is the identity the item already carries in the note's bytes: a multiple-choice
 * block's `id:` (`mcq-` plus 16 hex, the materializer's derived id) or a question-and-answer card's
 * `^blockId` (six characters of `[a-z0-9]`). Neither contains a colon, which the map format refuses
 * in a key. It is the same shape, and the same read/append layer (`../frontmatter/map.ts`), as the
 * cloze-id map (`olea-cloze-ids`, `[D-107]`), and an `olea-` key, so the model-request stripper
 * (the plugin's `strip-olea-frontmatter.ts`) and the evidence scope (`../keyword-index/
 * evidence-scope.ts`: a home note's frontmatter is scaffolding) already treat it as Olea's own.
 *
 * ## Olea's own layer only (INV-6, `[D-097]`)
 *
 * Both halves act only on a note carrying the home-note marker (`isHomeNoteDocument`). The writer
 * returns any other note unchanged, so nothing here can write into a note she authored; the reader
 * returns nothing for any other note, so a look-alike key in her own note never rebinds her items.
 * An item she wrote herself, in any note, has no record and keeps today's binding.
 *
 * ## Round trip (INV-2)
 *
 * The writer is `appendFrontmatterMapEntry`: one appended line, every other byte untouched, a
 * byte-identical no-op when the item is already recorded (read-then-mint: a recorded concept is
 * never overwritten). The reader writes nothing.
 *
 * Pure: no vault, no clock.
 */

import { parseDocument } from '../block/parse.js';
import type { ParsedDocument } from '../block/types.js';
import { appendFrontmatterMapEntry, readFrontmatterMap } from '../frontmatter/map.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { isHomeNoteDocument } from '../keyword-index/evidence-scope.js';

/** The home-note frontmatter key the per-item record lives under (`[D-558]`). */
export const DRAFTED_FOR_FRONTMATTER_KEY = 'olea-drafted-for';

/** What identifies an item in a note's bytes, as `./enumerate.ts` parses it. */
export interface DraftedForItem {
  readonly instrumentType: 'qa' | 'cloze' | 'mcq';
  /** A multiple-choice block's `id:` value, or `null`. */
  readonly explicitId: string | null;
  /** A question-and-answer card's block id (without the caret), or `null`. */
  readonly blockId: string | null;
}

const NO_RECORDS: ReadonlyMap<string, string> = new Map();

/**
 * The record's map key for an item: a multiple-choice block's `id:`, a question-and-answer card's
 * block id. `null` when the item carries neither yet, and always for a cloze (Olea drafts none).
 */
export function draftedForItemKey(item: DraftedForItem): string | null {
  const key =
    item.instrumentType === 'mcq'
      ? item.explicitId
      : item.instrumentType === 'qa'
        ? item.blockId
        : null;
  return key === null || key === '' ? null : key;
}

/**
 * Every item's drafted-for concept key in one note, by item key. Empty for a note that is not one
 * of Olea's home notes, and for a home note written before `[D-558]`. A hand-edited duplicate map
 * key reads as its first line, the one the writer would have kept.
 */
export function readDraftedFor(doc: ParsedDocument): ReadonlyMap<string, string> {
  if (!isHomeNoteDocument(doc)) return NO_RECORDS;
  const first = doc.blocks[0];
  if (first?.kind !== 'frontmatter') return NO_RECORDS;
  const entries = readFrontmatterMap(parseFrontmatter(first.inner), DRAFTED_FOR_FRONTMATTER_KEY);
  if (entries.length === 0) return NO_RECORDS;
  const out = new Map<string, string>();
  for (const { key, value } of entries) {
    if (value !== '' && !out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * `content` with the record that the item `itemKey` was drafted for `conceptKey`, appended in the
 * same text the caller is about to write (so the item and its record land in one vault write).
 *
 * Returns `content` unchanged when it is not one of Olea's home notes (INV-6), when the item is
 * already recorded (its first record stands), or when the record cannot be written as a map line
 * (a hand-edited, non-map `olea-drafted-for` entry, or a key the map format refuses). In the last
 * case the item keeps today's binding, exactly as a home note written before `[D-558]` does:
 * failing her accept over Olea's own bookkeeping would cost her the answer, and the item is never
 * lost either way.
 */
export function recordDraftedFor(content: string, itemKey: string, conceptKey: string): string {
  if (!isHomeNoteDocument(parseDocument(content))) return content;
  try {
    return appendFrontmatterMapEntry(content, DRAFTED_FOR_FRONTMATTER_KEY, itemKey, conceptKey)
      .content;
  } catch {
    return content;
  }
}
