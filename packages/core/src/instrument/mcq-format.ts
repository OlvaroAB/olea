/**
 * Olea's MCQ block (F2.15, C5.3's scope note, INV-2, P2-T05).
 *
 * ## Why this format and not another
 *
 * F2.15 gives MCQ its own shape on purpose: no SR plugin defines an MCQ format,
 * so there is nothing for ours to interoperate with and no compatibility
 * requirement to meet. The only constraints left are the real ones — she may
 * hand-author these from day one, the
 * bytes must round-trip, and a block must be unambiguously delimited in a note
 * full of her own prose.
 *
 * A fenced block with an info string is the one shape that satisfies all three:
 *
 *   - **It is already a block.** `block/parse.ts` recognises fences before
 *     anything else, so an MCQ can contain a `?` line, a `---`, a `- item`, a
 *     colon pair, or anything else she types, and none of it is reinterpreted.
 *     A convention built on headings or lists would collide with her outlines
 *     the first time a question needed a bullet in it.
 *   - **It is pleasant to type.** One field per line, one word per label, no
 *     indentation to get wrong, no quoting rules, no trailing punctuation. That
 *     matters literally: F2.15's population path is generation (P3-T07b), but
 *     the bead exists because hand-authoring has to work before generation
 *     does.
 *   - **It is the idiomatic Obsidian extension point.** A code-block
 *     post-processor keyed on the info string is how every Obsidian plugin that
 *     renders a custom block does it, so the review view can render this as a
 *     real quiz card later without changing a byte in her vault. Until then it
 *     renders as a monospace box that says exactly what it is, which is honest
 *     rather than broken.
 *
 * ```olea-mcq
 * stem: Which structure preserves the storm record below fair-weather wave base?
 * answer: Hummocky stratification
 * distractor: Ripple lamination
 * distractor: Cementation
 * distractor: Bioturbation
 * distractor: Paraconformity
 * ```
 *
 * ## The floor is enforced here, not only downstream
 *
 * A block with fewer than `MIN_DISTRACTOR_POOL` distractors **fails to parse**
 * and is reported as invalid. It is not accepted-with-a-warning and not
 * silently padded. See `types.ts`'s note on the constant — lowered from 4 to
 * 2 by `[D-195]` — for why one distractor short of the floor is not "nearly
 * enough" but a different instrument.
 *
 * ## Reading is not rewriting
 *
 * `McqInstrument.raw` is the block's exact bytes, and nothing in this module
 * writes a note it merely parsed. `serializeMcq` produces the **canonical**
 * form, which is what a newly created block is written in; a hand-typed block
 * with irregular spacing keeps its own bytes forever unless she edits it. A
 * formatter that tidied her notes on read would be a byte-churning diff in
 * every git commit she makes, for no gain she asked for.
 */

import type { AppliedSpan, DocumentEdit } from '../block/edit.js';
import { applyDocumentEdits } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import type { CodeBlock } from '../block/types.js';
import type { InvalidMcqBlock, McqInstrument, McqInvalidReason, SourceSpan } from './types.js';
import { MIN_DISTRACTOR_POOL } from './types.js';

/** The fence info string that marks a block as an Olea MCQ. */
export const MCQ_FENCE_INFO = 'olea-mcq';

export const MCQ_FIELD_STEM = 'stem';
export const MCQ_FIELD_ANSWER = 'answer';
export const MCQ_FIELD_DISTRACTOR = 'distractor';
export const MCQ_FIELD_FEEDBACK = 'feedback';
export const MCQ_FIELD_ID = 'id';
/** `[D-133]`'s revision-chain field — see `types.ts`'s doc on `McqInstrument.predecessor`. */
export const MCQ_FIELD_PREDECESSOR = 'predecessor';

const FIELD_LINE_RE = /^[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]?([\s\S]*)$/;

export interface McqParseResult {
  /** Blocks that are valid MCQ instruments, in source order. */
  readonly instruments: readonly McqInstrument[];
  /**
   * Blocks that announced themselves as MCQs and are not. Reported with their
   * location so the caller can tell her which block in which note, rather than
   * leaving her with a quiz item that quietly stopped existing.
   */
  readonly invalid: readonly InvalidMcqBlock[];
}

