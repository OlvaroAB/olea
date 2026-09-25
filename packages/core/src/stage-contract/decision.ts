/**
 * The Decision stage contract (`ol-egov.141.89.20`; design `[D-300]`'s
 * review, envelope in the intelligence build's pipelines README, "Shared
 * stage contracts").
 *
 * A decision step returns exactly one of three outcomes:
 *
 * - a **verdict** from the step's own closed set, with an optional payload
 *   (whatever else the producer returned alongside the verdict);
 * - **undecided**: the step could not settle it. It is never scored as a
 *   verdict and never read as a fact about her material or her;
 * - **unavailable**: an operational failure (`./provenance.ts`), likewise
 *   never a verdict and never about her.
 *
 * Every outcome carries producer provenance: task, seat, prompt and model
 * stamp, and evidence digests.
 *
 * **The step's own words stay the step's.** This file fixes only the
 * envelope. A step's closed verdict set is its own (`sufficient`/`partial`/
 * `insufficient`/`conflicting`, the five depth levels, and so on); a step
 * that also has its own word for undecided (`cannot-tell`, `uncertain`,
 * `unable-to-assess`) or for unavailable keeps it in its
 * `DecisionVocabulary`, and `decisionWord` reads it back. No task's wire
 * contract changes here: that stays with each chain's own decision.
 *
 * **Candidate and fallback behind one interface.** `DecisionSeat` is the one
 * interface every seat implements. `cascadeDecisionSeats` composes a
 * candidate seat and an optional fallback seat into another `DecisionSeat`:
 * the candidate settles the cases it is confident on, the fallback takes the
 * rest, and a caller holds the same interface either way. The outcome's
 * provenance still records which seat answered and why the case was handed
 * on, because D7.3 needs that; nothing else about the outcome differs.
 */

import { isNonEmptyString, isRecord } from './guards.js';
import {
  type StageEscalationReason,
  type StageProvenance,
  type StageUnavailable,
  stageProvenanceProblems,
  stageUnavailableProblems,
} from './provenance.js';

/**
 * Why a decision step could not settle a case.
 *
 * - `abstained`: the producer ran and said it could not settle it (a
 *   could-not-decide, cannot-tell or unclassified answer).
 * - `below-confidence-bar`: a verdict came back below the seat's confidence
 *   bar and no seat was left to take the case on.
 * - `voided-by-check`: a verdict came back and a code check removed its basis
 *   (for example, every finding it rested on failed its citation).
 * - `nothing-to-decide-from`: there was no input to decide from (an empty
 *   evidence package, no reference answer, no source material), so no model
 *   was asked, or the service refused on that ground. INV-5's refusal, and
 *   never a verdict (`[D-289]` rules the empty package this way).
 */
export type UndecidedBasis =
  | 'abstained'
  | 'below-confidence-bar'
  | 'voided-by-check'
  | 'nothing-to-decide-from';

export const UNDECIDED_BASES: readonly UndecidedBasis[] = [
  'abstained',
  'below-confidence-bar',
  'voided-by-check',
  'nothing-to-decide-from',
];

/** A verdict from the step's closed set `V`, with whatever else the producer returned as `payload`. */
export interface DecisionVerdict<V extends string, P> {
  readonly kind: 'verdict';
  readonly verdict: V;
  readonly payload: P;
  /** The producer's own confidence in `verdict`, in [0, 1], when it reports one. What a seat's confidence bar reads. */
  readonly confidence?: number;
  readonly provenance: StageProvenance;
}

/** The step ran, or was asked to run, and could not settle the case. */
export interface DecisionUndecided {
  readonly kind: 'undecided';
  readonly basis: UndecidedBasis;
  /** The producer's confidence behind a below-bar or abstained answer, when it reported one. Never a commitment. */
  readonly confidence?: number;
  readonly provenance: StageProvenance;
}

/** The operational-failure arm, shared with the Writing contract. */
export type DecisionUnavailable = StageUnavailable;

