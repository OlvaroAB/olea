/**
 * `stripInstrumentSpans` — the one string operation `citation-revision-
 * wiring.ts` needs to turn a note's raw source into "the material her
 * instruments cite," per `citation-hash-store.ts`'s module doc: a note's
 * text with every instrument block's own span removed, so an instrument's
 * OWN wording never counts as a change to the passage it cites.
 *
 * Pure and total — no vault access, no parsing beyond the spans it is
 * handed. `enumerateVaultInstruments` (olea-core) already parsed the note
 * once to produce those spans; this never re-parses.
 */

import type { SourceSpan } from 'olea-core';

/**
 * Removes every span in `spans` from `source`, concatenating what remains in
 * source order. Overlapping or out-of-order spans are tolerated (sorted and
 * clamped here) since two instrument parsers (`parseCards`/`parseMcqBlocks`)
 * produce them independently.
 */
export function stripInstrumentSpans(source: string, spans: readonly SourceSpan[]): string {
  if (spans.length === 0) return source;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const span of sorted) {
    if (span.start > cursor) result += source.slice(cursor, span.start);
    if (span.end > cursor) cursor = span.end;
  }
  if (cursor < source.length) result += source.slice(cursor);
  return result;
}
