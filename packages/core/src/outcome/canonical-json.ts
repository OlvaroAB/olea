/**
 * `canonicalJson` — one JSON text for one value, whatever order its keys were built in.
 *
 * Two devices that compute the same fact independently must land on the same content hash without
 * coordinating (`../ingestion/hash.ts`'s own argument for `hashText`, applied to a record instead of
 * a file). `JSON.stringify` alone is not enough for that: key order follows construction order, so
 * two equal records built by two code paths hash differently. This sorts object keys, recursively,
 * and drops `undefined` members exactly as `JSON.stringify` does, so the text is the same one the
 * record serialises to on disk apart from key order.
 *
 * Pure. Used by the scope-reading log (`./scope-reading-log.ts`, event identity) and the practice
 * paper's reuse fingerprint (`../oracle/paper-structure.ts`). Throws on a value JSON cannot carry
 * (`bigint`, a cycle), which is a caller bug rather than data.
 */

function canonicalise(value: unknown, seen: readonly object[]): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') throw new Error('canonicalJson: a bigint is not JSON');
    return value;
  }
  if (seen.includes(value)) throw new Error('canonicalJson: a cyclic value is not JSON');
  const path = [...seen, value];
  if (Array.isArray(value)) return value.map((entry) => canonicalise(entry, path));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const member = source[key];
    if (member === undefined) continue;
    out[key] = canonicalise(member, path);
  }
  return out;
}

/** The canonical JSON text of `value`: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value, []));
}
