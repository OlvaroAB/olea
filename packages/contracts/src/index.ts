// olea-contracts public entry point.
//
// INV-1: this package (and every file under it) MUST NEVER import `obsidian`.
// See scripts/check-inv1.mjs and packages/core/test/inv1.probe.spec.ts.

export { type ContractEntry, type ContractId, contracts, SchemaRegistry } from './registry.js';

// Frozen schemas (orchestrator-owned, per plan §0.3). Task payloads land in
// P3-T02; what is frozen here is what two parallel lanes must not move
// underneath each other: the D7.1 review-log record and the Worker envelope.
export {
  type InstrumentType,
  instrumentType,
  type MasteryAtTime,
  type MasteryState,
  masteryAtTime,
  masteryState,
  type Rating,
  REVIEW_LOG_READABLE_VERSIONS,
  REVIEW_LOG_SCHEMA_VERSION,
  type ReviewLogEntry,
  type ReviewLogEntryV2,
  type ReviewLogEntryV3,
  type ReviewLogEntryV4,
  type ReviewLogRecord,
  type ReviewLogRecordV1,
  type ReviewLogRecordV2,
  type ReviewLogRecordV3,
  type ReviewLogRecordV4,
  rating,
  reviewLogEntry,
  reviewLogEntryV2,
  reviewLogEntryV3,
  reviewLogEntryV4,
  reviewLogRecord,
  reviewLogRecordV1,
  reviewLogRecordV2,
  reviewLogRecordV3,
  reviewLogRecordV4,
  type SelectionContext,
  type SelectionContextV4,
  type SuspendEventKind,
  type SuspendLogRecord,
  type SuspendLogRecordV2,
  type SuspendLogRecordV3,
  type SuspendLogRecordV4,
  selectionContext,
  selectionContextV4,
  suspendEventKind,
  suspendLogRecord,
  suspendLogRecordV2,
  suspendLogRecordV3,
  suspendLogRecordV4,
} from './review-log.js';
// The versioned study-plan artifact (A2.5, C7.6, P5-T05). Worker-computed
// policy, cached and executed client-side; its `planVersion` is the one value
// that crosses from here into her append-only review log.
export {
  type PlannedConcept,
  plannedConcept,
  STUDY_PLAN_CONTRACT_ID,
  STUDY_PLAN_FORMAT_VERSION,
  type StudyPlanArtifact,
  type StudyPlanCitation,
  type StudyPlanCourse,
  studyPlanArtifact,
  studyPlanCitation,
  studyPlanCourse,
} from './study-plan.js';
export {
  ALL_TASK_IDS,
  isKnownTaskId,
  type KnownTaskId,
  knownTaskId,
  TASK_ENDPOINT_PATH,
  TASK_IDS,
} from './tasks.js';
export {
  CONTRACT_VERSION,
  type ErrorCode,
  type ErrorResponse,
  errorCode,
  errorResponse,
  isSupportedContractVersion,
  type RequestEnvelope,
  type RequestTelemetry,
  type ResponseStamp,
  requestEnvelope,
  requestTelemetry,
  responseStamp,
  SUPPORTED_CONTRACT_VERSIONS,
  type SuccessResponse,
  successResponse,
  type TaskId,
  taskId,
  type WorkerResponse,
  workerResponse,
} from './worker.js';
