/**
 * When a declared demand counts as met now (`ol-egov.141.89.9.4`, made live by
 * `ol-egov.141.89.2.27`) — **`[D-349]`, RULED** (2026-09-25) at option (a),
 * `'qualifying-review'`, below, with a narrower claim: one qualifying success can
 * provisionally demonstrate that particular demand, and missing qualifying
 * evidence means unknown, never inability. R7 (`[D-262]`) requires a
 * demand-shaped claim to rest on scored evidence from an instrument declaring
 * that demand, and says "a single success is an occasion, not a persistent
 * capability, and a sufficiency rule for the latter is not written here". The
 * gap view needs that rule; this is the pure function it is written as.
 *
 * **What "unmet" says, and what it never says.** An unmet demand is one no
 * qualifying review shows *now*. That is a reading of her practice evidence and
 * nothing else: it never claims her material is insufficient (that is the
 * sufficiency verdict's, `[D-414]`), never that the assessment's operation is
 * unknown or outside the five words (an operation no word covers, or a part whose
 * demand could not be read, is not a `PaperDemand`, so it cannot be a
 * `declaredDemands` entry), and never that she cannot do it. Those reasons stay
 * apart (2026-09-29 ruling, "different reasons for unresolved cases"); this
 * module carries the first only, as data, and writes no sentence.
 *
 * - `'qualifying-review'` — option (a), ruled, declared and conservative
 *   (review 3.4): demand *d* is met now for concept *c* when ONE review
 *   satisfies all of: its instrument scores *c* and declares *d*; it
 *   succeeded; the support shown was `independent` (recognition has no
 *   ladder, so a quiz answer is exempt from this condition); for
 *   `recall-a-fact`, it is recall-tier (a quiz answer never shows unaided
 *   recall, whatever its label); the instrument stands now; and it is current
 *   — its own recall estimate now is at or above the retention target. An
 *   instrument with no recall estimate (an explain-back, which is never
 *   scheduled) therefore never meets a demand under this option. **Still
 *   open, the ruling's own follow-up (an open question on
 *   `ol-egov.141.89.2.27`):** the definition of "current", how a later failure
 *   bears on it (today the replayed estimate simply includes it), and how
 *   confidence is expressed.
 * - `'any-past-success'` — option (b), not ruled: any past success from a
 *   standing instrument declaring *d*. Kept as the alternative the ruling
 *   declined; nothing in production names it.
 *
 * Option (c), "no demand-shaped need until outcome extraction is reachable", is
 * simply not calling this function. **The rule is a required argument,
 * deliberately with no default**, so a reader must say which rule it reads.
 * Under every option, evidence of another demand never meets *d* (R7), nothing
 * is inferred from an instrument's tier, proven-invalid evidence never counts
 * (`[D-338]` item 3), a review whose grade a corrected contest proved wrong is
 * dropped as readiness and the recognition credit drop it, and withheld
 * evidence follows `[D-347]`'s option for need.
 *
 * **The two inputs, and where each comes from.**
 *
 * - `instrumentDemands` is a projection over the instrument target record
 *   (`../instrument/demand-reading.ts`'s `projectInstrumentDemands`): `declared`
 *   readings only. An instrument with no record (every instrument that predates
 *   the build), a stale record or an unreadable one is absent, which reads as
 *   "declares none".
 * - `declaredDemands` are the assessment's, per concept, from the examiner-scope
 *   reading (`[D-429]`; `ol-2zfj.153` made extraction reachable). **Absent is
 *   not empty.** A concept whose demands were not read has no entry
 *   ({@link unmetDemandsByConcept} makes none for it), because `[]` would say
 *   "the assessment asks nothing, so nothing is unmet" about a concept nobody
 *   read. An entry, even `[]`, means the demands were read.
 *
 * **Callers.** {@link unmetDemandsByConcept} is the one supplier the gap view
 * reads; its caller is `olea/packages/plugin/src/gap/provider.ts`, the gap
 * view's composition root. **Production supplies no declared demands yet**: the
 * D-429 stores exist but have no per-concept reader and are not wired to the
 * gap provider, so today every concept is unread and every row omits the field.
 * That wiring, not this module, is what makes the rule show anything.
 */

import {
  type ReviewLogEntry,
  type ReviewLogRecord,
  readExplainBackCorrectness,
} from 'olea-contracts';
import {
  DEFAULT_WITHHELD_EVIDENCE_POLICY,
  excludedFromCurrent,
  type PassageChangeFact,
  unresolvedPassageInstrumentIds,
  type WithheldEvidencePolicy,
} from '../mastery/attainment.js';
import { HOLDING_CUT } from '../mastery/rollup.js';
import {
  type InstrumentValidityProjection,
  withoutCorrectedEvidence,
} from '../mastery/validity.js';
import { isRecallTier } from '../mastery/vitality.js';
import type { PaperDemand } from '../oracle/paper-types.js';
import type { Scheduler } from '../scheduler/types.js';
import { type ReplayResult, replaySchedulerStates } from '../session/replay.js';
import { creditsConcept } from '../session/scored-concept.js';

/** `[D-349]`'s options this function implements: (a) is the ruled one. See the module doc. */
export type DemandRule = 'qualifying-review' | 'any-past-success';

const DEMAND_RULES: readonly DemandRule[] = ['qualifying-review', 'any-past-success'];

