/**
 * CHK-1 — component register row 3.7's health check: **"total floor load
 * against concept count — it should flatten as concepts mature; if it
 * tracks linearly the frequency rule is not working."**
 * (`docs/Olea_component_register.md`, olea-service; `ol-3ux7.8`, discovered
 * from CHK-1 / `ol-3ux7.1`, `findings/CHK-1-algorithm-checks.md`).
 *
 * Same division of labour as every other check in this directory
 * (`./types.ts`'s module doc): computing floor load at a series of
 * successive concept-set sizes is the caller's job — a harness composing
 * (or, per `../session/floor-load.js`'s doc, classifying) a growing
 * synthetic vault — and this function only answers a yes/no question about
 * the resulting series. No `VaultSource`, no clock, no import of
 * `composeSessionRows` or `classifyObligation`.
 *
 * ## What "linear" and "flattening" mean here
 *
 * Floor load's **share of concept count** (`floorLoad / conceptCount`) is
 * the quantity register row 3.7 asks to watch, not the raw count: a system
 * where the frequency rule (the mastery-stage ladder,
 * `RETRIEVAL_BASELINE_STAGE_LADDER_DAYS`) is doing its widening job spends a
 * *shrinking* share of a growing concept set on baseline retrieval, because
 * a growing fraction of that set has matured onto the ladder's widest rung.
 * A system where the rule is not working — every concept baseline-due every
 * day, the "debt queue" `study-session/compose.ts`'s module doc explicitly
 * says this is not — holds that share constant however large the concept
 * set grows.
 *
 * Two structural facts distinguish the two shapes, both computed and
 * neither fitted:
 *
 * 1. **Monotonicity.** The share must never rise from one (successively
 *    larger) sample to the next. A rise anywhere is disqualifying on its
 *    own — flattening does not un-flatten partway through a maturing vault.
 * 2. **A minimum drop.** The share at the largest sampled concept count
 *    must fall at least {@link FLOOR_LOAD_FLATTENING_FLOOR} below the share
 *    at the smallest. This is the one number this check declares rather
 *    than derives — see the constant's own doc for the plain-English
 *    defence — and it exists because monotonicity alone is satisfied by a
 *    share that creeps down by a rounding error and calls that flattening.
 *
 * Both conditions must hold for `ok: true`. Failing either is reported by
 * name, never folded into one boolean with no attribution — the same
 * discipline `checkRankFactorAblation`'s `ol-3ux7.13` diagnosis added for a
 * flat factor's *reason*, kept lightweight here because there are only two
 * reasons to tell apart.
 *
 * ## A check that ran nothing cannot report a pass
 *
 * Fewer than {@link FLOOR_LOAD_MIN_SAMPLES} points, or concept counts that are not
 * strictly increasing across the series, are `ok: false` rather than a
 * vacuous pass — `census-concepts.mjs`'s own floors, and
 * `checkRankFactorAblation`'s zero-cells case, apply the identical rule.
 */
import type { CheckVerdict } from './types.js';

/**
 * One already-computed composition's floor load at a given concept-set
 * size — `../session/floor-load.js`'s `FloorLoadTally`, reduced to what
 * this check needs. `conceptCount` is the size of whatever population the
 * caller classified (every concept a composition considered, or only the
 * ones a budget-limited fill actually offered) — this check does not care
 * which, only that the same choice was made consistently across the series.
 */
export interface FloorLoadSample {
  readonly conceptCount: number;
  readonly floorLoad: number;
}

/** Fewer samples than this cannot show a trend at all. */
export const FLOOR_LOAD_MIN_SAMPLES = 2;

/**
 * The minimum fall in floor load's share of concept count, from the
 * smallest sampled concept count to the largest, required to call the
 * series "flattening" rather than "still tracking close to linearly."
 *
 * **Declared, not derived** (the component register's declared/derived
 * rule, `docs/Olea_component_register.md`) — never fitted against a corpus
 * or an eval set. Plain-English defence: a share that falls by less than a
 * fifth as the sampled vault grows (this check's fixtures span roughly an
 * order of magnitude in concept count) is a share a rounding error could
 * produce; asking for a fifth is asking for a fall a reader would actually
 * notice on the register's own plot, not a proof that the ladder is
 * asymptotically optimal.
 */
export const FLOOR_LOAD_FLATTENING_FLOOR = 0.2;

/**
 * Floating-point slack shared by the monotonicity comparison and the
 * flattening-floor boundary — never wide enough to change which side of
 * either comparison a share meaningfully different from its neighbour or
 * from {@link FLOOR_LOAD_FLATTENING_FLOOR} falls on.
 */
