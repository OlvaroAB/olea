/**
 * When a declared demand counts as met now (`ol-egov.141.89.9.4`) —
 * **`[D-349]`, OPEN** (the attainment chain spec's proposal 5, in
 * `olea-service`). R7 (`[D-262]`) requires a demand-shaped claim to rest on
 * scored evidence from an instrument declaring that demand, and says "a
 * single success is an occasion, not a persistent capability, and a
 * sufficiency rule for the latter is not written here". The gap view needs
 * that rule; this is the pure function the ruling will pick an option of.
 *
 * - `'qualifying-review'` — option (a), the spec's recommendation, declared
 *   and conservative (review 3.4): demand *d* is met now for concept *c* when
 *   ONE review satisfies all of: its instrument scores *c* and declares *d*;
 *   it succeeded; the support shown was `independent` (recognition has no
 *   ladder, so a quiz answer is exempt from this condition); for
 *   `recall-a-fact`, it is recall-tier (a quiz answer never shows unaided
 *   recall, whatever its label); the instrument stands now; and it is current
 *   — its own recall estimate now is at or above the retention target. An
 *   instrument with no recall estimate (an explain-back, which is never
 *   scheduled) therefore never meets a demand under this option: a
 *   consequence the ruling should state.
 * - `'any-past-success'` — option (b): any past success from a standing
 *   instrument declaring *d*.
 *
 * Option (c), "no demand-shaped need until outcome extraction is
 * reachable", is simply not calling this function. **The rule is a required
 * argument, deliberately with no default**: while `[D-349]` is open, a reader
 * adopting a rule must say which, rather than inheriting one. Under every
 * option, evidence of another demand never meets *d* (R7), nothing is
 * inferred from an instrument's tier, and proven-invalid evidence never
 * counts (`[D-338]` item 3); withheld evidence follows `[D-347]`'s option for
 * need.
 *
 * **No caller yet, and no demand reaches the client yet**: declared demands
 * per assessment are `SCP`'s (outcome extraction, `ol-2zfj.153`), and
 * demand-aware readiness is `ol-v7r5.65`, which follows this build.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import {
  DEFAULT_WITHHELD_EVIDENCE_POLICY,
  excludedFromCurrent,
  type WithheldEvidencePolicy,
} from '../mastery/attainment.js';
import { HOLDING_CUT } from '../mastery/rollup.js';
import type { InstrumentValidityProjection } from '../mastery/validity.js';
import { isRecallTier } from '../mastery/vitality.js';
import type { PaperDemand } from '../oracle/paper-types.js';
import type { Scheduler } from '../scheduler/types.js';
import { replaySchedulerStates } from '../session/replay.js';

/** `[D-349]`'s options this function implements. See the module doc. */
export type DemandRule = 'qualifying-review' | 'any-past-success';

const DEMAND_RULES: readonly DemandRule[] = ['qualifying-review', 'any-past-success'];

export interface DemandsMetInput {
  readonly conceptId: string;
  /** The assessment's declared demands for this concept, in its order. Never inferred here. */
  readonly declaredDemands: readonly PaperDemand[];
  /** Per instrument: the demands it declares. An instrument absent from the map declares none. */
  readonly instrumentDemands: ReadonlyMap<string, readonly PaperDemand[]>;
  readonly entries: readonly ReviewLogEntry[];
  readonly validity: InstrumentValidityProjection;
  readonly scheduler: Scheduler;
  readonly now: Date;
  /** The retention target "current" is read against. Defaults to `HOLDING_CUT` (identity with it, `[D-115]`). */
  readonly holdingCut?: number;
  /** `[D-347]`, open. Defaults to today's behaviour ("count"). */
  readonly withheldEvidence?: WithheldEvidencePolicy;
}

export interface DemandsMetReading {
  readonly met: ReadonlySet<PaperDemand>;
  /** The declared demands not met now, in declared order, without duplicates. */
  readonly unmet: readonly PaperDemand[];
}

function succeeded(review: ReviewLogRecord): boolean {
  if (review.instrumentType === 'explain-back') {
    return review.explainBackGrade?.correctness === 'correct';
  }
  return review.rating !== null && review.rating !== 'again';
}

/** Which declared demands are met now for one concept, under the rule the caller names. */
export function demandsMetNow(input: DemandsMetInput, rule: DemandRule): DemandsMetReading {
  if (!DEMAND_RULES.includes(rule)) {
    throw new Error(`demandsMetNow: rule must be one of ${DEMAND_RULES.join(', ')}, got ${rule}`);
  }
  const policy = input.withheldEvidence ?? DEFAULT_WITHHELD_EVIDENCE_POLICY;
  const cut = input.holdingCut ?? HOLDING_CUT;
  const declared = [...new Set(input.declaredDemands)];
  const met = new Set<PaperDemand>();
  if (declared.length === 0) return { met, unmet: [] };

  const replayed =
    rule === 'qualifying-review' ? replaySchedulerStates(input.entries, input.scheduler) : null;
  const currentByInstrument = new Map<string, boolean>();
  const isCurrent = (instrumentId: string): boolean => {
    const cached = currentByInstrument.get(instrumentId);
    if (cached !== undefined) return cached;
    const state = replayed?.states.get(instrumentId)?.state ?? null;
    const current =
      state !== null &&
      input.scheduler.retrievability({ instrumentId, state, now: input.now }).recallProbability >=
        cut;
    currentByInstrument.set(instrumentId, current);
    return current;
  };

  for (const entry of input.entries) {
    if (entry.kind !== 'review') continue;
    if (!entry.conceptIds.includes(input.conceptId)) continue;
    const declaresHere = input.instrumentDemands.get(entry.instrumentId) ?? [];
    if (declaresHere.length === 0) continue;
    if (excludedFromCurrent(entry.instrumentId, 'need', input.validity, policy)) continue;
    if (!succeeded(entry)) continue;

    for (const demand of declaresHere) {
      if (!declared.includes(demand) || met.has(demand)) continue;
      if (rule === 'qualifying-review') {
        const recognition = entry.instrumentType === 'mcq';
        if (!recognition && entry.supportLevelShown !== 'independent') continue;
        if (demand === 'recall-a-fact' && !isRecallTier(entry.instrumentType)) continue;
        if (!isCurrent(entry.instrumentId)) continue;
      }
      met.add(demand);
    }
  }

  return { met, unmet: declared.filter((demand) => !met.has(demand)) };
}
