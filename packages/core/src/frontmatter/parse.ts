/**
 * The byte path, read side (C1.3, INV-2, P1-T02).
 *
 * `parseFrontmatter` never interprets a value — it only decides, line by
 * line, whether a line opens a new `key: value` entry or is something else
 * (a comment, a blank line, a shape we don't recognise). Every line ends up
 * in exactly one node's `raw`, verbatim, so `isFrontmatterLossless` holds by
 * construction: see ./types.ts for the invariant and why it exists.
 *
 * No YAML library, ever — see ./types.ts's header comment for the measured
 * PyYAML failures that rule one out.
 */

import type { EntryNode, Frontmatter, FrontmatterNode } from './types.js';

interface RawLine {
  /** Line text including its own trailing line ending (`\n`, `\r\n`, or none for a final unterminated line). */
  readonly raw: string;
  /** Same line with the trailing line ending stripped, used only for pattern matching. */
  readonly content: string;
}

/**
 * Splits `inner` into lines that each carry their own trailing line ending,
 * so a CRLF file's `\r` survives as part of the line it belongs to (mirrors
 * ../block/parse.ts's `splitLines`, which this module deliberately keeps in
 * step with — same reasoning, same technique, applied one layer in).
 */
function splitLines(inner: string): RawLine[] {
  const lines: RawLine[] = [];
  let i = 0;
  while (i < inner.length) {
    const nl = inner.indexOf('\n', i);
    if (nl === -1) {
      lines.push({ raw: inner.slice(i), content: inner.slice(i) });
      break;
    }
    const end = nl + 1;
    const contentEnd = nl > i && inner[nl - 1] === '\r' ? nl - 1 : nl;
    lines.push({ raw: inner.slice(i, end), content: inner.slice(i, contentEnd) });
    i = end;
  }
  return lines;
}

/**
 * A top-level `key: value` line. The key is everything before the first
 * `:` (no colon inside a key — her frontmatter never needs one); the
 * optional group captures a value that starts after exactly one separating
 * space, so `(?: (.*))?` failing to match means "colon with nothing after
 * it on this line" (an empty inline value), not "no value at all".
 */
const KEY_LINE_RE = /^(\S[^:]*):(?: (.*))?$/;

/** A continuation line: indented, and therefore part of the previous key's value. */
function isIndented(content: string): boolean {
  return content.length > 0 && (content[0] === ' ' || content[0] === '\t');
}

/**
 * Parses `inner` (a `FrontmatterBlock.inner`, per ../block/types.ts) into a
 * `Frontmatter`. Leniency is load-bearing, not a fallback: any line that
 * isn't unambiguously a top-level `key:` line — a comment, a blank line, a
 * block-scalar shape we don't special-case — becomes a `PassthroughNode`
 * and survives untouched. Her vault defines the grammar; this function
 * never repairs or rejects a line it doesn't understand.
 */
export function parseFrontmatter(inner: string): Frontmatter {
  const lines = splitLines(inner);
  const nodes: FrontmatterNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;

    const match = isIndented(line.content) ? null : KEY_LINE_RE.exec(line.content);
    if (!match) {
      nodes.push({ kind: 'other', raw: line.raw });
      i += 1;
      continue;
    }

    const key = match[1] ?? '';
    // A literal separating space was consumed only if the optional group
    // matched at all (even capturing an empty rest) — see KEY_LINE_RE's doc.
    const hasSpaceSeparator = match[2] !== undefined;
    const prefixLength = key.length + 1 + (hasSpaceSeparator ? 1 : 0);

    let raw = line.raw;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (!next || !isIndented(next.content)) break;
      raw += next.raw;
      j += 1;
    }

    const entry: EntryNode = {
      kind: 'entry',
      key,
      raw,
      valueRaw: raw.slice(prefixLength),
    };
    nodes.push(entry);
    i = j;
  }

  return { inner, nodes };
}
