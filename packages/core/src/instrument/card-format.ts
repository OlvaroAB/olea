/**
 * Q&A and cloze cards in her vault (F2.1, C5.3, C1.4, INV-2, P2-T04).
 *
 * ## What "SR-plugin-readable" resolves to, and where that came from
 *
 * C5.3 requires the card *format* to be compatible with Obsidian SR plugins,
 * so that cards stay readable and editable inside Obsidian. Which SR plugin
 * dialect to target is left open by the contract — it is one of the functional
 * scope's open questions, and the contract does not record any incumbent
 * spaced-repetition plugin whose syntax this would have to match.
 * So the contract fixes the *requirement* and leaves the *dialect* open (both
 * points are in `olea-service/docs/Olea_alpha_functional_scope.md`, cited by
 * path because it is private-classified), and the fixture vault could not
 * settle it either: it contained no card syntax of any kind before this bead.
 *
 * The dialect was therefore established from the ecosystem, from primary
 * sources, the same way `fixtures/vault/Assignments.base` was established from
 * Obsidian's own Bases documentation rather than from memory:
 *
 *   - **st3v3nmw/obsidian-spaced-repetition** is the review-inside-Obsidian
 *     plugin C5.3 can plausibly mean; F2's own rationale ("Obsidian SR plugins
 *     review adequately") is about in-Obsidian reviewing, not about an Anki
 *     exporter, which is a different product shape with a different file
 *     format.
 *   - Its separators were read out of the plugin's **own default settings**
 *     (`src/data/settings.ts`, `DEFAULT_SETTINGS`), not out of prose:
 *     `singleLineCardSeparator: "::"`, `singleLineReversedCardSeparator:
 *     ":::"`, `multilineCardSeparator: "?"`, `multilineReversedCardSeparator:
 *     "??"`, `convertHighlightsToClozes: true` (so `==…==` is the default cloze
 *     delimiter), `convertBoldTextToClozes: false`,
 *     `convertCurlyBracketsToClozes: false`, `flashcardTags: ["#flashcards"]`.
 *   - Its scheduling storage was read from its own `docs/en/data-storage.md`:
 *     an HTML comment of the form `<!--SR:!2024-08-16,51,230-->`, by default on
 *     the line after the card.
 *
 * **The assumption, stated rather than silently taken:** the separators above
 * are user-configurable in that plugin, so "compatible" can only ever mean
 * "compatible with its defaults". We target the defaults. If she has changed
 * them, her cards parse here and ours do not parse there, and the fix is a
 * setting, not a format change. That is recorded on the bead rather than left
 * for someone to rediscover.
 *
 * ## Two things this module deliberately does not do
 *
 * **It never writes scheduling data.** Not the plugin's comment, not one of our
 * own beside it. C5.3's second sentence gives scheduling state a single owner,
 * on the ground that a schedule two systems write to has no authority left —
 * which is the reason the format is shared and the state is not. A `<!--SR:…-->` already in her vault is read
 * so the card's answer text does not silently include it, reported as
 * `foreignScheduling`, and otherwise left exactly where it is.
 *
 * **It never writes a deck tag.** The plugin only reviews cards in notes that
 * carry a flashcard tag (default `#flashcards`) or that live in a deck folder.
 * Writing that tag on her behalf would be the single action that starts a
 * second scheduler writing to the same cards, which is the outcome C5.3 exists
 * to prevent — so declaring a deck stays hers. Cards Olea creates are readable
 * and editable in the plugin the moment she tags the note, and invisible to it
 * until she does.
 *
 * ## Scope
 *
 * Her shapes, not the plugin's full grammar — the same rule `block/parse.ts`
 * follows. Cards are found in paragraphs and list items, which is what her
 * question-headed outlines are made of. Cloze recognises `==…==` and `{{…}}`
 * and deliberately **not** `**bold**`: the plugin ships that conversion off,
 * and her notes use bold for emphasis throughout, so reading bold as a cloze
 * would mint instruments she never wrote.
 */

