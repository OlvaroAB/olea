/**
 * Two structural guards the envelope checks in this directory share.
 * Internal to `stage-contract/`: the barrel does not re-export them.
 */

/** A plain object, and not an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
