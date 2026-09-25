/**
 * Decision adapter for the knowledge-kind seam: `classifyKnowledgeKind`'s
 * `ClassifyKnowledgeKindResult` (`../../concept/knowledge-kind.ts`). Pure;
 * the seam's file is not touched.
 *
 * The mapping:
 *
 * - `classified` with a committed label is a verdict (`fact`, `category`,
 *   `principle`), with the classifier's confidence carried through.
 * - `classified` with `unclassified` is undecided: the seam's own doc calls
 *   it "this module declined to commit", which is exactly undecided, and it
 *   is kept distinct from not-run. The basis is `below-confidence-bar` when
 *   the reported confidence sits below the floor the caller applied, and
 *   `abstained` otherwise. (Where a model said `unclassified` with a
 *   confidence that is also below the floor, the seam's result cannot tell
 *   the two apart; either way the outcome is undecided.)
 * - `not-run` for `no-source-material` is undecided `nothing-to-decide-from`,
 *   produced by code (INV-5: the port is never reached).
 * - `not-run` for `classifier-unavailable` is unavailable, with the seam's
 *   own reason as the cause (`offline`, `budget-exhausted`,
 *   `not-on-this-device`, `not-configured`: the same four words).
 * - `not-run` for `classifier-failed` is unavailable `call-failed`.
 */

import type { ClassifyKnowledgeKindResult, KnowledgeKind } from '../../concept/knowledge-kind.js';
import type { DecisionOutcome, DecisionVocabulary } from '../decision.js';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';

/** The classify step's closed verdict set, with its own word for undecided. */
export const KNOWLEDGE_KIND_VOCABULARY: DecisionVocabulary<KnowledgeKind> = {
  verdicts: ['fact', 'category', 'principle'],
  undecided: 'unclassified',
};

export type KnowledgeKindDecision = DecisionOutcome<KnowledgeKind, null>;

/** The code rule named on the undecided outcome when there is no source material. */
export const NO_SOURCE_MATERIAL_RULE = 'no-source-material';

export interface KnowledgeKindSeamContext extends StageSeamContext {
  /** The floor the seam call applied (`ClassifyKnowledgeKindOptions.confidenceFloor`), stated by the caller. */
  readonly confidenceFloor: number;
}

export function decisionFromKnowledgeKind(
  result: ClassifyKnowledgeKindResult,
  context: KnowledgeKindSeamContext,
): KnowledgeKindDecision {
  if (result.outcome === 'classified') {
    const classification = result.classification;
    if (classification.status === 'classified') {
      return {
        kind: 'verdict',
        verdict: classification.kind,
        payload: null,
        confidence: classification.confidence,
        provenance: modelProvenance(context),
      };
    }
    const confidence = classification.confidence;
    const belowFloor = confidence !== undefined && confidence < context.confidenceFloor;
    return {
      kind: 'undecided',
      basis: belowFloor ? 'below-confidence-bar' : 'abstained',
      ...(confidence !== undefined ? { confidence } : {}),
      provenance: modelProvenance(context),
    };
  }
  switch (result.reason) {
    case 'no-source-material':
      return {
        kind: 'undecided',
        basis: 'nothing-to-decide-from',
        provenance: codeProvenance(NO_SOURCE_MATERIAL_RULE, context.evidenceDigests),
      };
    case 'classifier-unavailable':
      return {
        kind: 'unavailable',
        cause: result.unavailableBecause ?? 'call-failed',
        provenance: failedCallProvenance(context),
      };
    case 'classifier-failed':
      return {
        kind: 'unavailable',
        cause: 'call-failed',
        provenance: failedCallProvenance(context),
      };
  }
}
