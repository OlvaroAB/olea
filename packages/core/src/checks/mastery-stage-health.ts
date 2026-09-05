/**
 * CHK-2 (`ol-3ux7.15`) — component register row 3.1's health check.
 *
 * Row 3.1 ("Compute mastery") names two shapes in plain terms: **"the stage
 * distribution over a real vault run — fails if the modal stage exceeds a
 * declared share or any stage is empty. Plus a monotonicity property test:
 * replay any log prefix by prefix and assert the stage never decreases."**
 *
 * Both take the ALREADY-COMPUTED output of `computeConceptMastery`
 * (`../mastery/rollup.js`) — a real, shipped, model-free pure function — the
 * same "check compares, a harness runs" split every other file in this
 * directory follows.
 *
 * ## The monotonicity check now passes, and what it is still FOR
 *
 * Until `MAT-6` (`ol-95vv.7`, 2026-09-05) this section said the monotonicity
 * check was expected to fail: `computeConceptMastery` bucketed a recent
 * windowed success rate and could fall back from `tree` to `sprout` when
 * enough failures entered the window, which row 3.1's State column named as
 * the "superseded model". That model is gone. The rollup is now a high-water
 * mark over the whole log, every predicate it reads is monotone, and this
 * check runs GREEN — `scripts/harness/mastery-checks.mjs` in `olea-service`
 * is the run of record.
 *
 * That does not make the check redundant, and it is worth saying why, because
 * a green property test is the easiest kind to quietly delete. Monotonicity
 * is a **contract clause with no compiler behind it** (knowledge model R3:
 * "no implementation may express decay by lowering it"; §8 test 4: "if a
 * growth stage has ever fallen for any concept ... R3 has been implemented
 * backwards"). Nothing in the type system stops a future caller adding a
 * decay term, a recency weight or a "current state" rollup that reintroduces
 * exactly the regression this check was built to catch — it caught it once
 * already. This is the standing guard against that recurrence, and it must
 * still be able to come back "no": `mastery-stage-health.spec.ts` pins that
 * by feeding it a regressing sequence and asserting it fails.
 */
import type { CheckVerdict } from './types.js';

/** F2.11/D-049's four growth stages, weakest to strongest — the ordinal `checkMasteryMonotonicity` walks. */
export const MASTERY_STAGE_ORDER = ['seed', 'sprout', 'sapling', 'tree'] as const;
export type MasteryStage = (typeof MASTERY_STAGE_ORDER)[number];

function stageRank(stage: MasteryStage): number {
  return MASTERY_STAGE_ORDER.indexOf(stage);
}

// ---------------------------------------------------------------------------
// Stage distribution — one batch of concepts' current stages.
// ---------------------------------------------------------------------------

export interface MasteryStageDistributionMeasured {
  readonly total: number;
  readonly counts: Readonly<Record<MasteryStage, number>>;
  readonly modalStage: MasteryStage | null;
  readonly modalShare: number;
  readonly emptyStages: readonly MasteryStage[];
}

/**
 * One batch of concepts' current growth-stage readings in, a verdict out.
 * Fails if any of the four stages is entirely empty, or if one stage covers
 * `modalShareCeiling` or more of the batch.
 *
 * `modalShareCeiling` is a REQUIRED argument with no shipped default —
 * unlike row 1.5's `DOMINANT_KIND_SHARE_CEILING`, no existing derivation
 * names a number for this shape yet, and CLAUDE.md's rule for this bead is
 * "compares against structure/invariants, not fitted numbers": inventing a
 * ceiling here would be exactly the guess-wearing-a-declared-label problem
 * row 3.1's own amended text warns about. A caller states its own ceiling
 * (and says, in its own report, why that number is defensible in plain
 * English) rather than this module shipping one quietly.
 */
