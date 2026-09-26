/**
 * The workbench's single fixed instant.
 *
 * Lives in its own module because two things now need it and neither may
 * import the other: `scenarios.ts` (which builds the queue and stamps the
 * review-log write) and `persona/history.ts` (which anchors a persona's
 * synthetic history so it ends the day before "today"). A shared constant is
 * the whole of the coupling.
 *
 * Fixed rather than `new Date()` for the reason WB-2 depends on: a screenshot
 * taken twice is the same screenshot, and every FSRS interval preview on screen
 * is a function of this instant.
 *
 * **`ol-egov.141.89.10.38` considered, and rejected, moving this value.**
 * This constant sat past every assessment the fixture vault declared (the
 * last was due 2026-11-27), so the oracle's `'assessment-passed'` veto
 * (`../../core/src/oracle/rank.ts`'s `checkEdgeVeto`) removed every
 * concept's evidence and the real composer ranked nothing — the exact bug
 * `ol-tq8f` [WBX-23] fixed for the persona worlds by adding a new upcoming
 * assessment, not by moving a clock. The same fix is used here instead of
 * moving this value: at least thirteen OTHER modules read this same
 * constant (`timeline-scenarios.ts`, `trends-scenarios.ts`,
 * `oracle-scenarios.ts`, `main.ts`, and more — `grep -rl WORKBENCH_NOW
 * src/ test/ e2e/`), none of them owned by that bead, so moving it would
 * have shifted goldens and behaviour this file's own bead had no mandate
 * to touch. `packages/core/fixtures/vault/02 Assignments/Season
 * Checkpoint - GEOL204.md` (due 14 days past this instant) gives the oracle a
 * live assessment to rank against instead, leaving this value — and every
 * golden outside `e2e/simulator/` that reads it — untouched.
 */
export const WORKBENCH_NOW = new Date('2027-01-15T09:15:00.000Z');

/** `YYYY-MM-DD` in UTC. The workbench runs its personas at `+00:00`, so UTC days are local days. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}
