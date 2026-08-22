/**
 * The single file in this package that reaches into `packages/synthetic`.
 *
 * Same rule as `plugin-bridge.ts`: "what does the workbench take from
 * `olea-synthetic`" should be answerable by reading one short file. The
 * *reason* for reaching into source rather than importing the package by name
 * is different, and worth stating because it is a gate-ordering fact rather
 * than a preference:
 *
 * `olea-synthetic`'s `main` is `./dist/index.js`, and CI runs `pnpm run test`
 * **before** `pnpm run build`. On a fresh clone that dist does not exist, so
 * `import … from 'olea-synthetic'` fails to resolve during the test gate —
 * verified, not assumed: it errors with "Failed to resolve entry for package".
 * Importing the source has no such ordering dependency. `package.json` still
 * declares the workspace dependency so pnpm orders the *build* correctly and so
 * the relationship is visible where dependencies are looked for.
 *
 * INV-1 note: nothing reachable from here imports `obsidian`.
 * `scripts/check-inv1.mjs` scans `packages/synthetic` in its own right.
 *
 * N-015 note: everything below fabricates data. It exercises machinery. It is
 * never evidence about the alpha user, and no threshold may be tuned on it.
 */

// The oracle surface's world (TB-1, `ol-opmb.1`): a curriculum and a corpus
// over the same coined vocabulary a persona's stream already uses, so the
// oracle chain never has to relabel onto the fixture vault — see
// `oracle/derive.ts` and `curriculum.ts`'s module doc for why that matters.
// The retrieval chain's synthetic inputs (`ol-opmb.2` [TB-2]): the corpus
// `oracle/retrieve.ts` indexes, the labelled query set it drives, and the
// embedding-cassette shape the precompute pass and `oracle/embedding-provider.ts`
// share.
export type {
  EmbeddingCassette,
  EmbeddingCassetteEntry,
  // The generation cassette (`ol-opmb.3` [TB-3]) — same shape family as the
  // embedding cassette above, one key axis wider (taskId + promptVersion +
  // modelId + payloadHash rather than a single pinned model). See
  // `oracle/generate.ts` and `generation-cassette.ts`'s own module doc.
  GenerationCassette,
  GenerationCassetteEntry,
  GenerationTaskResponse,
  PersonaId,
  QueryLabel,
  ScheduledType,
  SyntheticConcept,
  SyntheticCorpus,
  SyntheticCourse,
  SyntheticCurriculum,
  SyntheticInstrument,
  SyntheticNote,
  SyntheticQuery,
  SyntheticStream,
  SyntheticWorld,
  WorldProvenance,
  WorldSpec,
} from '../../synthetic/src/index.js';
export {
  ABSENT_CONCEPT_TOKENS,
  assessmentDisplayName,
  buildCorpus,
  buildCurriculum,
  buildRetrievalIndex,
  buildWorld,
  CASSETTE_MODEL_ID,
  CassetteMismatchError,
  CONCEPTS,
  COURSE_QUORBIN,
  COURSE_VANTREL,
  COURSES,
  cassetteEntriesByHash,
  conceptById,
  conceptDisplayName,
  courseDisplayName,
  courseOfConcept,
  EMBEDDING_CASSETTE_VERSION,
  emptyCassette,
  findGenerationEntryByRequest,
  findQuery,
  GENERATION_CASSETTE_VERSION,
  GENERATION_DATASET_VERSION,
  generateStream,
  hashGenerationPayload,
  INSTRUMENTS,
  isSyntheticRecord,
  joinProvenance,
  PERSONAS,
  QUERIES,
  queryTexts,
  RETRIEVAL_DATASET_VERSION,
  RICH_CONCEPT_TOKENS,
  readCassette,
  readGenerationCassette,
  retrievalCorpusBlockCount,
  SPARSE_CONCEPT_TOKENS,
  SYNTHETIC_EVENT_ID_PREFIX,
  SYNTHETIC_LOG_FOLDER,
  sourceDisplayName,
  streamSpec,
  toSerialisableCassette,
  writeSyntheticStream,
} from '../../synthetic/src/index.js';
