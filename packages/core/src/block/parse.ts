/**
 * Markdown block parser for Olea's note shapes (P1-T01, C1).
 *
 * Parses *her* shapes, not CommonMark completeness — see ./types.ts and
 * fixtures/vault/README.md for exactly what this does and does not cover.
 * The parser is a single left-to-right scan over lines: every line belongs
 * to exactly one block, blocks are emitted in source order with no gaps and
 * no overlaps, and every block's `raw` is a direct `source.slice(start, end)`
 * — never rebuilt from parsed pieces. That is what makes `isLossless` (see
 * ./types.ts) true by construction rather than by careful bookkeeping.
 */

import type {
  BlankBlock,
  Block,
  CalloutBlock,
  CodeBlock,
  FrontmatterBlock,
  HeadingBlock,
  ListBlock,
  ListItem,
  ParagraphBlock,
  ParsedDocument,
  ThematicBreakBlock,
} from './types.js';

interface LineSpan {
  readonly start: number;
  readonly end: number;
  /** Line text with its trailing line ending (`\n` or `\r\n`) stripped. */
  readonly content: string;
}

/**
 * Splits `source` into line spans covering `[0, source.length)` with no
 * gaps. A CRLF file keeps its `\r` as part of each line's own span (it sits
 * just before the `\n` that ends the span), so slicing `start..end` off the
 * original source always reproduces the exact bytes, `\r` included. A final
 * line with no trailing newline is still emitted, `end === source.length`.
 */
function splitLines(source: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let i = 0;
  while (i < source.length) {
    const nl = source.indexOf('\n', i);
    if (nl === -1) {
      lines.push({ start: i, end: source.length, content: source.slice(i) });
      break;
    }
    const end = nl + 1;
    const contentEnd = nl > i && source[nl - 1] === '\r' ? nl - 1 : nl;
    lines.push({ start: i, end, content: source.slice(i, contentEnd) });
    i = end;
  }
  return lines;
}

// ---- line-level classifiers -----------------------------------------------
// Each returns a parsed shape or null/false; none of them consume input —
// the caller decides how many lines a block spans.

const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const CALLOUT_OPEN_RE = /^[ \t]{0,3}>[ \t]?\[!([^\]]+)\]([+-]?)[ \t]?(.*)$/;
const BLOCKQUOTE_CONT_RE = /^[ \t]{0,3}>/;

function matchFenceOpen(content: string): { fence: string; info: string } | null {
  const m = FENCE_OPEN_RE.exec(content);
  if (!m) return null;
  const fence = m[1] ?? '';
  const info = (m[2] ?? '').trim();
  return { fence, info };
}

/** A closing fence: same character as the opener, at least as long, no info string. */
function isFenceClose(content: string, fence: string): boolean {
  const m = FENCE_OPEN_RE.exec(content);
  if (!m) return false;
  const run = m[1] ?? '';
  const rest = (m[2] ?? '').trim();
  if (rest !== '') return false;
  return run[0] === fence[0] && run.length >= fence.length;
}

/** A `---`/`***`/`___` rule: 3+ of one character, optionally space-separated. */
function isThematicBreak(content: string): boolean {
  const trimmed = content.replace(/^[ \t]{0,3}/, '');
  const noSpaces = trimmed.replace(/[ \t]/g, '');
  if (noSpaces.length < 3) return false;
  return /^-+$/.test(noSpaces) || /^_+$/.test(noSpaces) || /^\*+$/.test(noSpaces);
}

