/**
 * Shared helpers for the P1-T02 permanent suite (INV-2). Not itself a test
 * file (no `.spec.ts` suffix, so vitest's `include` glob skips it) — just
 * the line-diffing and synthetic-fixture plumbing both golden.spec.ts and
 * targeted-edit.spec.ts need.
 */

/**
 * Splits `text` into lines, each keeping its own trailing line ending
 * (`\n`, `\r\n`, or none for a final unterminated line) — the same
 * technique ../../src/frontmatter/parse.ts uses, applied here purely for
 * test-side diffing rather than parsing.
 */
export function toLines(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, nl + 1));
    i = nl + 1;
  }
  return out;
}

/**
 * Indices (into `toLines(before)` / `toLines(after)`) of every line that
 * differs between `before` and `after`, comparing line-for-line including
 * the line ending. Used to assert the untouched-lines property directly —
 * a black-box check independent of `setEntryValue`'s own splicing logic.
 */
export function changedLineIndices(before: string, after: string): number[] {
  const a = toLines(before);
  const b = toLines(after);
  const max = Math.max(a.length, b.length);
  const changed: number[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed.push(i);
  }
  return changed;
}

/** True when `indices` is non-empty and forms one contiguous run (no gaps). */
export function isContiguous(indices: readonly number[]): boolean {
  if (indices.length === 0) return false;
  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1];
    const cur = indices[i];
    if (prev === undefined || cur === undefined || cur !== prev + 1) return false;
  }
  return true;
}
