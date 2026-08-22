/**
 * The byte path, body side (C1.2, INV-2, P2-T04).
 *
 * `frontmatter/serialize.ts` is the round-trip engine's write side for the
 * `---` block. This file is the same discipline for everything below it, and
 * it exists because P2-T04's acceptance criteria puts the inline-create
 * command behind the round-trip engine and leaves it no second way to
 * put bytes on disk. Without a primitive
 * like this, "creating a card" means building a new file out of template
 * literals, and INV-2 becomes a thing we hope for rather than a thing the
 * write path structurally cannot break.
 *
 * ## The rule
 *
 * Every byte of the result comes from exactly one of two places: `doc.source`,
 * copied verbatim, or an edit's own `text`. Nothing is ever re-rendered from a
 * parsed shape — no block is rebuilt from its `level`/`text`/`items`, no
 * frontmatter is re-emitted, no line ending is inferred. That is the same
 * property `serializeFrontmatter` has (it is a `join`), stated for a whole
 * document.
 *
 * ## Why the constraints are constraints and not advice
 *
 * `applyDocumentEdits` rejects, rather than performs:
 *
 *   - edits over a `ParsedDocument` whose blocks do not tile its source
 *     (`isLossless`) — a doc that did not come from `parseDocument` is a doc
 *     whose offsets mean nothing;
 *   - ranges that fall outside the source, or run backwards;
 *   - ranges that overlap each other, where "the last edit wins" would be a
 *     silent corruption rather than an error;
 *   - ranges that straddle a block boundary. An edit that spans two blocks is
 *     always either a caller-side offset bug or a rewrite of content the
 *     caller did not parse; both are exactly the failure INV-2 names. A
 *     zero-width insertion *at* a boundary is fine — that is how new content
 *     gets in — but a replacement must live inside one block's bytes.
 *
 * A post-condition then re-checks the whole thing against the source: every
 * gap between edits in the result must equal the corresponding slice of
 * `doc.source`, byte for byte. That check is cheap and it is the invariant, so
 * it runs in production rather than only in tests. A writer that silently
 * corrupts a semester of notes is not a class of bug worth trading for a few
 * microseconds.
 */

import type { ParsedDocument } from './types.js';
import { isLossless } from './types.js';

/**
 * One edit against a parsed document, in `doc.source` offsets.
 *
 * There is deliberately no "delete" variant and no block-index-based variant.
 * Deletion is `replace` with an empty `text`, and offsets are what the block
 * model already speaks — `Block.start`/`Block.end`/`ListItem` spans are all
 * offsets into the same string, so a caller composes edits from the parse it
 * already has instead of from a second addressing scheme that could disagree
 * with it.
 */
export type DocumentEdit =
  /** Insert `text` at `at`, moving nothing. `at` must sit on a block boundary. */
  | { readonly kind: 'insert'; readonly at: number; readonly text: string }
  /** Replace `[start, end)` with `text`. The range must lie inside one block. */
  | {
      readonly kind: 'replace';
      readonly start: number;
      readonly end: number;
      readonly text: string;
    };

/** Where an applied edit's `text` ended up in the result. */
export interface AppliedSpan {
  readonly start: number;
  /** Exclusive. `end - start === edit.text.length`. */
  readonly end: number;
}

export interface DocumentEditResult {
  readonly content: string;
  /**
   * One entry per input edit, in the order the edits were given (not in
   * source order), each naming that edit's `text` span in `content`.
   *
   * This is what makes the INV-2 golden assertion direct rather than
   * inferential: delete these spans from `content` and, for a set of pure
   * insertions, you get `doc.source` back byte-for-byte. A test that can
   * subtract the intended change is a test that has actually checked
   * "everything else is unchanged", instead of checking a few fields that
   * happened to occur to whoever wrote it.
   */
  readonly spans: readonly AppliedSpan[];
}

function editStart(edit: DocumentEdit): number {
  return edit.kind === 'insert' ? edit.at : edit.start;
}

function editEnd(edit: DocumentEdit): number {
  return edit.kind === 'insert' ? edit.at : edit.end;
}

/**
 * The set of offsets that are block boundaries: 0, every `block.end`, and
 * (equivalently, since blocks tile the source) every `block.start`.
 */
function blockBoundaries(doc: ParsedDocument): Set<number> {
  const boundaries = new Set<number>([0, doc.source.length]);
  for (const block of doc.blocks) {
    boundaries.add(block.start);
    boundaries.add(block.end);
  }
  return boundaries;
}