const FLOAT_EPSILON = 1e-9;

export interface FloorLoadLinearityMeasured {
  /** `samples`, sorted ascending by `conceptCount` — what every other field below is computed from. */
  readonly samples: readonly FloorLoadSample[];
  /** `floorLoad / conceptCount` per sample, same order as `samples`. Empty when the series was rejected before a share could be computed. */
  readonly shares: readonly number[];
  /** Whether `shares` never rises from one sample to the next. */
  readonly monotonicNonIncreasing: boolean;
  /** `(shares[0] - shares[last]) / shares[0]`, or `null` when it could not be computed (rejected series, or a zero first share). */
  readonly shareDropFraction: number | null;
}

function rejected(
  samples: readonly FloorLoadSample[],
  detail: string,
): CheckVerdict<FloorLoadLinearityMeasured> {
  return {
    ok: false,
    measured: { samples, shares: [], monotonicNonIncreasing: false, shareDropFraction: null },
    detail,
  };
}

/**
 * `samples[i].floorLoad` against `samples[i].conceptCount`, across
 * successive compositions over a growing concept set — register row 3.7's
 * health check. See the module doc for what "linear" and "flattening" mean
 * here, and for the one declared constant this check uses.
 */
export function checkFloorLoadLinearity(
  samples: readonly FloorLoadSample[],
): CheckVerdict<FloorLoadLinearityMeasured> {
  if (samples.length < FLOOR_LOAD_MIN_SAMPLES) {
    return rejected(
      samples,
      `checkFloorLoadLinearity: need at least ${FLOOR_LOAD_MIN_SAMPLES} compositions at different concept ` +
        `counts to test for a trend, got ${samples.length} — a check that ran nothing cannot ` +
        'report a pass.',
    );
  }

  const sorted = [...samples].sort((a, b) => a.conceptCount - b.conceptCount);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev === undefined || cur === undefined || cur.conceptCount <= prev.conceptCount) {
      return rejected(
        samples,
        'checkFloorLoadLinearity: concept counts must be strictly increasing across the series ' +
          `once sorted — got a tie or a decrease at position ${i}.`,
      );
    }
  }

  const shares = sorted.map((s) => (s.conceptCount === 0 ? 0 : s.floorLoad / s.conceptCount));

  let monotonicNonIncreasing = true;
  for (let i = 1; i < shares.length; i += 1) {
    const prevShare = shares[i - 1];
    const curShare = shares[i];
    if (prevShare === undefined || curShare === undefined) continue;
    if (curShare > prevShare + FLOAT_EPSILON) {
      monotonicNonIncreasing = false;
      break;
    }
  }

  const firstShare = shares[0] ?? 0;
  const lastShare = shares[shares.length - 1] ?? 0;
  const shareDropFraction =
    firstShare === 0
      ? lastShare === 0
        ? 0
        : Number.NEGATIVE_INFINITY
      : (firstShare - lastShare) / firstShare;

  const measured: FloorLoadLinearityMeasured = {
    samples: sorted,
    shares,
    monotonicNonIncreasing,
    shareDropFraction,
  };

  const firstN = sorted[0]?.conceptCount ?? 0;
  const lastN = sorted[sorted.length - 1]?.conceptCount ?? 0;

  if (!monotonicNonIncreasing) {
    return {
      ok: false,
      measured,
      detail:
        "floor load's share of concept count rose at some step across N=" +
        `${sorted.map((s) => s.conceptCount).join(',')} — not monotonically flattening.`,
    };
  }

  // The epsilon guards the boundary itself: a drop fraction that is
  // arithmetically exactly the floor (e.g. 0.4 -> 0.2 shares) can land a
  // hair under it in floating point (0.5 - 0.4 is not exact), and the
  // declared constant is meant to gate on the fraction a reader would
  // compute by hand, not on IEEE-754 rounding.
  const ok = shareDropFraction >= FLOOR_LOAD_FLATTENING_FLOOR - FLOAT_EPSILON;
  const dropPct = (shareDropFraction * 100).toFixed(1);
  const floorPct = (FLOOR_LOAD_FLATTENING_FLOOR * 100).toFixed(0);
  const detail = ok
    ? `floor load's share of concept count fell ${dropPct}% from N=${firstN} to N=${lastN}, ` +
      'never rising in between — flattening, not linear tracking.'
    : `floor load's share of concept count fell only ${dropPct}% from N=${firstN} to N=${lastN}, ` +
      `short of the ${floorPct}% flattening floor — tracks close to linearly with concept count.`;

  return { ok, measured, detail };
}
