/**
 * Component register row 3.9's named health check, and its stated negative
 * check, in one file because the row states them as one bullet:
 *
 * > *"Health check: the offer rate against evidence depth — flat across
 * > depth means the trigger is not firing. Plus, as a negative: every
 * > review record carries a support level and no record carries her
 * > self-rating."*
 *
 * Same family as every other file in this directory: the algorithm has
 * already run (a real ladder replay, or a batch of real review records), a
 * caller reduces that to the shape below, and these functions answer a
 * yes/no question about it. No I/O, no clock, no `../support-level/`
 * import — this module never drives the ladder itself.
 */
import type { CheckVerdict } from './types.js';

// ---------------------------------------------------------------------------
// checkSupportOfferRateByDepth — "flat across depth means the trigger is not
// firing"
// ---------------------------------------------------------------------------

export interface SupportOfferCase {
  /**
   * How much depth evidence exists for this concept × instrument-tier cell
   * at the moment support was (or was not) offered — a caller's own
   * measure, at whatever granularity `../support-level/` fed it (e.g. a
   * count of prior recall-tier reviews). This module only bins the number;
   * it does not define what "depth" means.
   */
  readonly evidenceDepth: number;
  /** Whether `'prompted'` or `'guided'` was the level actually shown (i.e. NOT `'independent'`) for this case. */
  readonly offered: boolean;
}

export interface OfferRateBin {
  readonly binIndex: number;
  readonly n: number;
  readonly offered: number;
  readonly rate: number;
}

export interface SupportOfferRateByDepthMeasured {
  readonly n: number;
  readonly bins: readonly OfferRateBin[];
  /** Highest bin rate minus lowest bin rate, across bins with at least one case. Flat (near zero) is the failure this check names. */
  readonly rateRange: number;
}

/**
 * Bins `cases` by `evidenceDepth` (bin `i` covers
 * `[i * binWidth, (i + 1) * binWidth)`), computes the offer rate per bin, and
 * fails if the spread across bins does not clear `minRateRange` — the
 * register's own "flat across depth means the trigger is not firing".
 *
 * `minRateRange` is a REQUIRED argument with no shipped default, the same
 * discipline `checkMasteryStageDistribution`'s `modalShareCeiling` uses for
 * an identical reason: no derivation exists yet for how much spread counts
 * as "not flat" for this trigger, and shipping a guessed number here would
 * be exactly the kind of unfitted-but-undefended constant the register's
 * declared/derived line rules out. A caller states its own bar (and why, in
 * its own report).
 *
 * Fails on zero cases (N-013) or fewer than two non-empty bins — a range
 * cannot be measured over one point.
 */
export function checkSupportOfferRateByDepth(
  cases: readonly SupportOfferCase[],
  binWidth: number,
  minRateRange: number,
): CheckVerdict<SupportOfferRateByDepthMeasured> {
  if (cases.length === 0) {
    return {
      ok: false,
      measured: { n: 0, bins: [], rateRange: 0 },
      detail: 'zero cases supplied — nothing was checked',
    };
  }
  if (!(binWidth > 0)) {
    throw new Error(`checkSupportOfferRateByDepth: binWidth must be > 0, got ${binWidth}`);
  }

  const byBin = new Map<number, { n: number; offered: number }>();
  for (const c of cases) {
    const binIndex = Math.floor(c.evidenceDepth / binWidth);
    const bucket = byBin.get(binIndex) ?? { n: 0, offered: 0 };
    bucket.n += 1;
    if (c.offered) bucket.offered += 1;
    byBin.set(binIndex, bucket);
  }

  const bins: OfferRateBin[] = [...byBin.entries()]
    .sort(([a], [b]) => a - b)
    .map(([binIndex, { n, offered }]) => ({ binIndex, n, offered, rate: offered / n }));

  const rates = bins.map((b) => b.rate);
  const rateRange = rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 0;

  const measured: SupportOfferRateByDepthMeasured = { n: cases.length, bins, rateRange };

  if (bins.length < 2) {
    return {
      ok: false,
      measured,
      detail: `only ${bins.length} non-empty depth bin(s) — a range cannot be measured over fewer than two`,
    };
  }
  if (rateRange < minRateRange) {
    return {
      ok: false,
      measured,
      detail: `offer rate range across ${bins.length} bins is ${rateRange.toFixed(3)}, below the ${minRateRange.toFixed(3)} bar — flat across depth, the trigger is not firing`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `offer rate range across ${bins.length} bins is ${rateRange.toFixed(3)}, at or above the ${minRateRange.toFixed(3)} bar`,
  };
}

// ---------------------------------------------------------------------------
// checkSupportLevelRecordShape — the negative: every record shows what was
// shown, and none shows what she said.
// ---------------------------------------------------------------------------

export interface SupportLevelRecordCase {
  /** Opaque record id — never a real instrument id, concept name or note title beyond what is already opaque (INV-3). */
  readonly id: string;
  readonly hasSupportLevelShown: boolean;
  /** Whether this record's shape carries ANY field that would encode her self-report (a self-rating, a felt-confidence tag, etc.) — never true for a correctly-shaped record. */
  readonly hasSelfRating: boolean;
}

export interface SupportLevelRecordShapeMeasured {
  readonly n: number;
  readonly missingSupportLevel: readonly string[];
  readonly leakedSelfRating: readonly string[];
}

/**
 * Fails if any record is missing `supportLevelShown`, or if any record
 * carries a self-rating — the register's negative check, made exact.
 * Fails on zero cases (N-013).
 */
export function checkSupportLevelRecordShape(
  cases: readonly SupportLevelRecordCase[],
): CheckVerdict<SupportLevelRecordShapeMeasured> {
  const missingSupportLevel = cases.filter((c) => !c.hasSupportLevelShown).map((c) => c.id);
  const leakedSelfRating = cases.filter((c) => c.hasSelfRating).map((c) => c.id);

  const measured: SupportLevelRecordShapeMeasured = {
    n: cases.length,
    missingSupportLevel,
    leakedSelfRating,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero records supplied — nothing was checked' };
  }
  if (leakedSelfRating.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${leakedSelfRating.length} of ${cases.length} record(s) carry a self-rating, which the review log must never record: ${leakedSelfRating.join(', ')}`,
    };
  }
  if (missingSupportLevel.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${missingSupportLevel.length} of ${cases.length} record(s) are missing supportLevelShown: ${missingSupportLevel.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `all ${cases.length} record(s) carry a shown support level and none carries a self-rating`,
  };
}
