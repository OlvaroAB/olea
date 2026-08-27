/**
 * A pure health-check verdict over one run's `ConfusionPairingResult` — the
 * same `CheckVerdict` shape every check in `packages/core/src/checks/`
 * returns (`../../checks/types.js`), authored here instead of there because
 * this reader's `owns` path is `packages/core/src/concept/
 * confusion-pairing/` only (`ol-2zfj.20`) and `packages/core/src/checks/`
 * belongs to a different bead.
 *
 * **What this checks, and why it is a structural failure mode rather than
 * a fabricated ratio.** `./types.ts`'s top doc and `./corroborate.ts` name
 * the risk this reader inherits from `corpusRelationSignals.ts`'s
 * `AssessmentErrorAdjacencyOptions`: if a future misconception-store caller
 * starts stamping `conceptId`/`confusedWithConceptId` with `[D-088]`'s
 * opaque key instead of a name, EVERY evidence-bearing record silently
 * fails name/alias resolution rather than mismatching loudly — resolution
 * does not degrade gracefully, it goes to zero all at once. A ratio
 * threshold ("resolve at least N% of records") would be a derived constant
 * fitted against nothing — no eval set has ever measured a resolution rate
 * for this reader — which the component register's declared-vs-derived
 * rule warns against exactly this shape of invention. The check below
 * instead names the one failure this reader can actually distinguish from
 * ordinary "no evidence yet": every record that carried real evidence
 * (`confusedWithConceptId !== null`) failed to resolve, with at least one
 * such record to test against.
 *
 * **Not wired to anything.** Per this bead's brief, this reader has no
 * production caller yet — `ol-2zfj.21` (the open, human-held decision on
 * what "confusion pairing" means as student-visible behaviour) gates that.
 * A harness script driving this check against real material, the way
 * `olea-service`'s `scripts/harness/relation-reader-check.mjs` drives
 * `../../checks/relation-reader-health.ts`, is future work for whoever
 * builds that caller — this function only needs to exist and be correct
 * today.
 */

import type { CheckVerdict } from '../../checks/types.js';
import type { ConfusionPairingResult } from './types.js';

export interface ConfusionPairingResolutionHealth {
  readonly evidenceBearingRecords: number;
  readonly unresolvedRecords: number;
}

/**
 * `ok: true` when there was no evidence to resolve this run, or when at
 * least one evidence-bearing record resolved. `ok: false` only when there
 * was real evidence (`evidenceBearingRecords > 0`) and NONE of it resolved
 * — the identity-space mismatch this module's top doc names, made
 * checkable.
 */
export function checkConfusionPairingResolution(
  result: ConfusionPairingResult,
): CheckVerdict<ConfusionPairingResolutionHealth> {
  const measured: ConfusionPairingResolutionHealth = {
    evidenceBearingRecords: result.evidenceBearingRecords,
    unresolvedRecords: result.unresolvedRecords,
  };

  if (result.evidenceBearingRecords === 0) {
    return {
      ok: true,
      measured,
      detail: 'no misconception record carried confusedWithConceptId this run — nothing to resolve',
    };
  }

  if (result.unresolvedRecords === result.evidenceBearingRecords) {
    return {
      ok: false,
      measured,
      detail: `all ${result.evidenceBearingRecords} evidence-bearing record(s) failed name/alias resolution — the identity space likely no longer matches (see this module's doc)`,
    };
  }

  return {
    ok: true,
    measured,
    detail: `${result.evidenceBearingRecords - result.unresolvedRecords} of ${result.evidenceBearingRecords} evidence-bearing record(s) resolved`,
  };
}
