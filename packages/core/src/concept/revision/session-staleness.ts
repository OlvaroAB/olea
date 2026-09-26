/**
 * `[ILB-CHG-4]` (`ol-egov.141.89.5.4`), component register row 3.6 —
 * `docs/dev/intelligence-build/chg.md` (`../../../../olea-service/`) §2's
 * target line: "3.6: revision records -> one staleness fact per session ->
 * rebuild tomorrow's plan." This is that one fact, computed from THIS
 * CHAIN's own revision records rather than a vault `firstSeen`/arrival read
 * (chg.md's "3.6 staleness" row: "materialArrivedInScope reads processed
 * revisions rather than first-seen timestamps").
 *
 * ## Which revision record, and why this shape
 *
 * `[D-343]`/`[D-351]` already give this chain a durable, per-instrument fact
 * that is exactly a processed revision at the instant it is known — pending
 * revalidation, recorded the moment a cited passage's digest differs, ahead
 * of any judge verdict (`revision/types.ts`'s `PendingRevalidationRecorder`
 * doc). `study-session/compose.ts` already reads that fact (via
 * `citationPendingRevalidation`) and freezes the resulting instrument-id set
 * onto every `ComposedStudySession` it builds or extends, as
 * `citationRevalidationPending` — so the sitting a `StudySessionHolder`
 * already holds carries, for free, exactly the snapshot this function needs
 * on one side of the comparison: no second store read, no new frozen field,
 * no risk of drifting from `[D-330]`'s own withholding logic (which reads
 * that identical set — see `compose.ts`'s own "Citation validity" section).
 *
 * ## What this deliberately is not
 *
 * **Not enforcement.** `[D-330]` (David, 2026-09-25) already withholds a
 * pending-revalidation instrument at compose and extend time, including
 * inside an already-open session — that happens whether or not anyone ever
 * calls this function. This function answers a different, narrower
 * question: whether the SITTING a caller is already holding has become
 * stale enough to end and recompose (`[D-162]`'s freeze contract,
 * `queue/rebuild-controller.ts`), because a citation newly entered pending
 * revalidation after the sitting was frozen. Skipping this check costs a
 * missed recompute prompt, never a shown-stale citation — `[D-330]`'s own
 * filter is the backstop either way.
 *
 * **One direction only, since the freeze.** Mirrors
 * `queue/rebuild-controller.ts`'s `diffSittingScopeSnapshots` `itemsDueInScope`
 * field exactly: only an instrument id present in `current` but ABSENT from
 * `frozen` counts — "a concept newly due since the freeze, never a concept
 * that was already due and still is (that was already true the moment she
 * opened the sitting, so it is not a change)," the identical reasoning
 * applied here to "newly pending" rather than "newly due." An instrument
 * that RESOLVED out of pending since the freeze (an `immaterial` verdict
 * restored it, `revision/types.ts`'s three-state model) is not a staleness
 * signal either — losing a pending mark makes the sitting no less safe than
 * it already was.
 *
 * **Pure and total.** No clock, no I/O, no `obsidian` import (INV-1/§7.1) —
 * both sets already arrive resolved, exactly as `diffSittingScopeSnapshots`
 * takes both of its snapshots pre-built.
 */

/**
 * The one 3.6 staleness fact this chain's own revision records feed: true
 * when `currentPendingRevalidation` names at least one instrument id not
 * already present in `frozenPendingRevalidation` — a citation in today's
 * scope newly known to have changed since the sitting was frozen. See this
 * module's own doc for why only this direction counts, and why this is a
 * recompute prompt rather than the withholding itself (`[D-330]` already
 * does that, independently, at compose/extend time).
 */
export function hasCitationRevisionChangedInScope(
  frozenPendingRevalidation: ReadonlySet<string>,
  currentPendingRevalidation: ReadonlySet<string>,
): boolean {
  for (const instrumentId of currentPendingRevalidation) {
    if (!frozenPendingRevalidation.has(instrumentId)) return true;
  }
  return false;
}
