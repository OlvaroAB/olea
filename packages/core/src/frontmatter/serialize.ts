/**
 * The byte path, write side (C1.3, INV-2, P1-T02).
 *
 * `serializeFrontmatter` never rebuilds text from parsed pieces — it just
 * concatenates each node's `raw`, which is why `parseFrontmatter(x)` composed
 * with this function is exact identity for any `x` a real frontmatter block
 * produces. `setEntryValue` is the one sanctioned way to change a value: it
 * splices a single entry's `raw` and leaves every other node's `raw`
 * (including its own key/quoting/spacing) byte-for-byte untouched.
 */

import type { EntryNode, Frontmatter, FrontmatterNode } from './types.js';

/**
 * Concatenates every node's `raw` in order. This is deliberately just a
 * join — see ./types.ts's `isFrontmatterLossless`, the predicate this
 * function exists to satisfy for any `Frontmatter` produced by
 * `parseFrontmatter`.
 */
export function serializeFrontmatter(fm: Frontmatter): string {
  return fm.nodes.map((node) => node.raw).join('');
}

/**
 * Replaces one entry's value text and nothing else.
 *
 * `newValueRaw` is spliced in exactly where the old `valueRaw` was.
 *
 * **Line-terminator handling is deliberately forgiving.** `EntryNode.valueRaw`
 * includes the entry's trailing line ending, so a caller passing a bare value
 * like `'new-citekey'` would otherwise delete that terminator and silently weld
 * the edited line onto the next one — a targeted edit that corrupts two lines
 * instead of changing one. In the single highest-consequence function in the
 * product (INV-2), an API that requires the caller to remember `\n` is a defect
 * waiting to happen, and it *was* caught exactly that way during review.
 *
 * So: if `newValueRaw` already ends with a line terminator, it is spliced
 * verbatim. If it does not, **the original entry's own terminator bytes are
 * reused** — which preserves CRLF in a CRLF file without inferring anything,
 * and correctly appends nothing when the original entry was the last line of a
 * frontmatter block with no trailing newline. This is still splicing rather
 * than reconstructing: every byte written comes from the caller or from the
 * bytes already there.
 *
 * Callers needing multi-line values still pass their own terminators, and those
 * are respected untouched.
 *
 * The replaced entry's key line prefix (the key text, the colon, and the
 * single separating space if the original had one) is preserved verbatim
 * by construction: `valueRaw` is always a suffix of `raw` (that's how
 * `parseFrontmatter` built it), so slicing `raw` down to
 * `raw.length - valueRaw.length` recovers that prefix without re-deriving
 * it from the key.
 *
 * Throws if `key` doesn't name an existing entry — a silent no-op here
 * would hide a caller bug in the single highest-consequence code in the
 * product (INV-2). If the key appears more than once (malformed
 * frontmatter, but leniency means we don't reject it on read), the first
 * occurrence is the one edited.
 */
export function setEntryValue(fm: Frontmatter, key: string, newValueRaw: string): Frontmatter {
  const index = fm.nodes.findIndex(
    (node): node is EntryNode => node.kind === 'entry' && node.key === key,
  );
  if (index === -1) {
    throw new Error(`setEntryValue: no entry with key ${JSON.stringify(key)} in this frontmatter`);
  }

  const target = fm.nodes[index];
  if (target?.kind !== 'entry') {
    throw new Error(`setEntryValue: internal error locating key ${JSON.stringify(key)}`);
  }

  const prefix = target.raw.slice(0, target.raw.length - target.valueRaw.length);

  // Reuse the original entry's own terminator bytes when the caller omitted one.
  // Empty string when the original had none (last line, no trailing newline).
  const originalTerminator = /(\r?\n)$/.exec(target.valueRaw)?.[1] ?? '';
  const valueRaw = /\r?\n$/.test(newValueRaw) ? newValueRaw : newValueRaw + originalTerminator;

  const updated: EntryNode = {
    kind: 'entry',
    key: target.key,
    raw: prefix + valueRaw,
    valueRaw,
  };

  const nodes: FrontmatterNode[] = fm.nodes.slice();
  nodes[index] = updated;

  return { inner: nodes.map((node) => node.raw).join(''), nodes };
}
