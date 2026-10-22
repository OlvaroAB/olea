/**
 * Producer provenance and the operational-failure arm shared by both stage
 * contracts (`ol-egov.141.89.20`, the design in `[D-300]`'s review): every
 * decision outcome and every writing outcome says who produced it, from what.
 *
 * **Why one shape for both contracts.** Refusal presentation, the fallback
 * seat and telemetry are meant to be built once rather than once per chain.
 * Each of those reads "who answered, with which prompt and model, from which
 * evidence" and "did the call fail, and how" — so those two facts live here,
 * once, and `./decision.ts` and `./writing.ts` both carry them unchanged.
 *
 * **Never content (D-005).** Every field here is an identifier, a version, a
 * digest or a fixed word. A digest names what was read without carrying it;
 * a rule name is a stable code identifier, never her wording.
 */

import type { ArtifactProvenance } from 'olea-contracts';
import { isNonEmptyString, isRecord } from './guards.js';

/**
 * Which position in a decision step's cascade answered. A position, not a
 * model identity: `ModelStamp.modelId` says which model sat there. Today's
 * Worker slot model sits in the `candidate` seat of a step that has no
 * fallback wired yet; a cheaper model under test, once chosen, sits there
 * instead, with the stronger model in `fallback`.
 */
export type StageSeat = 'candidate' | 'fallback';

/** D7.3's prompt-and-model stamp, as the Worker's response carries it (`olea-contracts`' `responseStamp`). */
export interface ModelStamp {
  readonly promptVersion: string;
  readonly modelId: string;
}

/**
 * Who produced an outcome.
 *
 * - `model`: a model call made from a named seat for a named task. `stamp`
 *   is `null` exactly when no usable response arrived (an unavailable
 *   outcome), or when the seam the outcome came through does not surface the
 *   Worker's stamp today. It is never invented to fill the field.
 * - `code`: a deterministic rule settled it before or without any model, for
 *   example an empty-input refusal (INV-5). `rule` is a short, stable,
 *   content-free identifier for that rule.
 */
export type StageProducer =
  | {
      readonly kind: 'model';
      readonly seat: StageSeat;
      readonly taskId: string;
      readonly stamp: ModelStamp | null;
    }
  | {
      readonly kind: 'code';
      readonly rule: string;
    };

/** Why the candidate seat handed a case on to the fallback seat. */
export type StageEscalationReason = 'undecided' | 'below-confidence-bar' | 'unavailable';

/** Present on an outcome the fallback seat produced: what the candidate returned first. */
export interface StageEscalation {
  readonly from: StageProducer;
  readonly because: StageEscalationReason;
}

/**
 * The provenance every outcome carries: producer, and digests of the
 * evidence it read. `evidenceDigests` is empty only when the seam the
 * outcome came through computes none today, which the caller states by
 * passing an empty list; it is never defaulted silently.
 */
export interface StageProvenance {
  readonly producer: StageProducer;
  readonly evidenceDigests: readonly string[];
  readonly escalation?: StageEscalation;
}

/**
 * Why a stage produced nothing usable because of the run, never because of
 * her material or her.
 *
 * - `not-configured`: no producer is wired for this step (the Worker is not
 *   configured, or no judge was supplied).
 * - `offline`, `budget-exhausted`, `not-on-this-device`: the producer could
 *   not be reached at all, for the reason named (the same three words the
 *   concept reader and the knowledge-kind classifier already use).
 * - `call-failed`: a call was made and did not return a usable result, and
 *   the seam does not say more than that (a throw, a rejected promise, or an
 *   unusable value folded into one).
 * - `timeout`: the call ran past its budget.
 * - `malformed`: a response arrived and did not have the expected shape.
 * - `service-refused`: the Worker answered with a well-formed error;
 *   `serviceCode` carries its code.
 * - `upstream-unavailable`: this step never ran because a step it depends
 *   on was unavailable (for example, writing a question when the evidence
 *   check could not run).
 */
export type StageUnavailableCause =
  | 'not-configured'
  | 'offline'
  | 'budget-exhausted'
  | 'not-on-this-device'
  | 'call-failed'
  | 'timeout'
  | 'malformed'
  | 'service-refused'
  | 'upstream-unavailable';

export const STAGE_UNAVAILABLE_CAUSES: readonly StageUnavailableCause[] = [
  'not-configured',
  'offline',
  'budget-exhausted',
  'not-on-this-device',
  'call-failed',
  'timeout',
  'malformed',
  'service-refused',
  'upstream-unavailable',
];

/**
 * An operational failure: the same arm in both contracts. It is never scored
 * as a verdict or a draft, and never read as a fact about her material or
 * her. What she is told is "Olea could not do this right now", never
 * anything about her notes.
 */
export interface StageUnavailable {
  readonly kind: 'unavailable';
  readonly cause: StageUnavailableCause;
  /** The Worker's own error code; present only when `cause` is `service-refused`. */
  readonly serviceCode?: string;
  readonly provenance: StageProvenance;
}

