/**
 * CHK-2 (`ol-3ux7.15`) — component register row 3.2's health check.
 *
 * Row 3.2 ("Per-card timing") names it in plain terms: **"replay
 * determinism — replay a full log twice and assert byte-identical state."**
 * `../session/replay.js`'s `replaySchedulerStates` is a pure fold over
 * `(entries, scheduler)` with no clock and no I/O (its own module doc: "same
 * entries and same Scheduler, same result, always"), so this check exists to
 * catch the one way that claim could quietly stop being true — a scheduler
 * implementation that reads real wall-clock time, holds hidden mutable
 * state, or iterates a `Map` in a way that leaks non-determinism into the
 * result — none of which is visible from reading the type signature alone.
 *
 * Deliberately generic over the state shape: this module never imports
 * `SchedulerState` or `ts-fsrs`, so it can compare replay output for ANY
 * `Scheduler` implementation the project ever adds, not only the FSRS one.
 */
import type { CheckVerdict } from './types.js';

export interface ReplayDeterminismMeasured {
  readonly instrumentCount: number;
  /** Opaque instrument ids only (INV-3) — present in one pass and absent, or present in both with different state, in the other. */
  readonly mismatchedInstrumentIds: readonly string[];
}

/**
 * Two replays of the SAME log through the SAME scheduler, keyed by
 * instrument id, each value a JSON-serialisable snapshot of that
 * instrument's replayed state. Fails if the two passes disagree on any
 * instrument's state or on which instruments exist at all, or if both
 * passes are empty (N-013 — a check that replayed nothing cannot report a
 * pass).
 */
export function checkReplayDeterminism(
  firstPass: ReadonlyMap<string, unknown>,
  secondPass: ReadonlyMap<string, unknown>,
): CheckVerdict<ReplayDeterminismMeasured> {
  const allIds = new Set<string>([...firstPass.keys(), ...secondPass.keys()]);
  const mismatched: string[] = [];

  for (const id of allIds) {
    const a = firstPass.has(id) ? JSON.stringify(firstPass.get(id)) : undefined;
    const b = secondPass.has(id) ? JSON.stringify(secondPass.get(id)) : undefined;
    if (a !== b) mismatched.push(id);
  }
  mismatched.sort();

  const measured: ReplayDeterminismMeasured = {
    instrumentCount: allIds.size,
    mismatchedInstrumentIds: mismatched,
  };

  if (allIds.size === 0) {
    return { ok: false, measured, detail: 'zero instruments replayed — nothing was checked' };
  }
  if (mismatched.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${mismatched.length} of ${allIds.size} instrument(s) replayed to a different state on the second pass`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `all ${allIds.size} instrument(s) replayed to byte-identical state on both passes`,
  };
}