import type { AppliedSpan } from '../block/edit.js';
import { applyDocumentEdits } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import type { Block, ParsedDocument } from '../block/types.js';
import type {
  CardInstrument,
  ClozeCardInstrument,
  ClozeDelimiter,
  QaCardInstrument,
  QaCardStyle,
  SourceSpan,
} from './types.js';

/** The target plugin's default separators (`DEFAULT_SETTINGS`, see the header). */
export const SINGLE_LINE_SEPARATOR = '::';
export const SINGLE_LINE_REVERSED_SEPARATOR = ':::';
export const MULTI_LINE_SEPARATOR = '?';
export const MULTI_LINE_REVERSED_SEPARATOR = '??';

/** The plugin's default flashcard tag. Named here so it is greppable; never written by this module. */
export const SR_DEFAULT_DECK_TAG = '#flashcards';

/**
 * Another plugin's scheduling comment. Matched only as a whole trailing token,
 * never rewritten. `[\s\S]` rather than `.` because nothing guarantees the
 * comment is single-line in a file we did not write.
 */
const FOREIGN_SCHEDULING_RE = /<!--SR:[\s\S]*?-->\s*$/;

/** A trailing Obsidian block id (C1.4). Obsidian's own id charset is alphanumerics and hyphens. */
const TRAILING_BLOCK_ID_RE = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;

const CLOZE_PATTERNS: readonly { readonly delimiter: ClozeDelimiter; readonly re: RegExp }[] = [
  { delimiter: '==', re: /==([^=\n]+)==/g },
  { delimiter: '{{', re: /\{\{([^{}\n]+)\}\}/g },
];

interface LineSlice {
  /** Absolute start offset in the note source. */
  readonly start: number;
  /** Absolute end offset, exclusive, including this line's terminator. */
  readonly end: number;
  /** Absolute end offset of the line's text, i.e. before its `\r\n` or `\n`. */
  readonly textEnd: number;
  /** The line without its terminator. */
  readonly text: string;
}

/** Splits a block's raw text into absolute-offset line slices. */
function blockLines(block: Block): LineSlice[] {
  const lines: LineSlice[] = [];
  let i = 0;
  while (i < block.raw.length) {
    const nl = block.raw.indexOf('\n', i);
    const end = nl === -1 ? block.raw.length : nl + 1;
    const textEnd =
      nl === -1 ? block.raw.length : nl > i && block.raw[nl - 1] === '\r' ? nl - 1 : nl;
    lines.push({
      start: block.start + i,
      end: block.start + end,
      textEnd: block.start + textEnd,
      text: block.raw.slice(i, textEnd),
    });
    i = end;
  }
  return lines;
}

interface StrippedLine {
  /** The line text with any foreign scheduling comment and trailing block id removed. */
  readonly text: string;
  readonly blockId: string | null;
  readonly foreignScheduling: string | null;
}

/**
 * Removes, in the order they can legally appear, a trailing foreign scheduling
 * comment and a trailing block id. Both are *about* the line rather than part
 * of the card, and including either in an answer would show her plumbing.
 */
function stripLine(text: string): StrippedLine {
  let rest = text;
  let foreignScheduling: string | null = null;
  let blockId: string | null = null;

  const sched = FOREIGN_SCHEDULING_RE.exec(rest);
  if (sched) {
    foreignScheduling = sched[0].trimEnd();
    rest = rest.slice(0, sched.index).trimEnd();
  }

  const id = TRAILING_BLOCK_ID_RE.exec(rest);
  if (id?.[1]) {
    blockId = id[1];
    rest = rest.slice(0, id.index).trimEnd();
  }

  return { text: rest, blockId, foreignScheduling };
}

