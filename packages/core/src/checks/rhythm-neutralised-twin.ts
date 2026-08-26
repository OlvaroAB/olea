/**
 * Component register row 4.4's named health check, for the rhythm reading
 * (`../today/rhythm.js`, `ol-ggz3`).
 *
 * The row states the method in its own words: *"run it over constructed
 * terms and report, as an exact count, how often it fires on a course
 * merely between lecture cycles versus one genuinely gone quiet — the
 * neutralised-twin method."* Same family as `misconception-merge-boundary.ts`
 * (this directory's own pattern): the algorithm has already run — a caller
 * (a test, a workbench inspector) constructs a genuine case and its
 * neutralised twin, runs `detectRhythm` on each, and hands the two verdicts
 * here. This module does no I/O and calls no detector itself.
 *
 * ## Two different failures, held to two different bars
 *
 * - **Decorative** (`realStatus === neutralisedStatus`): the reading said the
 *   identical thing about a course genuinely gone quiet and about its twin
 *   with the quiet signal removed. This is the one this check FAILS on,
 *   unconditionally — a reading that cannot tell the two apart is exactly
 *   the "decoration" this bead's own brief names, and there is no
 *   `MIN_NEAR_STUDY_DAYS`-style floor to reach for here: `detectRhythm` has
 *   one constant, and a threshold that cannot separate a 40-day silence from
 *   a 2-day one is broken, not under-tuned.
 * - **False positive on the twin** (`neutralisedStatus === 'observed'`): the
 *   reading fired on a course that was only between lecture cycles. This is
 *   measured and reported as an exact count, **never gated** — the same
 *   discipline row 4.2's cramming detector uses for its own neutralised-twin
 *   false positives (8/40, reported rather than tuned away). The register's
 *   own row 4.4 leaves this open: *"whether [a measured false-positive rate]
 *   is an acceptable operating point [is] a threshold decision with an
 *   owner, not settled in the test that found it."*
 */
import type { RhythmStatus } from '../today/rhythm.js';
import type { CheckVerdict } from './types.js';

export interface RhythmTwinCase {
  /** Opaque case id — never a real course code or note title (INV-3). */
  readonly id: string;
  /** What `detectRhythm` returned for the genuinely-quiet construction. */
  readonly realStatus: RhythmStatus;
  /** What `detectRhythm` returned for the SAME case with only the quiet signal neutralised (e.g. a normal between-lecture-cycle gap in place of genuine silence). */
  readonly neutralisedStatus: RhythmStatus;
}

export interface RhythmNeutralisedTwinMeasured {
  readonly n: number;
  /** Ids where the real case and its neutralised twin read identically — the reading told them apart at all only if this is empty. */
  readonly decorative: readonly string[];
  /** Ids where the neutralised twin (merely between lecture cycles) still fired `observed`. Reported, never gated. */
  readonly falsePositiveOnTwin: readonly string[];
}

/**
 * Fails on any decorative pair, or if zero cases were supplied (N-013).
 * `falsePositiveOnTwin` is always reported in `measured` and never affects
 * `ok` — see this module's doc for why that asymmetry is deliberate.
 */
export function checkRhythmNeutralisedTwin(
  cases: readonly RhythmTwinCase[],
): CheckVerdict<RhythmNeutralisedTwinMeasured> {
  const decorative = cases.filter((c) => c.realStatus === c.neutralisedStatus).map((c) => c.id);
  const falsePositiveOnTwin = cases
    .filter((c) => c.neutralisedStatus === 'observed')
    .map((c) => c.id);

  const measured: RhythmNeutralisedTwinMeasured = {
    n: cases.length,
    decorative,
    falsePositiveOnTwin,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero cases supplied — nothing was checked' };
  }
  if (decorative.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${decorative.length} of ${cases.length} case(s) read identically on the real course and its neutralised twin — decorative: ${decorative.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `every case separated the real course from its neutralised twin; ${falsePositiveOnTwin.length} of ${cases.length} twin(s) still read observed (reported, not gated)`,
  };
}
