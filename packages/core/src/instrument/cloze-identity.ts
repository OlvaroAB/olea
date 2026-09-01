/**
 * Cloze identity, the case D-030 (`ol-5qjz`) left open and D-107 (`ol-k5b1`)
 * ruled on: **stamped identity via a per-note frontmatter map**, since a
 * cloze *is* her line and cannot carry a visible `^blockid` the way an MCQ
 * (`mcq-format.ts`'s `stampMcqId`) or a Q&A card (`card-format.ts`'s
 * `stampQaCardBlockId`) can without breaking C5.3's stays-readable-and-
 * editable property.
 *
 * `../frontmatter/map.ts` (`ol-hij4`) built the read/parse/append layer this
 * module is the first production consumer of. This module owns exactly one
 * thing beyond calling it: the **map key**, which has to identify one cloze
 * among however many share a note without touching the cloze's own line.
 *
 * ## The key, and what it does and does not fix
 *
 * The key is `<root>#<anchor>#<ordinal>` — the same three components
 * `../session/instrument-id.ts`'s `provisionalInstrumentId` already uses for
 * every instrument type (root = `olea-uid` or path; anchor = nearest heading,
 * since a cloze has no block id to prefer; ordinal = position within that
 * anchor). This is a **deliberate mirror, not a second scheme** — see that
 * module's doc for the full rule and `escapeComponent`'s reversibility
 * argument, reproduced locally below because `session/` is a different
 * bead's `owns` and this module must not edit it to import a private helper.
 * Unifying the two into one shared implementation is flagged as follow-up
 * work for whichever lane next touches `session/instrument-id.ts`.
 *
 * **What stamping buys, honestly stated rather than oversold.** Once a key
 * is minted, `appendFrontmatterMapEntry`'s read-then-mint guard means the
 * *value* behind it is data, never recomputed — the same property MCQ and
 * Q&A get. What it does **not** buy, because the key itself is still
 * position-derived: a heading rename, or inserting a second cloze above an
 * existing one under the *same* heading, still changes the key and therefore
 * still orphans the old entry — structurally the same gap `../session/
 * instrument-id.ts`'s module doc names for cloze under the pre-D-107 rule.
 * D-030's stated reason stamping exists at all (a heading rename must not
 * silently hand one instrument's history to another) is **not** closed by
 * this module for cloze; it is closed only for MCQ and Q&A, whose anchors
 * are things that can carry a durable marker. Closing it for cloze needs a
 * body-side marker of some kind, which is exactly the option this module's
 * own decision record (see `ol-k7eg`'s bead notes) found does not have a
 * drop-in answer yet. Flagging this here rather than silently presenting a
 * frontmatter key as a full fix is the point of this paragraph existing.
 */

import { parseDocument } from '../block/parse.js';
import type { FrontmatterBlock } from '../block/types.js';
import type { AppendFrontmatterMapResult } from '../frontmatter/map.js';
import { appendFrontmatterMapEntry, getFrontmatterMapValue } from '../frontmatter/map.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import type { VaultPath } from '../vault/types.js';

/** The frontmatter key every cloze id in a note lives under (D-107's shape). */
export const CLOZE_ID_FRONTMATTER_KEY = 'olea-cloze-ids';

/** Where a cloze sits, as far as identity is concerned — no block id, no explicit id; a cloze has neither. */
export interface ClozeIdAnchor {
  /** The note's `olea-uid` frontmatter value, or `null` when it carries none. */
  readonly noteUid: string | null;
  /** Vault-relative path of the note. The root when there is no `olea-uid`. */
  readonly notePath: VaultPath;
  /** Text of the nearest heading above the cloze, or `null` when there is none. */
  readonly heading: string | null;
  /** 1-based position within this anchor, in source order — never within the note (see module doc). */
  readonly ordinal: number;
}

/**
 * Percent-escapes the three characters the key format uses as structure,
 * plus `%` itself so the escaping is reversible. Mirrors `../session/
 * instrument-id.ts`'s private `escapeComponent` exactly — see this module's
 * doc for why it is reproduced rather than imported.
 */
function escapeComponent(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A').replace(/#/g, '%23');
}

/** `h:<heading>` where there is a heading, `-` otherwise — a cloze never has a block id. */
function anchorComponent(anchor: ClozeIdAnchor): string {
  if (anchor.heading !== null && anchor.heading !== '')
    return `h${escapeComponent(anchor.heading)}`;
  return '-';
}

/**
 * The frontmatter map key for one cloze anchor. Pure, total, and stable
 * across a run that reads the same bytes twice — but see the module doc for
 * what it does not survive.
 */
export function clozeMapKey(anchor: ClozeIdAnchor): string {
  const root = escapeComponent(
    anchor.noteUid !== null && anchor.noteUid !== '' ? anchor.noteUid : anchor.notePath,
  );
  // `../frontmatter/map.ts`'s `appendMapEntry` rejects a literal `:` anywhere
  // in a map key (it is the `key: value` line's own delimiter), unlike
  // `../session/instrument-id.ts`'s id strings, which use `:` freely because
  // they are never themselves a frontmatter map key. `#` separates every
  // component here instead — already escaped out of both `root` and
  // `anchorComponent`'s output, so it stays unambiguous as structure.
  return `${root}#${anchorComponent(anchor)}#${String(anchor.ordinal)}`;
}

/**
 * Reads a cloze's id from the note's frontmatter map, without writing
 * anything — the read half, callable before any stamp exists. Returns
 * `undefined` when this anchor has never been stamped.
 */
export function readClozeId(content: string, anchor: ClozeIdAnchor): string | undefined {
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  const fmBlock: FrontmatterBlock | undefined = first?.kind === 'frontmatter' ? first : undefined;
  if (!fmBlock) return undefined;
  const fm = parseFrontmatter(fmBlock.inner);
  return getFrontmatterMapValue(fm, CLOZE_ID_FRONTMATTER_KEY, clozeMapKey(anchor));
}

/**
 * Stamps a cloze's id into the note's frontmatter map, once. Idempotent:
 * `appendFrontmatterMapEntry`'s read-then-mint guard means `mintId()` is
 * only ever consulted when this anchor has no existing entry, and even then
 * only its return value is used — the guard never re-derives from the
 * anchor once a value is present. `mintId` is a caller-supplied generator
 * (never a position-derived string) precisely so an id, once minted, is
 * opaque data rather than a second computation the anchor could regenerate.
 */
export function stampClozeId(
  content: string,
  anchor: ClozeIdAnchor,
  mintId: () => string,
): AppendFrontmatterMapResult {
  const existing = readClozeId(content, anchor);
  const candidate = existing ?? mintId();
  return appendFrontmatterMapEntry(
    content,
    CLOZE_ID_FRONTMATTER_KEY,
    clozeMapKey(anchor),
    candidate,
  );
}