/** Splits on the reversed separator first — `:::` contains `::`, so order is the whole correctness argument. */
function matchSingleLine(text: string): { style: QaCardStyle; front: string; back: string } | null {
  const reversed = text.indexOf(SINGLE_LINE_REVERSED_SEPARATOR);
  if (reversed > 0) {
    const front = text.slice(0, reversed).trim();
    const back = text.slice(reversed + SINGLE_LINE_REVERSED_SEPARATOR.length).trim();
    if (front !== '' && back !== '') {
      return { style: 'single-line-reversed', front, back };
    }
    return null;
  }
  const plain = text.indexOf(SINGLE_LINE_SEPARATOR);
  if (plain > 0) {
    const front = text.slice(0, plain).trim();
    const back = text.slice(plain + SINGLE_LINE_SEPARATOR.length).trim();
    if (front !== '' && back !== '') {
      return { style: 'single-line', front, back };
    }
  }
  return null;
}

function clozesOnLine(line: LineSlice, stripped: StrippedLine): ClozeCardInstrument[] {
  for (const { delimiter, re } of CLOZE_PATTERNS) {
    re.lastIndex = 0;
    const found: { start: number; end: number; inner: string }[] = [];
    for (const m of stripped.text.matchAll(re)) {
      if (m.index === undefined || m[1] === undefined) continue;
      found.push({ start: m.index, end: m.index + m[0].length, inner: m[1] });
    }
    if (found.length === 0) continue;

    // One instrument per deletion. The other deletions on the line are shown
    // as ordinary text (that is how the plugin renders them), so their
    // delimiters are dropped from `before`/`after` but their words are kept.
    return found.map((target) => {
      let before = '';
      let after = '';
      let cursor = 0;
      for (const other of found) {
        const segment = stripped.text.slice(cursor, other.start);
        if (other.start < target.start) {
          before += segment + other.inner;
        } else if (other.start === target.start) {
          before += segment;
        } else {
          after += segment + other.inner;
        }
        cursor = other.end;
      }
      after += stripped.text.slice(cursor);
      return {
        type: 'cloze',
        delimiter,
        before,
        clozeText: target.inner,
        after,
        raw: line.text,
        span: { start: line.start, end: line.textEnd },
        blockId: stripped.blockId,
        foreignScheduling: stripped.foreignScheduling,
      } satisfies ClozeCardInstrument;
    });
  }
  return [];
}

/** A paragraph holding a `?`/`??` separator line is a multi-line card: the plugin ends one at a blank line, and a blank line is exactly where `block/parse.ts` ends a paragraph. */
function multiLineCard(block: Block, lines: readonly LineSlice[]): QaCardInstrument | null {
  let separatorIndex = -1;
  let style: QaCardStyle = 'multi-line';
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]?.text.trim();
    if (text === MULTI_LINE_REVERSED_SEPARATOR) {
      separatorIndex = i;
      style = 'multi-line-reversed';
      break;
    }
    if (text === MULTI_LINE_SEPARATOR) {
      separatorIndex = i;
      style = 'multi-line';
      break;
    }
  }
  if (separatorIndex <= 0 || separatorIndex >= lines.length - 1) return null;

  const frontLines = lines.slice(0, separatorIndex);
  const backLines = lines.slice(separatorIndex + 1);

  let blockId: string | null = null;
  let foreignScheduling: string | null = null;
  const backTexts: string[] = [];
  for (let i = 0; i < backLines.length; i++) {
    const raw = backLines[i]?.text ?? '';
    const isLast = i === backLines.length - 1;
    if (!isLast) {
      backTexts.push(raw);
      continue;
    }
    const stripped = stripLine(raw);
    blockId = stripped.blockId;
    foreignScheduling = stripped.foreignScheduling;
    if (stripped.text !== '') backTexts.push(stripped.text);
  }

  const back = backTexts.join('\n').trim();
  const front = frontLines
    .map((l) => l.text)
    .join('\n')
    .trim();
  if (front === '' || back === '') return null;

  return {
    type: 'qa',
    style,
    front,
    back,
    reversed: style === 'multi-line-reversed',
    raw: block.raw,
    span: { start: block.start, end: block.end },
    blockId,
    foreignScheduling,
  };
}

