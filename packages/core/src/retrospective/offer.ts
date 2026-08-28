/**
 * Offer memory (F8.8, `[D-134]` Q1/Q5/Q7/Q8) — pure functions over caller-
 * supplied events. Two things this module is honest about NOT being:
 *
 * 1. **Not a persistence layer.** D-134 Q5 rules the offer/open/dismiss
 *    events "ordinary events in the local event log... no new storage,
 *    second device converges" — meaning a new `EventKind` in
 *    `packages/contracts/src/review-log.ts`. That file is outside this
 *    bead's owned paths (`ol-r68l` owns `packages/core/src/retrospective/`,
 *    `packages/core/src/today/`, `packages/core/src/oracle/`, and the
 *    matching plugin/register paths — never `packages/contracts` or
 *    `packages/core/src/review-log/`). `RetrospectiveOfferEvent` below is
 *    shaped to slot into that union once a follow-up bead with contracts
 *    ownership adds it; this module reads whatever array of these a caller
 *    hands it and does not care where they came from.
 * 2. **Not a trigger.** Same posture `earlier-course-recognition.ts` takes
 *    for its own missing course-setup hook: deciding WHEN to check
 *    `resolveRetrospectiveOfferStatus` (on vault open, on a course view
 *    render, ...) is a caller's job.
 *
 * See `packages/plugin/src/retrospective/offer-store.ts` for the interim
 * production persistence this bead actually ships — a small Olea-owned vault
 * file under `.olea/`, not the review log — and the honest gap that names.
 */

/**
 * The local event shape. `kind` deliberately mirrors the vocabulary D-134's
 * ruling uses verbatim ("offered", "opened", "dismissed").
 */
export interface RetrospectiveOfferEvent {
  readonly kind: 'retrospective-offered' | 'retrospective-opened' | 'retrospective-dismissed';
  readonly assessmentPath: string;
  readonly timestamp: string;
}

/**
 * `'not-yet-eligible'` — the assessment has not passed; no offer exists.
 * `'offered'` — passed, and neither opened nor dismissed: the standing card
 * (D-134 Q1) shows. `'opened'` / `'dismissed'` — one of the two endings has
 * happened; the card never shows again for this assessment (F8.8: "small,
 * and offered once... does not chase her"), though the retrospective itself
 * stays reachable from the course (D-134 Q7/Q8, C7.8).
 */
export type RetrospectiveOfferStatus = 'not-yet-eligible' | 'offered' | 'opened' | 'dismissed';

/**
 * `daysUntilDue < 0` is a passed assessment — the identical rule
 * `oracle/rank.ts`'s `checkEdgeVeto` already uses for the `'assessment-passed'`
 * veto (F4.7/F6.3 correctness), restated here as its own small function so
 * this module does not import a private helper from a sibling directory.
 * `due` absent or unparseable reads as "not passed" — the same "an unreadable
 * date is never treated as more urgent than a real one" posture
 * `oracle/rank.ts`'s own module doc argues, applied to the opposite question
 * (whether it has already happened, not how close it is).
 */
const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hasAssessmentPassed(due: string | undefined, asOf: Date): boolean {
  if (due === undefined || !CALENDAR_DAY_RE.test(due)) return false;
  const dueDate = new Date(`${due}T00:00:00.000Z`);
  if (Number.isNaN(dueDate.getTime())) return false;
  const asOfUtcMidnight = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return dueDate.getTime() < asOfUtcMidnight;
}

/**
 * Resolves the offer's current status for one assessment from its event
 * history. Order-independent: an 'opened' or 'dismissed' event anywhere in
 * `events` for this `assessmentPath` ends the offer permanently — there is
 * no "un-dismiss" and no re-offering (F8.8: "offered once").
 */
export function resolveRetrospectiveOfferStatus(
  events: readonly RetrospectiveOfferEvent[],
  assessmentPath: string,
  assessmentPassed: boolean,
): RetrospectiveOfferStatus {
  if (!assessmentPassed) return 'not-yet-eligible';
  const forThisAssessment = events.filter((event) => event.assessmentPath === assessmentPath);
  if (forThisAssessment.some((event) => event.kind === 'retrospective-opened')) return 'opened';
  if (forThisAssessment.some((event) => event.kind === 'retrospective-dismissed'))
    return 'dismissed';
  return 'offered';
}