/** True when `[start, end)` lies within a single block's bytes. */
function withinOneBlock(doc: ParsedDocument, start: number, end: number): boolean {
  for (const block of doc.blocks) {
    if (start >= block.start && end <= block.end) return true;
  }
  return false;
}

/**
 * Applies `edits` to `doc.source`, copying every unedited byte verbatim.
 *
 * Throws on any edit the rules above forbid. Callers in this package treat a
 * throw as a bug in themselves, not as a condition to handle: the create paths
 * compute their offsets from a parse of the same string, so a rejected edit
 * means the caller's arithmetic is wrong and the correct outcome is a loud
 * failure before anything reaches her vault.
 */
export function applyDocumentEdits(
  doc: ParsedDocument,
  edits: readonly DocumentEdit[],
): DocumentEditResult {
  if (!isLossless(doc)) {
    throw new Error(
      'applyDocumentEdits: the parsed document does not tile its source; refusing to edit it',
    );
  }

  const boundaries = blockBoundaries(doc);
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => editStart(a.edit) - editStart(b.edit) || a.index - b.index);

  let previousEnd = 0;
  for (const { edit } of ordered) {
    const start = editStart(edit);
    const end = editEnd(edit);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error('applyDocumentEdits: edit offsets must be integers');
    }
    if (start < 0 || end > doc.source.length || end < start) {
      throw new Error(
        `applyDocumentEdits: edit range [${start}, ${end}) is outside the source [0, ${doc.source.length})`,
      );
    }
    if (start < previousEnd) {
      throw new Error(
        `applyDocumentEdits: edit range [${start}, ${end}) overlaps an earlier edit ending at ${previousEnd}`,
      );
    }
    if (edit.kind === 'insert') {
      if (!boundaries.has(start)) {
        throw new Error(
          `applyDocumentEdits: insertion at ${start} is not on a block boundary; new content goes between blocks, never inside one`,
        );
      }
    } else if (!withinOneBlock(doc, start, end)) {
      throw new Error(
        `applyDocumentEdits: replacement range [${start}, ${end}) straddles a block boundary`,
      );
    }
    previousEnd = end;
  }

  const spans: AppliedSpan[] = new Array<AppliedSpan>(edits.length);
  const pieces: string[] = [];
  let cursor = 0;
  let outLength = 0;

  for (const { edit, index } of ordered) {
    const start = editStart(edit);
    const end = editEnd(edit);
    const carried = doc.source.slice(cursor, start);
    pieces.push(carried);
    outLength += carried.length;
    spans[index] = { start: outLength, end: outLength + edit.text.length };
    pieces.push(edit.text);
    outLength += edit.text.length;
    cursor = end;
  }
  pieces.push(doc.source.slice(cursor));

  const content = pieces.join('');

  // Post-condition: the unedited gaps really are the source's own bytes.
  // Recomputed from `content` rather than trusted from the loop above, so a
  // future refactor of the splice cannot quietly stop being byte-preserving.
  let sourceCursor = 0;
  let contentCursor = 0;
  for (const { edit, index } of ordered) {
    const span = spans[index];
    if (!span) throw new Error('applyDocumentEdits: internal error, missing applied span');
    const gapLength = span.start - contentCursor;
    if (
      content.slice(contentCursor, span.start) !==
      doc.source.slice(sourceCursor, sourceCursor + gapLength)
    ) {
      throw new Error('applyDocumentEdits: post-condition failed, an unedited byte range changed');
    }
    if (content.slice(span.start, span.end) !== edit.text) {
      throw new Error(
        "applyDocumentEdits: post-condition failed, an edit's text was not written verbatim",
      );
    }
    sourceCursor += gapLength + (editEnd(edit) - editStart(edit));
    contentCursor = span.end;
  }
  if (content.slice(contentCursor) !== doc.source.slice(sourceCursor)) {
    throw new Error('applyDocumentEdits: post-condition failed, the trailing byte range changed');
  }

  return { content, spans };
}

/**
 * Deletes `spans` from `content`. The inverse of a set of pure insertions, and
 * the direct form of "everything except the intended change is unchanged":
 * `removeSpans(result.content, result.spans) === doc.source` holds exactly
 * when no byte outside the insertions moved or changed.
 *
 * Exported because the golden suites assert with it. It is not a write path.
 */
export function removeSpans(content: string, spans: readonly AppliedSpan[]): string {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const pieces: string[] = [];
  let cursor = 0;
  for (const span of ordered) {
    pieces.push(content.slice(cursor, span.start));
    cursor = span.end;
  }
  pieces.push(content.slice(cursor));
  return pieces.join('');
}
