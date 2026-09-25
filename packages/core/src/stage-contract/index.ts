/**
 * Barrel for the two shared stage contracts (`ol-egov.141.89.20`, design in
 * `[D-300]`'s review): Decision (`./decision.ts`) and Writing
 * (`./writing.ts`), their shared provenance and failure arm
 * (`./provenance.ts`), and one small pure adapter per existing core seam
 * (`./adapters/`).
 *
 * **Not yet re-exported from `packages/core/src/index.ts`.** That file is a
 * shared surface other lanes append to; this bead owns only this directory,
 * so the one line it needs, `export * from './stage-contract/index.js';`, is
 * left for the orchestrator to apply, the same way `./concept/revision/`
 * landed.
 *
 * **Reachability (`[D-072]`).** Nothing in production calls these yet, by
 * design: each chain adopts its contract in its own build bead, and a
 * consumer switching to read a seam through its adapter is that bead's
 * change to make and test. The adapters change no behaviour: they read the
 * seams' values, and the seams are untouched.
 */

export type {
  AssessSupportDecision,
  AssessSupportPayload,
} from './adapters/assess-support.js';
export {
  ASSESS_SUPPORT_VOCABULARY,
  assessSupportFromDecision,
  assessSupportSeat,
  decisionFromAssessSupport,
  EMPTY_EVIDENCE_PACKAGE_RULE,
} from './adapters/assess-support.js';
export type { AuthoringAttemptWithDraft } from './adapters/authoring.js';
export {
  EVIDENCE_REFUSED_RULE,
  MCQ_EXACT_CHECKS,
  mcqExactCheckResults,
  writingFromAuthoringAttempt,
  writingFromMcqDraft,
} from './adapters/authoring.js';
export {
  NO_READABLE_MATERIAL_RULE,
  RELATIONS_RECONCILED_CHECK,
  writingFromConceptRead,
} from './adapters/concept-read.js';
export type {
  ExplainBackCorrectnessDecision,
  ExplainBackCorrectnessVerdict,
} from './adapters/explain-back-correctness.js';
export {
  decisionFromExplainBackGrading,
  EMPTY_REFERENCE_ANSWER_RULE,
  EXPLAIN_BACK_CORRECTNESS_VOCABULARY,
} from './adapters/explain-back-correctness.js';
export type { ExplainBackDepthDecision } from './adapters/explain-back-depth.js';
export {
  decisionFromSoloGrading,
  EXPLAIN_BACK_DEPTH_VOCABULARY,
} from './adapters/explain-back-depth.js';
export type { ItemValidationDecision, ItemValidationVerdict } from './adapters/item-validation.js';
export {
  decisionFromItemValidation,
  ITEM_VALIDATION_VOCABULARY,
} from './adapters/item-validation.js';
export type {
  KnowledgeKindDecision,
  KnowledgeKindSeamContext,
} from './adapters/knowledge-kind.js';
export {
  decisionFromKnowledgeKind,
  KNOWLEDGE_KIND_VOCABULARY,
  NO_SOURCE_MATERIAL_RULE,
} from './adapters/knowledge-kind.js';
export type {
  CitedPassageRevisionDecision,
  MaterialityDecision,
  MaterialityPayload,
  MaterialityVerdict,
} from './adapters/revision-judge.js';
export {
  decisionFromCitedPassageRevision,
  decisionFromRevisionJudge,
  MATERIALITY_VOCABULARY,
} from './adapters/revision-judge.js';
export type { WorkerErrorReading } from './adapters/worker-failure.js';
export { GROUNDING_REFUSED_CODE, readWorkerErrorCode } from './adapters/worker-failure.js';
export type {
  DecisionCascadeOptions,
  DecisionOutcome,
  DecisionSeat,
  DecisionUnavailable,
  DecisionUndecided,
  DecisionVerdict,
  DecisionVocabulary,
  UndecidedBasis,
} from './decision.js';
export {
  cascadeDecisionSeats,
  decisionEnvelopeProblems,
  decisionWord,
  isDecisionVerdict,
  UNDECIDED_BASES,
} from './decision.js';
export type {
  ModelStamp,
  StageEscalation,
  StageEscalationReason,
  StageProducer,
  StageProvenance,
  StageSeamContext,
  StageSeat,
  StageUnavailable,
  StageUnavailableCause,
} from './provenance.js';
export {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  STAGE_UNAVAILABLE_CAUSES,
  stageProvenanceProblems,
  toArtifactProvenance,
} from './provenance.js';
export type {
  WritingAssurance,
  WritingCheckEntry,
  WritingCheckKind,
  WritingCheckResult,
  WritingCheckStatus,
  WritingDeclineBasis,
  WritingDeclined,
  WritingDisposition,
  WritingOutcome,
  WritingReceipt,
  WritingRefused,
  WritingUnavailable,
  WritingWritten,
} from './writing.js';
export {
  buildWritingReceipt,
  passedItsChecks,
  WRITING_CHECK_STATUSES,
  WRITING_DECLINE_BASES,
  writingEnvelopeProblems,
  writingFromChecks,
  writingReceiptProblems,
} from './writing.js';
