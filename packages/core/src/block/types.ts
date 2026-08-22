/**
 * The block model (C1, P1-T01).
 *
 * Design rule, and the reason this file exists before any parser does: **every
 * block retains its exact source text**. Downstream writers edit by splicing raw
 * segments rather than by re-rendering a tree, which is what makes INV-2 —
 * byte-identical round-trips — achievable at all. A parser that normalises as it
 * reads has already lost the bytes an invariant is defined over.
 *
 * Scope is *her* note shapes, not CommonMark completeness (P1-T01 context). The
 * fixture vault defines the scope; anything it does not contain is out of scope
 * until a real note proves otherwise, at which point it becomes a fixture first
 * and a parser change second.
 */

/** Kinds we parse. Deliberately small — see the scope note above. */
export type BlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code'
  | 'callout'
  | 'blank'
  | 'thematicBreak';

/** Fields every block carries, whatever its kind. */
interface BlockBase {
  readonly kind: BlockKind;
  /**
   * The exact source slice for this block, including its own trailing
   * newline(s) and preserving the file's line endings verbatim — a CRLF file
   * yields CRLF here. This is the field INV-2 depends on.
   */
  readonly raw: string;
  /** Offset of `raw` in the source string, in UTF-16 code units. */
  readonly start: number;
  /** Exclusive end offset, such that `source.slice(start, end) === raw`. */
  readonly end: number;
}

/**
 * The `---`-delimited block at the top of a file, if present.
 *
 * **Delimited here, not interpreted here.** `inner` is handed to the round-trip
 * engine (P1-T02, C1.3) untouched; this layer must not parse, re-quote, or
 * reorder it, and must never route it through a YAML library. A `---` line
 * inside a fenced code block is not a frontmatter delimiter, and frontmatter is
 * only recognised at offset 0.
 */
export interface FrontmatterBlock extends BlockBase {
  readonly kind: 'frontmatter';
  /** Everything between the delimiter lines, exclusive of them. */
  readonly inner: string;
}

/** An ATX heading. Her notes are question-headed, so `text` is often a card front. */
export interface HeadingBlock extends BlockBase {
  readonly kind: 'heading';
  /** 1–6, from the count of leading `#`. */
  readonly level: number;
  /** Heading text with the marker and surrounding whitespace removed. */
  readonly text: string;
}

export interface ParagraphBlock extends BlockBase {
  readonly kind: 'paragraph';
}

/** One item in a list block. */
export interface ListItem {
  /** Exact source slice for this item, including its trailing newline. */
  readonly raw: string;
  /** Indent depth. Tabs and spaces both occur in her notes; see `indentRaw`. */
  readonly depth: number;
  /** The literal indent characters, preserved so a writer can reproduce them. */
  readonly indentRaw: string;
  /** Item text after the marker, unmodified otherwise. */
  readonly text: string;
}

export interface ListBlock extends BlockBase {
  readonly kind: 'list';
  readonly ordered: boolean;
  readonly items: readonly ListItem[];
}

/** A fenced code block. Fences are recognised before `---` thematic breaks. */
export interface CodeBlock extends BlockBase {
  readonly kind: 'code';
  /** The fence characters actually used, e.g. ``` or ~~~~. */
  readonly fence: string;
  /** Info string after the opening fence, trimmed; empty when absent. */
  readonly info: string;
}

/** An Obsidian callout: a blockquote whose first line opens with `[!type]`. */
export interface CalloutBlock extends BlockBase {
  readonly kind: 'callout';
  /** The type token, lowercased, e.g. `note`, `warning`. */
  readonly calloutType: string;
  /** Title after the type marker; empty when absent. */
  readonly title: string;
  /** `+` (default open), `-` (default closed), or `''` when unspecified. */
  readonly fold: '' | '+' | '-';
}

/** One or more consecutive blank lines. Preserved so spacing round-trips. */
export interface BlankBlock extends BlockBase {
  readonly kind: 'blank';
}

/** A `---`/`***`/`___` rule that is *not* frontmatter and *not* inside a fence. */
export interface ThematicBreakBlock extends BlockBase {
  readonly kind: 'thematicBreak';
}

export type Block =
  | FrontmatterBlock
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CodeBlock
  | CalloutBlock
  | BlankBlock
  | ThematicBreakBlock;

/** A parsed document: an ordered block list plus the source it came from. */
export interface ParsedDocument {
  readonly source: string;
  readonly blocks: readonly Block[];
}

/**
 * A heading and everything under it, up to the next heading of the same or
 * higher level. Built from the block list; holds no text of its own.
 *
 * This is what F1.4/P1-T05 walks for concepts and what F3.2 cites into, so the
 * indices refer back to `ParsedDocument.blocks` rather than copying content.
 */
export interface OutlineNode {
  readonly heading: HeadingBlock;
  /** Index into `ParsedDocument.blocks` of `heading`. */
  readonly index: number;
  /** Indices of the blocks belonging to this heading, excluding sub-headings. */
  readonly contentIndices: readonly number[];
  readonly children: readonly OutlineNode[];
}

/**
 * THE INVARIANT this whole model exists to make testable:
 *
 *   blocks.map(b => b.raw).join('') === source
 *
 * Exported as a predicate so tests and future writers assert it directly rather
 * than restating it. Any parser change that breaks this breaks INV-2 downstream.
 */
export function isLossless(doc: ParsedDocument): boolean {
  let offset = 0;
  for (const block of doc.blocks) {
    if (block.start !== offset) return false;
    if (block.end !== offset + block.raw.length) return false;
    if (doc.source.slice(block.start, block.end) !== block.raw) return false;
    offset = block.end;
  }
  return offset === doc.source.length;
}
