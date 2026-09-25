/**
 * `[D-101]`'s belief-attribution filter (knowledge model §4.1's `statement`
 * field, amended `[D-101]`): "Only prose confidently hers is read as her
 * belief — a classmate's pasted claim is not; passages whose authorship is
 * *unknown* stay out." `[D-101]`'s own ruling lists belief attribution as
 * the FIRST admitted consumer of the `[D-101]` classifier
 * (`../source/materiality.js`'s `classifyMateriality`/`resolveMateriality`),
 * "exclusion-only... a false exclusion costs signal while a false inclusion
 * feeds the worst failure."
 *
 * This is the "belief-bearing-statement gatherer" `features/F5-explain-it-
 * back.md`'s two `[D-101]` scenarios, and `observe.ts`'s own former module
 * doc, name as not yet existing (`ol-egov.141.89.6.43`). `events.ts`'s
 * `buildObservationEvent` and `observe.ts`'s
 * `buildObservationEventWithEmbedding` both call `admitBeliefBearingStatement`
 * in front of the `statement` field, throwing `BeliefSourceExcludedError`
 * when it is not admitted — defense-in-depth for those two low-level
 * constructors. The one production caller that turns real candidates into
 * observations, `accepted-grading-observation.ts`'s
 * `buildObservationEventsFromAcceptedGrading`, gates BEFORE calling either
 * of them (the same shape its existing `'uncitable'`/`'unresolved-concept'`
 * skips already use), so an excluded candidate degrades to a recorded skip
 * reason, never a crash.
 *
 * **Not built here, named rather than silently absent**: nothing in this
 * module computes an authorship fact — see `ObservationInput
 * .statementAuthorship`'s doc (`events.ts`) for the production caller that
 * must start supplying a real one (a plugin file, out of this bead's
 * `owns`).
 */

import type { MaterialityAuthorship } from '../source/materiality.js';

/** Why a candidate statement was excluded — never the statement's own text (D-005: a reason/count only). */
export type ExcludedBeliefSourceReason = 'not-hers' | 'unknown-authorship';

/**
 * `[D-101]`'s admission bar for the misconception statement field: `true`
 * only for `'hers'`. `'not-hers'` and `'unknown'` both read `false` here —
 * unknown is a real, defined value with this exclusion behaviour, never a
 * hole that defaults to hers (knowledge model §4.1, `[D-101]`'s "the system
 * degrades toward unknown, visibly, never toward confidently wrong,
 * invisibly").
 */
export function isConfidentlyHersProse(authorship: MaterialityAuthorship): boolean {
  return authorship === 'hers';
}

export interface BeliefBearingStatementResult {
  readonly admitted: boolean;
  /** Present only when `admitted` is `false`. */
  readonly reason?: ExcludedBeliefSourceReason;
}

/**
 * The gate itself, called with whatever `[D-101]` authorship fact the
 * caller's `ObservationInput.statementAuthorship` carries for this
 * statement's source prose.
 *
 * **`authorship === undefined` admits.** This is deliberately NOT the same
 * question as "the classifier ran and returned `'unknown'`" — `undefined`
 * means no caller in the chain has supplied a `[D-101]` fact for this
 * observation AT ALL yet (the field is optional; see `events.ts`'s doc for
 * why). Treating an absent fact as an exclusion would silently drop every
 * observation built by every caller that has not yet been migrated to
 * supply one — including the one production caller that exists today,
 * which does not yet have a wired classifier upstream of it — which is
 * exactly the kind of "hole that defaults to hers" failure `[D-101]`
 * itself warns against, just inverted: a hole must default to "not this
 * filter's business yet," never to a value this function did not actually
 * conclude. A caller that HAS a real classifier wired always supplies a
 * genuine `MaterialityAuthorship`, at which point `'unknown'` is read and
 * excluded exactly as `'not-hers'` is, per `isConfidentlyHersProse`.
 */
export function admitBeliefBearingStatement(
  authorship: MaterialityAuthorship | undefined,
): BeliefBearingStatementResult {
  if (authorship === undefined || isConfidentlyHersProse(authorship)) {
    return { admitted: true };
  }
  return {
    admitted: false,
    reason: authorship === 'unknown' ? 'unknown-authorship' : 'not-hers',
  };
}

/**
 * Thrown by `events.ts`'s `buildObservationEvent` and `observe.ts`'s
 * `buildObservationEventWithEmbedding` when called with a
 * `statementAuthorship` this filter excludes. This is defense-in-depth, not
 * the expected control flow for a real not-hers/unknown candidate — a
 * caller that already knows the authorship fact should gate with
 * `admitBeliefBearingStatement` BEFORE reaching either constructor, the way
 * `accepted-grading-observation.ts` does for its own `'uncitable'`/
 * `'unresolved-concept'` skips. A caller that reaches either constructor
 * with an excluded authorship anyway has a bug: it built (or was handed) an
 * `ObservationInput` from prose it already knew was not hers.
 */
export class BeliefSourceExcludedError extends Error {
  readonly reason: ExcludedBeliefSourceReason;

  constructor(reason: ExcludedBeliefSourceReason) {
    super(`[D-101]: statement excluded from the misconception statement field (${reason})`);
    this.name = 'BeliefSourceExcludedError';
    this.reason = reason;
  }
}

/**
 * Throws `BeliefSourceExcludedError` unless `authorship` is admitted —
 * shared by `events.ts` and `observe.ts` so both constructors apply the
 * exact same rule in front of the `statement` field.
 */
export function assertBeliefBearingStatement(authorship: MaterialityAuthorship | undefined): void {
  const result = admitBeliefBearingStatement(authorship);
  if (!result.admitted) {
    throw new BeliefSourceExcludedError(result.reason ?? 'not-hers');
  }
}
