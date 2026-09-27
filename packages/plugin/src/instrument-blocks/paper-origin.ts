/**
 * A handed-off practice-paper item's `paper-origin` field — `[D-407]`'s home
 * for the paper and slot an instrument was entered from (F4.11, `[D-391]`):
 * "one optional field on the entered instrument's own block, stamped once
 * and idempotently at hand-off, in the same shape as the existing
 * predecessor field", in Olea's layer and never in her text (INV-6).
 *
 * **The block-agnostic twin of `olea-core`'s `stampMcqPaperOrigin`**, for
 * the same reason `./predecessor.ts` is the twin of `stampMcqPredecessor`:
 * it needs only the generic block layer (`parseDocument`,
 * `applyDocumentEdits`), so it works on any fenced block with a closing
 * fence line. Same mechanics as `./predecessor.ts`: read-then-mint, never
 * recompute; the new line goes immediately before the closing fence; one
 * zero-width `applyDocumentEdits` splice, so every other byte is provably
 * untouched (INV-2).
 *
 * **The value format is core's**, restated here because the core helpers
 * are not on `olea-core`'s barrel: `<paperId> <slotId>`, two whitespace-free
 * tokens separated by one space. `test/instrument-blocks/paper-origin.spec.ts`
 * pins that a block stamped here reads back through core's `parseMcqBlocks`
 * as the same origin, so the two sides cannot drift silently.
 *
 * **Reachability (`[D-072]`).** No production caller yet: the core hand-off
 * (`olea-core`'s `handOffPaperItem`) stamps through core's own twin, and the
 * paper view's per-item hand-off control that will call it is not built.
 */

import type { AppliedSpan, CodeBlock, DocumentEdit } from 'olea-core';
import { applyDocumentEdits, parseDocument } from 'olea-core';

/** The field name — matches `olea-core`'s `MCQ_FIELD_PAPER_ORIGIN`. */
export const PAPER_ORIGIN_FIELD_NAME = 'paper-origin';

/** The paper (`PaperRecord.id`) and slot (`PaperGeneratedItem.slotId`) a handed-off item came from. */
export interface PaperOrigin {
  readonly paperId: string;
  readonly slotId: string;
}

const FIELD_LINE_RE = /^[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]?([\s\S]*)$/;
const CLOSING_FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

/** Same intent as `./predecessor.ts`'s own: `raw`'s last line's offset, one trailing terminator stripped. */
function lastLineOffset(raw: string): number {
  let end = raw.length;
  if (raw.endsWith('\r\n')) end -= 2;
  else if (raw.endsWith('\n')) end -= 1;
  const idx = raw.lastIndexOf('\n', end - 1);
  return idx === -1 ? 0 : idx + 1;
}

function bodyLines(raw: string): string[] {
  const lines = raw.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const opened = lines.slice(1);
  if (opened.length > 0 && opened[opened.length - 1] === '') opened.pop();
  if (opened.length > 0) {
    const last = opened[opened.length - 1] ?? '';
    if (CLOSING_FENCE_LINE_RE.test(last)) opened.pop();
  }
  return opened;
}

/** The raw, non-empty `paper-origin:` value on a block, or `null` when it has none. */
function rawPaperOriginValue(block: Pick<CodeBlock, 'raw'>): string | null {
  for (const line of bodyLines(block.raw)) {
    const match = FIELD_LINE_RE.exec(line);
    if (match?.[1]?.toLowerCase() !== PAPER_ORIGIN_FIELD_NAME) continue;
    const value = (match[2] ?? '').trim();
    return value === '' ? null : value;
  }
  return null;
}

function parseValue(value: string): PaperOrigin | null {
  const tokens = value.trim().split(/[ \t]+/);
  if (tokens.length !== 2) return null;
  const [paperId, slotId] = tokens;
  if (paperId === undefined || slotId === undefined || paperId === '' || slotId === '') return null;
  return { paperId, slotId };
}

function formatValue(origin: PaperOrigin): string {
  for (const [name, id] of [
    ['paperId', origin.paperId],
    ['slotId', origin.slotId],
  ] as const) {
    if (id === '' || /\s/.test(id)) {
      throw new Error(
        `stampPaperOriginField: ${name} ${JSON.stringify(id)} must be non-empty and contain no whitespace`,
      );
    }
  }
  return `${origin.paperId} ${origin.slotId}`;
}

/**
 * Reads a code block's `paper-origin:` field from its raw bytes. `null` when
 * the block carries none, or carries a value that is not exactly two
 * whitespace-free tokens — an origin is read, never guessed.
 */
export function readPaperOriginField(block: Pick<CodeBlock, 'raw'>): PaperOrigin | null {
  const value = rawPaperOriginValue(block);
  return value === null ? null : parseValue(value);
}

export interface StampPaperOriginFieldResult {
  /** The full, new note content (identical to `source` when `changed` is `false`). */
  readonly content: string;
  /** `false` when the block already carried a non-empty `paper-origin:` — a true no-op. */
  readonly changed: boolean;
  /** The origin now on the block; `null` only when it already carries a value this module cannot read (left as it is). */
  readonly paperOrigin: PaperOrigin | null;
  /** Span of the newly written line in `content`, or `null` when `changed` is `false`. */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Stamps the durable `paper-origin:` field onto the code block at
 * `blockSpan`, if it does not already carry one. **Read-then-mint, never
 * recompute** — a block that already carries the field (even naming another
 * origin, even unreadably) is returned byte-identical, `changed: false`, so
 * a repeated hand-off is always a no-op diff (`[D-391]` binding condition 2).
 */
export function stampPaperOriginField(
  source: string,
  blockSpan: { readonly start: number; readonly end: number },
  origin: PaperOrigin,
): StampPaperOriginFieldResult {
  const value = formatValue(origin);

  const doc = parseDocument(source);
  const block = doc.blocks.find(
    (b): b is CodeBlock =>
      b.kind === 'code' && b.start === blockSpan.start && b.end === blockSpan.end,
  );
  if (!block) {
    throw new Error(
      `stampPaperOriginField: no code block at [${blockSpan.start}, ${blockSpan.end})`,
    );
  }

  const existing = rawPaperOriginValue(block);
  if (existing !== null) {
    return {
      content: source,
      changed: false,
      paperOrigin: parseValue(existing),
      insertedSpan: null,
    };
  }

  const lastLineStart = block.start + lastLineOffset(block.raw);
  const lastLineText = source.slice(lastLineStart, block.end).replace(/\r?\n$/, '');
  if (!CLOSING_FENCE_LINE_RE.test(lastLineText)) {
    throw new Error(
      `stampPaperOriginField: block at [${blockSpan.start}, ${blockSpan.end}) has no closing fence to stamp before`,
    );
  }

  const terminator = block.raw.includes('\r\n') ? '\r\n' : '\n';
  const edits: DocumentEdit[] = [
    {
      kind: 'replace',
      start: lastLineStart,
      end: lastLineStart,
      text: `${PAPER_ORIGIN_FIELD_NAME}: ${value}${terminator}`,
    },
  ];
  const result = applyDocumentEdits(doc, edits);
  const insertedSpan = result.spans[0];
  if (!insertedSpan)
    throw new Error('stampPaperOriginField: internal error, missing inserted span');
  return {
    content: result.content,
    changed: true,
    paperOrigin: { paperId: origin.paperId, slotId: origin.slotId },
    insertedSpan,
  };
}