/**
 * Every Q&A and cloze card in a note, in source order.
 *
 * Precedence on one line is Q&A over cloze: a line carrying `::` is a Q&A card
 * whose answer may happen to contain highlights, not a cloze card that happens
 * to contain a colon pair. That is the plugin's own reading and it is the one
 * that does not turn every highlighted answer into a second instrument.
 */
export function parseCards(source: string): readonly CardInstrument[] {
  const doc = parseDocument(source);
  const cards: CardInstrument[] = [];

  for (const block of doc.blocks) {
    if (block.kind === 'paragraph') {
      const lines = blockLines(block);
      const multi = multiLineCard(block, lines);
      if (multi) {
        cards.push(multi);
        continue;
      }
      for (const line of lines) {
        cards.push(...cardsOnLine(line));
      }
      continue;
    }

    if (block.kind === 'list') {
      for (const line of blockLines(block)) {
        // The item's marker (`- `, `1. `) is not part of the card text.
        const markerMatch = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)/.exec(line.text);
        const markerLength = markerMatch?.[1]?.length ?? 0;
        const itemLine: LineSlice = {
          start: line.start + markerLength,
          end: line.end,
          textEnd: line.textEnd,
          text: line.text.slice(markerLength),
        };
        cards.push(...cardsOnLine(itemLine));
      }
    }
  }

  return cards;
}

function cardsOnLine(line: LineSlice): CardInstrument[] {
  const stripped = stripLine(line.text);
  if (stripped.text === '') return [];

  const single = matchSingleLine(stripped.text);
  if (single) {
    return [
      {
        type: 'qa',
        style: single.style,
        front: single.front,
        back: single.back,
        reversed: single.style === 'single-line-reversed',
        raw: line.text,
        span: { start: line.start, end: line.textEnd },
        blockId: stripped.blockId,
        foreignScheduling: stripped.foreignScheduling,
      },
    ];
  }

  return clozesOnLine(line, stripped);
}

// ---- the create path ------------------------------------------------------
//
// Everything below writes, and everything below writes through
// `applyDocumentEdits` (../block/edit.ts) — no template assembles a whole file,
// no existing block is re-rendered from its parsed fields. That makes P2-T04's
// single-write-path requirement a property of the code rather than a promise in
// a comment.

/** Where a created card is anchored back to her note (C1.4). */
export type CardAnchor =
  | {
      readonly kind: 'block-id';
      readonly id: string;
      /** False when the line already carried one and it was reused. */
      readonly created: boolean;
    }
  /**
   * Headings do not take block ids — Obsidian addresses a heading by its text
   * (`#Heading`), and a `^id` typed onto a heading line renders as literal
   * text inside the heading. Her notes are question-headed, so this is the
   * common case, not an edge one.
   */
  | { readonly kind: 'heading'; readonly text: string };

export interface CreateQaCardInput {
  readonly source: string;
  /**
   * Index into `parseDocument(source).blocks` of the block she ran the command
   * on. A block index rather than a line number because the caller has already
   * parsed the note to know what she selected, and two addressing schemes over
   * one file is how offsets drift apart.
   */
  readonly anchorBlockIndex: number;
  readonly front: string;
  readonly back: string;
  /** Defaults to `multi-line`, which is the form that survives a front or back containing a colon. */
  readonly style?: 'single-line' | 'multi-line';
  /** Injectable for deterministic tests; defaults to a random id in Obsidian's charset. */
  readonly generateBlockId?: () => string;
}

export interface CreateQaCardResult {
  readonly content: string;
  /** The exact text inserted, card and separating blank lines included. */
  readonly inserted: string;
  /** Its span in `content` — subtract it and you have `source` back (INV-2). */
  readonly insertedSpan: AppliedSpan;
  /** The block id written onto her line, if one was, and its span in `content`. */
  readonly blockIdSpan: AppliedSpan | null;
  readonly anchor: CardAnchor;
}

