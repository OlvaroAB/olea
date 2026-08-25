export {
  checkGapWeightIdentity,
  type GapWeightIdentityMeasured,
} from './gap-weight-identity.js';
export {
  checkKnowledgeKindDistribution,
  DOMINANT_KIND_SHARE_CEILING,
  type KnowledgeKindDistributionMeasured,
  type KnowledgeKindLabel,
  MIN_SAMPLE_FOR_DISTRIBUTION_CHECK,
  type RealKnowledgeKind,
} from './knowledge-kind-distribution.js';
export {
  checkRankFactorAblation,
  type FactorAblationCell,
  type RankFactorAblationMeasured,
} from './rank-factor-ablation.js';
export type { CheckVerdict } from './types.js';
