/**
 * The attainment entry point (`ol-egov.141.89.9.4`; the attainment chain
 * spec's sections 2.3 to 2.5 and 8 in `olea-service`) — **one fold every
 * reader of a concept's stage, award, vitality, readiness and need can read,
 * over the whole log, with one validity projection (`./validity.ts`).**
 *
 * Pure logic only. Nothing here is wired yet: moving each reader (Today's
 * panel, the registry, the grove, the ranking, the gap view, the strong-recall
 * proposal, the retrospective and the review stamp) onto this entry point,
 * and the readiness producer's caller, are `ol-egov.141.89.9.5`'s and the
 * beads the spec's section 10 places before it. Until then every existing
 * reader keeps its behaviour, and this module changes nothing she sees.
 *
 * ## The stage: displayed, awarded, and the note between them (`[D-338]`)
 *
 * - **Displayed** — {@link foldConceptStage} over the evidence that stands
 *   now: the instruments proven invalid now are removed at EVERY stage, not
 *   only the top one (`[D-338]` items 2 and 3; the chain spec's item 5).
 *   Withheld-but-valid evidence (her suspension, a changed passage, a
 *   successor) is kept (`[D-338]` items 2 and 4; R3; F8.5).
 * - **The historical award** — the earliest instant at which an attempt
 *   qualifying for the top stage STOOD, judged against the validity known at
 *   that instant: the same fold, as of that instant, with the instruments
 *   proven invalid as of then. A later proven defect, a re-grade logged
 *   later, her withdrawal, a changed passage or forgetting never lowers it
 *   (`[D-338]` item 1). **An in-memory fold, never stored** — the chain spec's
 *   proposal 1 option (b); whether the award is instead a stored event is
 *   `[D-345]`, open, and either way this fold is what computes it. No surface
 *   reads the award until a clause names one.
 * - **The correction note** — present exactly when the displayed stage is
 *   below the highest stage that ever stood; it names the proven-invalid facts
 *   behind the drop (rejected, corrected on contest, re-graded). Its words
 *   are the vocabulary registry's to add with `[D-338]`'s contract text; this
 *   module returns facts, never prose.
 *
 * Within one arithmetic version the award never falls, and the displayed
 * stage falls only at a proven-invalid event (the prefix property, the
 * spec's class A8). A version that lowers a reading is a ruled change: that
 * is why every reading here carries {@link attainmentArithmeticVersion}.
 *
 * ## Current readings: one eligibility rule
 *
 * Vitality, readiness, need and the recognition credit exclude proven-invalid
 * instruments always (`[D-338]` item 3). What they do with withheld-but-valid
 * ones is `[D-347]`, open — built as {@link WithheldEvidencePolicy} with
 * today's behaviour ("count them") as the default. Readiness additionally
 * needs an unaided (independent) success (`[D-264]`); need carries a basis
 * (`[D-348]`, ruled: unknown enters at a declared value, never worded as a
 * deficit); the recognition credit reads only a correct answer that is
 * current and standing (review 3.4; `ol-lfhj`; `[D-278]`).
 *
 * **Operational failure is never a fact about her**: an event whose
 * timestamp cannot be read is left out of an as-of fold, and a concept the
 * log never names reads seed, too early to say, and unknown need.
 */

import type {
  MasteryState,
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
  SupportLevel,
} from 'olea-contracts';
import type { Scheduler } from '../scheduler/types.js';
import { type ReplayResult, replaySchedulerStates } from '../session/replay.js';
import {
  type ConceptMasteryResult,
  conceptVitalityInstruments,
  DEFAULT_SAPLING_RULE,
  foldConceptStage,
  HOLDING_CUT,
  type MasteryRollupOptions,
  reviewRecordsForConcept,
  type SaplingRule,
} from './rollup.js';
import type { InstrumentValidityProjection, ProvenInvalidReason } from './validity.js';
import {
  isRecallTier,
  type ReadinessRecallReading,
  readReadinessRecall,
  readVitality,
  type VitalityInstrument,
  type VitalityReading,
} from './vitality.js';

