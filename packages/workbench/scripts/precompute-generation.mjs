#!/usr/bin/env node

// precompute-generation.mjs — the paid generative passes behind the workbench's Generation
// states (`ol-opmb.3` [TB-3]) AND the explain surface's prose half (`ol-4k45` [XWY-2]).
//
// ================================================================================================
// WHAT THIS IS
// ================================================================================================
// Mirrors `precompute-embeddings.mjs`'s shape and spend discipline exactly (plan-only by default,
// --spend required to call anything, one reservation per missing request, content-addressed reuse
// so re-running with nothing new to record costs nothing) but for the GENERATIVE stage rather than
// the embedding one — it reuses `olea-service`'s `scripts/harness/cassette.mjs` for the actual
// `POST /v1/task` call and cache-invalidation discipline rather than reimplementing either.
//
// It writes `packages/workbench/.generation-cassette/cassette.json` (gitignored): a
// (taskId, promptVersion, modelId, payloadHash)-keyed store of `POST /v1/task` responses, in the
// shape `olea-synthetic`'s `generation-cassette.ts` defines. `packages/workbench/build.mjs` copies
// it into `dist/` verbatim when present (`copyGenerationCassette`), so the workbench's browser
// bundle fetches it as a static asset and never calls a model itself (D-021, INV-1 — see
// `oracle/generate.ts`'s module doc). One file, TWO task ids: the key already carries `taskId`
// (`generation-cassette.ts`'s own module doc argues for exactly this), so `quiz.generate.v1` and
// `explain-why.generate.v1` entries coexist in the same store without conflict, each looked up
// independently by its own `(taskId, payloadHash)` pair.
//
// ================================================================================================
// TWO INDEPENDENT REQUEST-BUILDING PATHS — never mix their corpora
// ================================================================================================
// `quiz.generate.v1` (the ORIGINAL pass, `ol-opmb.3`): requests are built from `olea-synthetic`'s
// coined corpus and queries, replaying the already-recorded EMBEDDING cassette
// (`.embedding-cassette/cassette.json`, `ol-opmb.2` [TB-2]'s pass) via `node-pipeline.mjs`'s
// `retrieveOverCassette` — never `eval/data/`, never the vault snapshot, never a real course code
// (see `generate-scenarios.ts`'s module doc for why `courseCode`/`conceptName` are coined
// `syn:course:…`/`syn:concept:…` tokens, restated here rather than imported because
// `generate-scenarios.ts` is not Node-importable — see `node-pipeline.mjs`'s own module doc for
// exactly why).
//
// `explain-why.generate.v1` (added by `ol-4k45`): requests are built from the REAL, checked-in
// FIXTURE vault (`packages/core/fixtures/vault/`) instead — the same corpus
// `packages/workbench/src/explain/ground.ts` and `explain-scenarios.ts` already use for the
// grounding half, and the same GEOL204/MUSTH104 vocabulary `check-fixture-vocabulary.mjs`
// sanctions for the PUBLIC workbench bundle (INV-3: this cassette ships inline to a public Pages
// URL — see `scripts/check-workbench-bundle.mjs`). No embedding cassette is used or needed here:
// this corpus has no recorded embeddings (`ground.ts`'s own module doc explains why none should
// exist), so `buildExplainWhyRequests` below reimplements `ground.ts`'s zero-embedding,
// keyword-only demo directly against `olea-core`'s BUILT DIST — real fixture-vault keyword search,
// real refusal logic, degrading exactly the way `retrieve()`'s own module doc says an unreachable
// embedding provider always degrades. This is the Node-safe restatement, not a second copy of the
// logic maintained by hand: it calls the same `buildFullIndex`/`retrieve` functions `ground.ts`
// calls, from the same package, just loaded from dist rather than source (see `node-pipeline.mjs`'s
// module doc for exactly why `ground.ts` itself — which imports `../oracle-bridge.js` — cannot be
// `import`ed from a plain Node script).
//
// ================================================================================================
// USAGE (from packages/workbench/)
// ================================================================================================
//   node scripts/precompute-generation.mjs                 # plan only, spends nothing
//   node scripts/precompute-generation.mjs --spend          # the real pass, both task groups
//   node scripts/precompute-generation.mjs --target local   # against a local wrangler dev Worker
//
// Requires OLEA_STAGING_URL / OLEA_STAGING_TOKEN (or OLEA_LOCAL_* for --target local) in the
// environment. Exit codes match the rest of the harness: 3 = spend guard refusal, 2 = harness
// error, 0 = done.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadCoreDist,
  memoryEmbeddingCacheStore,
  retrieveOverCassette,
  sourceChunksFrom,
} from './node-pipeline.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const WORKBENCH_ROOT = resolve(here, '..');
const OLEA_ROOT = resolve(WORKBENCH_ROOT, '..', '..');
const OLEA_SERVICE_ROOT = resolve(OLEA_ROOT, '..', 'olea-service');
const CORE_DIST = resolve(OLEA_ROOT, 'packages', 'core', 'dist');
const FIXTURE_VAULT_DIR = resolve(OLEA_ROOT, 'packages', 'core', 'fixtures', 'vault');
const EMBEDDING_CASSETTE_PATH = join(WORKBENCH_ROOT, '.embedding-cassette', 'cassette.json');
const GENERATION_CASSETTE_PATH = join(WORKBENCH_ROOT, '.generation-cassette', 'cassette.json');

