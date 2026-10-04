/**
 * The course-evidence scope of a note ([D-491], `ol-egov.141.89.1.90`): which of a note's own
 * bytes may supply course evidence (grounding, sufficiency, concept reading, evidence judging,
 * "explain why"), and which are Olea's own generated layer and may not.
 *
 * Two things are Olea's, and are excluded at SPAN level, never by dropping the file:
 *
 *   - **Instrument spans** — every Q&A card and quiz (MCQ) block the instrument parsers read in the
 *     note, whether it sits in a note she wrote or in an Olea home note. An item's own wording is
 *     Olea's output; letting it come back as the support for an explanation (or as a second
 *     attestation of the source it was written from) closes an evidence loop.
 *   - **Home-note scaffolding** — in a note carrying `olea-home-note: true`, Olea's frontmatter
 *     and the generated orientation paragraph it writes at creation.
 *
 * Everything else in the note is HER text and stays: her lines in a home note, and the lines
 * around an instrument in her own note. A cloze is not excluded here — its `==highlight==` is her
 * own sentence, and the item adds no wording of Olea's — only Q&A and MCQ items are Olea output.
 *
 * Pure and total over a source string; no vault access. `home-note.ts` in the plugin owns the
 * marker key and the orientation text; the two constants below mirror it (core never imports the
 * plugin), and `evidence-scope.spec.ts` pins them against the real home-note shape.
 */

import { parseDocument } from '../block/parse.js';
import type { Block, ParsedDocument } from '../block/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import { parseCardsWithInvalid } from '../instrument/card-format.js';
import { parseMcqBlocks } from '../instrument/mcq-format.js';
import type { SourceSpan } from '../instrument/types.js';

/** Mirrors `plugin/src/generation/home-note.ts`'s `HOME_NOTE_MARKER_KEY`. */
const HOME_NOTE_MARKER_KEY = 'olea-home-note';
/** Mirrors the orientation paragraph `initialHomeNoteContent` writes (the same match `sourceRevisionText` uses). */
const HOME_NOTE_ORIENTATION = /^\*Olea created this note[\s\S]*?\*$/m;

export type GeneratedSpanKind = 'instrument' | 'scaffold';

export interface GeneratedSpan {
  readonly kind: GeneratedSpanKind;
  readonly span: SourceSpan;
}

/** Whether the already-parsed document is an Olea home note (the marker in its frontmatter). */
export function isHomeNoteDocument(doc: ParsedDocument): boolean {
  const first = doc.blocks[0];
  if (first?.kind !== 'frontmatter') return false;
  return readScalar(parseFrontmatter(first.inner), HOME_NOTE_MARKER_KEY).scalar === 'true';
}

/**
 * Every span of `source` that is Olea's generated layer, sorted by start. `doc` must be
 * `parseDocument(source)` (passed so a caller that already parsed does not parse twice).
 */
export function generatedSpans(source: string, doc: ParsedDocument): readonly GeneratedSpan[] {
  const spans: GeneratedSpan[] = [];

  for (const card of parseCardsWithInvalid(source).cards) {
    if (card.type === 'qa') spans.push({ kind: 'instrument', span: card.span });
  }
  for (const mcq of parseMcqBlocks(source).instruments) {
    spans.push({ kind: 'instrument', span: mcq.span });
  }

  if (isHomeNoteDocument(doc)) {
    const first = doc.blocks[0];
    if (first?.kind === 'frontmatter') {
      spans.push({ kind: 'scaffold', span: { start: first.start, end: first.end } });
    }
    const orientation = HOME_NOTE_ORIENTATION.exec(source);
    if (orientation !== null) {
      spans.push({
        kind: 'scaffold',
        span: { start: orientation.index, end: orientation.index + orientation[0].length },
      });
    }
  }

  return spans.sort((a, b) => a.span.start - b.span.start);
}

/** What is left of `block` once every generated span is cut out of it, or `block.raw` untouched when none reaches it. */
function remainderOf(
  block: Block,
  source: string,
  spans: readonly GeneratedSpan[],
): { readonly touched: boolean; readonly text: string } {
  let text = '';
  let cursor = block.start;
  let touched = false;
  for (const { span } of spans) {
    if (span.end <= block.start || span.start >= block.end) continue;
    touched = true;
    const from = Math.max(span.start, block.start);
    if (from > cursor) text += source.slice(cursor, from);
    cursor = Math.max(cursor, Math.min(span.end, block.end));
  }
  if (!touched) return { touched: false, text: block.raw };
  if (cursor < block.end) text += source.slice(cursor, block.end);
  return { touched: true, text };
}

/** A leftover that is only HTML comments and whitespace (an instrument's scheduling comment) says nothing of hers. */
function isOnlyDebris(text: string): boolean {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

/**
 * `block`'s raw text restricted to her own text, or `null` when nothing of hers is left. A block no
 * generated span touches comes back as `block.raw` exactly, so a note with no Olea layer is
 * read byte-for-byte as before.
 */
export function evidenceRawOfBlock(
  block: Block,
  source: string,
  spans: readonly GeneratedSpan[],
): string | null {
  if (spans.length === 0) return block.raw;
  const { touched, text } = remainderOf(block, source, spans);
  if (!touched) return block.raw;
  return isOnlyDebris(text) ? null : text;
}

/** Convenience for a caller that holds only the source: the generated spans of `source`. */
export function generatedSpansOfSource(source: string): readonly GeneratedSpan[] {
  return generatedSpans(source, parseDocument(source));
}
