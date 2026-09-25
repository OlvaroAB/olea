/**
 * Decision adapters for the materiality seam, at its two grains. Pure; the
 * seam's files are not touched.
 *
 * 1. `decisionFromRevisionJudge`: the settled result of one
 *    `RevisionJudgePort.judge` call (`../../concept/revision/types.ts`). The
 *    plugin's file-level `MaterialityJudge` returns the same shape field for
 *    field (that file's own doc says so), so this adapter reads its results
 *    too, structurally, without core importing the plugin.
 *    - `material: true` is the verdict `material`, `false` is `immaterial`;
 *      the content-free `reason` is the payload.
 *    - a value whose `material` is not a boolean is unavailable `malformed`.
 *      Typed values never reach that branch; it is here for a value that
 *      crossed a boundary untyped.
 *    - a rejected call is unavailable `call-failed`.
 *
 * 2. `decisionFromCitedPassageRevision`: `evaluateCitedPassageRevision`'s
 *    outcome (`../../concept/revision/material-change.ts`). Only three of
 *    its seven arms involve the judge:
 *    - `refreshed` (the judge found the same claim) is `immaterial`;
 *    - `revised` (a changed claim) is `material`;
 *    - `judge-unavailable` (no judge configured) is unavailable
 *      `not-configured`.
 *    The other four (`unchanged`, `relocated`, `relocation-proposed`,
 *    `stranded`) are settled by code before any decision is asked for, so
 *    they return `null`: no decision was made, and none is invented.
 *    The payload is the seam's own outcome arm, so nothing is lost.
 *
 * The chain's target set also has `uncertain`. Under this contract that word
 * is the step's undecided word, not a verdict; no seam produces it today.
 */

import type {
  CitedPassageRevisionOutcome,
  RevisionJudgeVerdict,
} from '../../concept/revision/types.js';
import type { DecisionOutcome, DecisionVocabulary } from '../decision.js';
import { failedCallProvenance, modelProvenance, type StageSeamContext } from '../provenance.js';

export type MaterialityVerdict = 'material' | 'immaterial';

/** The materiality step's closed verdict set, with its own word for undecided. */
export const MATERIALITY_VOCABULARY: DecisionVocabulary<MaterialityVerdict> = {
  verdicts: ['material', 'immaterial'],
  undecided: 'uncertain',
};

export interface MaterialityPayload {
  /** Content-free (D-005): a short structural note, never her wording. */
  readonly reason?: string;
}

export type MaterialityDecision = DecisionOutcome<MaterialityVerdict, MaterialityPayload>;

export function decisionFromRevisionJudge(
  settled: PromiseSettledResult<RevisionJudgeVerdict>,
  context: StageSeamContext,
): MaterialityDecision {
  if (settled.status === 'rejected') {
    return { kind: 'unavailable', cause: 'call-failed', provenance: failedCallProvenance(context) };
  }
  const verdict = settled.value as Partial<RevisionJudgeVerdict> | null | undefined;
  if (typeof verdict?.material !== 'boolean') {
    return { kind: 'unavailable', cause: 'malformed', provenance: failedCallProvenance(context) };
  }
  return {
    kind: 'verdict',
    verdict: verdict.material ? 'material' : 'immaterial',
    payload: typeof verdict.reason === 'string' ? { reason: verdict.reason } : {},
    provenance: modelProvenance(context),
  };
}

type JudgedRevision = Extract<CitedPassageRevisionOutcome, { kind: 'refreshed' | 'revised' }>;

export type CitedPassageRevisionDecision = DecisionOutcome<MaterialityVerdict, JudgedRevision>;

export function decisionFromCitedPassageRevision(
  outcome: CitedPassageRevisionOutcome,
  context: StageSeamContext,
): CitedPassageRevisionDecision | null {
  switch (outcome.kind) {
    case 'refreshed':
      return {
        kind: 'verdict',
        verdict: 'immaterial',
        payload: outcome,
        provenance: modelProvenance(context),
      };
    case 'revised':
      return {
        kind: 'verdict',
        verdict: 'material',
        payload: outcome,
        provenance: modelProvenance(context),
      };
    case 'judge-unavailable':
      return {
        kind: 'unavailable',
        cause: 'not-configured',
        provenance: failedCallProvenance(context),
      };
    case 'unchanged':
    case 'relocated':
    case 'relocation-proposed':
    case 'stranded':
      return null;
  }
}
