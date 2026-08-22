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
