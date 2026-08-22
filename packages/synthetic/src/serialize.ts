/**
 * JSONL serialisation — the bytes the determinism claim is about.
 *
 * "Same seed, byte-identical stream" is only a checkable statement if there is
 * a canonical byte encoding, so this is it: one `JSON.stringify` per entry, one
 * `\n` after each, no trailing blank line, and an empty stream serialises to
 * the empty string (not to `"\n"`). Key order is the literal order the
 * generator constructs each record in — `JSON.stringify` preserves insertion
 * order for string keys — which is why every record shape in `./generate.ts` is
 * written as one object literal rather than assembled by spreading.
 *
 * This matches `olea-core`'s writer byte-for-byte (`review-log/write.ts`
 * appends `` `${JSON.stringify(entry)}\n` ``), so a synthetic file and a real
 * one are the same format, and `parseReviewLog` reads either.
 */

import type { ReviewLogEntry } from 'olea-contracts';

/** Newline-terminated JSONL. Empty in, empty out. */
export function toJsonl(entries: readonly ReviewLogEntry[]): string {
  if (entries.length === 0) return '';
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}