function serviceUrl(...segments) {
  return pathToFileURL(join(OLEA_SERVICE_ROOT, ...segments)).href;
}
function oleaUrl(...segments) {
  return pathToFileURL(join(OLEA_ROOT, ...segments)).href;
}
function coreDistUrl(...segments) {
  return pathToFileURL(join(CORE_DIST, ...segments)).href;
}

// --- olea-service's harness machinery, imported (never modified) --------------------------------
const { ensureLoader } = await import(serviceUrl('scripts', 'harness', 'register.mjs'));
ensureLoader();

const {
  authorisedDailyNeurons,
  estimateTokens,
  harnessBudgetNeurons,
  neuronsFor,
  neuronsToUsd,
  MAX_SINGLE_RESERVATION_NEURONS,
} = await import(serviceUrl('src', 'harness', 'neurons.ts'));
const { createSpendGuard, SpendGuardRefusal } = await import(
  serviceUrl('src', 'harness', 'spendGuard.ts')
);
const { getTaskDefinition } = await import(serviceUrl('src', 'tasks', 'registry.ts'));
const { SLOT_MODEL_CONFIG } = await import(serviceUrl('src', 'slots.ts'));
const { baseUrlFor, fileLedgerStore, HarnessError, parseArgs, tokenFor } = await import(
  serviceUrl('scripts', 'harness', 'lib.mjs')
);
const { runTaskCassetted, GenerationCassetteMismatchError, readTaskCassetteStore } = await import(
  serviceUrl('scripts', 'harness', 'cassette.mjs')
);
const { hashGenerationPayload, findGenerationEntryByRequest } = await import(
  oleaUrl('packages', 'synthetic', 'src', 'generation-cassette.ts')
);

function requireTask(taskId) {
  const task = getTaskDefinition(taskId);
  if (!task) {
    throw new HarnessError(
      `precompute-generation.mjs: "${taskId}" is not routed (src/tasks/registry.ts).`,
    );
  }
  return task;
}

const QUIZ_TASK_ID = 'quiz.generate.v1';
const quizTask = requireTask(QUIZ_TASK_ID);
const QUIZ_MODEL_ID = SLOT_MODEL_CONFIG[quizTask.slot].modelId;

const EXPLAIN_WHY_TASK_ID = 'explain-why.generate.v1';
const explainWhyTask = requireTask(EXPLAIN_WHY_TASK_ID);
const EXPLAIN_WHY_MODEL_ID = SLOT_MODEL_CONFIG[explainWhyTask.slot].modelId;

// --- olea-synthetic's own corpus + queries + cassette shape (quiz.generate.v1 only) --------------
const { buildRetrievalIndex } = await import(
  oleaUrl('packages', 'synthetic', 'src', 'retrieval-corpus.ts')
);
const { findQuery } = await import(oleaUrl('packages', 'synthetic', 'src', 'queries.ts'));
const { CASSETTE_MODEL_ID, CassetteMismatchError, RETRIEVAL_DATASET_VERSION, readCassette } =
  await import(oleaUrl('packages', 'synthetic', 'src', 'embedding-cassette.ts'));

// Same coined vocabulary `generate-scenarios.ts` uses (melspar/vantrel, ilmenor/quorbin) —
// restated, never imported, because `generate-scenarios.ts` reaches `oracle-bridge.ts`
// transitively and is not Node-importable (see `node-pipeline.mjs`'s module doc).
const MELSPAR_COURSE = 'syn:course:vantrel';
const MELSPAR_CONCEPT = 'syn:concept:melspar';
const ILMENOR_COURSE = 'syn:course:quorbin';
const ILMENOR_CONCEPT = 'syn:concept:ilmenor';

