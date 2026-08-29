/**
 * Component register row 4.4's named health check, for the calendar-schedule
 * freshness path (`../schedule/freshness.ts`'s `computeCourseFreshness`,
 * `ol-hna1` / `ol-at1a`). Filed as the primary-path residual on `ol-v7r5.14`:
 * the flat fallback (`../today/rhythm.ts`) already has
 * `./rhythm-neutralised-twin.ts`, and `view.ts` reaches for the
 * calendar-schedule signal FIRST when a with-yardstick reading exists
 * (`pickRhythmYardstickReading` in `packages/plugin/src/today/copy.ts`), so
 * the primary path had no health check of its own.
 *
 * Same family as `./rhythm-neutralised-twin.ts` (mirrored deliberately, not
 * reinvented): the algorithm has already run — a caller (a test, a workbench
 * inspector) constructs a genuinely-quiet course and its neutralised twin
 * (the identical construction with the quiet signal replaced by an ordinary
 * between-lecture-cycle gap), runs `computeCourseFreshness` on each, and
 * hands both readings' `.status` here. This module does no I/O and calls no
 * detector itself.
 *
 * **`CourseFreshnessStatus` is three-valued, not two-valued like
 * `RhythmStatus`** — `arrived`, `not-arrived-with-yardstick`,
 * `not-arrived-no-yardstick` (`../schedule/types.ts`). "Between lecture
 * cycles" always means `arrived`: nothing overdue was found, whether because
 * material genuinely arrived or because no session is due yet. Either
 * not-arrived state means the reading fired.
 *
 * ## Two different failures, held to two different bars — same asymmetry `./rhythm-neutralised-twin.ts` holds
 *
 * - **Decorative** (`realStatus === neutralisedStatus`): the reading said the
 *   identical thing about a course genuinely gone quiet and about its twin
 *   with the quiet signal removed. Failed unconditionally — a status that
 *   cannot tell "gone quiet" from "between cycles" apart is broken, not
 *   under-tuned.
 * - **False positive on the twin** (`neutralisedStatus !== 'arrived'`): the
 *   reading fired (either not-arrived state) on a course that was only
 *   between lecture cycles. Measured and reported as an exact count,
 *   **never gated** — the same discipline `./rhythm-neutralised-twin.ts` and
 *   row 4.2's cramming detector use for their own neutralised-twin false
 *   positives.
 */
import type { CourseFreshnessStatus } from '../schedule/types.js';
import type { CheckVerdict } from './types.js';

export interface ScheduleFreshnessTwinCase {
  /** Opaque case id — never a real course code or note title (INV-3). */
  readonly id: string;
  /** What `computeCourseFreshness` returned for the genuinely-quiet construction. */
  readonly realStatus: CourseFreshnessStatus;
  /**
   * What `computeCourseFreshness` returned for the SAME construction with
   * only the quiet signal neutralised (e.g. the material having actually
   * arrived, in place of it never arriving) — "merely between lecture
   * cycles" reads as `arrived` here, never as either not-arrived state.
   */
  readonly neutralisedStatus: CourseFreshnessStatus;
}

export interface ScheduleFreshnessNeutralisedTwinMeasured {
  readonly n: number;
  /** Ids where the real case and its neutralised twin read identically — the reading told them apart at all only if this is empty. */
  readonly decorative: readonly string[];
  /** Ids where the neutralised twin (merely between lecture cycles) still fired one of the two not-arrived statuses. Reported, never gated. */
  readonly falsePositiveOnTwin: readonly string[];
}

/**
 * Fails on any decorative pair, or if zero cases were supplied (N-013).
 * `falsePositiveOnTwin` is always reported in `measured` and never affects
 * `ok` — see this module's doc for why that asymmetry is deliberate.
 */
export function checkScheduleFreshnessNeutralisedTwin(
  cases: readonly ScheduleFreshnessTwinCase[],
): CheckVerdict<ScheduleFreshnessNeutralisedTwinMeasured> {
  const decorative = cases.filter((c) => c.realStatus === c.neutralisedStatus).map((c) => c.id);
  const falsePositiveOnTwin = cases
    .filter((c) => c.neutralisedStatus !== 'arrived')
    .map((c) => c.id);

  const measured: ScheduleFreshnessNeutralisedTwinMeasured = {
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
    detail: `every case separated the real course from its neutralised twin; ${falsePositiveOnTwin.length} of ${cases.length} twin(s) still read as a not-arrived status (reported, not gated)`,
  };
}
