/**
 * Content hashing for ingestion idempotency (D-002, P3-T03).
 *
 * `IngestionQueueEngine` never hashes anything itself — it only compares
 * `contentHash` strings a caller already computed (see `EnqueueInput` in
 * `types.ts`). This module is that computation, factored out so both the
 * plugin (hashing real PDF/note bytes) and this package's own tests (hashing
 * synthetic fixtures) get the same algorithm and the same guarantee: **the
 * same bytes always produce the same hash, on any device.** That single
 * property is what makes "a synced queue never double-charges" (D-002) true
 * — two devices hashing the same synced content independently land on the
 * identical `contentHash` without coordinating.
 *
 * Uses the Web Crypto `SubtleCrypto` API (`globalThis.crypto.subtle`)
 * rather than `node:crypto`: this package ships into an Obsidian plugin
 * bundle that runs on desktop *and* mobile (INV-1 — no Node built-ins
 * belong in code that must also run in a mobile Obsidian host), and
 * `SubtleCrypto` is the one hashing primitive available in both. `uid/stamp.ts`
 * makes the identical choice for `crypto.randomUUID()`.
 */

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 of `bytes`, hex-encoded. The one hash function every job's `contentHash` must come from. */
export async function hashContent(bytes: Uint8Array): Promise<string> {
  // `bytes.buffer` is typed `ArrayBufferLike` (it admits `SharedArrayBuffer`,
  // which nothing in this codebase ever produces), and DOM's `SubtleCrypto.digest`
  // (only present in packages that pull in the `DOM` lib, e.g. packages/plugin)
  // wants a concrete `ArrayBuffer`. `.slice()` both narrows to the exact bytes
  // this view covers — safe even when `bytes` is itself a sub-view of a larger
  // buffer — and produces a fresh `ArrayBuffer`, so the cast below asserts a
  // type-checker fact (never a `SharedArrayBuffer` in practice) rather than
  // papering over a real one.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer as ArrayBuffer);
  return toHex(new Uint8Array(digest));
}

/** Convenience over `hashContent` for text sources (UTF-8 encoded before hashing). */
export async function hashText(text: string): Promise<string> {
  return hashContent(new TextEncoder().encode(text));
}
