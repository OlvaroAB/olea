/**
 * CHK-1 (`ol-3ux7.1`, foundation item 34) — component register row 4.1's
 * health check: **"the count must never move without a named cause — a
 * document arriving or a corrected classification, never silence — so
 * growth from a new source and shrink from a reclassification are the same
 * check, not opposite ones."** (`docs/Olea_component_register.md` row 4.1,
 * olea-service; F1.5(c)/F8.1/F8.3, `[D-184]`, `ol-v7r5.29`.)
 *
 * Same division of labour as every check in this directory (`./types.ts`'s
 * module doc): replaying a course through a sequence of registrations and
 * corrections — calling `../scope/grove.js#buildGroveModel` once per step
 * and reading off `GroveCourseSummary.denominatorCount` — is the caller's
 * job (a harness script or a spec). This function only answers a yes/no
 * question about the ALREADY-COMPUTED series of counts: **did the
 * denominator ever move between two adjacent reads with no named event
 * attached to the later read?**
 *
 * ## One check, not two (the register row's own point)
 *
 * `../scope/grove.ts`'s own module doc explains why growth and shrink are
 * structurally the same event for `buildGroveModel` — it holds no memory of
 * a previous read, so "a document arrived" and "she reclassified one" both
 * just mean the next call sees a different `citations`/`sources` set. This
 * check mirrors that at the audit layer: `ScopeCountCauseStep.causeEvent`
 * is checked only for PRESENCE, never for which of `'source-added'` /
 * `'reclassified'` it names, and a step's direction (the count rose or
 * fell) is measured and reported but never used to decide which cause kind
 * would have been acceptable. A check that required "shrink must cite
 * `'reclassified'`, growth must cite `'source-added'`" would itself be the
 * "opposite ones" the register row rejects — a reclassification that
 * *grows* scope (a document corrected INTO a declaring role) is exactly as
 * legitimate a cause for a rise as a freshly registered source is.
 *
 * ## A check that ran nothing cannot report a pass
 *
 * Fewer than {@link SCOPE_COUNT_CAUSE_MIN_STEPS} reads carries no transition
 * to test at all — `checkFloorLoadLinearity`'s and `checkRankFactorAblation`'s
 * own floor, applied here for the identical reason (N-013).
 */
import type { CheckVerdict } from './types.js';

/**
 * The two named events F1.5(c)/F8.1 recognise as a legitimate cause for the
 * denominator to move — a source registered under F1.5, or an existing
 * source's role corrected (F1.5(c)'s "correcting a document's
 * classification is the same gesture as making it"). This check never asks
 * which of the two a given step names (see module doc) — the type exists so
 * a caller cannot attach an event of some THIRD, unrecognised kind by
 * accident and have it silently count as a cause.
 */
export type ScopeCountCauseEventKind = 'source-added' | 'reclassified';

/**
 * One already-computed read of a course's grove denominator — `../scope/
 * grove.ts#GroveCourseSummary.denominatorCount` at one point in a replayed
 * sequence, plus whichever named event (if any) the caller attributes to
 * THIS read having landed a different count from the read before it.
 * `causeEvent` on the FIRST step in a sequence is never inspected (there is
 * no prior read for it to explain) and may be omitted.
 */
export interface ScopeCountCauseStep {
  /** Opaque step id (INV-3) — never a real course, source or concept name. */
  readonly id: string;
  readonly denominatorCount: number;
  /** Absent means "nothing happened to explain a change" — see module doc for why this check does not care WHICH kind is named, only whether one is. */
  readonly causeEvent?: ScopeCountCauseEventKind;
}

/** Fewer reads than this cannot show a transition at all. */
export const SCOPE_COUNT_CAUSE_MIN_STEPS = 2;

export interface ScopeCountCauseMeasured {
  /** `steps.length`, after sequencing — kept even when the check is rejected below the floor. */
  readonly n: number;
  /** `n - 1` once past the floor, `0` otherwise — the number of adjacent-read comparisons made. */
  readonly transitions: number;
  /** Transitions where the denominator actually differed from the read before it, in either direction. */
  readonly movedTransitions: number;
  /** Of `movedTransitions`, how many rose — reported for transparency, never gates the verdict (see module doc). */
  readonly grewTransitions: number;
  /** Of `movedTransitions`, how many fell — reported for transparency, never gates the verdict (see module doc). */
  readonly shrankTransitions: number;
  /** Step ids where the count moved with `causeEvent` absent — the defect this check exists to catch. */
  readonly silentMoves: readonly string[];
}

function rejected(n: number, detail: string): CheckVerdict<ScopeCountCauseMeasured> {
  return {
    ok: false,
    measured: {
      n,
      transitions: 0,
      movedTransitions: 0,
      grewTransitions: 0,
      shrankTransitions: 0,
      silentMoves: [],
    },
    detail,
  };
}

/**
 * Replay one course's `denominatorCount` series (register row 4.1's health
 * check) and fail on any adjacent pair where the count moved with no named
 * cause attached to the later read. Direction — growth or shrink — is
 * measured but never gates the verdict: only silence does.
 */
export function checkScopeCountCauseAttribution(
  steps: readonly ScopeCountCauseStep[],
): CheckVerdict<ScopeCountCauseMeasured> {
  if (steps.length < SCOPE_COUNT_CAUSE_MIN_STEPS) {
    return rejected(
      steps.length,
      `checkScopeCountCauseAttribution: need at least ${SCOPE_COUNT_CAUSE_MIN_STEPS} reads to ` +
        `test a transition, got ${steps.length} — a check that ran nothing cannot report a pass.`,
    );
  }

  const silentMoves: string[] = [];
  let grewTransitions = 0;
  let shrankTransitions = 0;

  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1];
    const cur = steps[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.denominatorCount === prev.denominatorCount) continue;

    if (cur.denominatorCount > prev.denominatorCount) grewTransitions += 1;
    else shrankTransitions += 1;

    if (cur.causeEvent === undefined) silentMoves.push(cur.id);
  }

  const measured: ScopeCountCauseMeasured = {
    n: steps.length,
    transitions: steps.length - 1,
    movedTransitions: grewTransitions + shrankTransitions,
    grewTransitions,
    shrankTransitions,
    silentMoves,
  };

  if (silentMoves.length > 0) {
    return {
      ok: false,
      measured,
      detail:
        `${silentMoves.length} of ${measured.transitions} read(s) moved the denominator with no ` +
        `named cause attached (${silentMoves.join(', ')}) — a document arriving or a corrected ` +
        'classification must always be named; silence is the defect.',
    };
  }

  return {
    ok: true,
    measured,
    detail:
      `every count change across ${measured.transitions} read(s) — ${grewTransitions} grew, ` +
      `${shrankTransitions} shrank — carried a named cause, never silence.`,
  };
}
