/**
 * The successor instrument's `predecessor` field — `[D-133]`'s first durable
 * home (`ol-w00s`): "a metadata-position predecessor field on the successor
 * instrument's markdown block, the C1.3 item-id pattern — canonical home of
 * the revision chain." Mirrors the write-once `id:` field
 * `olea-core`'s `instrument/mcq-format.ts` already stamps (`stampMcqId`,
 * D-030) field-for-field in mechanics: read-then-mint, never recompute;
 * written as its own line immediately before the block's closing fence, so
 * "human fields first, machine fields last" (`serializeMcq`'s own rule)
 * holds regardless of what order she — or a generation pass — typed the
 * others in; and a `applyDocumentEdits` zero-width splice, so every other
 * byte in the block is provably untouched (INV-2).
 *
 * **BLOCKED ON A CORE CHANGE before this may run against a real vault
 * write.** `olea-core`'s `instrument/mcq-format.ts` `parseBlock` rejects any
 * field line it does not recognise (`'unknown-field'`) — its known-field set
 * is `stem`/`answer`/`distractor`/`feedback`/`id` and does not include
 * `predecessor`. Stamping a `predecessor:` line into a real MCQ block today
 * would make `parseMcqBlocks` (the function every production reader —
 * session enumeration, the review queue — calls to find instruments in a
 * note) classify the WHOLE block as `invalid`, so the successor instrument
 * would silently stop being reviewable at all. That is a strictly worse
 * outcome than not building the field, so nothing in this module may be
 * wired into a materialization path (`packages/plugin/src/generation/
 * materialize-mcq.ts` and its kin) until `olea-core` recognises the field.
 * The exact addition needed there is out of this bead's `owns` and is named
 * in `ol-w00s`'s close notes.
 *
 * **Deliberately independent of `mcq-format.ts`.** This module imports only
 * the generic block layer (`parseDocument`, `applyDocumentEdits`, `CodeBlock`
 * from `olea-core`'s barrel) — never anything MCQ-format-specific — so it
 * owns no path under `packages/core/src/instrument/` and this bead's
 * file-ownership boundary holds. That also makes it honestly general: the
 * mechanics work on any fenced code block with a closing fence line, not
 * only an `olea-mcq` one, which is what "the C1.3 item-id pattern" as a
 * reusable convention actually means.
 */

import type { AppliedSpan, CodeBlock, DocumentEdit } from 'olea-core';
import { applyDocumentEdits, parseDocument } from 'olea-core';

/** The field name this module reads and writes — matches the name the core change (`ol-w00s`'s close notes) is asked to register as a known MCQ field, so both sides agree the day it lands. */
export const PREDECESSOR_FIELD_NAME = 'predecessor';

const FIELD_LINE_RE = /^[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]?([\s\S]*)$/;
const CLOSING_FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Offset, relative to `raw`'s own start, of its last line's own text — i.e.
 * `raw` with exactly one trailing line terminator (if any) stripped.
 * Identical in intent to `mcq-format.ts`'s private `lastLineOffset` (not
 * exported, hence re-derived here rather than imported) — the new field
 * line goes immediately before the closing fence, whatever order the human
 * fields were typed in.
 */
function lastLineOffset(raw: string): number {
  let end = raw.length;
  if (raw.endsWith('\r\n')) end -= 2;
  else if (raw.endsWith('\n')) end -= 1;
  const idx = raw.lastIndexOf('\n', end - 1);
  return idx === -1 ? 0 : idx + 1;
}

/** The block's body lines with both fence lines stripped and terminators removed — enough to scan for a `field: value` line without depending on any format-specific parser. */
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

/**
 * Reads a code block's `predecessor:` field directly from its raw bytes,
 * bypassing any format-specific parser's field allowlist — see this file's
 * module doc for why that matters. Returns `null` when the block carries no
 * such field, whether because it has none yet or because the value is
 * empty.
 */
export function readPredecessorField(block: Pick<CodeBlock, 'raw'>): string | null {
  for (const line of bodyLines(block.raw)) {
    if (line.trim() === '') continue;
    const match = FIELD_LINE_RE.exec(line);
    const key = match?.[1]?.toLowerCase();
    if (key !== PREDECESSOR_FIELD_NAME) continue;
    const value = (match?.[2] ?? '').trim();
    return value === '' ? null : value;
  }
  return null;
}

export interface StampPredecessorFieldResult {
  /** The full, new note content (identical to `source` when `changed` is `false`). */
  readonly content: string;
  /** `false` when the block already carried a non-empty `predecessor:` — a true no-op, same idempotence `stampMcqId` guarantees for `id:`. */
  readonly changed: boolean;
  /** The predecessor id now present, whether newly written or pre-existing. */
  readonly predecessorInstrumentId: string;
  /** Span of the newly written `predecessor:` line in `content`, or `null` when `changed` is `false`. */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Stamps the durable `predecessor:` field onto the code block at
 * `blockSpan`, if it does not already carry one. **Read-then-mint, never
 * recompute** — a block that already names a predecessor is returned
 * byte-identical, `changed: false`, with that value; re-running this on an
 * already-stamped block is always a no-op diff.
 *
 * Writes through `applyDocumentEdits` and nothing else: one zero-width
 * `replace` splicing in the new line, so every other byte in the note is
 * provably untouched (INV-2).
 *
 * **Callers: see this file's module doc's BLOCKED note before wiring this
 * into a real materialization path.**
 */
export function stampPredecessorField(
  source: string,
  blockSpan: { readonly start: number; readonly end: number },
  predecessorInstrumentId: string,
): StampPredecessorFieldResult {
  if (predecessorInstrumentId.trim() === '') {
    throw new Error('stampPredecessorField: predecessorInstrumentId must not be empty');
  }

  const doc = parseDocument(source);
  const block = doc.blocks.find(
    (b): b is CodeBlock =>
      b.kind === 'code' && b.start === blockSpan.start && b.end === blockSpan.end,
  );
  if (!block) {
    throw new Error(
      `stampPredecessorField: no code block at [${blockSpan.start}, ${blockSpan.end})`,
    );
  }

  const existing = readPredecessorField(block);
  if (existing !== null) {
    return {
      content: source,
      changed: false,
      predecessorInstrumentId: existing,
      insertedSpan: null,
    };
  }

  const lastLineStart = block.start + lastLineOffset(block.raw);
  const lastLineRaw = source.slice(lastLineStart, block.end);
  const lastLineText = lastLineRaw.replace(/\r?\n$/, '');
  if (!CLOSING_FENCE_LINE_RE.test(lastLineText)) {
    throw new Error(
      `stampPredecessorField: block at [${blockSpan.start}, ${blockSpan.end}) has no closing fence to stamp before`,
    );
  }

  const terminator = block.raw.includes('\r\n') ? '\r\n' : '\n';
  const edits: DocumentEdit[] = [
    {
      kind: 'replace',
      start: lastLineStart,
      end: lastLineStart,
      text: `${PREDECESSOR_FIELD_NAME}: ${predecessorInstrumentId}${terminator}`,
    },
  ];
  const result = applyDocumentEdits(doc, edits);
  const insertedSpan = result.spans[0];
  if (!insertedSpan)
    throw new Error('stampPredecessorField: internal error, missing inserted span');
  return { content: result.content, changed: true, predecessorInstrumentId, insertedSpan };
}
