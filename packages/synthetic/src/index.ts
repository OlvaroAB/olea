// olea-synthetic public entry point — DEV TOOLING (SYN-1 / ol-6vyi).
//
// INV-1: this package MUST NEVER import `obsidian`. See scripts/check-inv1.mjs,
// which scans every packages/* except packages/plugin, this one included.
//
// N-015: everything exported here fabricates data. It exercises machinery and
// verifies detectors against known ground truth. It is never evidence about the
// alpha user, and no threshold may be tuned on anything it produces.

export type { TwoProportionResult } from './analysis.js';
export { abInstrumentShareEffect, twoProportionEffect, Z_CRITICAL_ALPHA_05 } from './analysis.js';
export type { CorpusVariant, SyntheticCorpus, SyntheticNote } from './corpus.js';
export {
  buildCorpus,
  NOTES,
  SOURCE_COVERAGE,
  SOURCE_COVERAGE_ALL_READ,
  sourceDisplayName,
} from './corpus.js';
export type { SyntheticCurriculum } from './curriculum.js';
export {
  assessmentDisplayName,
  buildCurriculum,
  CONCEPT_DORNITH,
  CONCEPT_KELVANE,
  CONCEPT_MELSPAR,
  CONCEPT_TIRASP,
} from './curriculum.js';
export type { TwoDeviceSameDay } from './edge.js';
export { emptyHistoryStream, singleSessionStream, twoDeviceSameDayStreams } from './edge.js';
export type { EmbeddingCassette, EmbeddingCassetteEntry } from './embedding-cassette.js';
export {
  CASSETTE_MODEL_ID,
  CassetteMismatchError,
  cassetteEntriesByHash,
  EMBEDDING_CASSETTE_VERSION,
  emptyCassette,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
  toSerialisableCassette,
} from './embedding-cassette.js';
export type {
  FixtureConceptGroundTruth,
  FixtureVaultGroundTruth,
  FixtureVaultShapeId,
} from './fixture-vaults.js';
export {
  buildFixtureVault,
  FIXTURE_VAULT_SHAPES,
  fixtureVaultGroundTruth,
} from './fixture-vaults.js';
export type { DeclaredGroundTruth, StreamSpec, SyntheticStream } from './generate.js';
export { generateStream, MASTERY_STABILITY_BANDS, SPEC_DEFAULTS, streamSpec } from './generate.js';
export type {
  GenerationCassette,
  GenerationCassetteEntry,
  GenerationCassetteMissDiagnostic,
  GenerationCassetteOtherPin,
  GenerationTaskResponse,
} from './generation-cassette.js';
export {
  canonicalJson,
  diagnoseGenerationCassetteMiss,
  emptyGenerationCassette,
  findGenerationEntry,
  findGenerationEntryByRequest,
  GENERATION_CASSETTE_VERSION,
  GENERATION_DATASET_VERSION,
  GenerationCassetteMismatchError,
  hashGenerationPayload,
  readGenerationCassette,
  toSerialisableGenerationCassette,
} from './generation-cassette.js';
export type {
  LogPathResolver,
  SyntheticLogFile,
  WriteSyntheticStreamOptions,
} from './guard.js';
export {
  assertSyntheticSafePath,
  isProductVaultPath,
  isRealVaultReviewLogPath,
  SYNTHETIC_LOG_FOLDER,
  syntheticLogFiles,
  syntheticLogPath,
  writeSyntheticStream,
} from './guard.js';
export type { BothOfferedShare, CourseLapseRate } from './measures.js';
export {
  dayCounts,
  dueStateCounts,
  earlyPullShare,
  eventDays,
  explainBackRecords,
  instrumentShareWhenBothOffered,
  lapseRateByCourse,
  localDayOf,
  maxGapDays,
  medianExamProximity,
  recurringFailureConceptIds,
  reviewCountByCourse,
  reviewsOf,
  reviewsPerActiveDay,
  timeShareByCourse,
  timeSpentMsByCourse,
  topDayShare,
} from './measures.js';
export type { StreamPair } from './pairs.js';
export { behaviourDelta, nullPair, plantedPair, specDelta } from './pairs.js';
export type { Behaviour, Blackout, Persona, PersonaId, PlantedPattern } from './personas.js';
export { PERSONA_IDS, PERSONAS } from './personas.js';
export type { SyntheticProvenance, WorldProvenance } from './provenance.js';
export {
  assertNoSyntheticRecords,
  isSyntheticEventId,
  isSyntheticRecord,
  joinProvenance,
  SYNTHETIC_EVENT_ID_PREFIX,
  SYNTHETIC_GENERATOR,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_ID_PREFIX,
  SYNTHETIC_NOTICE,
} from './provenance.js';
export type { QueryLabel, SyntheticQuery } from './queries.js';
export { findQuery, QUERIES, queryTexts } from './queries.js';
export {
  ABSENT_CONCEPT_TOKENS,
  buildRetrievalIndex,
  RICH_CONCEPT_TOKENS,
  retrievalCorpusBlockCount,
  SPARSE_CONCEPT_TOKENS,
} from './retrieval-corpus.js';
export { Rng } from './rng.js';
export { toJsonl } from './serialize.js';
export type {
  ScheduledType,
  SyntheticConcept,
  SyntheticCourse,
  SyntheticInstrument,
} from './vocabulary.js';
export {
  CARD_TYPES,
  CONCEPTS,
  COURSE_QUORBIN,
  COURSE_VANTREL,
  COURSES,
  conceptById,
  conceptDisplayName,
  courseDisplayName,
  courseOfConcept,
  INSTRUMENTS,
  SCHEDULED_TYPES,
} from './vocabulary.js';
export type { SyntheticWorld, WorldSpec } from './world.js';
export { buildWorld } from './world.js';
