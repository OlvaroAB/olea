/**
 * Shared by every client path that puts her note text into a model request
 * (`routing.ts`, `revision-job-runner.ts`, `corpusRelationSignals.ts`;
 * `ol-egov.141.89.2.32`).
 */
import { parseDocument, parseFrontmatter } from 'olea-core';
import { stripInstrumentSpans } from '../ingestion/materiality/citation-material.js';

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
  const block = parseDocument(source).blocks[0];
  if (block?.kind !== 'frontmatter') return source;
  const nodes = parseFrontmatter(block.inner).nodes;
  const ownEntries = nodes.filter((n) => n.kind === 'entry' && OLEA_OWN_KEY.test(n.key));
  if (ownEntries.length === 0) return source;
  const onlyOwn = nodes.every(
    (n) => (n.kind === 'entry' && OLEA_OWN_KEY.test(n.key)) || n.raw.trim() === '',
  );
  if (onlyOwn) return stripInstrumentSpans(source, [{ start: block.start, end: block.end }]);
  let offset = block.start + block.raw.indexOf('\n') + 1;
  const spans = [];
  for (const node of nodes) {
    if (node.kind === 'entry' && OLEA_OWN_KEY.test(node.key)) {
      spans.push({ start: offset, end: offset + node.raw.length });
    }
    offset += node.raw.length;
  }
  return stripInstrumentSpans(source, spans);
}