export function checkMasteryStageDistribution(
  stages: readonly MasteryStage[],
  modalShareCeiling: number,
): CheckVerdict<MasteryStageDistributionMeasured> {
  const counts: Record<MasteryStage, number> = { seed: 0, sprout: 0, sapling: 0, tree: 0 };
  for (const stage of stages) counts[stage] += 1;

  const total = stages.length;
  let modalStage: MasteryStage | null = null;
  let modalCount = 0;
  for (const stage of MASTERY_STAGE_ORDER) {
    if (counts[stage] > modalCount) {
      modalCount = counts[stage];
      modalStage = stage;
    }
  }
  const modalShare = total === 0 ? 0 : modalCount / total;
  const emptyStages = MASTERY_STAGE_ORDER.filter((stage) => counts[stage] === 0);

  const measured: MasteryStageDistributionMeasured = {
    total,
    counts,
    modalStage,
    modalShare,
    emptyStages,
  };

  if (total === 0) {
    return { ok: false, measured, detail: 'zero concepts supplied — nothing was checked' };
  }
  if (emptyStages.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${emptyStages.length} of 4 stages never occur across ${total} concept(s): ${emptyStages.join(', ')}`,
    };
  }
  if (modalShare >= modalShareCeiling) {
    return {
      ok: false,
      measured,
      detail:
        `stage '${modalStage}' covers ${(modalShare * 100).toFixed(1)}% of ${total} concepts — ` +
        `at or above the ${(modalShareCeiling * 100).toFixed(0)}% ceiling`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `modal stage '${modalStage}' at ${(modalShare * 100).toFixed(1)}% of ${total}, every stage represented`,
  };
}

// ---------------------------------------------------------------------------
// Monotonicity — one concept's stage, replayed prefix by prefix.
// ---------------------------------------------------------------------------

export interface MasteryMonotonicityMeasured {
  readonly steps: number;
  /** Index into the supplied sequence (1-based: the step AFTER which the drop was observed) where the stage first dropped, or `null` if it never did. */
  readonly firstRegressionAtStep: number | null;
  readonly regressionFrom: MasteryStage | null;
  readonly regressionTo: MasteryStage | null;
}

/**
 * `stageAfterPrefix[i]` must be the growth stage `computeConceptMastery`
 * returns after replaying the log's first `i + 1` entries (any entries, not
 * only ones for the concept in question — the caller decides what "a
 * prefix" means; this function only walks the resulting sequence). Fails on
 * the first step where the stage's ordinal rank is lower than the previous
 * step's — a real regression, never a plateau (equal is fine).
 */
export function checkMasteryMonotonicity(
  stageAfterPrefix: readonly MasteryStage[],
): CheckVerdict<MasteryMonotonicityMeasured> {
  if (stageAfterPrefix.length === 0) {
    return {
      ok: false,
      measured: { steps: 0, firstRegressionAtStep: null, regressionFrom: null, regressionTo: null },
      detail: 'zero prefixes supplied — nothing was replayed',
    };
  }

  for (let i = 1; i < stageAfterPrefix.length; i += 1) {
    const prev = stageAfterPrefix[i - 1] as MasteryStage;
    const curr = stageAfterPrefix[i] as MasteryStage;
    if (stageRank(curr) < stageRank(prev)) {
      const measured: MasteryMonotonicityMeasured = {
        steps: stageAfterPrefix.length,
        firstRegressionAtStep: i + 1,
        regressionFrom: prev,
        regressionTo: curr,
      };
      return {
        ok: false,
        measured,
        detail: `stage dropped from '${prev}' to '${curr}' at step ${i + 1} of ${stageAfterPrefix.length}`,
      };
    }
  }

  const measured: MasteryMonotonicityMeasured = {
    steps: stageAfterPrefix.length,
    firstRegressionAtStep: null,
    regressionFrom: null,
    regressionTo: null,
  };
  return {
    ok: true,
    measured,
    detail: `stage never decreased across ${stageAfterPrefix.length} replayed prefixes`,
  };
}
