/**
 * The meaning path (C1.3, P1-T02) — lossy by design.
 *
 * `readScalar`, `readList`, and `readWikilinks` interpret a value for
 * consumers like F1.4's `topic` extraction. They are best-effort: a value
 * shape this module declines to interpret yields empty results, not an
 * error (see `InterpretedValue`'s doc in ./types.ts).
 *
 * **Never feed this output back into serialisation.** Round-tripping through
 * these readers and back into a value string is exactly how a hand-rolled
 * parser grows a YAML library's silent-corruption bugs by the back door —
 * the whole reason this module exists is to keep "read for meaning" and
 * "write for bytes" (./parse.ts, ./serialize.ts) from ever touching.
 */

import type { Frontmatter, InterpretedValue } from './types.js';

const EMPTY: InterpretedValue = { scalar: '', items: [], wikilinks: [] };

/**
 * Finds every `[[...]]` pair in raw text by scanning, not by parsing the
 * value as a data structure. The capture excludes `[` and `]` so a nested
 * flow-list corruption like `[[[Imbrication]], [[Threshold
 * potential]]]` — PyYAML's silent-mangling shape (see ./types.ts) — still
 * yields the two intended links rather than swallowing the flow list's
 * extra outer bracket into the first link's name. This is the one place in
 * the module where getting the regex wrong reproduces the exact bug this
 * whole engine exists to avoid; see the P1-T02 report for the worked
 * example.
 *
 * **Exported** (`ol-2zfj.33`, F1.3's widened course-reference rule) so
 * `../concept/extract.js` can scan a note's *body* text for wikilinks the
 * same way this module already scans a frontmatter value — one regex, two
 * callers, rather than a second copy of it growing up beside this one. A
 * body wikilink can carry a pipe alias or a heading anchor
 * (`[[Target|shown as]]`, `[[Target#Heading]]`) that a frontmatter value
 * never does; this function still returns the raw capture unstripped, same
 * as always, and it is the caller's job to normalise that when the target
 * half is what matters.
 */
export function extractWikilinks(raw: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^[\]]+)\]\]/g;
  for (const match of raw.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) links.push(name);
  }
  return links;
}

/**
 * The link target of a value that is *entirely* one wikilink, or `undefined`
 * for anything else — a bare string, prose that merely contains a link, or a
 * value carrying two links.
 *
 * This is the per-item counterpart to `readWikilinks`, for call sites that
 * read a list through `readList` and then need each item interpreted as
 * either "a pointer at a note" or "a name written out". Deliberately strict:
 * the whole trimmed value must be the link, so a value that only *mentions* a
 * note keeps its verbatim text and is never silently replaced by the target
 * (`ol-aq2p`; R1/R2). It shares `extractWikilinks` with the readers above
 * rather than restating that regex — see its doc for why there is exactly one
 * copy of it in this package.
 */
export function wikilinkTarget(value: string): string | undefined {
  const trimmed = value.trim();
  const links = extractWikilinks(trimmed);
  const only = links.length === 1 ? links[0] : undefined;
  return only !== undefined && trimmed === `[[${only}]]` ? only : undefined;
}

/** Strips one layer of matching quotes, if the whole trimmed string has them. Best-effort; no un-escaping. */
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function findValueRaw(fm: Frontmatter, key: string): string | undefined {
  const entry = fm.nodes.find((node) => node.kind === 'entry' && node.key === key);
  return entry?.kind === 'entry' ? entry.valueRaw : undefined;
}

/** A block-list line: optional indent, `-`, then the item text. */
const BLOCK_ITEM_RE = /^[ \t]*-[ \t]+(.*)$/;

/**
 * Every block-list item (`- item` continuation line) in a raw value, each
 * with its own dash marker stripped and one layer of quoting removed —
 * the same per-item interpretation `readList` applies. Empty when the value
 * has no block-list shape at all (a bare scalar, a flow list, ...).
 */
