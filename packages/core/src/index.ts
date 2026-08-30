// olea-core public entry point.
//
// INV-1: this package (and every file under it) MUST NEVER import `obsidian`.
// See scripts/check-inv1.mjs and packages/core/test/inv1.probe.spec.ts.

export {
  extractDeclaredProperties,
  extractExtFilters,
  extractInFolderFilters,
} from './assessment/base-file.js';
export { readAssessments } from './assessment/read.js';
// F2.19's assessment-scope resolver (`ol-v7r5.11`): F1.7's free-text scope
// and F4.7's due day, resolved to the `conceptKey`-keyed context
// `study-session/compose.ts`'s within-block grouping seam reads. See
// `./assessment/scope-concept-keys.js`'s module doc for the exact/
// normalized-exact-only matching convention (`ol-2zfj.27`).
export type {
  AssessmentConceptContext,
  AssessmentGroupingContextResolution,
} from './assessment/scope-concept-keys.js';
export { resolveAssessmentGroupingContext } from './assessment/scope-concept-keys.js';
export type {
  AssessmentField,
  AssessmentReadReport,
  AssessmentRecord,
  ColumnMapping,
} from './assessment/types.js';
export { REQUIRED_ASSESSMENT_FIELDS } from './assessment/types.js';
// The byte path, body side (INV-2). Every write into a note goes through this;
// see block/edit.ts for why it rejects rather than performs a straddling edit.
export type { AppliedSpan, DocumentEdit, DocumentEditResult } from './block/edit.js';
export { applyDocumentEdits, removeSpans } from './block/edit.js';
export { buildOutline } from './block/outline.js';
export { parseDocument } from './block/parse.js';
export type {
  BlankBlock,
  Block,
  BlockKind,
  CalloutBlock,
  CodeBlock,
  FrontmatterBlock,
  HeadingBlock,
  ListBlock,
  ListItem,
  OutlineNode,
  ParagraphBlock,
  ParsedDocument,
  ThematicBreakBlock,
} from './block/types.js';
export { isLossless } from './block/types.js';
export type { ConceptKeyInput, ConceptKeySource } from './concept/concept-key.js';
// The provisional concept-key seam (`ol-il6m`, C7.11, `[D-088]`, `[D-109]`).
// See `./concept/concept-key.js`'s module doc for what this derivation can
// and cannot yet promise.
export {
  PROVISIONAL_CONCEPT_KEY_PREFIX,
  provisionalConceptKey,
} from './concept/concept-key.js';
export { corroborateConfusionPairs } from './concept/confusion-pairing/corroborate.js';
export type { ConfusionPairingResolutionHealth } from './concept/confusion-pairing/health.js';
export { checkConfusionPairingResolution } from './concept/confusion-pairing/health.js';
// The confusion-pairing corroboration reader (`ol-2zfj.20`) — corroborates
// `contrasts-with` edges against misconception evidence
// (`confusedWithConceptId`). Pure, no persistence, no student surface: see
// `./concept/confusion-pairing/types.ts`'s module doc for the full scope
// argument and `[D-072]` clause 5's named exception — no production caller
// yet, gated on the open decision at `ol-2zfj.21`.
export type {
  ConfusionCorroborationStanding,
  ConfusionPairCorroboration,
  ConfusionPairingConcept,
  ConfusionPairingResult,
} from './concept/confusion-pairing/types.js';
export type {
  PassageTextLookup,
  RunCorpusRelationBatchInput,
} from './concept/corpus-relations/batch.js';
export { runCorpusRelationBatch, totalCorpusDropped } from './concept/corpus-relations/batch.js';
export { nominateCorpusRelationCandidates } from './concept/corpus-relations/nominate.js';
export type {
  CorpusRelationBatchTriggerInput,
  CorpusRelationBatchTriggerReason,
  CorpusRelationBatchTriggerResult,
} from './concept/corpus-relations/trigger.js';
export { shouldRunCorpusRelationBatch } from './concept/corpus-relations/trigger.js';
// The corpus-level relation stage (`[D-082]`, component register row 1.2a,
// `[EXT-5]` `ol-2zfj.7`): candidate nomination over cheap signals, a
// combined-passage verdict, and the batch trigger/scope rule. Structurally
// separate from `./concept/read.js` (per-document) and `./concept/
// reconcile.js` (that stage's own reconciliation) — see `./concept/
// corpus-relations/types.js`'s module doc. `CorpusRelationVerdictPort` is the
// service seam; `[EXT-11]` (`ol-kw4a`, `[D-118]`) is its first production
// adapter, in `packages/plugin/src/concept/`, which is why these need to be
// nameable outside this package for the first time.
export type {
  CorpusConcept,
  CorpusRelationBatchResult,
  CorpusRelationCandidate,
  CorpusRelationDropReason,
  NominationSignal,
  NominationSignalKind,
} from './concept/corpus-relations/types.js';
export {
  CORPUS_RELATION_DROP_REASONS,
  CORPUS_STAGE_EMITTABLE_TYPES,
  emptyCorpusDropCounts,
} from './concept/corpus-relations/types.js';
export type {
  CorpusRelationVerdictPort,
  CorpusVerdict,
  CorpusVerdictRequest,
  CorpusVerdictRequestCandidate,
  CorpusVerdictResponse,
  ReconcileCorpusVerdictsResult,
} from './concept/corpus-relations/verdict.js';
export { reconcileCorpusVerdicts } from './concept/corpus-relations/verdict.js';
// ol-p3t07a: the F3.3 automatic-generation pipeline (`packages/plugin/src/
// generation/`) needs F1.3's course-from-path derivation to turn a
// newly-landed source's note path into the `courseCode` `draftQuizCardsFor
// Concept` requires — nothing outside `olea-core` could reach it before this
// additive barrel export (same precedent as `masteryAtTimeForConceptIds`'s
// own addition: a deep import would risk double-bundling, and this package
// is the one place the derivation is defined). Does not touch course.ts
// itself.
export { courseFromPath, DEFAULT_COURSES_FOLDER, notePathCourses } from './concept/course.js';
export { extractConcepts } from './concept/extract.js';
// Knowledge-kind classification (component register row 1.5, `[KCT-1]`,
// `ol-kxr6`) — a label, or explicitly unclassified, read by component 2.2
// (instrument-type routing). `KnowledgeKindClassifierPort` is the service
// seam — the model call that does the classifying — and has no production
// adapter yet; see `./concept/knowledge-kind.js`'s module doc.
export type {
  ClassifyKnowledgeKindFailure,
  ClassifyKnowledgeKindOptions,
  ClassifyKnowledgeKindRequest,
  ClassifyKnowledgeKindResponse,
  ClassifyKnowledgeKindResult,
  ConceptKindClassified,
  ConceptKindUnclassified,
  KnowledgeKind,
  KnowledgeKindClassification,
  KnowledgeKindClassified,
  KnowledgeKindClassifierPort,
  KnowledgeKindClassifierUnavailableReason,
  KnowledgeKindDistribution,
  KnowledgeKindHealthCheck,
  KnowledgeKindNotRun,
  KnowledgeKindSourcePassage,
} from './concept/knowledge-kind.js';
export {
  assessKnowledgeKindDistribution,
  classifyKnowledgeKind,
  DOMINANT_KIND_SHARE_CEILING,
  gateKnowledgeKindConfidence,
  isKnowledgeKind,
  KNOWLEDGE_KINDS,
  KnowledgeKindClassifierUnavailableError,
  MIN_SAMPLE_FOR_DISTRIBUTION_CHECK,
  summariseKnowledgeKindDistribution,
} from './concept/knowledge-kind.js';
export type {
  ConceptPassage,
  ConceptReadBudget,
  ConceptReadCoverage,
  ConceptReaderPort,
  ConceptReaderUnavailableReason,
  ConceptReadFailure,
  ConceptReadRequest,
  ConceptReadResponse,
  ConceptReadResult,
  ConceptsRead,
  ConceptsUnrecognised,
  ProposedConcept,
  ReadConcept,
  ReadConceptsOptions,
} from './concept/read.js';
// Concepts from the material, not from the filing (F1.4, `[D-068]`,
// `[D-082]`). `readConcepts` is the stage; `extractConcepts` above is now one
// corroborating source feeding it. `ConceptReaderPort` is the service seam —
// the model call that does the reading — and has no production adapter yet.
export { ConceptReaderUnavailableError, gatherPassages, readConcepts } from './concept/read.js';
// The reconciliation contract (`[EXT-6]`, `ol-2zfj.8`): a relation naming a
// concept the same read did not return is dropped and counted, never used to
// mint one. `readConcepts` is the production caller.
export type {
  ReconcilableConcept,
  ReconcileRelationsResult,
  RelationDropReason,
} from './concept/reconcile.js';
export { reconcileRelations, totalDropped } from './concept/reconcile.js';
// F2.19's relatedness resolver (`ol-v7r5.11`): joins `ConceptRelation.from`/
// `.to` NAMES to the `conceptKey`-keyed adjacency map the within-block
// grouping seam reads. See `./concept/related-concept-keys.js`'s module doc
// for the reused name→key derivation (`ol-63e1`) and the reversible
// "every relation type counts, adjacency is symmetric" default.
export type { RelatedConceptKeysResolution } from './concept/related-concept-keys.js';
export { resolveRelatedConceptKeys } from './concept/related-concept-keys.js';
// The six ruled concept-to-concept relation types (`[REL-1]`, C7.10,
// `[D-070]`) — vocabulary, directedness, and which types v0.9 actually
// emits. See `./concept/relation.js`'s module doc for the per-type argument.
// The fold both relation producers land in (`ol-2zfj.12`) — an in-memory
// projection, deliberately NOT a persisted store: see `./concept/relation.js`'s
// "THE FOLD" section and `olea-service/docs/dev/relation-landing-design.md`
// for the argument and the Class C line it stops at.
export type {
  ConceptRelation,
  ProposedRelation,
  RelationEmissionStatus,
  RelationEvidenceState,
  RelationProvenanceKind,
  RelationSet,
  RelationSetEntry,
  RelationStage,
  RelationTriageStanding,
  RelationType,
} from './concept/relation.js';
export {
  assertionsForTriage,
  deriveRelationSet,
  PER_DOCUMENT_EMITTABLE_TYPES,
  RELATION_DIRECTEDNESS,
  RELATION_EMISSION_STATUS,
  RELATION_TYPES,
  relationKey,
  servedRelations,
  stageForRelationType,
  TRIAGE_STANDING_BY_PROVENANCE,
} from './concept/relation.js';
// `[CORP-3]` (`ol-2zfj.2`) — citation-grain material-change detection and the
// in-memory revision event; applied at the orchestrator's merge per the lane's
// shared-file diff. See `./concept/revision/index.js`'s module doc.
export * from './concept/revision/index.js';
// Concept size (`[D-066]`, component register row 1.3) — a deterministic,
// material-grounded floor read by two named consumers outside this package:
// honest scope counting (F8.1, F8.3) and session composition (F2.17). See
// `./concept/size.js`'s module doc for what it is and is not.
export type {
  ConceptMaterialExtent,
  ConceptSize,
  ConceptSizeBand,
  ReadConceptExtentInput,
} from './concept/size.js';
export {
  COARSE_EXTENT_FLOOR,
  conceptRecordExtent,
  conceptRecordSize,
  deriveConceptSize,
  readConceptExtent,
  readConceptSize,
} from './concept/size.js';
export type { ConceptRecord, ConceptTier, ExtractConceptsOptions } from './concept/types.js';
// C7.8's course lifecycle (`[D-098]`, `ol-0r92.7`): the BEGINNING slice —
// detection proposes, never creates (point 1) — plus the mapping shape and
// its uid-silent re-map / genuine-scatter check. `packages/plugin/src/
// main.ts` is the one production caller, additive same as `courseFromPath`
// above: neither `lifecycle.ts` nor `mapping.ts` is touched by this export.
export type { CourseDetectionProposal } from './course/lifecycle.js';
export { detectCourseProposals } from './course/lifecycle.js';
export type {
  CourseMapping,
  CourseRemapResult,
  CourseRootSnapshot,
} from './course/mapping.js';
export { buildCourseMapping, pathInCourseMapping, recomputeCourseRoot } from './course/mapping.js';
export { addDays, daysBetween } from './dates.js';
// The concept↔assessment evidence edge (knowledge model §5, F4.2, P5-T03) — a
// pure projection over past-paper citations and the assessments Base, never
// stored. See evidence-edge/types.ts's module doc for the edge shape and the
// two places the knowledge model is silent.
export {
  buildConceptAssessmentEdges,
  resolveCitations,
  UnresolvableCitationError,
} from './evidence-edge/build.js';
export type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
  ConceptAssessmentEdge,
  EvidenceQuestionCitation,
} from './evidence-edge/types.js';
export { docxExtractor } from './extract/docx.js';
export type {
  DiscoverEmbeddedSourcesResult,
  ResolvedEmbed,
  UnresolvedEmbed,
} from './extract/embeds.js';
export { discoverEmbeddedSources } from './extract/embeds.js';
// The running-head/page-number furniture detector (SCAN-1, ol-738i): is a
// page's own decoded, threshold-clearing text actually content, or a
// repeated header/footer/folio? See furniture.ts's module doc.
export {
  applyFurnitureDetection,
  findRunningHeadLines,
  furnitureStrippedCharCount,
  isPageNumberLine,
  RUNNING_HEAD_MIN_PAGES,
} from './extract/furniture.js';
// The standing check on the extractor interface: no success with zero yield (N-013).
export {
  assertHonestExtraction,
  extractionYieldViolations,
  guardExtractor,
  SilentExtractionError,
} from './extract/guard.js';
export { imageExtractor } from './extract/image.js';
export { pdfExtractor } from './extract/pdf.js';
// Is what came out of a page actually text? (ol-s3xa, ol-x1ch.)
export {
  classifyPageText,
  controlCharShare,
  isPlausiblePageText,
  isReachedButUnreadable,
  MAX_CONTROL_CHAR_SHARE,
} from './extract/plausibility.js';
export { pptxExtractor } from './extract/pptx.js';
export { EXTRACTORS, extractFromVault, formatFromExtension } from './extract/registry.js';
export {
  DEFAULT_TEXT_LAYER_CHAR_THRESHOLD,
  routePage,
} from './extract/threshold.js';
export type {
  CharRange,
  EmbeddedInNote,
  ExtractedUnit,
  ExtractionOutcome,
  ExtractionResult,
  ExtractOptions,
  Extractor,
  ExtractorInput,
  PageExtraction,
  PageTextLayer,
  Provenance,
  RouteDecision,
  SourceFormat,
  SourceLocation,
} from './extract/types.js';
export { parseFrontmatter } from './frontmatter/parse.js';
export { readList, readScalar, readWikilinks } from './frontmatter/read.js';
export { serializeFrontmatter, setEntryValue } from './frontmatter/serialize.js';
export type {
  EntryNode,
  Frontmatter,
  FrontmatterNode,
  InterpretedValue,
  PassthroughNode,
} from './frontmatter/types.js';
export { isFrontmatterLossless } from './frontmatter/types.js';
// The gap and coverage views (F4.3, F4.5, F4.9, F4.10; P5-T06a), with
// ol-cvsc's scope statement folded in. Pure projection over the oracle
// ranking, mastery, and what tier-3 extraction actually read — see
// gap/build.ts's module doc for the three gap classes and why they are three,
// and gap/coverage.ts for why an unread source may never look like a zero.
export type {
  BuildGapViewInput,
  ConceptMaterialPresence,
  GapAffordance,
  GapClass,
  GapCourseView,
  GapRow,
  GapViewModel,
} from './gap/build.js';
export {
  affordancesFor,
  allGapRows,
  buildGapView,
  buildMaterialPresence,
  classifyGap,
} from './gap/build.js';
export type { CoverageScope, CoverageScopeSource, SourceReadState } from './gap/coverage.js';
export { readStateOf, sourcesInState, summariseCoverageScope } from './gap/coverage.js';
export type { AssessmentFormat, ReadinessFactors, ReadinessOptions } from './gap/readiness.js';
export {
  assessmentFormatOf,
  DEFAULT_MCQ_RECOGNITION_WEIGHT,
  readinessFactorsFor,
} from './gap/readiness.js';
export type { CardAuthorship, ClassifiedCard, StyleProfile } from './generate/style-profile.js';
export {
  computeStyleProfile,
  DEFAULT_STYLE_PROFILE,
  MIN_SAMPLE_FOR_PROFILE,
} from './generate/style-profile.js';
// The generation-side [D-101] consumers (F3.8 voice fidelity, F3.9 card-style
// profile; `[D-008]` transient personalization context, `ol-p3t07c`). Pure,
// bounded projections in the same shape as `misconception/digest.js` — see
// each file's own module doc for the F1/F3 boundary and the shed line.
export type {
  AssembleVoiceExemplarsOptions,
  ClassifiedPassage,
  PassageAuthorship,
  PassageCurationAuthority,
  VoiceExemplars,
} from './generate/voice-sources.js';
export { assembleVoiceExemplars } from './generate/voice-sources.js';
// `[D-077]`'s content-store minting seam for the SOLO grading pipeline
// (`ol-0r92.1` / `ol-0r92.10`) — see explainBackSolo.ts's module doc for why
// this is the one impure export in that file, and why calling it only
// partially discharges `ol-95vv.3` rather than finishing it. Only the
// contentRef-minting surface is exported here; the rest of
// `explainBackSolo.ts`'s API (gradeSolo, acceptSoloGrading, ...) is
// `ol-95vv.2`/`ol-95vv.3` territory, out of this bead's `owns`.
export type { MintSoloGradingContentInput } from './grading/explainBackSolo.js';
export { writeSoloGradingContent } from './grading/explainBackSolo.js';
// The explain-back grading pipeline: pre-check -> (maybe) model call ->
// citation grounding -> accept step (ol-p4t02).
export type {
  AcceptedExplainBackGrading,
  CitedIssue,
  CitedIssueKind,
  ExplainBackGradingWireResponse,
  ExplainBackJudgeWireRequest,
  GradeExplainBackInput,
  GradingTelemetrySummary,
  GroundedGrading,
  JudgeCaller,
  MisconceptionCandidate,
  PendingExplainBackGrading,
  SourceBlockRef,
} from './grading/gradingPipeline.js';
export {
  acceptExplainBackGrading,
  discardExplainBackGrading,
  gradeExplainBack,
  groundCitations,
  summarizeGradingForTelemetry,
  toWireMisconceptionDigest,
  UnusableGradingInputError,
} from './grading/gradingPipeline.js';
// Mechanical answer-vs-source overlap pre-check, upstream of Slot J (ol-nvdk).
// Record-only since [D-138] deleted the gating threshold — see the module.
export type {
  OverlapMeasurement,
  RestatementPrecheckInput,
  RestatementPrecheckOptions,
} from './grading/restatementOverlap.js';
export { measureAnswerSourceOverlap, precheckRestatement } from './grading/restatementOverlap.js';
// The production `JudgeCaller` (`ol-drfy`): builds the frozen
// `explain-back.judge.v1` envelope, but leaves the HTTP call itself to an
// injected `WorkerTaskTransport` — the same seam `WorkerEmbeddingProvider`
// uses. Grounding stays in `gradeExplainBack`/`groundCitations` above; this
// class only marshals the request/response faithfully.
export type { WorkerJudgeCallerDeps } from './grading/workerJudgeCaller.js';
export {
  createWorkerJudgeCaller,
  EXPLAIN_BACK_JUDGE_CONTRACT_VERSION,
  EXPLAIN_BACK_JUDGE_TASK_ID,
  WorkerJudgeError,
} from './grading/workerJudgeCaller.js';
// Question-shaped heading detection (F2.10, `ol-f210bead`) — the detection
// half only. See heading-offer/detect.ts's module doc for the rules, the
// "has no card" coverage window, and the wiring seam this stops short of.
export { detectHeadingOffers, isQuestionShapedHeading } from './heading-offer/detect.js';
export type { HeadingOfferCandidate, HeadingQuestionRule } from './heading-offer/types.js';
export {
  backoffDelayMs,
  classifyHeadroom,
  EXHAUSTED_HEADROOM_THRESHOLD,
  type HeadroomBand,
  MAX_BACKOFF_MS,
  MAX_PACING_DELAY_MS,
  MIN_BACKOFF_MS,
  MIN_PACING_DELAY_MS,
  nextUtcMidnightMs,
  PACING_HEADROOM_THRESHOLD,
  pacingDelayMs,
} from './ingestion/budget.js';
export { type EngineDeps, IngestionQueueEngine, type TickResult } from './ingestion/engine.js';
export {
  DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
  ENQUEUE_DEBOUNCE_MS,
  type EnqueueDebounceDecision,
  type EnqueueDebouncePolicy,
  evaluateEnqueueDebounce,
} from './ingestion/enqueue-debounce.js';
export type {
  EmptyExtractionReport,
  ExtractedUnitSink,
  ExtractionJobPayload,
  ExtractionRunnerDeps,
  JobEnqueuer,
} from './ingestion/extraction-runner.js';
export {
  createExtractionJobRunner,
  deferredEnqueuer,
  isExtractionJobPayload,
} from './ingestion/extraction-runner.js';
export { hashContent, hashText } from './ingestion/hash.js';
export type {
  Clock,
  DeferReason,
  DeviceCapability,
  DrainBlockedReason,
  EnqueueInput,
  EnqueueResult,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  JobStatus,
  PersistedJob,
  PersistedQueue,
  QueueSnapshot,
  QueueStore,
  RandomSource,
} from './ingestion/types.js';
// F6.5's observed-pattern insights (`ol-p6t04` / P6-T04). Detectors only — every
// sentence lives in packages/plugin's today/copy.ts, in one enumerable list,
// because the phrasing is David's to review before ship.
export type {
  ConceptCourses,
  CourseEffort,
  EffortInput,
  EffortInsight,
  EffortMeasured,
  InsightId,
  InsightResult,
  InsightStatus,
  InsightsInput,
  InsightsSummary,
  SpacingInsight,
  SpacingMeasured,
  WeightedAssessment,
} from './insights/index.js';
export {
  ATTENDANCE_RATIO,
  buildInsights,
  CONCENTRATION_RATIO,
  detectEffortImbalance,
  detectSpacing,
  impliedAssessmentDays,
  MIN_GAP,
  MIN_REVIEWS,
  MIN_SPAN_DAYS,
  MIN_TIMED_REVIEWS,
  MIN_WEIGHTED_COURSES,
  PRE_ASSESSMENT_WINDOW_DAYS,
} from './insights/index.js';
// Instrument formats in the vault (F2.1, F2.15, C5.3). Q&A/cloze target an
// Obsidian SR plugin's default syntax; MCQ is Olea's own block. Both parse and
// write through the round-trip engine above and nowhere else.
export type {
  CardAnchor,
  CreateClozeCardInput,
  CreateClozeCardResult,
  CreateQaCardInput,
  CreateQaCardResult,
  StampQaCardBlockIdOptions,
  StampQaCardBlockIdResult,
} from './instrument/card-format.js';
export {
  createClozeCard,
  createQaCard,
  MULTI_LINE_REVERSED_SEPARATOR,
  MULTI_LINE_SEPARATOR,
  parseCards,
  SINGLE_LINE_REVERSED_SEPARATOR,
  SINGLE_LINE_SEPARATOR,
  SR_DEFAULT_DECK_TAG,
  stampQaCardBlockId,
} from './instrument/card-format.js';
export type {
  InsertMcqInput,
  InsertMcqResult,
  McqFields,
  McqParseResult,
  McqSerializeOptions,
  StampMcqIdOptions,
  StampMcqIdResult,
  StampMcqPredecessorResult,
} from './instrument/mcq-format.js';
export {
  insertMcqBlock,
  MCQ_FENCE_INFO,
  MCQ_FIELD_PREDECESSOR,
  parseMcqBlocks,
  serializeMcq,
  serializeMcqInstrument,
  stampMcqId,
  stampMcqPredecessor,
} from './instrument/mcq-format.js';
export type { GeneratedMcqCandidate } from './instrument/mcq-generated.js';
export { acceptGeneratedMcq } from './instrument/mcq-generated.js';
export type {
  McqPresentation,
  McqPresentationOption,
  PresentableMcq,
} from './instrument/mcq-present.js';
export { mathRandomSource, presentMcq } from './instrument/mcq-present.js';
// F2.16's rating mapping — one pure function per instrument type. Easy is
// absent from `McqRating` by type, and explain-back has no mapper at all;
// `loggedRating` is the single site where "no rating" becomes the log's null.
export type {
  CardReviewOutcome,
  ExplainBackOutcome,
  McqRating,
  McqReviewOutcome,
  RatingMapping,
  ReviewOutcome,
  SchedulableInstrumentType,
} from './instrument/rating.js';
export {
  loggedRating,
  mapCardRating,
  mapMcqRating,
  mapReviewOutcome,
  RATING_MAPPERS,
} from './instrument/rating.js';
export type {
  CardInstrument,
  ClozeCardInstrument,
  ClozeDelimiter,
  InvalidMcqBlock,
  McqInstrument,
  McqInvalidReason,
  QaCardInstrument,
  QaCardStyle,
  SourceSpan,
} from './instrument/types.js';
export {
  MIN_DISTRACTOR_POOL,
  PRESENTED_DISTRACTORS,
  PRESENTED_OPTIONS,
} from './instrument/types.js';
export type {
  BuildFullIndexOptions,
  BuildProgress,
  BuildResult,
} from './keyword-index/build.js';
export { buildFullIndex, DEFAULT_INDEX_CHUNK_SIZE } from './keyword-index/build.js';
export { indexDocument } from './keyword-index/document.js';
export type {
  KeywordIndexEngineDeps,
  RebuildOptions,
  RebuildResult,
} from './keyword-index/engine.js';
export { KeywordIndexEngine } from './keyword-index/engine.js';
export type { SearchHit, SearchOptions } from './keyword-index/query.js';
export { documentsByCourse, searchKeywordIndex } from './keyword-index/query.js';
export type {
  CancellationController,
  CancellationSignal,
  // Named `YieldScheduler`, not `Scheduler`: in this codebase `Scheduler` is the
  // FSRS port (./scheduler/types.js) and means "when does this instrument come
  // back". This one means "yield to the event loop between chunks". Two unrelated
  // concepts sharing a name in one public surface is a bug waiting to be written.
  YieldScheduler,
} from './keyword-index/scheduling.js';
export { createCancellationController, macrotaskScheduler } from './keyword-index/scheduling.js';
export type {
  IndexedBlock,
  IndexedDocument,
  KeywordIndexStore,
  PersistedKeywordIndex,
} from './keyword-index/types.js';
export { EMPTY_KEYWORD_INDEX } from './keyword-index/types.js';
// F2.11's single vocabulary site (D-017). Anything rendering mastery imports
// from here; there is deliberately no second copy of these five words.
export type { MasteryDisplay } from './mastery/display.js';
export { MASTERY_DISPLAY, MASTERY_ORDER, masteryTitle } from './mastery/display.js';
// The value a review-log writer stamps onto a new v4 record (`ol-7328`'s
// per-concept ruling, `ol-g6zg`'s v4 shape, wired by `ol-rpr4`). Exported here
// rather than left to a deep source import: the plugin's review port is
// production code that gets bundled, and it was the only one of its 43 core
// imports reaching past this barrel. The workbench does reach into
// `core/src/mastery/rollup.js` directly, but that is dev tooling and not a
// precedent for the shipped plugin.
export { masteryAtTimeForConceptIds } from './mastery/rollup.js';
// The sprig data (F2.3, F2.11, P4-T06) and the distribution F6.2's overview is
// rendered from. Reachable only inside core until now; the Today panel is its
// first consumer outside it (`ol-lohq`).
export type { MasteryDistribution } from './mastery/sprig.js';
export { masteryDistribution } from './mastery/sprig.js';
// F2.11's second axis (knowledge model R3, `[D-087]`; `VIT-1` / `ol-1bjz`).
// The fold from per-instrument retrievability to a concept's `holding` /
// `tending` / `early` reading. **It has no consumer outside core yet** — the
// mastery surface that will show a stage beside its vitality is `MAT-2`
// (`ol-95vv`), and until that lands nothing here renders. Exported now so the
// fold and the scheduler accessor it depends on are nameable from one place
// when it does, and so no surface is tempted to re-derive vitality locally.
export type {
  ReadVitalityInput,
  RecallTierInstrumentType,
  Vitality,
  VitalityInstrument,
  VitalityReading,
  VitalityWeakest,
} from './mastery/vitality.js';
export { isRecallTier, readVitality } from './mastery/vitality.js';
// The misconception store (F5.6, knowledge model §4.1, D-008, M1-M4,
// P4-T04): a local projection folded from its own append-only event log,
// never a second source of truth — see misconception/types.ts's module doc.
//
// `ol-4053`: the accepted-grading -> observation-event composition — see
// `accepted-grading-observation.ts`'s own module doc.
export type {
  AcceptedGradingMisconceptionCandidate,
  AcceptedGradingObservationContext,
  AcceptedGradingObservationDeps,
  AcceptedGradingObservationOutcome,
  SkippedAcceptedGradingCandidateReason,
} from './misconception/accepted-grading-observation.js';
export { buildObservationEventsFromAcceptedGrading } from './misconception/accepted-grading-observation.js';
// F2.12 confusion routing (`ol-p4t05`) lives alongside the store rather than
// its own top-level module: it reads the same "route a repeated failure into
// an explanation" territory this store already occupies, and its prompt-line
// framing follows `./framing.js`'s M3 discipline directly — see
// `confusion-routing.ts`'s own module doc for the full argument, and the
// component register's open note that this bead currently has no dedicated
// register row.
export type {
  ConfusionRoutingDecision,
  ConfusionRoutingInput,
} from './misconception/confusion-routing.js';
export {
  CONFUSION_ROUTING_LAPSE_THRESHOLD,
  confusionRoutingPromptLine,
  evaluateConfusionRouting,
} from './misconception/confusion-routing.js';
// The confusion-pairing corroboration reader (`ol-2zfj.32`, `[D-130]`) — a
// thin, honest-empty-input wrapper over `ol-2zfj.20`'s already-built join
// (`./concept/confusion-pairing/corroborate.js`), wired as a named
// production reader at `packages/plugin/src/main.ts`'s ingestion-tick call
// site. See `./misconception/corroboration.js`'s module doc for the reuse
// argument and the honest-empty-input fix.
export type {
  ConfusionPairingConcept as ConfusionPairingCorroborationConcept,
  ConfusionPairingVerdict,
  ConfusionPairingVerdictKind,
} from './misconception/corroboration.js';
export { corroborateConfusionPairings } from './misconception/corroboration.js';
// `MisconceptionDigestEntry` is aliased below to avoid a name collision with
// `./grading/gradingPipeline.js`'s identically-named type. The two are
// deliberately different shapes for different layers, not duplicates: this
// module's is the store's own digest-entry shape (id/status/occurrenceCount
// included); `gradingPipeline.js`'s is the leaner `{concept, statement}`
// wire mirror of the Worker's `explain-back.judge.v1` request. Reconciling
// them into one adapter belongs to whichever task wires P4-T02's output into
// this store — flagged as a coordination item rather than guessed at here.
export type {
  BuildMisconceptionDigestOptions,
  MisconceptionDigestEntry as MisconceptionStoreDigestEntry,
} from './misconception/digest.js';
export { buildMisconceptionDigest } from './misconception/digest.js';
export type {
  TextEmbeddingBackend,
  TextEmbeddingRequest,
  TextEmbeddingResult,
} from './misconception/embedder.js';
export { WorkerMisconceptionEmbedder } from './misconception/embedder.js';
export type {
  CachedMisconceptionEmbeddingEntry,
  MisconceptionEmbeddingCacheStore,
  PersistedMisconceptionEmbeddingCache,
} from './misconception/embedding-cache.js';
export {
  emptyMisconceptionEmbeddingCache,
  MISCONCEPTION_EMBEDDING_CACHE_VERSION,
  MisconceptionEmbeddingCacheEngine,
} from './misconception/embedding-cache.js';
export type {
  BuildObservationEventOptions,
  BuildObservationEventResult,
  BuildResolutionEvidenceEventOptions,
  ObservationInput,
  ResolutionEvidenceInput,
} from './misconception/events.js';
export {
  buildObservationEvent,
  buildResolutionEvidenceEvent,
} from './misconception/events.js';
export {
  FORBIDDEN_VERDICT_PHRASES,
  misconceptionFramingLine,
} from './misconception/framing.js';
export type { MisconceptionMatchCandidate } from './misconception/matcher.js';
export {
  DEFAULT_M1_THRESHOLD,
  matchExistingMisconception,
} from './misconception/matcher.js';
export type { MergeMisconceptionLogResult } from './misconception/merge.js';
export { mergeMisconceptionEvents } from './misconception/merge.js';
export type { BuildObservationEventWithEmbeddingDeps } from './misconception/observe.js';
export { buildObservationEventWithEmbedding } from './misconception/observe.js';
export type {
  InvalidMisconceptionLogLine,
  ParseMisconceptionLogResult,
} from './misconception/parse.js';
export {
  parseMisconceptionEvent,
  parseMisconceptionLog,
} from './misconception/parse.js';
export {
  isValidDeviceId as isValidMisconceptionDeviceId,
  MISCONCEPTION_LOG_FOLDER,
  misconceptionLogPath,
} from './misconception/path.js';
export { projectMisconceptions } from './misconception/project.js';
export type {
  EmbeddingVector as MisconceptionEmbeddingVector,
  MisconceptionEmbedder,
  MisconceptionEvent,
  MisconceptionObservedEvent,
  MisconceptionRecord,
  MisconceptionResolutionEvidenceEvent,
  MisconceptionStatus,
  ResolutionEvidenceKind,
  SourceCitation as MisconceptionSourceCitation,
} from './misconception/types.js';
export {
  MISCONCEPTION_EVENT_SCHEMA_VERSION,
  MISCONCEPTION_STATUSES,
} from './misconception/types.js';
export type { AppendMisconceptionEventResult } from './misconception/write.js';
export { appendMisconceptionEvent } from './misconception/write.js';
// F5.1's first-suggestion picker (`ol-0r92.22`): the generic, declared
// tier-ordering rule that consumes `olea-service/eval/explainback/SEEDING.md`'s
// schema (real, per-student seeding data stays private) — see
// onboarding/first-invitation-picker.ts's module doc for the full argument.
export type {
  FirstInvitationCandidate,
  InvitationTier,
} from './onboarding/first-invitation-picker.js';
export { pickNextExplainBackInvitation, TIER_ORDER } from './onboarding/first-invitation-picker.js';
// P5-T07's switch-on: the composition that actually produces a
// `RankOracleResult` from a vault and a review log — `rankOracle` had no
// non-test caller anywhere until this joined `buildConceptAssessmentEdges`
// and the mastery rollup to it. See oracle/compose.ts's module doc.
export type {
  ComposeOracleRankingInput,
  ComposeOracleRankingResult,
  ComposeRetrievabilityInput,
} from './oracle/compose.js';
export { composeOracleRanking } from './oracle/compose.js';
// F4.2's high-yield ranking (P5-T04). Not previously reachable from this entry
// point — added here because `buildStudyPlan` takes a `RankOracleResult` and an
// input type a consumer cannot name is an export in name only.
export { rankOracle } from './oracle/rank.js';
export type {
  ConceptPriority,
  CourseOracleRanking,
  OracleAbstainReason,
  OracleConceptFactors,
  OracleEdgeContribution,
  OracleMasteryState,
  RankOracleInput,
  RankOracleOptions,
  RankOracleResult,
} from './oracle/types.js';
// The versioned study plan (A2.5, C5.5, C7.6, P5-T05) — the client half of
// "the Worker computes the policy, the client caches it and runs review
// against it". `executeStudyPlan` is the offline path and takes no port at
// all; `refreshStudyPlan` is the only thing here that can touch a provider,
// and it never throws when one is missing or failing. See plan/types.ts.
export type { BuildStudyPlanInput } from './plan/build.js';
export { buildStudyPlan, studyPlanVersion } from './plan/build.js';
export type { LoadCachedStudyPlanResult, StudyPlanCacheRejection } from './plan/cache.js';
export { loadCachedStudyPlan, saveCachedStudyPlan } from './plan/cache.js';
export type { ExecutedQueue, ExecuteStudyPlanInput, PlannedQueueItem } from './plan/execute.js';
export { executeStudyPlan } from './plan/execute.js';
export type { RefreshStudyPlanDeps } from './plan/refresh.js';
export { refreshStudyPlan } from './plan/refresh.js';
export type {
  StudyPlanProvider,
  StudyPlanRefreshResult,
  StudyPlanSource,
  StudyPlanStore,
} from './plan/types.js';
// Queue composition v1 (P2-T07): plain FSRS due order, per-session concept
// dedupe that defers rather than drops (F2.17), course/topic filter (F2.5),
// and the suspended set excluded (F2.6). The one module that joins instruments
// to concepts — see queue/types.ts for why that join lives only here.
export { composeQueue } from './queue/compose.js';
export type {
  ComposedQueue,
  ComposeQueueInput,
  DeferredInstrument,
  QueueCandidate,
  QueueFilter,
  QueueItem,
  QueueSelectionContext,
} from './queue/types.js';
export { buildRegistryModel } from './registry/build.js';
// The concept and instrument registry (F8.4/F8.4a/F8.5, `[REG-1]`,
// `ol-4v2l`, amended acceptance `[D-135]`) — the browsable inventory over
// concepts, their course associations, their instrument mix, and their
// two-axis mastery. `buildRegistryModel` computes nothing new (see its own
// module doc); `./registry/overrides.ts`'s pure transforms are the local
// rename/prune state F8.4 calls "cache state no Obsidian affordance can
// reach". Split/merge are `[D-135]`'s explicit non-scope — no export here
// names an offshoot or a merge candidate.
export {
  aliasEquivalenceGroups,
  aliasesFor,
  EMPTY_REGISTRY_OVERRIDES,
  isConceptPruned,
  pruneConcept,
  renameConcept,
  resolvedDisplayName,
  unpruneConcept,
} from './registry/overrides.js';
export type {
  BuildRegistryModelInput,
  RegistryConceptEntry,
  RegistryExplainBackSummary,
  RegistryInstrumentSummary,
  RegistryModel,
  RegistryOverrides,
  RegistryRenameOverride,
} from './registry/types.js';
// Retrieval — embeddings, hybrid keyword+cosine retrieval, grounding refusal
// (C2.3, C2.5, C4.7, D-004, INV-5, P3-T05). Builds on the keyword index
// above rather than duplicating it — see retrieval/chunks.ts.
// `expandQueryWithAliases` (`ol-l5og.11`) is the F8.4/`[D-088]` follow-up:
// alias-aware keyword search, wired into `retrieve()` via the optional
// `RetrieveDeps.registryOverrides` below — see `retrieval/aliasExpansion.ts`.
export { expandQueryWithAliases } from './retrieval/aliasExpansion.js';
export { chunksFromIndex } from './retrieval/chunks.js';
export type {
  CompositeGroundingSignals,
  CompositeGroundingThresholds,
  ComputeCompositeGroundingSignalsParams,
} from './retrieval/compositeSignals.js';
export {
  computeCompositeGroundingSignals,
  meetsCompositeThreshold,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
} from './retrieval/compositeSignals.js';
export type { CosineHit } from './retrieval/cosine.js';
export { cosinePercentile, cosineSimilarity, topKByCosine } from './retrieval/cosine.js';
export type { EmbeddingCacheEngineDeps } from './retrieval/embeddingCache.js';
export {
  EmbeddingCacheEngine,
  emptyEmbeddingCache,
} from './retrieval/embeddingCache.js';
export type { RetrieveDeps, RetrieveOptions } from './retrieval/engine.js';
export { retrieve } from './retrieval/engine.js';
export type {
  AssembleBandedGroundedContextOptions,
  AssembleGroundedContextOptions,
  BandDecision,
  GroundedChunk,
  GroundingBandThresholds,
  GroundingBandTier,
  GroundingDiagnostic,
  GroundingDiagnosticHit,
  GroundingJudgePort,
  GroundingJudgeRequest,
  GroundingJudgeVerdict,
  GroundingRefusalReason,
  GroundingResult,
  ResolveGroundedContextOptions,
} from './retrieval/groundedContext.js';
export {
  assembleBandedGroundedContext,
  assembleGroundedContext,
  classifyGroundingBand,
  PROVISIONAL_GROUNDING_BAND,
  resolveGroundedContext,
} from './retrieval/groundedContext.js';
export type {
  HybridHit,
  HybridRetrievalOptions,
  HybridRetrieveParams,
  MatchSource,
} from './retrieval/hybrid.js';
export { hybridRetrieve } from './retrieval/hybrid.js';
export type { Lexicon } from './retrieval/lexicon.js';
export { buildLexicon, idfFor, lexicalCoverage, tokenize } from './retrieval/lexicon.js';
export { D112_GROUNDING_BAND } from './retrieval/operating-point.js';
export type {
  CachedEmbeddingEntry,
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbeddingVector,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
  RerankCandidate,
  RerankedCandidate,
  RerankProvider,
  RerankRequest,
  RerankResult,
  RetrievalChunk,
} from './retrieval/types.js';
// The production `EmbeddingProvider` (C4.1): builds the frozen
// `retrieval.embed.v1` envelope, but leaves the HTTP call itself to an
// injected `WorkerTaskTransport` — the plugin supplies one over `requestUrl`
// (C1.6/INV-1), a Node harness supplies one over `fetch`.
export type {
  WorkerEmbeddingProviderDeps,
  WorkerTaskRequest,
  WorkerTaskTransport,
} from './retrieval/workerProvider.js';
export {
  RETRIEVAL_EMBED_CONTRACT_VERSION,
  RETRIEVAL_EMBED_TASK_ID,
  WorkerEmbeddingError,
  WorkerEmbeddingProvider,
} from './retrieval/workerProvider.js';
// F8.8's post-assessment retrospective (`[POST-1]`, `ol-r68l`, `[D-134]`) —
// what held, what faded, and what carries, over a caller-resolved scope (see
// `retrospective/types.ts`'s module doc for why the scope itself is never
// derived here). `hasAssessmentPassed`/`resolveRetrospectiveOfferStatus` are
// the pure half of the offer mechanism; see `retrospective/offer.ts`'s
// module doc for what is deliberately NOT persisted by this package.
export { buildRetrospective } from './retrospective/build.js';
export {
  hasAssessmentPassed,
  type RetrospectiveOfferEvent,
  type RetrospectiveOfferStatus,
  resolveRetrospectiveOfferStatus,
} from './retrospective/offer.js';
export type {
  RetrospectiveCarriesLine,
  RetrospectiveConceptCoverage,
  RetrospectiveConceptLine,
  RetrospectiveInput,
  RetrospectiveReading,
  RetrospectiveScopeOrigin,
} from './retrospective/types.js';
// [D-077] / C6.2a's immutable content store — her explanation text, the
// grader's feedback and misconception detail, referenced from a review
// event's explainBackGrade.contentRef by id. See review-log/content-store.ts
// for the write-once and referential-integrity discipline.
export type {
  ContentReadResult,
  ContentStoreRecord,
  WriteContentOptions,
  WriteContentResult,
} from './review-log/content-store.js';
export {
  CONTENT_STORE_FOLDER,
  contentStorePath,
  isValidContentId,
  readContentForGrade,
  readContentRecord,
  writeContentRecord,
} from './review-log/content-store.js';
// `[D-046]` clause 4's contest mechanism, mechanised by `[D-095]` (`ol-fgba`
// [DISP-1]). The routing table, the three kind-specific effects, the dispute
// record and its evidence-relative aging, and `[D-095]` §4's named contest-rate
// health check. The dispute record's schema lives in core rather than contracts
// pending the Class C move — see review-log/contest-record.ts's header.
export type {
  ClaimContestState,
  ClaimRendering,
  ClaimRouting,
  ContestedClaim,
  ContestInput,
  ContestOutcome,
  ContestRateReading,
} from './review-log/contest.js';
export {
  CLAIM_ROUTING,
  CONTEST_GESTURE_LABEL,
  CONTEST_RATE_MIN_CLAIMS,
  CONTEST_RATE_THRESHOLD,
  contestClaim,
  contestEffectFor,
  contestOutcomeShapes,
  contestRateHealthCheck,
  contestStateForClaim,
  FORBIDDEN_CONTEST_STRINGS,
  isDisputeCurrent,
  isRoutedRendering,
  quarantinedGradeInstrumentIds,
  resolveDispute,
  reviewLogDisputes,
  routeClaimRendering,
  standingDissent,
  UnroutedClaimError,
  withdrawnStructuralClaims,
} from './review-log/contest.js';
export type {
  ContestEffect,
  ContestedClaimKind,
  ContestedClaimRendering,
  DisputeLogRecord,
  DisputeLogRecordInput,
} from './review-log/contest-record.js';
export { safeParseDisputeLogRecord } from './review-log/contest-record.js';
// [EVID-1] (`ol-0r92.1`) — the per-instrument explain-back history is a
// projection over the review log, never a second write; entries carry
// contentRef only and compose with content-store.ts to resolve evidence.
export type {
  ExplainBackHistoryEntry,
  GradedExplainBackReview,
} from './review-log/explain-back-history.js';
export {
  explainBackGradeEvents,
  explainBackGradeHistoryByInstrument,
  latestExplainBackGradeByInstrument,
} from './review-log/explain-back-history.js';
export type { MergeReviewLogResult } from './review-log/merge.js';
export { mergeReviewLogRecords } from './review-log/merge.js';
export type { InvalidReviewLogLine, ParseReviewLogResult } from './review-log/parse.js';
export { parseReviewLog } from './review-log/parse.js';
export { isValidDeviceId, REVIEW_LOG_FOLDER, reviewLogPath } from './review-log/path.js';
export { readReviewLogFile } from './review-log/read.js';
// F2.6's durable half (D-020): the suspended set is a projection folded from
// the review log, never stored — see review-log/suspension.ts.
export { isInstrumentSuspended, suspendedInstrumentIds } from './review-log/suspension.js';
// The one review-log migration site (D-020, `ol-t3sd`, `ol-g6zg`). One function
// per version hop, chained; there is deliberately no other migration anywhere,
// and each hop takes exactly one argument so it cannot consult current state.
export { upgradeV1, upgradeV2, upgradeV3 } from './review-log/upgrade.js';
// INV-6's accept step, evidenced (`ol-548w`): the verdict projection folded
// from the review log, never stored — see review-log/verdicts.ts.
export { latestVerdictByInstrument, reviewLogVerdicts } from './review-log/verdicts.js';
export type {
  AppendDisputeLogResult,
  AppendRetrospectiveOfferLogResult,
  AppendReviewLogOptions,
  AppendReviewLogResult,
  AppendSuccessionLogResult,
  AppendSuspendLogResult,
  AppendVerdictLogResult,
  RetrospectiveOfferLogRecordInput,
  ReviewLogRecordInput,
  SuccessionLogRecordInput,
  SuspendLogRecordInput,
  VerdictLogRecordInput,
} from './review-log/write.js';
export {
  appendDisputeRecord,
  appendRetrospectiveOfferRecord,
  appendReviewLogRecord,
  appendSuccessionRecord,
  appendSuspendRecord,
  appendVerdictRecord,
} from './review-log/write.js';
// Component register row 2.2's KC-type-to-instrument routing policy
// (`ol-tqd5`, `ol-dlr1`) — a pre-registered default, not a measured
// baseline (n=1 has no power to test one). **No caller exists yet**,
// deliberately: the same two-hops-behind-ready-inputs gap
// `./concept/knowledge-kind.js` documents for its own entry point — see
// `./routing/instrument-mix.js`'s module doc.
export type {
  ConceptInstrumentInventory,
  InstrumentEmphasis,
  InstrumentMix,
  InstrumentMixGap,
  RoutingGroup,
} from './routing/instrument-mix.js';
export {
  CARDS_FOR_EVERYTHING_NULL,
  EMPHASIS_ORDER,
  EMPTY_INVENTORY,
  instrumentMixGaps,
  ROUTING_GROUP_INSTRUMENT_TYPES,
  ROUTING_GROUPS,
  routeKnowledgeKind,
  routeKnowledgeKindClassification,
  routingReason,
  UNCLASSIFIED_MIX,
} from './routing/instrument-mix.js';
// RHY-3's schedule-extraction build chain, step 2 (`ol-4chx` -> `ol-r6s0` ->
// `ol-hna1` -> `ol-at1a`): case-insensitive course association plus explicit
// ambiguity handling for step 1's parsed events. No production caller yet —
// see `./schedule/associate.ts`'s module doc for the exact scope boundary.
export {
  type AssociatedScheduleEvent,
  associateScheduleEvents,
  type CourseLabelMatch,
  matchCourseLabel,
  type ScheduleAssociationMiss,
  type ScheduleAssociationReport,
  type UnmatchedScheduleEvent,
} from './schedule/associate.js';
// RHY-3's schedule-extraction build chain, step 1 (`ol-4chx` -> `ol-r6s0` ->
// `ol-hna1` -> `ol-at1a`): evidence-based calendar-note discovery and the
// narrow event-line grammar scan. No production caller yet — `ol-at1a` wires
// the eventual freshness signal into a displayed surface; see
// `./schedule/discover.ts`'s module doc for the exact scope boundary and the
// four Class C stops this build must not cross.
export {
  discoverScheduleEvents,
  type ScheduleDiscoveryReport,
  type ScheduleEventRecord,
  type ScheduleNoteScan,
  type ScheduleTimeRange,
  scanNoteForScheduleEvents,
} from './schedule/discover.js';
// RHY-3's schedule-extraction build chain, step 3 (`ol-4chx` -> `ol-r6s0` ->
// `ol-hna1` -> `ol-at1a`): weekday recurrence detection over step 2's matched
// events, forward extrapolation past a stale synced window, and the
// freshness measure combining both with a caller-supplied "last arrival"
// fact. No production caller yet — `ol-at1a` wires the freshness signal
// into the displayed rhythm surface; see `./schedule/freshness.ts`'s module
// doc for the exact scope boundary and RHY-3 §8's four Class C stops this
// build must not cross.
export {
  ARRIVAL_GRACE_DAYS,
  type CourseFreshnessBasis,
  type CourseFreshnessReading,
  type CourseFreshnessStatus,
  computeCourseFreshness,
  computeScheduleFreshness,
  EXTRAPOLATION_BOUND_WEEKS,
  MIN_HISTORICAL_SESSIONS_TO_TRUST,
} from './schedule/freshness.js';
export {
  type CourseRecurrencePattern,
  detectRecurrencePattern,
  mostRecentExpectedOccurrence,
  type RecurringWeekday,
} from './schedule/recurrence.js';
export { createFsrsScheduler } from './scheduler/fsrs-scheduler.js';
export type {
  // The recall-probability half of the port (`VIT-1`, `ol-1bjz`). Exported
  // here rather than left as a deep import because every out-of-package caller
  // — the mastery surface that will read a concept's vitality, and the test
  // fakes that have to satisfy `Scheduler` at all — needs to name both shapes.
  RetrievabilityInput,
  RetrievabilityOutput,
  ScheduleInput,
  ScheduleOutput,
  Scheduler,
  SchedulerState,
} from './scheduler/types.js';
// F8.1's six-state grove coverage computation (`[D-054]`, `ol-o8eo`) — the
// examiner-declared denominator (F1.5/F4.1), never Olea's own inference.
// `./scope/coverage.ts` classifies one concept; `./scope/grove.ts` assembles
// a whole course's reading (declared / inferred / no-registered-source) and
// F8.3's count-and-source summary. See `./scope/grove.ts`'s module doc.
export type {
  ClassifyDeclaredConceptInput,
  DeclaredConceptClassification,
  GroveDeclaredState,
} from './scope/coverage.js';
export {
  classifyDeclaredConcept,
  GROUND_STALL_STREAK_THRESHOLD,
  isVolunteer,
} from './scope/coverage.js';
export type {
  BuildGroveModelInput,
  BuildGroveModelResult,
  GroveCell,
  GroveCourseModel,
  GroveCourseSummary,
  GroveMaterialGapCell,
  GroveVolunteerCell,
} from './scope/grove.js';
export { buildGroveModel } from './scope/grove.js';
// The session pipeline (P2-T07's missing half): walk her vault for instruments,
// bind each to its concept and courses, replay the review log into per-instrument
// scheduling state, and hand the result to `composeQueue`. `buildReviewSession`
// is the one entry point; `instrument-id.ts` is the one seam where D-030's
// ruled identity derivation lives (stamped identity, `ol-k7eg`), and the
// derivation module itself still writes nothing into her notes — the write
// half is `mcq-format.ts`'s `stampMcqId` and `card-format.ts`'s
// `stampQaCardBlockId`.
export type { BuildReviewSessionInput, ReviewSession } from './session/build.js';
export { buildReviewSession, toQueueCandidate } from './session/build.js';
export { toDueInstruments } from './session/due-instruments.js';
export type { EnumerateVaultInstrumentsOptions } from './session/enumerate.js';
export { enumerateVaultInstruments } from './session/enumerate.js';
export type { FloorLoadConcept, FloorLoadTally } from './session/floor-load.js';
export { floorLoadOf } from './session/floor-load.js';
export type { ReadReviewLogHistoryOptions, ReviewLogHistory } from './session/history.js';
export { REVIEW_LOG_EXTENSION, readReviewLogHistory } from './session/history.js';
export type { InstrumentIdInput, InstrumentIdSource } from './session/instrument-id.js';
export { PROVISIONAL_ID_PREFIX, provisionalInstrumentId } from './session/instrument-id.js';
export type { ReplayedInstrument, ReplayResult } from './session/replay.js';
export { replayedStateOf, replaySchedulerStates } from './session/replay.js';
export type {
  ClozeInstrumentRecord,
  InvalidMcqReport,
  McqInstrumentRecord,
  QaInstrumentRecord,
  UnboundInstrumentReport,
  VaultInstrumentEnumeration,
  VaultInstrumentRecord,
} from './session/types.js';
// The `[D-101]` source-materiality classifier (knowledge model §3.2) — F1's
// block that F3.8 (`../generate/voice-sources.js`) and F3.9
// (`../generate/style-profile.js`) consume. See `./source/materiality.js`'s
// own module doc for the cascade, its tier ordering, and what is
// deliberately not wired yet (the arrival declaration, the repair badge).
export type {
  ClassifiedMateriality,
  MaterialityAuthorship,
  MaterialityCorrection,
  MaterialityCues,
  MaterialityCurationAuthority,
  MaterialityFact,
  MaterialityProvenance,
  MaterialityProvenanceSource,
} from './source/materiality.js';
export {
  carriesNotHersMarkers,
  classifyMateriality,
  expireCorrectionIfMaterial,
  folderPriorFor,
  hasHersLinkStructure,
  resolveMateriality,
  structuralNotHersFragment,
  UNKNOWN_MATERIALITY,
} from './source/materiality.js';
export { DEFAULT_SOURCES_FOLDER, registerSources } from './source/register.js';
export type {
  NonQuestionHeading,
  PastPaperSegmentationResult,
  QuestionBlock,
} from './source/segment-past-paper.js';
export { segmentPastPaper } from './source/segment-past-paper.js';
export type {
  RegisterSourcesOptions,
  Source,
  SourceRegistrationReport,
  SourceRole,
} from './source/types.js';
// The session builder (F4.6, F4.7, F4.8; P5-T06b). Pure selection over the gap
// view's own order — it ranks nothing, recomputes no exam proximity, and widens
// no format map; study-session/build.ts's module doc states each of those three
// refusals and why. `duration.ts` is the first reader of the review log's
// `durationMs` and is explicit, in a field rather than a comment, about which
// of its numbers are measured from her history and which are stated
// assumptions.
export type {
  BuildStudySessionInput,
  SessionAssessmentCountdown,
  SessionFormatMatch,
  StudySessionItem,
  StudySessionModel,
  StudySessionOmission,
  StudySessionOmissionReason,
} from './study-session/build.js';
export { buildStudySession, CONCEPT_SIZE_SECONDS_MULTIPLIER } from './study-session/build.js';
// Session composition (SESS-1/`ol-xd1v`, SESS-2/`ol-4a78`; `[D-113]`). The
// layer above `build.ts`'s fill — decides which concepts are eligible and in
// what order (obligation class, cross-course allocation, F2.18 course
// blocks) — see compose.ts's module doc for the full algorithm.
export type {
  BuildComposedStudySessionInput,
  ComposedStudySession,
  ComposeSessionRowsInput,
  ComposeSessionRowsResult,
  ObligationClass,
  ObligationClassification,
  ObligationOverflowEntry,
  ObligationSignals,
} from './study-session/compose.js';
export {
  buildComposedStudySession,
  classifyObligation,
  composeSessionRows,
  RETRIEVAL_BASELINE_STAGE_LADDER_DAYS,
} from './study-session/compose.js';
export type {
  DurationEstimateSource,
  DurationModel,
  DurationModelBasis,
  EstimateDurationsOptions,
  InstrumentDurationEstimate,
} from './study-session/duration.js';
export {
  ASSUMED_INSTRUMENT_SECONDS,
  DEFAULT_MIN_MEASURED_REVIEWS,
  EXPLAIN_BACK_ASSUMED_SECONDS,
  estimateInstrumentDurations,
  MINIMUM_ESTIMATE_SECONDS,
  SESSION_INSTRUMENT_TYPES,
} from './study-session/duration.js';
// Accepted explain-back's presence inside a composed session (F2.14a,
// `[D-126]`) — priced, never selected. See explain-back.ts's module doc for
// why this is a separate shape from `StudySessionItem`.
export type { AcceptedExplainBack, ComposedExplainBackItem } from './study-session/explain-back.js';
export {
  priceAcceptedExplainBacks,
  totalExplainBackSeconds,
} from './study-session/explain-back.js';
export type { ConceptInstrumentIndex } from './study-session/instrument-index.js';
export { buildConceptInstrumentIndex } from './study-session/instrument-index.js';
// Re-entry after absence (register row 3.8, `ol-nhxa`) — the SAME selection rule at a
// smaller budget, never a second mechanism.
export type {
  ComposedReentrySession,
  ComposeReentrySessionInput,
  ReentryStudySessionView,
} from './study-session/reentry.js';
export {
  clampReentryBudgetMinutes,
  composeReentrySession,
  isReentryDue,
  REENTRY_ABSENCE_THRESHOLD_DAYS,
  REENTRY_SIZE_FLOOR_MINUTES,
} from './study-session/reentry.js';
export type { SupportLevelPresentation } from './study-session/support-level-chooser.js';
export {
  chooseSupportLevel,
  supportLevelStateFromHistory,
} from './study-session/support-level-chooser.js';
// Component register 3.9's CHOOSER (SUPP-1, `ol-7883`) — picks the support
// level an instrument is presented with from a concept's real review
// evidence, at a granularity finer than card-level correctness, and lets it
// recede as she demonstrates she no longer needs it. `./support-level/`
// (round 19/20) built the ladder rules this folds over; nothing built the
// fold itself before this.
export type { GradedReviewEvidence } from './study-session/support-level-signal.js';
export { deriveFailureShape } from './study-session/support-level-signal.js';
// Support-level ladder (register row 3.9, `ol-ry2k`, `[D-094]`) — session-boundary
// transitions only; self-assessment adjusts the offer, never the persisted level.
export {
  advanceSupportLevel,
  ESCALATION_FAILURE_COUNT,
  initialSupportLevelState,
  RECESSION_CLEAN_STREAK_THRESHOLD,
  SNAPBACK_RECESSION_MULTIPLIER,
  type SupportLevelState,
} from './support-level/ladder.js';
export { type SupportLevelReviewFields, supportLevelReviewFields } from './support-level/record.js';
export {
  applySelfAssessment,
  type SelfAssessmentFeeling,
} from './support-level/self-assessment.js';
export {
  ESCALATION_FAILURE_SHAPES,
  type FailureShape,
  isEscalationTrigger,
  lowerSupportLevel,
  raiseSupportLevel,
  type SessionSupportOutcome,
  SUPPORT_LEVEL_ORDER,
  type SupportLadderTier,
  type SupportLevel,
} from './support-level/types.js';
export { extractTier3Evidence } from './tier3-evidence/build.js';
export type {
  ConceptCitation,
  ConceptCitationKind,
  ExtractTier3EvidenceOptions,
  ExtractTier3EvidenceResult,
  PastPaperCluster,
  PastPaperClusterQuestion,
  // What tier-3 extraction actually read, one row per source, zero-yield rows
  // included — `ol-cvsc`'s read-path half. `gap/coverage.ts` is its first
  // user-facing consumer, and needs the row shape nameable outside this
  // package to be usable from `packages/plugin`.
  SourceCoverage,
  SourceLimitation,
  // [EXT-8] / `ol-ac7g`: relocated from `./concept/evidence.js` — that path
  // is a compatibility shim now (see its own doc comment), kept alive only
  // because `./concept/extract.ts` still imports from it.
} from './tier3-evidence/types.js';
// The Today panel (F6.1, P2-T09). The whole of what the panel decides lives
// here so `packages/plugin`'s view stays a renderer — see today/panel.ts.
export type { CalendarDay } from './today/calendar-day.js';
export {
  calendarDayFromLocalDate,
  calendarDayOfTimestamp,
  calendarDaysEndingOn,
  isCalendarDay,
  shiftCalendarDay,
} from './today/calendar-day.js';
// Every claim the Today panel asserts, enumerated so the contest gesture goes
// on all of them rather than on the ones a renderer remembered (`ol-fgba`).
export type {
  EnumerateTodayClaimsInput,
  EventsEvidenceRef,
  HeldReadingBasis,
  TodayClaim,
} from './today/contest.js';
export {
  contestedClaimFor,
  enumerateTodayClaims,
  evidenceBasisOf,
  heldReadingBasis,
} from './today/contest.js';
export type {
  CourseDueCount,
  DueInstrument,
  DueSummary,
  SummariseDueOptions,
} from './today/due.js';
export { isDueThrough, summariseDue } from './today/due.js';
// Cross-term recognition (F8.7, `[D-058]`, `ol-y6h1`) — a screen over existing data;
// fires only on exact concept-id match across courses, never a merge.
export type {
  EarlierCourseEvidence,
  EarlierCourseRecognition,
  EarlierCourseRecognitionInput,
} from './today/earlier-course-recognition.js';
export { buildEarlierCourseRecognitions } from './today/earlier-course-recognition.js';
// F6.2's per-course mastery overview (`ol-lohq`) — grouping over
// `masteryDistribution`, never a second mastery calculation.
export type {
  CourseMastery,
  MasteryOverview,
  MasteryOverviewInput,
} from './today/mastery-overview.js';
export { buildMasteryOverview } from './today/mastery-overview.js';
export type { TodayPanelInput, TodayViewModel } from './today/panel.js';
export { buildTodayPanel } from './today/panel.js';
// F6.9's rhythm reading (`ol-v7r5.6`, `RHY-2`) — nameable outside this
// package so `packages/plugin`'s ingestion and Today-panel wiring can build
// `RhythmCourseInput`s and read a `TermWindow`, the same reachability need
// `SourceCoverage` above states for `gap/coverage.ts`.
export type {
  RhythmCourseInput,
  RhythmCourseReading,
  RhythmInput,
  RhythmInsight,
  RhythmMeasured,
  RhythmStatus,
  TermWindow,
} from './today/rhythm.js';
export { detectRhythm, QUIET_DAYS_THRESHOLD, resolveTermBoundary } from './today/rhythm.js';
export type { ComputeStreakOptions, StreakDay, StreakSummary } from './today/streak.js';
export { computeStreak, DEFAULT_WEEK_LENGTH, studyDays } from './today/streak.js';
// F5.1 voice input: audio -> transcript -> the SAME `GradeExplainBackInput`
// typed input already uses (`ol-p4t01`, `[D-007]`). Voice is an input method,
// not a new grading path — see transcription/transcribe.ts's module doc for
// the reachability seam this stops at (no plugin wiring, no recording UI).
export type {
  ExplainBackPromptContext,
  TranscribeAudioWireRequest,
  TranscribeAudioWireResponse,
  TranscriptionCaller,
} from './transcription/transcribe.js';
export { buildGradeExplainBackInputFromTranscript } from './transcription/transcribe.js';
// The production `TranscriptionCaller`, mirroring `createWorkerJudgeCaller`
// exactly: builds the frozen `audio.transcribe.v1` envelope, leaves the HTTP
// call to an injected `WorkerTaskTransport`.
export type { WorkerTranscriptionCallerDeps } from './transcription/workerTranscriptionCaller.js';
export {
  AUDIO_TRANSCRIBE_CONTRACT_VERSION,
  AUDIO_TRANSCRIBE_TASK_ID,
  createWorkerTranscriptionCaller,
  WorkerTranscriptionError,
} from './transcription/workerTranscriptionCaller.js';
export type { StampResult, StampUidOptions } from './uid/stamp.js';
export { appendEmptyEntry, OLEA_UID_KEY, stampUid } from './uid/stamp.js';
export type { BuildUidTableResult, UidTableEntry, UidTableOptions } from './uid/table.js';
export { buildUidTable } from './uid/table.js';
export { FolderSource } from './vault/folder-source.js';
export {
  isVaultPath,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultEventKind,
  type VaultPath,
  type VaultSource,
} from './vault/types.js';