interface FieldLine {
  readonly key: string;
  readonly value: string;
}

function invalid(block: CodeBlock, reason: McqInvalidReason, detail: string): InvalidMcqBlock {
  return {
    reason,
    detail,
    raw: block.raw,
    span: { start: block.start, end: block.end },
  };
}

/** The block's body lines: everything between the two fence lines, terminators stripped. */
function bodyLines(block: CodeBlock): string[] {
  const lines = block.raw
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  // First line is the opening fence. The last line is the closing fence when
  // the block was closed; an unterminated fence (parse.ts runs it to EOF) has
  // no closing line to drop, and its trailing empty element is dropped below.
  const opened = lines.slice(1);
  if (opened.length > 0 && opened[opened.length - 1] === '') opened.pop();
  if (opened.length > 0) {
    const last = opened[opened.length - 1] ?? '';
    if (/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.test(last)) opened.pop();
  }
  return opened;
}

function parseBlock(block: CodeBlock): McqInstrument | InvalidMcqBlock {
  const fields: FieldLine[] = [];
  for (const line of bodyLines(block)) {
    if (line.trim() === '') continue;
    const m = FIELD_LINE_RE.exec(line);
    const key = m?.[1]?.toLowerCase();
    if (!m || key === undefined) {
      return invalid(
        block,
        'unknown-field',
        `line is not a \`field: value\` pair: ${JSON.stringify(line)}`,
      );
    }
    fields.push({ key, value: (m[2] ?? '').trim() });
  }

  const known = new Set([
    MCQ_FIELD_STEM,
    MCQ_FIELD_ANSWER,
    MCQ_FIELD_DISTRACTOR,
    MCQ_FIELD_FEEDBACK,
    MCQ_FIELD_ID,
    MCQ_FIELD_PREDECESSOR,
  ]);
  for (const field of fields) {
    if (!known.has(field.key)) {
      return invalid(block, 'unknown-field', `unknown field ${JSON.stringify(field.key)}`);
    }
    if (field.value === '') {
      return invalid(block, 'empty-value', `field ${JSON.stringify(field.key)} has no value`);
    }
  }

  const singles = [
    MCQ_FIELD_STEM,
    MCQ_FIELD_ANSWER,
    MCQ_FIELD_FEEDBACK,
    MCQ_FIELD_ID,
    MCQ_FIELD_PREDECESSOR,
  ];
  for (const key of singles) {
    const count = fields.filter((f) => f.key === key).length;
    if (count > 1) {
      return invalid(
        block,
        'repeated-field',
        `field ${JSON.stringify(key)} appears ${count} times`,
      );
    }
  }

  const stem = fields.find((f) => f.key === MCQ_FIELD_STEM)?.value;
  if (stem === undefined) return invalid(block, 'missing-stem', 'no `stem:` line');
  const answer = fields.find((f) => f.key === MCQ_FIELD_ANSWER)?.value;
  if (answer === undefined) return invalid(block, 'missing-answer', 'no `answer:` line');

  const distractors = fields.filter((f) => f.key === MCQ_FIELD_DISTRACTOR).map((f) => f.value);

  // Duplicates are checked *before* the count, because a pool of five holding
  // one repeat is a pool of four presented as five — the exact silent
  // under-rotation the floor exists to stop, wearing a passing count.
  const seen = new Set<string>([answer]);
  for (const distractor of distractors) {
    if (seen.has(distractor)) {
      return invalid(
        block,
        'duplicate-option',
        `option ${JSON.stringify(distractor)} appears more than once, or repeats the answer`,
      );
    }
    seen.add(distractor);
  }

  if (distractors.length < MIN_DISTRACTOR_POOL) {
    return invalid(
      block,
      'insufficient-distractors',
      `${distractors.length} distractor(s); F2.15 requires a pool of at least ${MIN_DISTRACTOR_POOL} so a repeated presentation can rotate`,
    );
  }

  return {
    type: 'mcq',
    id: fields.find((f) => f.key === MCQ_FIELD_ID)?.value ?? null,
    predecessor: fields.find((f) => f.key === MCQ_FIELD_PREDECESSOR)?.value ?? null,
    stem,
    answer,
    distractors,
    feedback: fields.find((f) => f.key === MCQ_FIELD_FEEDBACK)?.value ?? null,
    raw: block.raw,
    span: { start: block.start, end: block.end },
    fence: block.fence,
    terminator: block.raw.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** Every MCQ block in a note, plus every block that claimed to be one and is not. */
export function parseMcqBlocks(source: string): McqParseResult {
  const doc = parseDocument(source);
  const instruments: McqInstrument[] = [];
  const invalidBlocks: InvalidMcqBlock[] = [];

  for (const block of doc.blocks) {
    if (block.kind !== 'code') continue;
    if (block.info.toLowerCase() !== MCQ_FENCE_INFO) continue;
    const parsed = parseBlock(block);
    if ('type' in parsed) instruments.push(parsed);
    else invalidBlocks.push(parsed);
  }

  return { instruments, invalid: invalidBlocks };
}

// ---- the write side -------------------------------------------------------

/** The semantic content of an MCQ, without the bytes it happened to be written in. */
export interface McqFields {
  readonly stem: string;
  readonly answer: string;
  readonly distractors: readonly string[];
  readonly feedback?: string | null;
  readonly id?: string | null;
  /** `[D-133]`'s revision-chain field — see `types.ts`'s doc on `McqInstrument.predecessor`. */
  readonly predecessor?: string | null;
}

export interface McqSerializeOptions {
  /** Fence characters to use. Defaults to three backticks. */
  readonly fence?: string;
  /** Line terminator. Defaults to `\n`; pass the note's own to keep a CRLF file CRLF. */
  readonly terminator?: '\n' | '\r\n';
}

/**
 * The canonical form: stem, answer, the pool in order, then the optional
 * feedback, id, and predecessor. Human fields first and the machine fields
 * last, because the form has to read well to someone typing it — `id` and
 * `predecessor` are both machine fields, in that order, matching the order
 * `stampMcqId` then `stampMcqPredecessor` (or the plugin's block-agnostic
 * `stampPredecessorField`) would write them onto an already-serialized
 * block, each splicing its own line in immediately before the closing fence.
 *
 * Refuses to emit a block that could not be parsed back — the floor, duplicate
 * options, empty values, and any value carrying a newline or a fence run. A
 * serializer that can produce text its own parser rejects is a round-trip
 * engine with a hole in it.
 */
export function serializeMcq(fields: McqFields, options: McqSerializeOptions = {}): string {
  const fence = options.fence ?? '```';
  const terminator = options.terminator ?? '\n';

  const values: [string, string][] = [
    [MCQ_FIELD_STEM, fields.stem],
    [MCQ_FIELD_ANSWER, fields.answer],
    ...fields.distractors.map((d): [string, string] => [MCQ_FIELD_DISTRACTOR, d]),
  ];
  if (fields.feedback != null && fields.feedback !== '') {
    values.push([MCQ_FIELD_FEEDBACK, fields.feedback]);
  }
  if (fields.id != null && fields.id !== '') {
    values.push([MCQ_FIELD_ID, fields.id]);
  }
  if (fields.predecessor != null && fields.predecessor !== '') {
    values.push([MCQ_FIELD_PREDECESSOR, fields.predecessor]);
  }

  for (const [key, value] of values) {
    if (value.trim() === '') {
      throw new Error(`serializeMcq: field ${JSON.stringify(key)} has no value`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`serializeMcq: field ${JSON.stringify(key)} contains a line break`);
    }
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(value)) {
      throw new Error(`serializeMcq: field ${JSON.stringify(key)} would close the fence`);
    }
  }
  if (fields.distractors.length < MIN_DISTRACTOR_POOL) {
    throw new Error(
      `serializeMcq: ${fields.distractors.length} distractor(s); F2.15 requires at least ${MIN_DISTRACTOR_POOL}`,
    );
  }
  const seen = new Set<string>([fields.answer]);
  for (const distractor of fields.distractors) {
    if (seen.has(distractor)) {
      throw new Error(`serializeMcq: duplicate option ${JSON.stringify(distractor)}`);
    }
    seen.add(distractor);
  }

  const body = values.map(([key, value]) => `${key}: ${value}${terminator}`).join('');
  return `${fence}${MCQ_FENCE_INFO}${terminator}${body}${fence}${terminator}`;
}

/** `serializeMcq` for a block that was parsed, reusing the bytes it was written with. */
export function serializeMcqInstrument(instrument: McqInstrument): string {
  return serializeMcq(instrument, {
    fence: instrument.fence,
    terminator: instrument.terminator,
  });
}

export interface InsertMcqInput {
  readonly source: string;
  /** Insert after this block index; `-1` appends at the top of the file. */
  readonly afterBlockIndex: number;
  readonly fields: McqFields;
}

export interface InsertMcqResult {
  readonly content: string;
  readonly inserted: string;
  readonly insertedSpan: { readonly start: number; readonly end: number };
}

/**
 * Inserts a new MCQ block into a note, through `applyDocumentEdits` and
 * nothing else. This is the write path an accept step (INV-6, F3.4) hands a
 * generated-and-accepted quiz item to; it has no opinion about acceptance and
 * offers no way to skip it.
 */
export function insertMcqBlock(input: InsertMcqInput): InsertMcqResult {
  const { source, afterBlockIndex, fields } = input;
  const doc = parseDocument(source);

  if (afterBlockIndex < -1 || afterBlockIndex >= doc.blocks.length) {
    throw new Error(`insertMcqBlock: no block at index ${afterBlockIndex}`);
  }
  const anchor = afterBlockIndex === -1 ? null : (doc.blocks[afterBlockIndex] ?? null);
  const terminator = source.includes('\r\n') ? '\r\n' : '\n';
  const block = serializeMcq(fields, { terminator });

  const next = afterBlockIndex === -1 ? doc.blocks[0] : doc.blocks[afterBlockIndex + 1];
  const followsBlank = next?.kind === 'blank';
  const insertAt = anchor === null ? 0 : followsBlank && next ? next.end : anchor.end;
  const endsWithNewline = insertAt === 0 || source.slice(0, insertAt).endsWith('\n');
  const lead =
    insertAt === 0
      ? ''
      : endsWithNewline
        ? followsBlank
          ? ''
          : terminator
        : `${terminator}${terminator}`;
  const trail = insertAt < source.length ? terminator : '';
  const text = `${lead}${block}${trail}`;

  const edits: DocumentEdit[] = [{ kind: 'insert', at: insertAt, text }];
  const result = applyDocumentEdits(doc, edits);
  const span = result.spans[0];
  if (!span) throw new Error('insertMcqBlock: internal error, missing inserted span');
  return { content: result.content, inserted: text, insertedSpan: span };
}

// ---- identity stamping (D-030, option (b)) ---------------------------------
//
// A hand-authored MCQ block parses fine with `id: null` (F2.15). Once the
// pipeline needs a stable `instrumentId` for it (session/instrument-id.ts),
// that gap has to close by *writing* the field, once, so every later read
// sees the same id forever — "an id is written into the note once and
// thereafter only ever READ" (D-030's ruling). This is the write half; the
// read half is `instrument-id.ts`, which already prefers an explicit `id:`
// over anything it could derive, so a block stamped here is never
// re-identified by position again.

const CLOSING_FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

/** Alphabet and shape distinct from `card-format.ts`'s block ids (`^abc123`), so the two id families are never confused on sight. */
const MCQ_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function defaultGenerateMcqId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (const byte of bytes) {
    suffix += MCQ_ID_ALPHABET[byte % MCQ_ID_ALPHABET.length];
  }
  return `mcq-${suffix}`;
}