function blockListItems(valueRaw: string): string[] {
  return valueRaw
    .split('\n')
    .map((line) => BLOCK_ITEM_RE.exec(line.replace(/\r$/, '')))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => unquote((m[1] ?? '').trim()));
}

/**
 * Interprets a value as a single scalar: trims surrounding whitespace and
 * one layer of quoting. `items` is `[scalar]` when non-empty, else `[]`.
 * `wikilinks` is scanned independently of the scalar/quote interpretation.
 *
 * **A one-item block list reads as its single scalar value** (`ol-j9c8`): a
 * single-valued field authored as
 * ```
 * course:
 *   - GEOL204
 * ```
 * reads as `GEOL204`, not `- GEOL204` — the leading dash is `readList`'s
 * marker for a genuinely multi-valued field, not part of a single-valued
 * field's content, so it is stripped here the same way a plain scalar's
 * quoting is. A block list with more than one item is a shape this reader
 * was never meant to collapse into one value (that ambiguity is `readList`'s
 * to resolve, not this function's), so it falls through unchanged to the
 * plain trim-and-unquote path below, same as before this fix.
 */
export function readScalar(fm: Frontmatter, key: string): InterpretedValue {
  const valueRaw = findValueRaw(fm, key);
  if (valueRaw === undefined) return EMPTY;

  const items = blockListItems(valueRaw);
  if (items.length === 1) {
    const scalar = items[0] ?? '';
    return { scalar, items: scalar === '' ? [] : [scalar], wikilinks: extractWikilinks(valueRaw) };
  }

  const scalar = unquote(valueRaw.trim());
  return { scalar, items: scalar === '' ? [] : [scalar], wikilinks: extractWikilinks(valueRaw) };
}

/**
 * Interprets a value as a list, trying the shapes her vault actually uses,
 * in order: a block list (`- item` continuation lines), a bare
 * space-separated run of wikilinks (`[[A]] [[B]]` — the shape a YAML
 * library can't even parse), a flow list (`[a, b]`), or else a single bare
 * scalar treated as a one-item list. `wikilinks` is scanned independently
 * and is always complete regardless of which shape `items` used.
 */
export function readList(fm: Frontmatter, key: string): InterpretedValue {
  const valueRaw = findValueRaw(fm, key);
  if (valueRaw === undefined) return EMPTY;

  const wikilinks = extractWikilinks(valueRaw);
  const trimmed = valueRaw.trim();
  if (trimmed === '') return { scalar: '', items: [], wikilinks };

  const blockItems = blockListItems(valueRaw);
  if (blockItems.length > 0) {
    return { scalar: trimmed, items: blockItems, wikilinks };
  }

  // Bare space-separated wikilinks, no enclosing flow-list brackets of
  // their own — e.g. `[[Imbrication]] [[Hummocky stratification]]`.
  // Detected as: the whole trimmed value is nothing but `[[...]]` tokens
  // and whitespace between them.
  if (/^(\[\[[^[\]]+\]\]\s*)+$/.test(trimmed)) {
    return { scalar: trimmed, items: wikilinks.slice(), wikilinks };
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const items =
      inner.trim() === ''
        ? []
        : inner
            .split(',')
            .map((piece) => unquote(piece.trim()))
            .filter((piece) => piece !== '');
    return { scalar: trimmed, items, wikilinks };
  }

  const scalar = unquote(trimmed);
  return { scalar, items: scalar === '' ? [] : [scalar], wikilinks };
}

/**
 * Interprets a value purely as a set of wikilinks, ignoring everything else
 * about its shape. `scalar` and `items` both echo the same wikilink list —
 * this reader exists for call sites that only care about `[[...]]` targets
 * and don't want to think about quoting or list style at all.
 */
export function readWikilinks(fm: Frontmatter, key: string): InterpretedValue {
  const valueRaw = findValueRaw(fm, key);
  if (valueRaw === undefined) return EMPTY;

  const wikilinks = extractWikilinks(valueRaw);
  return { scalar: wikilinks.join(', '), items: wikilinks, wikilinks };
}