/** One decision step's result: a verdict, undecided, or unavailable. */
export type DecisionOutcome<V extends string, P = null> =
  | DecisionVerdict<V, P>
  | DecisionUndecided
  | DecisionUnavailable;

/**
 * A step's own outcome words. `verdicts` is the closed domain set. `undecided`
 * and `unavailable` are the step's own names for the two non-verdict
 * outcomes, when it has them (`cannot-tell`, `uncertain`, `failed`); when it
 * does not, the envelope's own words stand.
 */
export interface DecisionVocabulary<V extends string> {
  readonly verdicts: readonly V[];
  readonly undecided?: string;
  readonly unavailable?: string;
}

/**
 * What the step's own vocabulary calls `outcome`: the verdict itself, the
 * step's undecided or unavailable word, or the envelope's word when the step
 * has none of its own.
 */
export function decisionWord<V extends string>(
  vocabulary: DecisionVocabulary<V>,
  outcome: DecisionOutcome<V, unknown>,
): string {
  switch (outcome.kind) {
    case 'verdict':
      return outcome.verdict;
    case 'undecided':
      return vocabulary.undecided ?? 'undecided';
    case 'unavailable':
      return vocabulary.unavailable ?? 'unavailable';
  }
}

/** Narrowing helper: true only for a verdict, the one outcome a consumer may score. */
export function isDecisionVerdict<V extends string, P>(
  outcome: DecisionOutcome<V, P>,
): outcome is DecisionVerdict<V, P> {
  return outcome.kind === 'verdict';
}

/**
 * One seat of a decision step. Implementations never throw: every failure
 * comes back as an `unavailable` outcome. `cascadeDecisionSeats` still
 * guards against a throwing seat, so a broken seat cannot turn into an
 * uncaught error in the caller.
 */
export interface DecisionSeat<Req, V extends string, P = null> {
  decide(request: Req): Promise<DecisionOutcome<V, P>>;
}

export interface DecisionCascadeOptions<Req, V extends string, P> {
  /** The step's task id: stamped on the unavailable outcome a throwing seat is turned into. */
  readonly taskId: string;
  readonly candidate: DecisionSeat<Req, V, P>;
  /** The stronger seat for the cases the candidate does not settle, or `null` where the step has none. */
  readonly fallback: DecisionSeat<Req, V, P> | null;
  /**
   * The candidate's confidence bar, in [0, 1]. **No default**: a bar is a
   * threshold, and a threshold moves only through a decision bead, so the
   * caller states the ruled value. When set, a candidate verdict below it, or
   * one that reports no confidence at all, is handed on. When absent, every
   * candidate verdict stands.
   */
  readonly confidenceBar?: number;
  /**
   * Whether an unavailable candidate is handed to the fallback. Defaults to
   * `false`: the fallback takes the cases the candidate could not settle, and
   * an outage is not one of those. A step that wants the fallback as a
   * resilience path opts in.
   */
  readonly escalateUnavailable?: boolean;
}

async function decideGuarded<Req, V extends string, P>(
  seat: DecisionSeat<Req, V, P>,
  request: Req,
  taskId: string,
  seatName: 'candidate' | 'fallback',
): Promise<DecisionOutcome<V, P>> {
  try {
    return await seat.decide(request);
  } catch {
    return {
      kind: 'unavailable',
      cause: 'call-failed',
      provenance: {
        producer: { kind: 'model', seat: seatName, taskId, stamp: null },
        evidenceDigests: [],
      },
    };
  }
}

/** Why the candidate's outcome goes to the fallback, or `null` when it stands. */
function escalationReason<V extends string, P>(
  outcome: DecisionOutcome<V, P>,
  confidenceBar: number | undefined,
  escalateUnavailable: boolean,
): StageEscalationReason | null {
  switch (outcome.kind) {
    case 'verdict':
      if (confidenceBar === undefined) return null;
      if (outcome.confidence === undefined || outcome.confidence < confidenceBar) {
        return 'below-confidence-bar';
      }
      return null;
    case 'undecided':
      return 'undecided';
    case 'unavailable':
      return escalateUnavailable ? 'unavailable' : null;
  }
}