/**
 * The fold rule's own version. Bumped whenever the stage, award, note or
 * eligibility arithmetic here changes meaning. The full arithmetic version a
 * reading carries adds each open rule's chosen option and the scheduler
 * configuration's version ({@link attainmentArithmeticVersion}).
 */
export const ATTAINMENT_FOLD_VERSION = 'att-fold-1';

/**
 * **What current readings do with an instrument withheld but not proven
 * invalid — `[D-347]`, OPEN** (the chain spec's proposal 3). Her suspension
 * (F2.6) or withdrawal (F8.5), a passage change pending revalidation, a
 * predecessor replaced by a successor. The displayed stage and the award keep
 * this evidence under every option.
 *
 * - `'count'` — (a), **today's behaviour and the default until ruled**: every
 *   current reading counts it.
 * - `'drop-from-readiness-and-need'` — (b): readiness and need drop it while
 *   withheld; vitality keeps it.
 * - `'drop-from-every-current-reading'` — (c), the spec's recommendation:
 *   vitality, readiness and need all drop it, and take it back when restored.
 *
 * Note what the log can say today: a suspension has no reason
 * (`./validity.ts`), so a revision's suspension and her own read alike; the
 * option applies to both. `[D-338]` item 4's "readiness moves on a revision"
 * becomes expressible apart from her choice only once `[D-345]` gives the
 * event a reason.
 */
export type WithheldEvidencePolicy =
  | 'count'
  | 'drop-from-readiness-and-need'
  | 'drop-from-every-current-reading';

/** `[D-347]` is open: today's behaviour. See {@link WithheldEvidencePolicy}. */
export const DEFAULT_WITHHELD_EVIDENCE_POLICY: WithheldEvidencePolicy = 'count';

const WITHHELD_POLICIES: readonly WithheldEvidencePolicy[] = [
  'count',
  'drop-from-readiness-and-need',
  'drop-from-every-current-reading',
];

/**
 * **Need's value when its basis is unknown — `[D-348]`, RULED** (the chain
 * spec's proposal 4; registry §22). Declared, never fitted: nothing she has
 * shown lowers it, so it enters at 1, the value a never-practised concept
 * has in the ranking today (`../oracle/rank.ts`'s mastery-need ladder for
 * `seed`). It is never a measured zero in readiness (`[D-264]`), and every
 * surface that words it says it is unknown, never that she is weak — the
 * ruling's point, per registry §22. The ruling's alternative, a declared
 * middle value, can be handed in to {@link readNeed}.
 */
export const UNKNOWN_NEED_VALUE = 1;

/** Options every attainment reading takes. Every default is today's behaviour. */
export interface AttainmentOptions
  extends Pick<
    MasteryRollupOptions,
    | 'minSpacedRetrievalDays'
    | 'depthGate'
    | 'admittedSupportLevels'
    | 'saplingRule'
    | 'explanationMissingEventIds'
  > {
  /** `[D-347]`, open. Defaults to {@link DEFAULT_WITHHELD_EVIDENCE_POLICY}. */
  readonly withheldEvidence?: WithheldEvidencePolicy;
  /**
   * The scheduler configuration version to stamp on stage readings, which do
   * not themselves read the scheduler. Current readings take it from the
   * scheduler they are handed. Absent reads as `unknown`, never guessed.
   */
  readonly schedulerVersion?: string;
}

/** The inputs of the one arithmetic version string. */
export interface ArithmeticVersionInput {
  readonly saplingRule: SaplingRule;
  readonly withheldEvidence: WithheldEvidencePolicy;
  readonly schedulerVersion?: string | undefined;
}

/**
 * The arithmetic version every attainment reading carries: the fold rule's
 * version, the option chosen for each open rule, and the scheduler
 * configuration's version — what `ol-95vv.8`'s stamp will record beside a
 * belief, so a reading can always say which arithmetic produced it (X4).
 */