const BLOCK_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function defaultGenerateBlockId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += BLOCK_ID_ALPHABET[byte % BLOCK_ID_ALPHABET.length];
  }
  return id;
}

/** The line terminator a block already uses, so a CRLF note stays a CRLF note without anything being inferred from the platform. */
function terminatorOf(block: Block, source: string): '\n' | '\r\n' {
  if (block.raw.includes('\r\n')) return '\r\n';
  if (block.raw.includes('\n')) return '\n';
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function assertAnchorable(doc: ParsedDocument, index: number): Block {
  const block = doc.blocks[index];
  if (!block) {
    throw new Error(`createQaCard: no block at index ${index}`);
  }
  if (block.kind !== 'paragraph' && block.kind !== 'list' && block.kind !== 'heading') {
    throw new Error(
      `createQaCard: cannot create a card from a ${block.kind} block; cards come from her prose, headings and outline items`,
    );
  }
  return block;
}

/**
 * Creates a Q&A card in the note, anchored to the block she ran the command on.
 *
 * The card is inserted *after* that block rather than woven into it, so her own
 * line keeps its bytes; the only edit made to her existing text is the block id
 * (C1.4), and only when the block can carry one and does not already.
 */
export function createQaCard(input: CreateQaCardInput): CreateQaCardResult {
  const { source, anchorBlockIndex, front, back } = input;
  const style = input.style ?? 'multi-line';
  const generateBlockId = input.generateBlockId ?? defaultGenerateBlockId;

  if (front.trim() === '' || back.trim() === '') {
    throw new Error('createQaCard: a card needs both a front and a back');
  }

  const doc = parseDocument(source);
  const anchor = assertAnchorable(doc, anchorBlockIndex);
  const terminator = terminatorOf(anchor, source);

  const edits: Parameters<typeof applyDocumentEdits>[1][number][] = [];
  let cardAnchor: CardAnchor;
  let blockIdEditIndex: number | null = null;

  if (anchor.kind === 'heading') {
    cardAnchor = { kind: 'heading', text: anchor.text };
  } else {
    const lines = blockLines(anchor);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) throw new Error('createQaCard: internal error, anchor block has no lines');
    const existing = TRAILING_BLOCK_ID_RE.exec(lastLine.text);
    if (existing?.[1]) {
      cardAnchor = { kind: 'block-id', id: existing[1], created: false };
    } else {
      const id = generateBlockId();
      cardAnchor = { kind: 'block-id', id, created: true };
      blockIdEditIndex = edits.length;
      edits.push({
        kind: 'replace',
        start: lastLine.textEnd,
        end: lastLine.textEnd,
        text: ` ^${id}`,
      });
    }
  }

  const cardText =
    style === 'single-line'
      ? `${front.trim()}${SINGLE_LINE_SEPARATOR}${back.trim()}${terminator}`
      : `${front.trim()}${terminator}${MULTI_LINE_SEPARATOR}${terminator}${back.trim()}${terminator}`;

  const next = doc.blocks[anchorBlockIndex + 1];
  const followsBlank = next?.kind === 'blank';
  const insertAt = followsBlank && next ? next.end : anchor.end;
  const endsWithNewline = source.slice(0, insertAt).endsWith('\n');
  const lead = endsWithNewline ? (followsBlank ? '' : terminator) : `${terminator}${terminator}`;
  const trail = insertAt < source.length ? terminator : '';

  const cardEditIndex = edits.length;
  edits.push({ kind: 'insert', at: insertAt, text: `${lead}${cardText}${trail}` });

  const result = applyDocumentEdits(doc, edits);
  const insertedSpan = result.spans[cardEditIndex];
  if (!insertedSpan) throw new Error('createQaCard: internal error, missing inserted span');

  return {
    content: result.content,
    inserted: `${lead}${cardText}${trail}`,
    insertedSpan,
    blockIdSpan: blockIdEditIndex === null ? null : (result.spans[blockIdEditIndex] ?? null),
    anchor: cardAnchor,
  };
}