/**
 * The context an adapter needs to stamp provenance on a seam's result: which
 * seat the call occupied, for which task, the stamp if the seam surfaced one,
 * and the digests of what the call read.
 */
export interface StageSeamContext {
  readonly seat: StageSeat;
  readonly taskId: string;
  readonly stamp: ModelStamp | null;
  readonly evidenceDigests: readonly string[];
}

/** Provenance for an outcome a model produced from `context`'s seat. */
export function modelProvenance(context: StageSeamContext): StageProvenance {
  return {
    producer: {
      kind: 'model',
      seat: context.seat,
      taskId: context.taskId,
      stamp: context.stamp,
    },
    evidenceDigests: context.evidenceDigests,
  };
}

/** Provenance for a call from `context`'s seat that returned nothing usable: the stamp is dropped, since no response carried one. */
export function failedCallProvenance(context: StageSeamContext): StageProvenance {
  return {
    producer: { kind: 'model', seat: context.seat, taskId: context.taskId, stamp: null },
    evidenceDigests: context.evidenceDigests,
  };
}

/** Provenance for an outcome a code rule settled without asking any model. */
export function codeProvenance(rule: string, evidenceDigests: readonly string[]): StageProvenance {
  return { producer: { kind: 'code', rule }, evidenceDigests };
}

/**
 * The persisted D7.3 shape (`olea-contracts`' `artifactProvenance`) for an
 * outcome, when one exists: a model producer with a stamp. `null` for a code
 * producer or an unstamped model producer, since the persisted shape has no
 * way to say either and must not be filled with invented values.
 */
export function toArtifactProvenance(provenance: StageProvenance): ArtifactProvenance | null {
  const producer = provenance.producer;
  if (producer.kind !== 'model' || producer.stamp === null) return null;
  return {
    taskId: producer.taskId,
    promptVersion: producer.stamp.promptVersion,
    modelId: producer.stamp.modelId,
  };
}

const SEATS: ReadonlySet<string> = new Set<StageSeat>(['candidate', 'fallback']);

/**
 * `[D-598]` (`ol-egov.141.89.5.135`): the producer a stored source-change
 * verdict keeps beside it, so a record can later say whether the judge or a
 * code rule settled it, and under which version.
 *
 * - `model`: `StageProducer`'s model arm, field for field. `stamp` is the
 *   D7.3 stamp exactly as the response carried it, or `null` when it carried
 *   none (or carried an unreadable one); it is never filled in.
 * - `code`: a deterministic rule, by a stable kebab-case id, and the version
 *   of that rule's behaviour. Each version's behaviour is frozen by tests
 *   where the rule lives; a changed behaviour is a new version, never the
 *   same number reused.
 *
 * Never content (D-005): ids, versions and the stamp only. Not a verdict: a
 * stored producer says who decided, never what was decided.
 */
export type PersistedStageProducer =
  | Extract<StageProducer, { readonly kind: 'model' }>
  | {
      readonly kind: 'code';
      readonly rule: string;
      readonly ruleVersion: number;
    };

/**
 * How a stored producer value reads back:
 * - `known`: a well-formed `PersistedStageProducer`;
 * - `unknown`: no value at all, which is every record written before
 *   `[D-598]`. Never guessed from the record's dates or from deployments;
 * - `unrecognised`: a value is present but this build cannot read it (a
 *   newer build's shape, or damage). The caller keeps it verbatim on any
 *   write that carries it, and it never drops the record it sits on.
 */
export type StoredProducerReading =
  | { readonly state: 'known'; readonly producer: PersistedStageProducer }
  | { readonly state: 'unknown' }
  | { readonly state: 'unrecognised' };

/**
 * The D7.3 stamp in `value`, read defensively: a fresh `{ promptVersion,
 * modelId }` when both are non-empty strings, otherwise `null` (absent,
 * malformed, or a judge that never attaches one). Never invented.
 */
export function readModelStamp(value: unknown): ModelStamp | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.promptVersion) || !isNonEmptyString(value.modelId)) return null;
  return { promptVersion: value.promptVersion, modelId: value.modelId };
}

/** A code rule's id: lower-case words joined by single hyphens. */
const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The persisted form of `producer` when it is a model producer: its model arm
 * copied field for field. `null` for a code producer, which carries no
 * version and so cannot be stored as one without guessing it.
 */
export function persistedModelProducer(producer: StageProducer): PersistedStageProducer | null {
  if (producer.kind !== 'model') return null;
  return { kind: 'model', seat: producer.seat, taskId: producer.taskId, stamp: producer.stamp };
}

/**
 * Reads a stored producer value (see {@link StoredProducerReading}). Strict
 * about the shape it knows: a model value needs a known seat, a non-empty
 * task id and a `stamp` that is `null` or a readable stamp; a code value
 * needs a kebab-case rule id and a whole version of at least 1. Anything
 * else present is `unrecognised`, never coerced. Keys this build does not
 * know are ignored, and the producer returned holds only the known fields.
 */