function matchHeading(content: string): { level: number; text: string } | null {
  const m = HEADING_RE.exec(content);
  if (!m) return null;
  const hashes = m[1] ?? '';
  let text = (m[2] ?? '').trim();
  // Closed ATX form: strip a trailing run of `#` with its leading space.
  text = text.replace(/[ \t]+#+[ \t]*$/, '');
  return { level: hashes.length, text };
}

function matchListItem(content: string): { indent: string; ordered: boolean; text: string } | null {
  const m = LIST_ITEM_RE.exec(content);
  if (!m) return null;
  const indent = m[1] ?? '';
  const marker = m[2] ?? '';
  const text = m[3] ?? '';
  return { indent, ordered: /^\d/.test(marker), text };
}

function matchCalloutOpen(
  content: string,
): { calloutType: string; title: string; fold: '' | '+' | '-' } | null {
  const m = CALLOUT_OPEN_RE.exec(content);
  if (!m) return null;
  const calloutType = (m[1] ?? '').trim().toLowerCase();
  const foldRaw = m[2] ?? '';
  const fold = foldRaw === '+' || foldRaw === '-' ? foldRaw : '';
  const title = (m[3] ?? '').trim();
  return { calloutType, title, fold };
}

function isBlockquoteContinuation(content: string): boolean {
  return BLOCKQUOTE_CONT_RE.test(content);
}

/**
 * Indent depth for a list item. Her notes mix tabs and spaces; a tab is one
 * level and every two spaces is one level (there's no third convention in
 * the fixture vault to calibrate against — see the parser's report for this
 * as a named assumption).
 */
function computeListDepth(indent: string): number {
  let depth = 0;
  let spaceRun = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      depth += 1;
      spaceRun = 0;
    } else if (ch === ' ') {
      spaceRun += 1;
      if (spaceRun === 2) {
        depth += 1;
        spaceRun = 0;
      }
    }
  }
  return depth;
}

function isBlockStart(content: string): boolean {
  return (
    matchFenceOpen(content) !== null ||
    matchCalloutOpen(content) !== null ||
    isThematicBreak(content) ||
    matchHeading(content) !== null ||
    matchListItem(content) !== null
  );
}

/**
 * Parses `source` into an ordered, gap-free block list. Every byte of
 * `source` is accounted for by exactly one block — see `isLossless` in
 * ./types.ts, which this function's output must always satisfy.
 */