export function attainmentArithmeticVersion(input: ArithmeticVersionInput): string {
  return [
    ATTAINMENT_FOLD_VERSION,
    `sapling=${input.saplingRule}`,
    `withheld=${input.withheldEvidence}`,
    `scheduler=${input.schedulerVersion ?? 'unknown'}`,
  ].join(';');
}

function withheldPolicyOf(options: AttainmentOptions): WithheldEvidencePolicy {
  const policy = options.withheldEvidence ?? DEFAULT_WITHHELD_EVIDENCE_POLICY;
  if (!WITHHELD_POLICIES.includes(policy)) {
    throw new Error(
      `attainment: withheldEvidence must be one of ${WITHHELD_POLICIES.join(', ')}, got ${policy}`,
    );
  }
  return policy;
}

function versionOf(options: AttainmentOptions, schedulerVersion: string | undefined): string {
  return attainmentArithmeticVersion({
    saplingRule: options.saplingRule ?? DEFAULT_SAPLING_RULE,
    withheldEvidence: withheldPolicyOf(options),
    schedulerVersion,
  });
}

function rollupOptionsOf(options: AttainmentOptions): MasteryRollupOptions {
  return {
    ...(options.minSpacedRetrievalDays !== undefined
      ? { minSpacedRetrievalDays: options.minSpacedRetrievalDays }
      : {}),
    ...(options.depthGate !== undefined ? { depthGate: options.depthGate } : {}),
    ...(options.admittedSupportLevels !== undefined
      ? { admittedSupportLevels: options.admittedSupportLevels }
      : {}),
    ...(options.saplingRule !== undefined ? { saplingRule: options.saplingRule } : {}),
    ...(options.explanationMissingEventIds !== undefined
      ? { explanationMissingEventIds: options.explanationMissingEventIds }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The stage, the award and the note
// ---------------------------------------------------------------------------

/** `[D-338]` item 1's historical award: when she first reached the top stage, on which attempt. */
export interface TopStageAward {
  readonly stage: 'tree';
  /** The qualifying attempt's event id. */
  readonly attemptEventId: string;
  readonly instrumentId: string;
  /** The attempt's timestamp, as written. */
  readonly attemptAt: string;
  /**
   * When the attempt first STOOD. The attempt's own timestamp, unless its
   * instrument was not standing then and came to stand later (a rejection
   * reversed), in which case the instant it came to stand, in ISO form.
   */
  readonly standingFrom: string;
}

/** One proven-invalid fact behind a correction. */
export type CorrectionFact =
  | {
      readonly kind: 'instrument';
      readonly instrumentId: string;
      readonly reason: ProvenInvalidReason;
      /** The proving event. */
      readonly eventId: string;
      readonly at: string;
    }
  | {
      readonly kind: 'regraded';
      /** The instrument the superseded attempt was on. */
      readonly instrumentId: string;
      readonly supersededEventId: string;
      /** The corrective re-grade. */
      readonly byEventId: string;
      readonly at: string;
    };

/**
 * `[D-338]` item 2's note: the displayed stage is below a stage that stood,
 * because evidence was proven invalid. Facts only; the words are the
 * vocabulary registry's.
 */
export interface StageCorrection {
  /** The highest stage that ever stood, judged against the validity known at each instant. */
  readonly from: MasteryState;
  /** The displayed stage now. */
  readonly to: MasteryState;
  readonly facts: readonly CorrectionFact[];
}

/** One concept's attainment, from the one entry point. */
export interface ConceptAttainment {
  readonly conceptId: string;
  /** The displayed stage and the evidence it rests on — over evidence that stands now. */
  readonly displayed: ConceptMasteryResult;
  readonly award: TopStageAward | null;
  /** Present exactly when the displayed stage is below a stage that stood. */
  readonly correction: StageCorrection | null;
  /** Instruments with evidence for this concept whose grade is contested and unresolved: thin, never absent (`[D-095]`). */
  readonly thinEvidenceInstrumentIds: readonly string[];
  readonly arithmeticVersion: string;
}

const STAGE_ORDER: readonly MasteryState[] = ['seed', 'sprout', 'sapling', 'tree'];

function stageRank(state: MasteryState): number {
  return STAGE_ORDER.indexOf(state);
}

function sortedDistinct(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}

function correctionFacts(
  records: readonly ReviewLogRecord[],
  validity: InstrumentValidityProjection,
): CorrectionFact[] {
  const facts: CorrectionFact[] = [];
  const instrumentIds = [...new Set(records.map((record) => record.instrumentId))].sort();
  for (const instrumentId of instrumentIds) {
    const fact = validity.provenInvalid.get(instrumentId);
    if (fact === undefined) continue;
    facts.push({
      kind: 'instrument',
      instrumentId,
      reason: fact.reason,
      eventId: fact.eventId,
      at: fact.at,
    });
  }
  const correctAttempts = new Map<string, ReviewLogRecord>();
  for (const record of records) {
    if (record.explainBackGrade?.correctness === 'correct') {
      correctAttempts.set(record.eventId, record);
    }
  }
  for (const record of records) {
    const revisionOf = record.explainBackGrade?.revisionOf;
    if (revisionOf === undefined || revisionOf === null) continue;
    const superseded = correctAttempts.get(revisionOf);
    if (superseded === undefined) continue;
    facts.push({
      kind: 'regraded',
      instrumentId: superseded.instrumentId,
      supersededEventId: revisionOf,
      byEventId: record.eventId,
      at: record.timestamp,
    });
  }
  return facts.sort((a, b) => {
    const byInstant = Date.parse(a.at) - Date.parse(b.at);
    if (byInstant !== 0 && Number.isFinite(byInstant)) return byInstant;
    const aId = a.kind === 'instrument' ? a.eventId : a.byEventId;
    const bId = b.kind === 'instrument' ? b.eventId : b.byEventId;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

/**
 * One concept's displayed stage, historical award and correction note — the
 * one entry point (see the module doc). Pure: same log, same validity, same
 * options, same reading.
 */
export function readConceptAttainment(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  validity: InstrumentValidityProjection,
  options: AttainmentOptions = {},
): ConceptAttainment {
  const rollup = rollupOptionsOf(options);
  const arithmeticVersion = versionOf(options, options.schedulerVersion);
  const records = reviewRecordsForConcept(entries, conceptId);

  const provenNow = new Set(validity.provenInvalid.keys());
  const displayed = foldConceptStage(entries, conceptId, rollup, {
    excludedInstrumentIds: provenNow,
  });
  // The cheap upper bound: every record, no validity, no supersession. No
  // stage above it ever stood, so when it equals the displayed stage there is
  // nothing to correct, and when it does not qualify for the top stage there
  // is no award — the as-of scans below run only when they can matter.
  const upper = foldConceptStage(entries, conceptId, rollup, { supersession: 'ignored' });

  const asOfFold = (instant: number): ConceptMasteryResult =>
    foldConceptStage(entries, conceptId, rollup, {
      asOf: instant,
      excludedInstrumentIds: new Set(validity.provenInvalidAsOf(instant).keys()),
    });

  let award: TopStageAward | null = null;
  if (upper.evidence.topStageQualified) {
    // An attempt can first stand only at its own instant or when its
    // instrument comes to stand again; supersession only ever removes.
    const attemptInstants = records
      .filter((record) => record.explainBackGrade !== undefined)
      .map((record) => Date.parse(record.timestamp));
    const earliest = Math.min(...attemptInstants.filter((instant) => Number.isFinite(instant)));
    const candidates = sortedDistinct([
      ...attemptInstants,
      ...validity.changeInstants.filter((instant) => instant >= earliest),
    ]);
    for (const instant of candidates) {
      const attempt = asOfFold(instant).evidence.topStageAttempt;
      if (attempt === undefined || attempt === null) continue;
      award = {
        stage: 'tree',
        attemptEventId: attempt.eventId,
        instrumentId: attempt.instrumentId,
        attemptAt: attempt.at,
        standingFrom:
          Date.parse(attempt.at) === instant ? attempt.at : new Date(instant).toISOString(),
      };
      break;
    }
  }

  let correction: StageCorrection | null = null;
  if (stageRank(upper.state) > stageRank(displayed.state)) {
    let highest = displayed.state;
    const candidates = sortedDistinct([
      ...records.map((record) => Date.parse(record.timestamp)),
      ...validity.changeInstants,
    ]);
    for (const instant of candidates) {
      const stood = asOfFold(instant).state;
      if (stageRank(stood) > stageRank(highest)) highest = stood;
      if (highest === upper.state) break;
    }
    if (stageRank(highest) > stageRank(displayed.state)) {
      correction = {
        from: highest,
        to: displayed.state,
        facts: correctionFacts(records, validity),
      };
    }
  }

  const thinEvidenceInstrumentIds = [
    ...new Set(
      records
        .map((record) => record.instrumentId)
        .filter((instrumentId) => validity.contested.has(instrumentId)),
    ),
  ].sort();

  return { conceptId, displayed, award, correction, thinEvidenceInstrumentIds, arithmeticVersion };
}

/** {@link readConceptAttainment} for every concept in `conceptIds` — the same fold, once per concept. */
export function readAllConceptAttainment(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  validity: InstrumentValidityProjection,
  options: AttainmentOptions = {},
): ReadonlyMap<string, ConceptAttainment> {
  const result = new Map<string, ConceptAttainment>();
  for (const id of conceptIds) {
    result.set(id, readConceptAttainment(entries, id, validity, options));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Current readings: vitality, readiness, need, the recognition credit
// ---------------------------------------------------------------------------

/** The current readings the eligibility rule distinguishes. */
export type CurrentReading = 'vitality' | 'readiness' | 'need';

/**
 * The one eligibility rule for current readings (see the module doc):
 * proven invalid never counts; withheld per `[D-347]`'s option. Exported so
 * every current reading built outside this file (the gap view's demand rule,
 * `../gap/demand.ts`) reads the same rule rather than restating it.
 */
export function excludedFromCurrent(
  instrumentId: string,
  reading: CurrentReading,
  validity: InstrumentValidityProjection,
  policy: WithheldEvidencePolicy,
): boolean {
  if (validity.provenInvalid.has(instrumentId)) return true;
  if (!validity.withheld.has(instrumentId)) return false;
  switch (policy) {
    case 'count':
      return false;
    case 'drop-from-readiness-and-need':
      return reading !== 'vitality';
    case 'drop-from-every-current-reading':
      return true;
  }
}

/** A vitality reading over eligible instruments, naming what was left out and the arithmetic that produced it. */
export interface EligibleVitalityReading extends VitalityReading {
  /** Instruments with evidence for this concept that the eligibility rule left out, sorted. */
  readonly excludedInstrumentIds: readonly string[];
  readonly arithmeticVersion: string;
}

/**
 * Vitality (R3, `[D-087]`) per concept over ELIGIBLE instruments: proven
 * invalid never counts; withheld per `[D-347]`'s option. The minimum stays,
 * naming the instrument that sets it; replays the log once for every concept.
 * The existing `readAllConceptVitality` (`./rollup.ts`) is unchanged for the
 * readers that call it today.
 */
export function readAllEligibleConceptVitality(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  scheduler: Scheduler,
  now: Date,
  holdingCut: number,
  validity: InstrumentValidityProjection,
  options: AttainmentOptions = {},
): ReadonlyMap<string, EligibleVitalityReading> {
  const policy = withheldPolicyOf(options);
  const arithmeticVersion = versionOf(options, scheduler.configuration?.version);
  const replayed = replaySchedulerStates(entries, scheduler);
  const result = new Map<string, EligibleVitalityReading>();
  for (const id of conceptIds) {
    const instruments = conceptVitalityInstruments(entries, id, replayed);
    const eligible: VitalityInstrument[] = [];
    const excluded: string[] = [];
    for (const instrument of instruments) {
      if (excludedFromCurrent(instrument.instrumentId, 'vitality', validity, policy)) {
        excluded.push(instrument.instrumentId);
      } else {
        eligible.push(instrument);
      }
    }
    const reading = readVitality({ instruments: eligible, scheduler, now, holdingCut });
    result.set(id, { ...reading, excludedInstrumentIds: excluded.sort(), arithmeticVersion });
  }
  return result;
}

/** Instruments with at least one successful review shown at `independent` support. */
function instrumentsWithIndependentSuccess(
  entries: readonly ReviewLogEntry[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.rating === null || entry.rating === 'again') continue;
    if (entry.supportLevelShown !== 'independent') continue;
    ids.add(entry.instrumentId);
  }
  return ids;
}

/** C5.6's per-concept readiness input: the weakest eligible, unaided recall estimate, or none. */
export interface ConceptReadinessReading extends ReadinessRecallReading {
  /** Instruments that entered the reading whose grade is contested and unresolved: thin, never absent. */
  readonly thinEvidenceInstrumentIds: readonly string[];
  readonly arithmeticVersion: string;
}

/**
 * The per-concept readiness reading (C5.6's input; attainment owns it, a
 * Class B default recorded since `ol-egov.141.89.24`): the minimum, over
 * eligible recall-tier instruments with an unaided (independent) success, of
 * recall now — or none, never a measured zero (`[D-237]`, `[D-264]`).
 * Proven-invalid instruments never count; withheld ones per `[D-347]`.
 * Planning folds this over an assessment's scope. No production caller yet:
 * `ol-v7r5.54` wires it into `oracle/compose.ts`.
 */
export function readAllConceptReadiness(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  scheduler: Scheduler,
  now: Date,
  validity: InstrumentValidityProjection,
  options: AttainmentOptions = {},
): ReadonlyMap<string, ConceptReadinessReading> {
  const policy = withheldPolicyOf(options);
  const arithmeticVersion = versionOf(options, scheduler.configuration?.version);
  const replayed = replaySchedulerStates(entries, scheduler);
  const independent = instrumentsWithIndependentSuccess(entries);
  const result = new Map<string, ConceptReadinessReading>();
  for (const id of conceptIds) {
    const instruments = conceptVitalityInstruments(entries, id, replayed)
      .filter(
        (instrument) =>
          !excludedFromCurrent(instrument.instrumentId, 'readiness', validity, policy),
      )
      .map((instrument) => ({
        ...instrument,
        hasIndependentSuccess: independent.has(instrument.instrumentId),
      }));
    const reading = readReadinessRecall({ instruments, scheduler, now });
    const thin = instruments
      .filter(
        (instrument) =>
          isRecallTier(instrument.instrumentType) &&
          instrument.state !== null &&
          instrument.hasIndependentSuccess &&
          validity.contested.has(instrument.instrumentId),
      )
      .map((instrument) => instrument.instrumentId)
      .sort();
    result.set(id, { ...reading, thinEvidenceInstrumentIds: thin, arithmeticVersion });
  }
  return result;
}

/** Whether need rests on eligible evidence, or on none (`[D-348]`, ruled). */
export type NeedBasis = 'estimated' | 'unknown';

/** Need for one concept: its basis, its value, and the readiness reading it came from. */
export interface NeedReading {
  readonly basis: NeedBasis;
  /** In `[0, 1]`. Estimated: one minus current unaided recall. Unknown: the declared value. */
  readonly value: number;
  readonly readiness: ReadinessRecallReading;
}

/**
 * Need from the per-concept readiness reading (`[D-332]`, ruled: need reads
 * current recall, then demand-aware readiness once `ol-v7r5.65` lands, never
 * both). The basis split and the unknown value are `[D-348]`'s, ruled:
 * **no production caller may word an unknown basis as weakness** — that is
 * the part the ruling was asked for (registry §22). No production caller
 * yet for the ranking's own need input (`PLN`'s); the gap view's copy layer
 * reads the basis as of `ol-egov.141.89.9.58` (`gap/copy.ts`'s
 * `masteryGapLine`).
 */
export function readNeed(
  readiness: ReadinessRecallReading,
  options: { readonly unknownNeedValue?: number } = {},
): NeedReading {
  const unknownValue = options.unknownNeedValue ?? UNKNOWN_NEED_VALUE;
  if (!(Number.isFinite(unknownValue) && unknownValue >= 0 && unknownValue <= 1)) {
    throw new RangeError(`readNeed: unknownNeedValue must be within [0, 1], got ${unknownValue}`);
  }
  if (readiness.weakest === null) {
    return { basis: 'unknown', value: unknownValue, readiness };
  }
  return { basis: 'estimated', value: 1 - readiness.weakest.recallProbability, readiness };
}

/** The latest rated review per instrument, by `(instant, eventId)`. */
function latestRatedReviewByInstrument(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, ReviewLogRecord> {
  const latest = new Map<string, { instant: number; record: ReviewLogRecord }>();
  for (const entry of entries) {
    if (entry.kind !== 'review' || entry.rating === null) continue;
    const instant = Date.parse(entry.timestamp);
    if (!Number.isFinite(instant)) continue;
    const prior = latest.get(entry.instrumentId);
    if (
      prior === undefined ||
      instant > prior.instant ||
      (instant === prior.instant && entry.eventId > prior.record.eventId)
    ) {
      latest.set(entry.instrumentId, { instant, record: entry });
    }
  }
  const result = new Map<string, ReviewLogRecord>();
  for (const [id, { record }] of latest) result.set(id, record);
  return result;
}

/**
 * Per concept: does a correct, CURRENT, standing quiz answer exist? The
 * gap view's recognition credit (`[D-278]`'s 0.60 weight) fires only on
 * this — the chain spec's section 2.5 — so a wrong, stale or invalid answer
 * never lowers need (review 3.4; `ol-lfhj`; `[D-338]` item 3):
 *
 * - **correct**: the instrument's LATEST rated answer succeeded;
 * - **current**: its own recall estimate now is at or above the retention
 *   target (`holdingCut`, identity with it under `[D-115]`) — it is not yet
 *   due again. Declared, plain English, no new constant;
 * - **standing**: not proven invalid; withheld per `[D-347]`'s option for need.
 *
 * Recognition has no support ladder, so "assisted" has no quiz case. Feeds
 * `../gap/readiness.ts`'s optional `currentRecognition` input; no production
 * caller yet (`ol-egov.141.89.9.5` wires the gap view).
 */
export function readAllCurrentRecognition(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  scheduler: Scheduler,
  now: Date,
  validity: InstrumentValidityProjection,
  options: AttainmentOptions & { readonly holdingCut?: number } = {},
): ReadonlyMap<string, boolean> {
  const policy = withheldPolicyOf(options);
  const cut = options.holdingCut ?? HOLDING_CUT;
  const replayed: ReplayResult = replaySchedulerStates(entries, scheduler);
  const latest = latestRatedReviewByInstrument(entries);
  const result = new Map<string, boolean>();
  for (const id of conceptIds) {
    let current = false;
    for (const instrument of conceptVitalityInstruments(entries, id, replayed)) {
      if (instrument.instrumentType !== 'mcq' || instrument.state === null) continue;
      if (excludedFromCurrent(instrument.instrumentId, 'need', validity, policy)) continue;
      const last = latest.get(instrument.instrumentId);
      if (last === undefined || last.rating === null || last.rating === 'again') continue;
      const { recallProbability } = scheduler.retrievability({
        instrumentId: instrument.instrumentId,
        state: instrument.state,
        now,
      });
      if (recallProbability >= cut) {
        current = true;
        break;
      }
    }
    result.set(id, current);
  }
  return result;
}

/** Re-exported for callers that only import the entry point. */
export type { SaplingRule, SoloLevel, SupportLevel };