export function readStoredProducer(value: unknown): StoredProducerReading {
  if (value === undefined) return { state: 'unknown' };
  const unrecognised: StoredProducerReading = { state: 'unrecognised' };
  if (!isRecord(value)) return unrecognised;
  if (value.kind === 'code') {
    const { rule, ruleVersion } = value;
    if (typeof rule !== 'string' || !RULE_ID.test(rule)) return unrecognised;
    if (typeof ruleVersion !== 'number' || !Number.isInteger(ruleVersion) || ruleVersion < 1) {
      return unrecognised;
    }
    return { state: 'known', producer: { kind: 'code', rule, ruleVersion } };
  }
  if (value.kind !== 'model') return unrecognised;
  const { seat, taskId } = value;
  if (typeof seat !== 'string' || !SEATS.has(seat)) return unrecognised;
  if (!isNonEmptyString(taskId)) return unrecognised;
  if (!('stamp' in value)) return unrecognised;
  const stamp = value.stamp === null ? null : readModelStamp(value.stamp);
  if (value.stamp !== null && stamp === null) return unrecognised;
  return {
    state: 'known',
    producer: { kind: 'model', seat: seat as StageSeat, taskId, stamp },
  };
}
const ESCALATION_REASONS: ReadonlySet<string> = new Set<StageEscalationReason>([
  'undecided',
  'below-confidence-bar',
  'unavailable',
]);
const UNAVAILABLE_CAUSES: ReadonlySet<string> = new Set(STAGE_UNAVAILABLE_CAUSES);

function producerProblems(value: unknown, at: string): string[] {
  if (!isRecord(value)) return [`${at} is not an object`];
  if (value.kind === 'code') {
    return isNonEmptyString(value.rule) ? [] : [`${at}.rule is not a non-empty string`];
  }
  if (value.kind !== 'model') return [`${at}.kind is neither model nor code`];
  const problems: string[] = [];
  if (typeof value.seat !== 'string' || !SEATS.has(value.seat)) {
    problems.push(`${at}.seat is not candidate or fallback`);
  }
  if (!isNonEmptyString(value.taskId)) problems.push(`${at}.taskId is not a non-empty string`);
  if (value.stamp !== null) {
    if (!isRecord(value.stamp)) {
      problems.push(`${at}.stamp is neither null nor an object`);
    } else {
      if (!isNonEmptyString(value.stamp.promptVersion)) {
        problems.push(`${at}.stamp.promptVersion is not a non-empty string`);
      }
      if (!isNonEmptyString(value.stamp.modelId)) {
        problems.push(`${at}.stamp.modelId is not a non-empty string`);
      }
    }
  }
  return problems;
}

/**
 * Every way `value` fails to be a `StageProvenance`, as content-free
 * messages; empty when it is one. Structural only: a runtime check for a
 * value that crossed a boundary (JSON, a record file, another package), so a
 * consumer can test the envelope without trusting the producer's types.
 */
export function stageProvenanceProblems(value: unknown, at = 'provenance'): string[] {
  if (!isRecord(value)) return [`${at} is not an object`];
  const problems = producerProblems(value.producer, `${at}.producer`);
  if (
    !Array.isArray(value.evidenceDigests) ||
    value.evidenceDigests.some((digest) => !isNonEmptyString(digest))
  ) {
    problems.push(`${at}.evidenceDigests is not a list of non-empty strings`);
  }
  if (value.escalation !== undefined) {
    const escalation = value.escalation;
    if (!isRecord(escalation)) {
      problems.push(`${at}.escalation is not an object`);
    } else {
      problems.push(...producerProblems(escalation.from, `${at}.escalation.from`));
      if (typeof escalation.because !== 'string' || !ESCALATION_REASONS.has(escalation.because)) {
        problems.push(`${at}.escalation.because is not a known escalation reason`);
      }
    }
    const producer = value.producer;
    if (!isRecord(producer) || producer.kind !== 'model' || producer.seat !== 'fallback') {
      problems.push(`${at}.escalation is present but the producer is not the fallback seat`);
    }
  }
  return problems;
}

/** Every way `value` fails to be a `StageUnavailable`; empty when it is one. */
export function stageUnavailableProblems(value: Record<string, unknown>, at: string): string[] {
  const problems: string[] = [];
  if (typeof value.cause !== 'string' || !UNAVAILABLE_CAUSES.has(value.cause)) {
    problems.push(`${at}.cause is not a known unavailable cause`);
  }
  if (value.serviceCode !== undefined) {
    if (!isNonEmptyString(value.serviceCode)) {
      problems.push(`${at}.serviceCode is present but not a non-empty string`);
    }
    if (value.cause !== 'service-refused') {
      problems.push(`${at}.serviceCode is present but the cause is not service-refused`);
    }
  }
  problems.push(...stageProvenanceProblems(value.provenance, `${at}.provenance`));
  return problems;
}