export function parseDocument(source: string): ParsedDocument {
  const lines = splitLines(source);
  const blocks: Block[] = [];
  let li = 0;

  // Frontmatter: recognised only at offset 0 (C1.3), and only when a
  // matching `---` closing line actually exists — an unclosed `---` at the
  // top of the file is not frontmatter, it falls through to the normal scan
  // below and is treated as a thematic-break line.
  //
  // A leading UTF-8 BOM (U+FEFF) survives folder-source read/write as the
  // first character of line 0 (`ol-2zfj.51`) — some editors and OSes add
  // one, Olea never strips it (INV-2). Tolerated here by comparing line 0's
  // content *after* stripping a leading BOM against the literal '---'; the
  // BOM itself is never stripped from the recorded span, since `first.start`
  // is always 0 and every block's `raw` is a direct `source.slice`. Every
  // downstream writer that inserts by span (never by rebuilding the block's
  // text) therefore reproduces the BOM byte-for-byte with no further change.
  const first = lines[0];
  const BOM = '\uFEFF';
  const firstContent = first?.content.startsWith(BOM)
    ? first.content.slice(BOM.length)
    : first?.content;
  if (first && firstContent === '---') {
    let closeIdx = -1;
    for (let k = 1; k < lines.length; k++) {
      const line = lines[k];
      if (line && line.content === '---') {
        closeIdx = k;
        break;
      }
    }
    const closeLine = closeIdx !== -1 ? lines[closeIdx] : undefined;
    if (closeLine) {
      const frontmatter: FrontmatterBlock = {
        kind: 'frontmatter',
        raw: source.slice(first.start, closeLine.end),
        start: first.start,
        end: closeLine.end,
        inner: source.slice(first.end, closeLine.start),
      };
      blocks.push(frontmatter);
      li = closeIdx + 1;
    }
  }

  while (li < lines.length) {
    const line = lines[li];
    if (!line) break;
    const { content } = line;

    // Blank run: one or more consecutive blank/whitespace-only lines.
    if (content.trim() === '') {
      let j = li;
      let lastEnd = line.end;
      while (j < lines.length) {
        const l = lines[j];
        if (l?.content.trim() !== '') break;
        lastEnd = l.end;
        j++;
      }
      const block: BlankBlock = {
        kind: 'blank',
        raw: source.slice(line.start, lastEnd),
        start: line.start,
        end: lastEnd,
      };
      blocks.push(block);
      li = j;
      continue;
    }

    // Fenced code block — recognised before thematic breaks, so a `---`
    // line inside a fence is never mistaken for a rule (or, earlier, for a
    // frontmatter close).
    const fenceOpen = matchFenceOpen(content);
    if (fenceOpen) {
      let j = li + 1;
      let closeEnd: number | null = null;
      while (j < lines.length) {
        const l = lines[j];
        if (!l) break;
        if (isFenceClose(l.content, fenceOpen.fence)) {
          closeEnd = l.end;
          j++;
          break;
        }
        j++;
      }
      // An unterminated fence runs to end of file — see the parser's report
      // for why that's the chosen behaviour over, say, treating it as a
      // paragraph.
      const lastConsumed = lines[j - 1];
      const end = closeEnd ?? lastConsumed?.end ?? line.end;
      const block: CodeBlock = {
        kind: 'code',
        raw: source.slice(line.start, end),
        start: line.start,
        end,
        fence: fenceOpen.fence,
        info: fenceOpen.info,
      };
      blocks.push(block);
      li = j;
      continue;
    }

    // Callout: a blockquote whose first line opens with `[!type]`. The rest
    // of the blockquote (including any nested markdown) is retained as raw
    // text only — this layer does not parse inside it.
    const calloutOpen = matchCalloutOpen(content);
    if (calloutOpen) {
      let j = li + 1;
      let lastEnd = line.end;
      while (j < lines.length) {
        const l = lines[j];
        if (!l || !isBlockquoteContinuation(l.content)) break;
        lastEnd = l.end;
        j++;
      }
      const block: CalloutBlock = {
        kind: 'callout',
        raw: source.slice(line.start, lastEnd),
        start: line.start,
        end: lastEnd,
        calloutType: calloutOpen.calloutType,
        title: calloutOpen.title,
        fold: calloutOpen.fold,
      };
      blocks.push(block);
      li = j;
      continue;
    }

    // Thematic break.
    if (isThematicBreak(content)) {
      const block: ThematicBreakBlock = {
        kind: 'thematicBreak',
        raw: source.slice(line.start, line.end),
        start: line.start,
        end: line.end,
      };
      blocks.push(block);
      li += 1;
      continue;
    }

    // ATX heading.
    const heading = matchHeading(content);
    if (heading) {
      const block: HeadingBlock = {
        kind: 'heading',
        raw: source.slice(line.start, line.end),
        start: line.start,
        end: line.end,
        level: heading.level,
        text: heading.text,
      };
      blocks.push(block);
      li += 1;
      continue;
    }

    // List: a run of contiguous items of the same ordered/unordered kind.
    const firstItem = matchListItem(content);
    if (firstItem) {
      const items: ListItem[] = [];
      let j = li;
      let lastEnd = line.start;
      while (j < lines.length) {
        const l = lines[j];
        if (!l) break;
        const m = matchListItem(l.content);
        if (!m || m.ordered !== firstItem.ordered) break;
        items.push({
          raw: source.slice(l.start, l.end),
          depth: computeListDepth(m.indent),
          indentRaw: m.indent,
          text: m.text,
        });
        lastEnd = l.end;
        j++;
      }
      const block: ListBlock = {
        kind: 'list',
        raw: source.slice(line.start, lastEnd),
        start: line.start,
        end: lastEnd,
        ordered: firstItem.ordered,
        items,
      };
      blocks.push(block);
      li = j;
      continue;
    }

    // Paragraph: fallback run of plain lines, up to a blank line or the
    // start of a different block kind.
    {
      let j = li + 1;
      let lastEnd = line.end;
      while (j < lines.length) {
        const l = lines[j];
        if (!l || l.content.trim() === '' || isBlockStart(l.content)) break;
        lastEnd = l.end;
        j++;
      }
      const block: ParagraphBlock = {
        kind: 'paragraph',
        raw: source.slice(line.start, lastEnd),
        start: line.start,
        end: lastEnd,
      };
      blocks.push(block);
      li = j;
    }
  }

  return { source, blocks };
}
