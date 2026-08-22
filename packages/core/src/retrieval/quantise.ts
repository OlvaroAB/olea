/**
 * Int8 scalar quantisation for the persisted embedding cache (C2.3, F2.13,
 * D-004, D-006 — implements the ruling on `ol-l1qz`).
 *
 * **The problem this exists to solve.** A 1024-dimension bge-m3 vector
 * written as a JSON number array costs ~19.5 KB, because every component
 * serialises as a ~19-character decimal (`-0.023456789012345678`). At C2.3's
 * stated working scale (~8,000 blocks) that is ~156 MB in the plugin data
 * folder, and F2.13 requires this product to work on mobile. It is worse than
 * the disk figure suggests: the file has to be `JSON.parse`d in full to be
 * used, and the parsed result is ~8,000 x 1024 JS doubles — over 64 MB of
 * heap before retrieval has compared anything.
 *
 * **Why quantisation and not "don't cache".** The only thing retrieval ever
 * does with a cached vector is compare it to a fresh query vector by cosine
 * (`cosine.ts`, via `hybrid.ts`). Nothing reconstructs the original floats,
 * nothing hands them to a model, nothing ships them anywhere. So the cache
 * does not owe anyone the vector — it owes them the *ranking* the vector
 * produces. Not caching at all is the other end of that trade and is not
 * available: the alternative to a stored representation is re-embedding every
 * block on every query, which is exactly the cost C2.3 exists to avoid.
 *
 * **Why the per-vector scale is not stored.** Cosine similarity is invariant
 * under positive scaling of either side: `cos(q, a*v) === cos(q, v)` for
 * `a > 0`. Quantisation here is symmetric and per-vector — `code[i] =
 * round(v[i] / max|v| * 127)` — so the codes are just the direction of `v`
 * on a coarser grid, and the discarded scale is precisely the factor cosine
 * would have divided out anyway. Storing it would be 8 more bytes per vector
 * that no caller could use.
 *
 * **Asymmetric on purpose.** The *query* vector is never quantised. It
 * arrives full-precision from the provider and is never persisted, so there
 * is nothing to save by degrading it and real accuracy to lose. Comparing a
 * full-precision query against quantised documents is strictly more accurate
 * than quantising both, at identical storage cost.
 *
 * **Base64 rather than a JSON number array.** The codes are bytes. Written as
 * JSON numbers they would cost ~3.5 characters each (~3.6 KB/vector);
 * base64'd they cost 4 characters per 3 bytes (~1.37 KB/vector). The store
 * port (`EmbeddingCacheStore`) moves plain JSON through Obsidian's
 * `loadData`/`saveData`, so a string is the densest thing that fits through
 * it. The codec here is hand-rolled rather than `btoa`/`Buffer`: neither is
 * in this package's `lib` (`ES2022`, no DOM) and neither is guaranteed on
 * every host the plugin runs on, and INV-1 keeps this file host-agnostic.
 *
 * The measured accuracy cost of all of the above is in
 * `quantise.accuracy.spec.ts`, which is a measurement, not an assertion of
 * received wisdom.
 */

/**
 * A cached embedding as the cache actually holds it: 1024 int8 direction
 * codes, not the provider's floats. Deliberately a distinct type from
 * `EmbeddingVector` so that "this is a lossy, cosine-only representation"
 * is visible at every call site rather than being a comment somewhere.
 */
export type QuantisedVector = Int8Array;

/** The positive end of the int8 code range. -128 is deliberately unused so the grid is symmetric about zero and `-v` quantises to exactly `-quantise(v)`. */
export const QUANTISED_CODE_MAX = 127;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_REVERSE: ReadonlyMap<string, number> = new Map(
  [...B64_ALPHABET].map((char, index) => [char, index] as const),
);

/**
 * Quantises a full-precision vector to int8 direction codes.
 *
 * A zero vector, an empty vector, or one whose components are all
 * non-finite quantises to all-zero codes — `cosineSimilarity` already
 * answers 0 for a zero-magnitude side, which is the same "no signal" the
 * original vector carried. Non-finite components inside an otherwise usable
 * vector are coded as 0 rather than propagating `NaN` through every
 * subsequent comparison.
 */
export function quantiseVector(vector: ArrayLike<number>): QuantisedVector {
  const codes = new Int8Array(vector.length);
  let scale = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] ?? 0;
    if (!Number.isFinite(value)) continue;
    const magnitude = value < 0 ? -value : value;
    if (magnitude > scale) scale = magnitude;
  }
  if (scale === 0) return codes;

  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] ?? 0;
    if (!Number.isFinite(value)) continue;
    const code = Math.round((value / scale) * QUANTISED_CODE_MAX);
    codes[i] = code > QUANTISED_CODE_MAX ? QUANTISED_CODE_MAX : code;
  }
  return codes;
}

/** Base64 of the codes' raw bytes — what `PersistedEmbeddingCache` stores per entry. */
export function encodeQuantisedVector(codes: QuantisedVector): string {
  const bytes = new Uint8Array(codes.buffer, codes.byteOffset, codes.byteLength);
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const word = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      `${B64_ALPHABET[(word >>> 18) & 63]}${B64_ALPHABET[(word >>> 12) & 63]}${B64_ALPHABET[(word >>> 6) & 63]}${B64_ALPHABET[word & 63]}`,
    );
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const word = (bytes[i] ?? 0) << 16;
    parts.push(`${B64_ALPHABET[(word >>> 18) & 63]}${B64_ALPHABET[(word >>> 12) & 63]}==`);
  } else if (remaining === 2) {
    const word = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    parts.push(
      `${B64_ALPHABET[(word >>> 18) & 63]}${B64_ALPHABET[(word >>> 12) & 63]}${B64_ALPHABET[(word >>> 6) & 63]}=`,
    );
  }
  return parts.join('');
}

/**
 * Inverse of `encodeQuantisedVector`.
 *
 * Returns `null` — never throws — for anything that is not well-formed
 * base64 of a whole number of bytes. The persisted cache is untrusted JSON
 * read off disk, and D-006 already makes the whole cache safely deletable and
 * rebuildable, so dropping one unreadable entry and re-embedding that one
 * chunk is a strictly better failure than taking retrieval down. See
 * `EmbeddingCacheEngine.create`, which is the caller that does exactly that.
 */
export function decodeQuantisedVector(encoded: string): QuantisedVector | null {
  if (encoded.length === 0) return new Int8Array(0);
  if (encoded.length % 4 !== 0) return null;

  let padding = 0;
  if (encoded.endsWith('==')) padding = 2;
  else if (encoded.endsWith('=')) padding = 1;

  const byteLength = (encoded.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let out = 0;

  for (let i = 0; i < encoded.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const char = encoded[i + j] ?? '';
      if (char === '=') {
        // Padding is only ever legal in the final quartet's last two slots.
        if (i + 4 !== encoded.length || j < 2) return null;
        word = (word << 6) >>> 0;
        continue;
      }
      const value = B64_REVERSE.get(char);
      if (value === undefined) return null;
      word = ((word << 6) | value) >>> 0;
    }
    if (out < byteLength) bytes[out++] = (word >>> 16) & 0xff;
    if (out < byteLength) bytes[out++] = (word >>> 8) & 0xff;
    if (out < byteLength) bytes[out++] = word & 0xff;
  }

  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Quantise and encode in one step — what `EmbeddingCacheEngine` does with every vector the provider returns. */
export function encodeVectorForCache(vector: ArrayLike<number>): string {
  return encodeQuantisedVector(quantiseVector(vector));
}