export interface CreateClozeCardInput {
  readonly source: string;
  /** Absolute offset of the first character of the span she marked. */
  readonly spanStart: number;
  /** Absolute offset just past the last character of that span. */
  readonly spanEnd: number;
  /** Defaults to `==`, the target plugin's own default cloze delimiter. */
  readonly delimiter?: ClozeDelimiter;
}

export interface CreateClozeCardResult {
  readonly content: string;
  /** The marked text, unchanged — returned so a caller can show what was clozed. */
  readonly clozeText: string;
  /** Spans of the two delimiters in `content`; removing both yields `source`. */
  readonly delimiterSpans: readonly [AppliedSpan, AppliedSpan];
}

const CLOZE_CLOSERS: Record<ClozeDelimiter, string> = { '==': '==', '{{': '}}' };

/**
 * Wraps the span she marked in cloze delimiters, in place.
 *
 * **No block id and no scheduling data are written.** For a Q&A card the block
 * id lives on her line and the card lives beside it, so an anchor costs her
 * line nothing visible; a cloze *is* her line, so anything appended to it would
 * appear inside the card itself — a visible `^a1b2c3` in the middle of a
 * flashcard is precisely the "stays readable and editable" failure C5.3 is
 * about. Deriving a stable id for a cloze is queue composition's problem, and
 * it is filed rather than solved by making her notes uglier.
 */
export function createClozeCard(input: CreateClozeCardInput): CreateClozeCardResult {
  const { source, spanStart, spanEnd } = input;
  const delimiter = input.delimiter ?? '==';
  const closer = CLOZE_CLOSERS[delimiter];

  if (spanEnd <= spanStart) {
    throw new Error('createClozeCard: the marked span is empty');
  }
  const marked = source.slice(spanStart, spanEnd);
  if (marked.includes('\n')) {
    throw new Error('createClozeCard: a cloze deletion cannot span more than one line');
  }
  if (marked.includes(delimiter) || marked.includes(closer)) {
    throw new Error('createClozeCard: the marked span already contains a cloze delimiter');
  }

  const doc = parseDocument(source);
  const host = doc.blocks.find((b) => spanStart >= b.start && spanEnd <= b.end);
  if (!host || (host.kind !== 'paragraph' && host.kind !== 'list')) {
    throw new Error(
      'createClozeCard: the marked span is not inside a paragraph or list item; clozes come from her prose',
    );
  }

  const result = applyDocumentEdits(doc, [
    { kind: 'replace', start: spanStart, end: spanStart, text: delimiter },
    { kind: 'replace', start: spanEnd, end: spanEnd, text: closer },
  ]);
  const open = result.spans[0];
  const close = result.spans[1];
  if (!open || !close) throw new Error('createClozeCard: internal error, missing delimiter spans');

  return { content: result.content, clozeText: marked, delimiterSpans: [open, close] };
}

// ---- identity stamping (D-030, option (b)) ---------------------------------
//
// A hand-typed Q&A card's own line may carry no block id at all — she never
// ran a command, she just typed `Front::Back`. Once the pipeline needs a
// stable `instrumentId` for it, that gap has to close by *writing* the id,
// once, the same way `stampMcqId` does for MCQ blocks: a trailing `^id`
// appended to the card's own last line, in exactly the shape
// `card-format.ts` already reads back (`TRAILING_BLOCK_ID_RE`) and the shape
// `createQaCard` already writes for the anchor line of a *generated* card.
// Nothing changes for cloze here — a cloze *is* her line, so a trailing
// marker would sit inside the card text, which is the C5.3 failure this
// module's header already explains; that case is not solved by this
// function and is not attempted here.

export interface StampQaCardBlockIdOptions {
  /** Injectable for deterministic tests; defaults to a random id in Obsidian's charset. */
  readonly generateBlockId?: () => string;
}