export interface DemandsMetInput {
  readonly conceptId: string;
  /** The assessment's declared demands for this concept, in its order. Never inferred here. */
  readonly declaredDemands: readonly PaperDemand[];
  /** Per instrument: the demands it declares (`projectInstrumentDemands` over the target records). An instrument absent from the map declares none. */
  readonly instrumentDemands: ReadonlyMap<string, readonly PaperDemand[]>;
  readonly entries: readonly ReviewLogEntry[];
  readonly validity: InstrumentValidityProjection;
  readonly scheduler: Scheduler;
  readonly now: Date;
  /** The retention target "current" is read against. Defaults to `HOLDING_CUT` (identity with it, `[D-115]`). */
  readonly holdingCut?: number;
  /** `[D-347]`'s option. Defaults to today's behaviour ("count"). */
  readonly withheldEvidence?: WithheldEvidencePolicy;
  /** `[D-347]`'s split: changed cited passages and where each stands in revalidation. Absent reads as none changed. */
  readonly passageChanges?: readonly PassageChangeFact[];
}

export interface DemandsMetReading {
  readonly met: ReadonlySet<PaperDemand>;
  /**
   * The declared demands not shown by a qualifying review now, in declared order, without
   * duplicates. This reads "not shown", never "cannot": missing qualifying evidence is unknown.
   */
  readonly unmet: readonly PaperDemand[];
}

function succeeded(review: ReviewLogRecord): boolean {
  if (review.instrumentType === 'explain-back') {
    return readExplainBackCorrectness(review)?.verdict === 'correct';
  }
  return review.rating !== null && review.rating !== 'again';
}

/**
 * The review-log entries every current reading replays: `entries` less the reviews whose grade a
 * corrected contest proved wrong (`[D-338]`; a proven-wrong rating says nothing about her recall).
 */
function standingEntries(
  entries: readonly ReviewLogEntry[],
  validity: InstrumentValidityProjection,
): readonly ReviewLogEntry[] {
  return withoutCorrectedEvidence(entries, validity.correctedEvidence);
}

/** One concept's reading over already-standing entries. `declared` is non-empty and duplicate-free. */
function readOneConcept(
  input: DemandsMetInput,
  declared: readonly PaperDemand[],
  rule: DemandRule,
  standing: readonly ReviewLogEntry[],
  replayed: ReplayResult | null,
): DemandsMetReading {
  const policy = input.withheldEvidence ?? DEFAULT_WITHHELD_EVIDENCE_POLICY;
  const cut = input.holdingCut ?? HOLDING_CUT;
  const unresolvedPassage = unresolvedPassageInstrumentIds(input.passageChanges, input.now);
  const met = new Set<PaperDemand>();

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

  for (const entry of standing) {
    if (entry.kind !== 'review') continue;
    // `[D-423]`: a review is evidence only for its scored concept, never for one it names as context.
    if (!creditsConcept(entry, input.conceptId)) continue;
    const declaresHere = input.instrumentDemands.get(entry.instrumentId) ?? [];
    if (declaresHere.length === 0) continue;
    if (excludedFromCurrent(entry.instrumentId, 'need', input.validity, policy, unresolvedPassage))
      continue;
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

function assertRule(rule: DemandRule): void {
  if (!DEMAND_RULES.includes(rule)) {
    throw new Error(`demandsMetNow: rule must be one of ${DEMAND_RULES.join(', ')}, got ${rule}`);
  }
}

/** Which declared demands are met now for one concept, under the rule the caller names. */
export function demandsMetNow(input: DemandsMetInput, rule: DemandRule): DemandsMetReading {
  assertRule(rule);
  const declared = [...new Set(input.declaredDemands)];
  if (declared.length === 0) return { met: new Set(), unmet: [] };
  const standing = standingEntries(input.entries, input.validity);
  const replayed =
    rule === 'qualifying-review' ? replaySchedulerStates(standing, input.scheduler) : null;
  return readOneConcept(input, declared, rule, standing, replayed);
}

/**
 * What {@link unmetDemandsByConcept} reads: {@link DemandsMetInput}'s shared inputs once, and the
 * declared demands for every concept whose demands were read.
 */
export interface UnmetDemandsInput extends Omit<DemandsMetInput, 'conceptId' | 'declaredDemands'> {
  /**
   * Per concept KEY (the opaque join key, as `entries`' `conceptIds` carry it): the assessment's
   * declared demands, present **only for a concept whose demands were read**. `undefined` means no
   * concept's demands were read. **Absent is not empty**: a concept with no entry is not read as
   * "asks nothing"; an entry of `[]` is a concept that was read and states no demand.
   */
  readonly declaredDemands: ReadonlyMap<string, readonly PaperDemand[]> | undefined;
}

/**
 * The gap view's `unmetDemands` input (`./build.ts`): per concept whose declared demands were
 * read, the demands not met now under the ruled rule (`'qualifying-review'`, `[D-349]`).
 *
 * **A concept whose demands were not read has no entry** — never `[]` — so the row omits the
 * field and "not yet known" never reads "all met". An entry exists exactly when the concept
 * appears in `declaredDemands`, and its list is `demandsMetNow(…, 'qualifying-review').unmet`.
 * The review log is replayed once for all concepts, not once per concept.
 */
export function unmetDemandsByConcept(
  input: UnmetDemandsInput,
): ReadonlyMap<string, readonly PaperDemand[]> {
  const unmet = new Map<string, readonly PaperDemand[]>();
  if (input.declaredDemands === undefined) return unmet;
  const standing = standingEntries(input.entries, input.validity);
  let replayed: ReplayResult | undefined;
  for (const [conceptId, demands] of input.declaredDemands) {
    const declared = [...new Set(demands)];
    if (declared.length === 0) {
      unmet.set(conceptId, []);
      continue;
    }
    replayed ??= replaySchedulerStates(standing, input.scheduler);
    const reading = readOneConcept(
      { ...input, conceptId, declaredDemands: declared },
      declared,
      'qualifying-review',
      standing,
      replayed,
    );
    unmet.set(conceptId, reading.unmet);
  }
  return unmet;
}