/**
 * Offset, relative to `raw`'s own start, of its last line's own text — i.e.
 * `raw` with exactly one trailing line terminator (if any) stripped. For a
 * well-formed `CodeBlock.raw` (opening fence, body, closing fence) this is
 * the start of the closing fence line, which is what stamping needs: the new
 * `id:` line goes immediately before it, so field order stays "human fields
 * first, machine field last" (`serializeMcq`'s own rule) regardless of what
 * order she typed the others in.
 */
function lastLineOffset(raw: string): number {
  let end = raw.length;
  if (raw.endsWith('\r\n')) end -= 2;
  else if (raw.endsWith('\n')) end -= 1;
  const idx = raw.lastIndexOf('\n', end - 1);
  return idx === -1 ? 0 : idx + 1;
}

export interface StampMcqIdOptions {
  /** Injectable for deterministic tests; defaults to a random `mcq-` id. */
  readonly generateId?: () => string;
}

export interface StampMcqIdResult {
  /** The full, new note content (identical to `source` when `changed` is `false`). */
  readonly content: string;
  /** `false` when the block already carried a non-empty `id:` — a true no-op. */
  readonly changed: boolean;
  /** The id now present, whether newly generated or pre-existing. */
  readonly id: string;
  /**
   * Span of the newly written `id:` line in `content`, or `null` when
   * `changed` is `false`. `removeSpans(content, [insertedSpan])` recovers
   * `source` exactly — the direct, checkable form of "the id field is the
   * only change" (C1.2), the same proof `insertMcqBlock` and `createQaCard`
   * already offer for their own inserts.
   */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Stamps a durable `id:` field onto the MCQ block at `blockSpan`, if it does
 * not already carry one. **Read-then-mint, never recompute:** a block that
 * already has an `id:` is returned byte-identical, `changed: false`, with
 * that id — re-running this on an already-stamped block is always a no-op
 * diff, the same idempotence `uid/stamp.ts` guarantees for `olea-uid`.
 *
 * Writes through `applyDocumentEdits` and nothing else: one zero-width
 * `replace` splicing in the new line, so every other byte in the note —
 * including the rest of this very block — is provably untouched (INV-2,
 * C1.2). No block is re-serialized; a hand-typed block with irregular
 * spacing keeps every byte it already had.
 */
export function stampMcqId(
  source: string,
  blockSpan: SourceSpan,
  options: StampMcqIdOptions = {},
): StampMcqIdResult {
  const generateId = options.generateId ?? defaultGenerateMcqId;
  const doc = parseDocument(source);
  const block = doc.blocks.find(
    (b): b is CodeBlock =>
      b.kind === 'code' && b.start === blockSpan.start && b.end === blockSpan.end,
  );
  if (!block) {
    throw new Error(`stampMcqId: no code block at [${blockSpan.start}, ${blockSpan.end})`);
  }

  const parsed = parseBlock(block);
  if (!('type' in parsed)) {
    throw new Error(
      `stampMcqId: block at [${blockSpan.start}, ${blockSpan.end}) does not parse as an MCQ instrument`,
    );
  }
  if (parsed.id !== null && parsed.id !== '') {
    return { content: source, changed: false, id: parsed.id, insertedSpan: null };
  }

  const lastLineStart = block.start + lastLineOffset(block.raw);
  const lastLineRaw = source.slice(lastLineStart, block.end);
  const lastLineText = lastLineRaw.replace(/\r?\n$/, '');
  if (!CLOSING_FENCE_LINE_RE.test(lastLineText)) {
    throw new Error(
      `stampMcqId: block at [${blockSpan.start}, ${blockSpan.end}) has no closing fence to stamp before`,
    );
  }

  const terminator = block.raw.includes('\r\n') ? '\r\n' : '\n';
  const id = generateId();
  const edits: DocumentEdit[] = [
    {
      kind: 'replace',
      start: lastLineStart,
      end: lastLineStart,
      text: `${MCQ_FIELD_ID}: ${id}${terminator}`,
    },
  ];
  const result = applyDocumentEdits(doc, edits);
  const insertedSpan = result.spans[0];
  if (!insertedSpan) throw new Error('stampMcqId: internal error, missing inserted span');
  return { content: result.content, changed: true, id, insertedSpan };
}

// ---- revision-chain stamping ([D-133], ol-w00s / ol-2zfj.37) --------------
//
// `predecessor` mirrors `id` field-for-field: read-then-mint, never
// recompute; a zero-width `replace` spliced in immediately before the
// closing fence, so every other byte — including the rest of this very
// block — is provably untouched (INV-2, C1.2). Unlike `id`, the value is
// never generated by this module (a predecessor id is minted by whatever
// wrote the PREDECESSOR instrument, not by this successor's own stamp);
// the caller always supplies it.
//
// **Not the write path `materialize-mcq.ts` actually uses.** The plugin's
// `instrument-blocks/predecessor.ts` (`stampPredecessorField`) is
// deliberately independent of this module — it works on any fenced block,
// not only an MCQ one — and that generic function is what the
// materialization wiring composes (its own module doc's "BLOCKED" note,
// now lifted now that `predecessor` is a known MCQ field). This MCQ-aware
// twin exists so the format module's write side is complete and testable
// on its own terms, the same way `stampMcqId` is, and so a future
// MCQ-specific caller (one that wants `parseBlock`'s validation on the way
// in, e.g.) is not forced through the generic block layer to get it.

export interface StampMcqPredecessorResult {
  /** The full, new note content (identical to `source` when `changed` is `false`). */
  readonly content: string;
  /** `false` when the block already carried a non-empty `predecessor:` — a true no-op. */
  readonly changed: boolean;
  /** The predecessor id now present, whether newly written or pre-existing. */
  readonly predecessor: string;
  /**
   * Span of the newly written `predecessor:` line in `content`, or `null`
   * when `changed` is `false`. `removeSpans(content, [insertedSpan])`
   * recovers `source` exactly, the same proof `stampMcqId` offers.
   */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Stamps a durable `predecessor:` field onto the MCQ block at `blockSpan`,
 * if it does not already carry one. **Read-then-mint, never recompute:** a
 * block that already names a predecessor is returned byte-identical,
 * `changed: false`, with that value — re-running this on an
 * already-stamped block is always a no-op diff, mirroring `stampMcqId`'s
 * own idempotence.
 *
 * Writes through `applyDocumentEdits` and nothing else: one zero-width
 * `replace` splicing in the new line (INV-2, C1.2). No block is
 * re-serialized; a hand-typed or already-stamped block keeps every byte it
 * already had.
 */
export function stampMcqPredecessor(
  source: string,
  blockSpan: SourceSpan,
  predecessorInstrumentId: string,
): StampMcqPredecessorResult {
  if (predecessorInstrumentId.trim() === '') {
    throw new Error('stampMcqPredecessor: predecessorInstrumentId must not be empty');
  }

  const doc = parseDocument(source);
  const block = doc.blocks.find(
    (b): b is CodeBlock =>
      b.kind === 'code' && b.start === blockSpan.start && b.end === blockSpan.end,
  );
  if (!block) {
    throw new Error(`stampMcqPredecessor: no code block at [${blockSpan.start}, ${blockSpan.end})`);
  }

  const parsed = parseBlock(block);
  if (!('type' in parsed)) {
    throw new Error(
      `stampMcqPredecessor: block at [${blockSpan.start}, ${blockSpan.end}) does not parse as an MCQ instrument`,
    );
  }
  if (parsed.predecessor !== null && parsed.predecessor !== '') {
    return {
      content: source,
      changed: false,
      predecessor: parsed.predecessor,
      insertedSpan: null,
    };
  }

  const lastLineStart = block.start + lastLineOffset(block.raw);
  const lastLineRaw = source.slice(lastLineStart, block.end);
  const lastLineText = lastLineRaw.replace(/\r?\n$/, '');
  if (!CLOSING_FENCE_LINE_RE.test(lastLineText)) {
    throw new Error(
      `stampMcqPredecessor: block at [${blockSpan.start}, ${blockSpan.end}) has no closing fence to stamp before`,
    );
  }

  const terminator = block.raw.includes('\r\n') ? '\r\n' : '\n';
  const edits: DocumentEdit[] = [
    {
      kind: 'replace',
      start: lastLineStart,
      end: lastLineStart,
      text: `${MCQ_FIELD_PREDECESSOR}: ${predecessorInstrumentId}${terminator}`,
    },
  ];
  const result = applyDocumentEdits(doc, edits);
  const insertedSpan = result.spans[0];
  if (!insertedSpan) throw new Error('stampMcqPredecessor: internal error, missing inserted span');
  return {
    content: result.content,
    changed: true,
    predecessor: predecessorInstrumentId,
    insertedSpan,
  };
}