/**
 * The candidate seat and the fallback seat behind one `DecisionSeat`.
 *
 * 1. The candidate decides. Its verdict stands unless a confidence bar is set
 *    and the verdict falls below it (or reports no confidence).
 * 2. An undecided candidate outcome, a below-bar verdict, and (only when
 *    `escalateUnavailable` is set) an unavailable one go to the fallback. The
 *    fallback's outcome is the answer, whatever it is, and its provenance
 *    gains `escalation`: what the candidate returned and why it was handed on.
 * 3. With no fallback, a below-bar verdict becomes `undecided` with basis
 *    `below-confidence-bar`, keeping the candidate's provenance and
 *    confidence; an undecided or unavailable outcome is returned as it came.
 *
 * Pure composition: no state between calls, no retry, no timeout (a seat
 * owns its own budget and reports `timeout` itself).
 */
export function cascadeDecisionSeats<Req, V extends string, P>(
  options: DecisionCascadeOptions<Req, V, P>,
): DecisionSeat<Req, V, P> {
  return {
    async decide(request: Req): Promise<DecisionOutcome<V, P>> {
      const first = await decideGuarded(options.candidate, request, options.taskId, 'candidate');
      const reason = escalationReason(
        first,
        options.confidenceBar,
        options.escalateUnavailable === true,
      );
      if (reason === null) return first;

      if (options.fallback === null) {
        if (first.kind === 'verdict') {
          return {
            kind: 'undecided',
            basis: 'below-confidence-bar',
            ...(first.confidence !== undefined ? { confidence: first.confidence } : {}),
            provenance: first.provenance,
          };
        }
        return first;
      }

      const second = await decideGuarded(options.fallback, request, options.taskId, 'fallback');
      return {
        ...second,
        provenance: {
          ...second.provenance,
          escalation: { from: first.provenance.producer, because: reason },
        },
      };
    },
  };
}

const UNDECIDED_BASIS_SET: ReadonlySet<string> = new Set(UNDECIDED_BASES);

function confidenceProblems(value: unknown, at: string): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return [`${at} is present but not a number in [0, 1]`];
  }
  return [];
}

/**
 * Every way `value` fails to be a `DecisionOutcome` over `vocabulary`'s
 * verdicts, as content-free messages; empty when it is one. The contract
 * test a consumer runs at a producer-consumer boundary, on a value that may
 * have crossed JSON or a package line, without trusting the producer's types.
 * It checks the envelope only: a verdict's `payload` belongs to the step.
 */
export function decisionEnvelopeProblems<V extends string>(
  value: unknown,
  vocabulary: DecisionVocabulary<V>,
): string[] {
  if (!isRecord(value)) return ['outcome is not an object'];
  switch (value.kind) {
    case 'verdict': {
      const problems: string[] = [];
      if (
        !isNonEmptyString(value.verdict) ||
        !(vocabulary.verdicts as readonly string[]).includes(value.verdict)
      ) {
        problems.push('outcome.verdict is not one of the step verdicts');
      }
      if (!('payload' in value)) problems.push('outcome.payload is missing');
      problems.push(...confidenceProblems(value.confidence, 'outcome.confidence'));
      problems.push(...stageProvenanceProblems(value.provenance, 'outcome.provenance'));
      return problems;
    }
    case 'undecided': {
      const problems: string[] = [];
      if (typeof value.basis !== 'string' || !UNDECIDED_BASIS_SET.has(value.basis)) {
        problems.push('outcome.basis is not a known undecided basis');
      }
      problems.push(...confidenceProblems(value.confidence, 'outcome.confidence'));
      problems.push(...stageProvenanceProblems(value.provenance, 'outcome.provenance'));
      return problems;
    }
    case 'unavailable':
      return stageUnavailableProblems(value, 'outcome');
    default:
      return ['outcome.kind is not verdict, undecided or unavailable'];
  }
}
