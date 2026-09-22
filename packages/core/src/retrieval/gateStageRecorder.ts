/**
 * `GateStageRecorder` — the aggregator half of `[JEV-11]` (`ol-3ux7.96`).
 *
 * `groundedContext.ts`'s `onStage` callback hands one `GateStage` per request;
 * this module is the smallest thing that turns a stream of those into the
 * number the study needs — what share of gate requests the judge decided.
 * **It is an in-memory counter, nothing more.** No network call, no disk
 * write, no vault access: those decisions belong to whatever composes this
 * class into a real client (`main.ts`'s job, per the boundary document's
 * ownership rule), not to a module living beside the pure gate logic.
 *
 * **Privacy (`[JEV-11]`, D-005).** The only value this class ever stores is
 * an integer count keyed by `GateStage`. It has no field, method or code path
 * that can hold a query, a chunk, a path or anything derived from her
 * content — there is nothing here for content to travel *through*.
 */

import type { GateStage } from './groundedContext.js';

const ALL_STAGES: readonly GateStage[] = [
  'no-hits',
  'composite-unavailable',
  'composite-veto',
  'below-band',
  'above-band',
  'relevance-empty',
  'escalated-to-judge',
];

/** Counts only — the one figure a study or an operator may read off this. */
export interface GateStageSummary {
  readonly total: number;
  readonly counts: Readonly<Record<GateStage, number>>;
  /** `counts['escalated-to-judge'] / total`, or `null` when `total` is 0 (nothing to divide). */
  readonly judgeShare: number | null;
}

/**
 * Accumulates `GateStage` counts across many gate requests. Pass its
 * `record` method as `onStage` to `assembleBandedGroundedContext` /
 * `resolveGroundedContext` and call `summary()` whenever the share is
 * needed — over a session, a day, or whatever period the caller chooses to
 * reset the recorder for.
 */
export class GateStageRecorder {
  private readonly counts = new Map<GateStage, number>(ALL_STAGES.map((s) => [s, 0]));

  /** Bound so it can be passed directly as `onStage` without `.bind(this)`. */
  readonly record = (stage: GateStage): void => {
    this.counts.set(stage, (this.counts.get(stage) ?? 0) + 1);
  };

  summary(): GateStageSummary {
    const counts = Object.fromEntries(this.counts) as Record<GateStage, number>;
    const total = ALL_STAGES.reduce((sum, s) => sum + counts[s], 0);
    const judgeShare = total === 0 ? null : counts['escalated-to-judge'] / total;
    return { total, counts, judgeShare };
  }

  /** Zeroes every count, for starting a fresh measurement period. */
  reset(): void {
    for (const s of ALL_STAGES) this.counts.set(s, 0);
  }
}
