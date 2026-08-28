/**
 * `normalizeAssessmentWeight` — the single place `[D-143]`'s canonical basis
 * for an assessment weight is applied.
 *
 * **The ruling (`[D-143]`, `ol-d0xe`, Aug 2026):** assessment weights are
 * canonically **fractions of the course grade, `0..1`**, and *readers
 * normalize on ingest* — a recorded value **above 1 is a percentage**
 * (divide by 100); a value **at or below 1 is already a fraction** (keep
 * it). Everything downstream of a reader may then assume the fraction
 * basis, which is what lets component 3.3's weight factor be a plain
 * identity rather than a scale nobody can check (see `oracle/rank.ts`'s
 * `DECLARED_FALLBACK_ASSESSMENT_WEIGHT_DIVISOR`).
 *
 * **Why the rule can be a threshold at 1 rather than a judgement.** The two
 * bases only collide at exactly `1`, and there the fraction reading — "this
 * assessment is the whole course grade" — is both the rarer case and the
 * safe one: reading it as 1% would silently discard a real signal, whereas
 * reading a genuine 1% as the whole grade requires her to have written `1`
 * where every other percentage-basis note in the same file writes `20` or
 * `35`. `[D-143]` rules the boundary inclusive-to-fraction for that reason,
 * and this function does not second-guess it per note: a per-note guess
 * would make two identical values in the same column normalize differently,
 * which is worse than a rule that is occasionally wrong in a way a reader
 * can predict.
 *
 * **Idempotent over every realistic input, and deliberately not "fixed" for
 * the rest.** `normalize(normalize(x)) === normalize(x)` for all
 * `x <= 100`; a value above 100 (more than 100% of a course grade) divides
 * twice and is a data error either way. Guarding that case would mean
 * inventing a repair this reader has no basis for — the honest handling is
 * that `basis` reports what was assumed, and `AssessmentRecord.weightRaw`
 * keeps the untouched source text so a caller can always see the original.
 *
 * **Never silent.** The returned `basis` is what the record carries, so
 * "this number was divided by 100 on your behalf" is inspectable rather
 * than a transformation buried in a reader — the same discipline
 * `weightRaw` already follows for "weight was 0" vs "weight didn't parse".
 */

/** Which reading `[D-143]` gave a recorded weight — see this file's doc above for the rule and why its boundary sits where it does. */
export type AssessmentWeightBasis = 'fraction' | 'percentage';

/** `[D-143]`'s boundary: strictly above this reads as a percentage, at or below it as a fraction. */
const FRACTION_BASIS_MAX = 1;

/** `[D-143]`'s divisor for a value read as a percentage. */
const PERCENTAGE_TO_FRACTION = 100;

export interface NormalizedAssessmentWeight {
  /** The weight as a fraction of the course grade. `undefined` when the source value was absent or did not parse — never a fabricated 0. */
  readonly value: number | undefined;
  /** Which reading `[D-143]` gave the source value, or `undefined` when there was no value to read. */
  readonly basis: AssessmentWeightBasis | undefined;
}

/**
 * Applies `[D-143]` to one recorded weight.
 *
 * A non-finite or absent input yields `{ value: undefined, basis: undefined }`
 * — "no weight was readable", which every consumer already treats as neutral
 * rather than as a zero (`oracle/rank.ts`'s `computeAssessmentWeightScore`).
 * A negative value is passed through on the fraction branch rather than
 * clamped here: this function's job is the *basis*, and squashing a negative
 * into 0 at ingest would hide a data problem the consumer's own clamp
 * reports honestly.
 */
export function normalizeAssessmentWeight(raw: number | undefined): NormalizedAssessmentWeight {
  if (raw === undefined || !Number.isFinite(raw)) return { value: undefined, basis: undefined };
  if (raw > FRACTION_BASIS_MAX) {
    return { value: raw / PERCENTAGE_TO_FRACTION, basis: 'percentage' };
  }
  return { value: raw, basis: 'fraction' };
}