/** The two scenarios `generate-scenarios.ts`'s three states need — `generation-accepted` replays the SAME grounded request as `generation-pending-accept`, so there is nothing extra to record for it. */
const QUIZ_SCENARIOS = [
  {
    queryId: 'ans-01',
    courseCode: MELSPAR_COURSE,
    conceptName: MELSPAR_CONCEPT,
    retrieveOptions: {},
  },
  {
    queryId: 'ans-03',
    courseCode: ILMENOR_COURSE,
    conceptName: ILMENOR_CONCEPT,
    retrieveOptions: {},
  },
];

/**
 * F2.7's grounded query — the SAME string `explain-scenarios.ts`'s `GROUNDED_QUERY` uses,
 * restated here rather than imported for the same reason as the synthetic vocabulary above: this
 * is a plain Node script and that file transitively reaches `oracle-bridge.ts`. It is also the
 * `question` sent to `explain-why.generate.v1` below, matching production wiring
 * (`retrieveExplainWhySourceChunks` in `packages/plugin/src/review/explainWhy.ts` uses the review
 * item's own question text as the retrieval query, never a second string) — echoes the fixture
 * vault's own lecture-note title (`01 Courses/GEOL204/WEEK 1/Lecture - Grain Provenance and Clast
 * Imbrication.md`), never invented.
 */
const EXPLAIN_WHY_QUESTION = 'What causes clast imbrication in a rolling bedload?';
/** GEOL204's own `05 Zettelkasten/Imbrication.md` note — real, public, checked-in fixture content. */
const EXPLAIN_WHY_COURSE_CODE = 'GEOL204';
const EXPLAIN_WHY_CONCEPT_NAME = 'Imbrication';
/** A plausible wrong answer — the opposite of the note's actual claim (upstream vs. downstream dip) — never a real student's words, since none exist for fixture-vault fiction. */
const EXPLAIN_WHY_STUDENT_ANSWER =
  'The current pushes the flat side of each clast so it settles facing downstream.';
const EXPLAIN_WHY_CORRECT_ANSWER =
  'Clasts tip so their long axis dips upstream as the bed rolls, recording the last flow strong ' +
  'enough to move the whole grain skeleton.';

/** Not a note of hers — same exclusion `ground.ts` applies, restated here for the same reason as the rest of this file's fixture-vault path. */
const FIXTURE_EXCLUDED_PATHS = ['README.md'];

/**
 * Rebuilds `ground.ts`'s zero-embedding, keyword-only retrieval over the real fixture vault, from
 * `olea-core`'s BUILT DIST — see this file's module doc for why `ground.ts` itself cannot be
 * imported here. Returns `sourceChunks` exactly as `explain-scenarios.ts`'s grounded state would
 * produce them: `[]` on any refusal, chunk text on a grounded result.
 */
async function retrieveExplainWhySourceChunksOverFixtureVault(query) {
  const { FolderSource } = await import(coreDistUrl('vault', 'folder-source.js'));
  const { buildFullIndex } = await import(coreDistUrl('keyword-index', 'build.js'));
  const { retrieve } = await import(coreDistUrl('retrieval', 'engine.js'));
  const { EmbeddingCacheEngine } = await import(coreDistUrl('retrieval', 'embeddingCache.js'));

  const vault = new FolderSource(FIXTURE_VAULT_DIR);
  const built = await buildFullIndex({ vault });
  if (built.status === 'cancelled') {
    throw new HarnessError(
      'precompute-generation.mjs: unexpected cancellation building the fixture keyword index.',
    );
  }
  const documents = built.index.documents.filter(
    (doc) => !FIXTURE_EXCLUDED_PATHS.includes(doc.path),
  );
  const index = { version: built.index.version, documents };

  /** Always rejects — the provider this demo ships, deliberately, matching `ground.ts`'s `NoEmbeddingProvider`. No cassette exists for this corpus and none should be recorded for a zero-spend workbench surface. */
  const provider = {
    embed: () =>
      Promise.reject(
        new Error(
          'precompute-generation.mjs: no embedding provider for the fixture vault — this demo ' +
            "always degrades to keyword-only retrieval by design; see ground.ts's module doc.",
        ),
      ),
  };
  const cache = await EmbeddingCacheEngine.create({
    store: memoryEmbeddingCacheStore(),
    provider,
    model: 'workbench-explain/no-embedding-provider',
  });

  const result = await retrieve(
    { keywordIndex: index, embeddingCache: cache, embeddingProvider: provider },
    query,
    {},
  );
  return { status: result.status, sourceChunks: sourceChunksFrom(result) };
}

