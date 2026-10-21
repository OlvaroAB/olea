/**
 * `stripInstrumentSpans` — the one string operation `citation-revision-
 * wiring.ts` needs to turn a note's raw source into "the material her
 * instruments cite," per `citation-hash-store.ts`'s module doc: a note's
 * text with every instrument block's own span removed, so an instrument's
 * OWN wording never counts as a change to the passage it cites.
 *
 * `stripInstrumentSpans` is pure and total — no vault access, no parsing
 * beyond the spans it is handed. {@link stripQuestionBlocks}
 * (`ol-egov.141.89.5.113`) parses the note for those spans itself: every
 * question block in it, whether or not it is bound to a course.
 */

import { parseCardsWithInvalid, parseMcqBlocks, type SourceSpan } from 'olea-core';

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

/**
 * `ol-egov.141.89.5.113` (C5.3 as amended by `[D-543]`): the material of a cited note, the whole
 * note, its frontmatter included, minus the question blocks. Every block the two instrument parsers
 * find is stripped (`parseCardsWithInvalid`'s cards and `parseMcqBlocks`'s multiple-choice blocks),
 * whether or not it is bound to a course, the same blocks the session's presentation check strips
 * (`review/open-session.ts`, `citedPassageUnchanged`), so the citation pass and that check read one
 * text. A note with no question block is returned as it is.
 */
export function stripQuestionBlocks(source: string): string {
  return stripInstrumentSpans(source, [
    ...parseCardsWithInvalid(source).cards.map((card) => card.span),
    ...parseMcqBlocks(source).instruments.map((mcq) => mcq.span),
  ]);
}
