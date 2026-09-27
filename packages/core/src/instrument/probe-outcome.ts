/**
 * Deriving an application probe's outcome — `[D-394]` choice 2, the other
 * half of `../instrument/probe-presentation-store.js`'s "shown" fact.
 *
 * `[D-394]`'s own text: *"success is derived at read time from the
 * qualifying review-log event of that presentation, and a skip, a
 * defective-probe attempt or a missing event reads as not succeeded... the
 * probe record stores no outcome"* — the same discipline the execution
 * model already applies one layer up (mastery and vitality are local
 * projections over the append-only log, never mutable fields written back
 * onto an instrument).
 *
 * ## The one thing this module deliberately does NOT do
 *
 * It does not read `packages/contracts/src/review-log.ts`, and it declares
 * no new review-log record kind. Wiring a probe's actual review event to
 * this shape is a **Class C, persisted-schema change**
 * (`docs/Olea_alpha_functional_scope.md`'s D7.1/F5.7 wording, and the
 * `explainBackOfferTrigger` enum both live in `olea-contracts`) — exactly
 * the half of the D-335 contract diff brief 85 itself declines to draft
 * ("belongs with whichever bead lands the persisted schema, escalated per
 * CLAUDE.md's 'Escalate to the orchestrator'"). This module instead defines
 * the narrowest possible ABSTRACT shape a real review-log reader would need
 * to produce — {@link QualifyingProbeReviewEvent} — and derives success from
 * that shape alone, so the pure decision logic is built, tested and ready
 * the moment a Class C lane lands the real schema field and a thin adapter
 * to it.
 *
 * ## The four readings, all "not succeeded" except one
 *
 * - **No qualifying event at all** (`undefined`) — never presented, or
 *   presented but nothing was ever recorded. Not succeeded.
 * - **`skipped`** (F5.7) — a named skip or a prompt closed without an
 *   answer. Not succeeded.
 * - **`defective`** — the presented item was later found to carry an
 *   objectively established structural defect (C5.3, `[D-097]`'s
 *   generalised exclusion). Not succeeded: a defective probe's attempt is
 *   excluded from evidence exactly like any other defective instrument's.
 * - **`graded`** — a real grading verdict exists. Succeeded exactly when
 *   `correct` is `true`.
 */

/**
 * The narrowest shape a real review-log reader needs to produce for this
 * module to derive an outcome. Deliberately not `ReviewLogEntryV6` or any
 * contracts type — see the module doc's "one thing this module does NOT do".
 */
export type QualifyingProbeReviewEvent =
  | { readonly kind: 'graded'; readonly correct: boolean }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'defective' };

/** `succeeded` exactly when a `graded` event with `correct: true` was found. */
export type ProbeOutcome = 'succeeded' | 'not-succeeded';

/**
 * Derives a probe's outcome from the qualifying review-log event of its
 * presentation, or the absence of one. Pure, synchronous, and the only
 * function in this module — there is nothing to store, so there is nothing
 * to read back except what the caller already found in the log.
 */
export function deriveProbeOutcome(event: QualifyingProbeReviewEvent | undefined): ProbeOutcome {
  if (event === undefined) return 'not-succeeded';
  if (event.kind === 'skipped') return 'not-succeeded';
  if (event.kind === 'defective') return 'not-succeeded';
  return event.correct ? 'succeeded' : 'not-succeeded';
}

/** Convenience boolean form, for a caller building `ApplicationProbeSincePresentation.succeeded`. */
export function probeSucceeded(event: QualifyingProbeReviewEvent | undefined): boolean {
  return deriveProbeOutcome(event) === 'succeeded';
}