/** The one `explain-why.generate.v1` scenario `explain-scenarios.ts`'s `explanation-grounded` state needs. `explanation-refused-no-grounding` stays local/zero-spend — see that file's own note. */
async function buildExplainWhyRequests() {
  const { status, sourceChunks } =
    await retrieveExplainWhySourceChunksOverFixtureVault(EXPLAIN_WHY_QUESTION);
  const payload = {
    courseCode: EXPLAIN_WHY_COURSE_CODE,
    conceptName: EXPLAIN_WHY_CONCEPT_NAME,
    question: EXPLAIN_WHY_QUESTION,
    studentAnswer: EXPLAIN_WHY_STUDENT_ANSWER,
    correctAnswer: EXPLAIN_WHY_CORRECT_ANSWER,
    sourceChunks,
  };
  return [
    {
      taskId: EXPLAIN_WHY_TASK_ID,
      queryId: 'explain-imbrication-wrong-answer',
      retrieveStatus: status,
      payload,
    },
  ];
}

async function buildQuizRequests(core, embeddingCassette) {
  const index = buildRetrievalIndex();
  const requests = [];
  for (const scenario of QUIZ_SCENARIOS) {
    const query = findQuery(scenario.queryId);
    if (!query)
      throw new HarnessError(`unknown synthetic query id ${JSON.stringify(scenario.queryId)}`);
    const result = await retrieveOverCassette({
      core,
      index,
      embeddingCassette,
      query: query.query,
      options: scenario.retrieveOptions,
    });
    const sourceChunks = sourceChunksFrom(result);
    const payload = {
      courseCode: scenario.courseCode,
      conceptName: scenario.conceptName,
      sourceChunks,
    };
    requests.push({
      taskId: QUIZ_TASK_ID,
      queryId: scenario.queryId,
      retrieveStatus: result.status,
      payload,
    });
  }
  return requests;
}

// ------------------------------------------------------------------------------------------------
// arguments
// ------------------------------------------------------------------------------------------------
const KNOWN = new Set(['target', 'base-url', 'spend', 'json']);
const { args } = parseArgs(process.argv.slice(2));
for (const key of Object.keys(args)) {
  if (!KNOWN.has(key)) die(2, [`unrecognised argument: --${key}`]);
}
const options = {
  target: args.target ?? 'staging',
  baseUrlOverride: args['base-url'] ?? null,
  spend: args.spend === 'true',
  json: args.json === 'true',
};

/** This LANE's own hard cap (`ol-opmb.3`'s brief: 20,000 neurons) — checked BEFORE the shared guard's own reservation. `ol-4k45`'s own brief caps its addition far lower (~150 neurons worst case; the orchestrator's own hard ceiling for that run is 500) but that is an operator-side check on the printed estimate, not a second constant to maintain here. */
const LANE_CAP_NEURONS = 20_000;

try {
  await main();
} catch (error) {
  if (error instanceof SpendGuardRefusal) {
    die(3, [
      'SPEND GUARD REFUSED. Nothing was sent.',
      `  requested: ${error.requestedNeurons.toFixed(3)} neurons`,
      `  remaining: ${error.remainingNeurons.toFixed(3)} neurons`,
    ]);
  }
  if (
    error instanceof HarnessError ||
    error instanceof CassetteMismatchError ||
    error instanceof GenerationCassetteMismatchError
  ) {
    die(2, [error.message]);
  }
  throw error;
}

function modelIdFor(taskId) {
  return taskId === QUIZ_TASK_ID ? QUIZ_MODEL_ID : EXPLAIN_WHY_MODEL_ID;
}
function taskDefinitionFor(taskId) {
  return taskId === QUIZ_TASK_ID ? quizTask : explainWhyTask;
}

