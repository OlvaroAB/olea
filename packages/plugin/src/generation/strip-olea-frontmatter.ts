/**
 * Shared by every client path that puts her note text into a model request
 * (`routing.ts`, `revision-job-runner.ts`, `corpusRelationSignals.ts`;
 * `ol-egov.141.89.2.32`), and by the one reader that must leave Olea's own
 * frontmatter writes out of a note's material (`stripOleaFrontmatterWrites`,
 * `[D-626]`, `ol-egov.141.89.2.39`).
 */
import { parseDocument, parseFrontmatter } from 'olea-core';
import { stripInstrumentSpans } from '../ingestion/materiality/citation-material.js';
import { HOME_NOTE_TOPIC_KEY, isOleaHomeNote } from './home-note.js';

/** Olea's own frontmatter keys (`olea-uid`, `olea-cloze-ids`, ...) — her notes' stamps, never her words. */
const OLEA_OWN_KEY = /^olea-/;

/**
 * The note's text with Olea's own `olea-*` frontmatter entries removed, so
 * the stamp block never travels inside a passage (`ol-egov.141.89.2.32`).
 * Her own keys and body stay byte-for-byte; a frontmatter block holding
 * nothing but Olea's keys goes whole. Removal is the existing
 * `stripInstrumentSpans` over the entries' spans — no second stripper.
 */
export function stripOleaFrontmatter(source: string): string {
  return stripFrontmatterEntries(source, (key) => OLEA_OWN_KEY.test(key));
}

/**
 * `[D-626]` (`ol-egov.141.89.2.39`): the note's text without the frontmatter writes Olea makes
 * itself, for the material a whole-note comparison reads (a drafted item's input-note fingerprint,
 * `input-notes.ts`, and the cited note's whole-note check at presentation and in the citation pass).
 * Those writes are exactly:
 *  - Olea's own `olea-*` entries, wherever they stand (the first-sight stamps `olea-uid` and
 *    `olea-cloze-ids`, and in a home note `olea-home-note` and the `olea-drafted-for` record): the
 *    same predicate {@link stripOleaFrontmatter} applies to every model request;
 *  - in one of Olea's own home notes (`isOleaHomeNote`, the predicate `main.ts` reads to tell a
 *    home-note write from a change to her material), the `topic:` list it grows
 *    (`home-note.ts`'s `ensureTopicIncludes`, through `HOME_NOTE_TOPIC_KEY`).
 * Her own frontmatter stays in, byte for byte, as does every body line. A note with no such entry is
 * returned unchanged.
 */
export function stripOleaFrontmatterWrites(source: string): string {
  const homeNote = isOleaHomeNote(source);
  return stripFrontmatterEntries(
    source,
    (key) => OLEA_OWN_KEY.test(key) || (homeNote && key === HOME_NOTE_TOPIC_KEY),
  );
}

/** `source` with every frontmatter entry `drop` names removed — see {@link stripOleaFrontmatter}. */
function stripFrontmatterEntries(source: string, drop: (key: string) => boolean): string {
  const block = parseDocument(source).blocks[0];
  if (block?.kind !== 'frontmatter') return source;
  const nodes = parseFrontmatter(block.inner).nodes;
  const dropped = nodes.filter((n) => n.kind === 'entry' && drop(n.key));
  if (dropped.length === 0) return source;
  const onlyDropped = nodes.every(
    (n) => (n.kind === 'entry' && drop(n.key)) || n.raw.trim() === '',
  );
  if (onlyDropped) return stripInstrumentSpans(source, [{ start: block.start, end: block.end }]);
  let offset = block.start + block.raw.indexOf('\n') + 1;
  const spans = [];
  for (const node of nodes) {
    if (node.kind === 'entry' && drop(node.key)) {
      spans.push({ start: offset, end: offset + node.raw.length });
    }
    offset += node.raw.length;
  }
  return stripInstrumentSpans(source, spans);
}
