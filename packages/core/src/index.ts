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
} from './concept/evidence.js';
export { extractTier3Evidence } from './concept/evidence.js';
export { extractConcepts } from './concept/extract.js';
// ol-p3t07a: the F3.3 automatic-generation pipeline (`packages/plugin/src/
// generation/`) needs F1.3's course-from-path derivation to turn a
// newly-landed source's note path into the `courseCode` `draftQuizCardsFor
// Concept` requires — nothing outside `olea-core` could reach it before this
// additive barrel export (same precedent as `masteryAtTimeForConceptIds`'s
// own addition: a deep import would risk double-bundling, and this package
// is the one place the derivation is defined). Does not touch course.ts
// itself.
export { courseFromPath, DEFAULT_COURSES_FOLDER, notePathCourses } from './concept/course.js';
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
export type {
  OverlapMeasurement,
  RestatementPrecheckGrading,
  RestatementPrecheckInput,
  RestatementPrecheckOptions,
  RestatementPrecheckResult,
} from './grading/restatementOverlap.js';
export {
  DEFAULT_RESTATEMENT_PRECHECK_OPTIONS,
  gradeExplainBackWithPrecheck,
  measureAnswerSourceOverlap,
  precheckRestatement,
} from './grading/restatementOverlap.js';
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
} from './instrument/mcq-format.js';
export {
  insertMcqBlock,
  MCQ_FENCE_INFO,
  parseMcqBlocks,
  serializeMcq,
  serializeMcqInstrument,
  stampMcqId,
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
export type { ConceptSprig, MasteryDistribution } from './mastery/sprig.js';
export { conceptSprig, masteryDistribution } from './mastery/sprig.js';
// The misconception store (F5.6, knowledge model §4.1, D-008, M1-M4,
// P4-T04): a local projection folded from its own append-only event log,
// never a second source of truth — see misconception/types.ts's module doc.
//
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
// P5-T07's switch-on: the composition that actually produces a
// `RankOracleResult` from a vault and a review log — `rankOracle` had no
// non-test caller anywhere until this joined `buildConceptAssessmentEdges`
// and the mastery rollup to it. See oracle/compose.ts's module doc.
export type { ComposeOracleRankingInput, ComposeOracleRankingResult } from './oracle/compose.js';
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
// Retrieval — embeddings, hybrid keyword+cosine retrieval, grounding refusal
// (C2.3, C2.5, C4.7, D-004, INV-5, P3-T05). Builds on the keyword index
// above rather than duplicating it — see retrieval/chunks.ts.
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
  AppendReviewLogOptions,
  AppendReviewLogResult,
  AppendSuspendLogResult,
  AppendVerdictLogResult,
  ReviewLogRecordInput,
  SuspendLogRecordInput,
  VerdictLogRecordInput,
} from './review-log/write.js';
export {
  appendReviewLogRecord,
  appendSuspendRecord,
  appendVerdictRecord,
} from './review-log/write.js';
export { createFsrsScheduler } from './scheduler/fsrs-scheduler.js';
export type {
  ScheduleInput,
  ScheduleOutput,
  Scheduler,
  SchedulerState,
} from './scheduler/types.js';
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
export { buildStudySession } from './study-session/build.js';
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
  estimateInstrumentDurations,
  MINIMUM_ESTIMATE_SECONDS,
  SESSION_INSTRUMENT_TYPES,
} from './study-session/duration.js';
export type { ConceptInstrumentIndex } from './study-session/instrument-index.js';
export { buildConceptInstrumentIndex } from './study-session/instrument-index.js';
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
export type {
  CourseDueCount,
  DueInstrument,
  DueSummary,
  SummariseDueOptions,
} from './today/due.js';
export { isDueThrough, summariseDue } from './today/due.js';
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
export type { ComputeStreakOptions, StreakDay, StreakSummary } from './today/streak.js';
export { computeStreak, DEFAULT_WEEK_LENGTH, studyDays } from './today/streak.js';
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