async function main() {
  if (!existsSync(EMBEDDING_CASSETTE_PATH)) {
    throw new HarnessError(
      `no embedding cassette at ${EMBEDDING_CASSETTE_PATH}. Run ` +
        '`node scripts/precompute-embeddings.mjs --spend` first (ol-opmb.2) — quiz.generate.v1 ' +
        'requests need real retrieval results, never a hand-built context.',
    );
  }
  const embeddingCassette = readCassette(
    JSON.parse(readFileSync(EMBEDDING_CASSETTE_PATH, 'utf8')),
    {
      model: CASSETTE_MODEL_ID,
      datasetVersion: RETRIEVAL_DATASET_VERSION,
    },
  );

  const core = await loadCoreDist(CORE_DIST);

  // --- build every request first (no spend yet) — retrieval replay costs nothing -----------------
  const quizRequests = await buildQuizRequests(core, embeddingCassette);
  const explainWhyRequests = await buildExplainWhyRequests();
  const requests = [...quizRequests, ...explainWhyRequests];

  // --- what's already cached vs what needs a real call -------------------------------------------
  const cassettePath = GENERATION_CASSETTE_PATH;
  let cassette;
  try {
    cassette = readTaskCassetteStore(cassettePath);
  } catch (error) {
    throw new HarnessError(
      `${error.message}\n  Delete ${cassettePath} before re-running if you intend to rebuild it from zero.`,
    );
  }

  const missing = [];
  for (const req of requests) {
    const payloadHash = await hashGenerationPayload(req.payload);
    const found = findGenerationEntryByRequest(cassette, { taskId: req.taskId, payloadHash });
    if (found === undefined) missing.push({ ...req, payloadHash });
  }

  let estimatedNeurons = 0;
  for (const req of missing) {
    const task = taskDefinitionFor(req.taskId);
    const { system, user } = task.buildPrompt(req.payload);
    estimatedNeurons += neuronsFor(
      modelIdFor(req.taskId),
      estimateTokens(system) + estimateTokens(user),
      4096,
    );
  }

  console.log('');
  console.log('GENERATION PASS — ESTIMATE (quiz.generate.v1 + explain-why.generate.v1)');
  console.log(`  scenarios total           ${requests.length}`);
  console.log(
    `  already cached            ${requests.length - missing.length} / ${requests.length}`,
  );
  console.log(`  missing (to call)         ${missing.length}`);
  for (const req of missing) {
    console.log(`    - ${req.taskId} :: ${req.queryId} (model ${modelIdFor(req.taskId)})`);
  }
  console.log(
    `  ESTIMATE                  ${estimatedNeurons.toFixed(3)} neurons (~US$${neuronsToUsd(estimatedNeurons).toFixed(6)})`,
  );
  console.log(
    `  today's ceiling            ${authorisedDailyNeurons(Date.now())} neurons; harness budget ${harnessBudgetNeurons(Date.now())}`,
  );
  console.log(`  THIS LANE's own cap        ${LANE_CAP_NEURONS} neurons`);
  console.log(`  single-reservation tripwire ${MAX_SINGLE_RESERVATION_NEURONS} neurons`);
  console.log('');

  if (missing.length === 0) {
    console.log('Nothing to record. Every scenario is already cached — this run is FREE.');
    return;
  }

  if (estimatedNeurons > LANE_CAP_NEURONS) {
    throw new HarnessError(
      `estimated ${estimatedNeurons.toFixed(3)} neurons exceeds this lane's own cap of ` +
        `${LANE_CAP_NEURONS} — stopping. Report the arithmetic; do not raise the cap here.`,
    );
  }

  if (!options.spend) {
    console.log('PLAN ONLY. No model call was made and nothing was written to the ledger.');
    console.log('Re-run with --spend to perform the pass.\n');
    return;
  }

  const baseUrl = baseUrlFor(options.target, options.baseUrlOverride);
  const token = tokenFor(options.target);
  const guard = createSpendGuard({ store: fileLedgerStore(), now: () => Date.now() });

  let spentNeurons = 0;
  let calls = 0;
  for (const req of missing) {
    const outcome = await runTaskCassetted({
      cassettePath,
      taskId: req.taskId,
      payload: req.payload,
      target: options.target,
      baseUrl,
      token,
      guard,
      spend: true,
    });
    if (!outcome.replayed) {
      calls += 1;
      spentNeurons += outcome.neurons ?? 0;
    }
    console.log(
      `  recorded ${req.taskId} :: ${req.queryId} (${req.retrieveStatus}) — replayed: ${outcome.replayed}, ` +
        `response.ok: ${outcome.response.ok}, neurons: ${(outcome.neurons ?? 0).toFixed(3)}`,
    );
  }

  console.log(`Recorded ${calls} new call(s) over ${requests.length} scenario(s).`);
  console.log(
    `Spent ${spentNeurons.toFixed(3)} neurons (~US$${neuronsToUsd(spentNeurons).toFixed(6)}).`,
  );
  console.log(`  wrote ${cassettePath}`);
  if (options.json) {
    console.log(
      JSON.stringify({ estimatedNeurons, spentNeurons, missing: missing.length, calls }, null, 2),
    );
  }
}

function die(code, lines) {
  console.error('');
  console.error('!'.repeat(96));
  console.error('!!  PRECOMPUTE-GENERATION: STOPPED.');
  console.error('!!');
  for (const line of lines) console.error(`!!  ${line}`);
  console.error('!'.repeat(96));
  console.error('');
  process.exit(code);
}