export interface StampQaCardBlockIdResult {
  /** The full, new note content (identical to `source` when `changed` is `false`). */
  readonly content: string;
  /** `false` when the card's line already carried a block id — a true no-op. */
  readonly changed: boolean;
  /** The block id now present, whether newly generated or pre-existing. */
  readonly blockId: string;
  /**
   * Span of the newly written ` ^<id>` text in `content`, or `null` when
   * `changed` is `false`. `removeSpans(content, [insertedSpan])` recovers
   * `source` exactly (C1.2).
   */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Offset, relative to `raw`'s own start, of the end of its last line's own
 * text — i.e. `raw.length` with exactly one trailing line terminator (if
 * any) stripped. For a single-line card `raw` is already terminator-free
 * (see `cardsOnLine`'s `LineSlice.text`), so this is simply `raw.length` —
 * the card's own end. For a multi-line card `raw` is the whole block, so
 * this lands at the end of the back's last line's text, which is exactly
 * where `multiLineCard` strips a trailing block id from on read.
 */
function lastLineTextEnd(raw: string): number {
  if (raw.endsWith('\r\n')) return raw.length - 2;
  if (raw.endsWith('\n')) return raw.length - 1;
  return raw.length;
}

/**
 * Where, within the card's own last line, a new block id should be spliced
 * in — relative to `raw`'s own start. Ordinarily this is the end of the
 * line's text (`lastLineTextEnd`), but a foreign scheduling comment (another
 * plugin's `<!--SR:…-->`) is read-only and must stay the last thing on the
 * line (`stripLine` only recognises it there): inserting *after* it would
 * make the comment un-recognisable on the next parse, silently pulling its
 * bytes into the card's answer text. So when one is present, the new id goes
 * immediately before it instead — still a single splice, still touching no
 * byte that was already there.
 */
function blockIdInsertOffset(raw: string): number {
  const end = lastLineTextEnd(raw);
  const lineStart = raw.lastIndexOf('\n', end - 1) + 1;
  const lastLine = raw.slice(lineStart, end);
  const scheduling = FOREIGN_SCHEDULING_RE.exec(lastLine);
  return scheduling?.index === undefined ? end : lineStart + scheduling.index;
}

/**
 * Stamps a durable block id (C1.4) onto the Q&A card at `cardSpan`'s own
 * last line, if it does not already carry one. **Read-then-mint, never
 * recompute:** a card whose line already ends in `^id` is returned
 * byte-identical, `changed: false`, with that id.
 *
 * Writes through `applyDocumentEdits` and nothing else: one zero-width
 * `replace` splicing in ` ^<id>`, so every other byte in the note is
 * provably untouched (INV-2, C1.2). `cardSpan` must be a `QaCardInstrument`
 * span from a fresh `parseCards(source)` — cloze cards are rejected, since
 * this function does not attempt C5.3's hard case.
 */
export function stampQaCardBlockId(
  source: string,
  cardSpan: SourceSpan,
  options: StampQaCardBlockIdOptions = {},
): StampQaCardBlockIdResult {
  const generateBlockId = options.generateBlockId ?? defaultGenerateBlockId;
  const card = parseCards(source).find(
    (c): c is QaCardInstrument =>
      c.type === 'qa' && c.span.start === cardSpan.start && c.span.end === cardSpan.end,
  );
  if (!card) {
    throw new Error(`stampQaCardBlockId: no Q&A card at [${cardSpan.start}, ${cardSpan.end})`);
  }
  if (card.blockId !== null && card.blockId !== '') {
    return { content: source, changed: false, blockId: card.blockId, insertedSpan: null };
  }

  const doc = parseDocument(source);
  const lastLineEnd = card.span.start + blockIdInsertOffset(card.raw);
  const blockId = generateBlockId();
  const result = applyDocumentEdits(doc, [
    { kind: 'replace', start: lastLineEnd, end: lastLineEnd, text: ` ^${blockId}` },
  ]);
  const insertedSpan = result.spans[0];
  if (!insertedSpan) throw new Error('stampQaCardBlockId: internal error, missing inserted span');

  return { content: result.content, changed: true, blockId, insertedSpan };
}
