#!/usr/bin/env node

// precompute-generation.mjs — the one paid `quiz.generate.v1` pass behind the workbench's
// Generation states (`ol-opmb.3` [TB-3]).
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
// `oracle/generate.ts`'s module doc).
//
// Requires the EMBEDDING cassette to already exist (`.embedding-cassette/cassette.json`,
// `ol-opmb.2` [TB-2]'s pass) — the retrieval half of every scenario here replays it, never
// re-embeds anything, so this script spends nothing on Slot E.
//
// Only ever builds requests from `olea-synthetic`'s own corpus and queries — never `eval/data/`,
// never the vault snapshot, never a real course code (see `generate-scenarios.ts`'s module doc for
// why `courseCode`/`conceptName` are coined `syn:course:…`/`syn:concept:…` tokens, restated here
// rather than imported because `generate-scenarios.ts` is not Node-importable — see
// `node-pipeline.mjs`'s own module doc for exactly why).
//
// ================================================================================================
// USAGE (from packages/workbench/)
// ================================================================================================
//   node scripts/precompute-generation.mjs                 # plan only, spends nothing
//   node scripts/precompute-generation.mjs --spend          # the real pass
//   node scripts/precompute-generation.mjs --target local   # against a local wrangler dev Worker
//
// Requires OLEA_STAGING_URL / OLEA_STAGING_TOKEN (or OLEA_LOCAL_* for --target local) in the
// environment. Exit codes match the rest of the harness: 3 = spend guard refusal, 2 = harness
// error, 0 = done.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCoreDist, retrieveOverCassette, sourceChunksFrom } from './node-pipeline.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const WORKBENCH_ROOT = resolve(here, '..');
const OLEA_ROOT = resolve(WORKBENCH_ROOT, '..', '..');
const OLEA_SERVICE_ROOT = resolve(OLEA_ROOT, '..', 'olea-service');
const CORE_DIST = resolve(OLEA_ROOT, 'packages', 'core', 'dist');
const EMBEDDING_CASSETTE_PATH = join(WORKBENCH_ROOT, '.embedding-cassette', 'cassette.json');
const GENERATION_CASSETTE_PATH = join(WORKBENCH_ROOT, '.generation-cassette', 'cassette.json');

function serviceUrl(...segments) {
  return pathToFileURL(join(OLEA_SERVICE_ROOT, ...segments)).href;
}
function oleaUrl(...segments) {
  return pathToFileURL(join(OLEA_ROOT, ...segments)).href;
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
const { runTaskCassetted, GenerationCassetteMismatchError } = await import(
  serviceUrl('scripts', 'harness', 'cassette.mjs')
);

const TASK_ID = 'quiz.generate.v1';
const task = getTaskDefinition(TASK_ID);
if (!task) {
  throw new HarnessError(
    `precompute-generation.mjs: "${TASK_ID}" is not routed (src/tasks/registry.ts).`,
  );
}
const MODEL_ID = SLOT_MODEL_CONFIG[task.slot].modelId;

// --- olea-synthetic's own corpus + queries + cassette shape --------------------------------------
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
const SCENARIOS = [
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

/** This LANE's own hard cap (`ol-opmb.3`'s brief: 20,000 neurons). Checked BEFORE the shared guard's own reservation. */
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

async function main() {
  if (!existsSync(EMBEDDING_CASSETTE_PATH)) {
    throw new HarnessError(
      `no embedding cassette at ${EMBEDDING_CASSETTE_PATH}. Run ` +
        '`node scripts/precompute-embeddings.mjs --spend` first (ol-opmb.2) — generation requests ' +
        'need real retrieval results, never a hand-built context.',
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
  const index = buildRetrievalIndex();

  // --- build every request first (no spend yet) — retrieval replay costs nothing -----------------
  const requests = [];
  for (const scenario of SCENARIOS) {
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
    requests.push({ ...scenario, retrieveStatus: result.status, payload });
  }

  // --- what's already cached vs what needs a real call -------------------------------------------
  const cassettePath = GENERATION_CASSETTE_PATH;
  const { readTaskCassetteStore } = await import(serviceUrl('scripts', 'harness', 'cassette.mjs'));
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
    const { hashGenerationPayload, findGenerationEntryByRequest } = await import(
      oleaUrl('packages', 'synthetic', 'src', 'generation-cassette.ts')
    );
    const payloadHash = await hashGenerationPayload(req.payload);
    const found = findGenerationEntryByRequest(cassette, { taskId: TASK_ID, payloadHash });
    if (found === undefined) missing.push({ ...req, payloadHash });
  }

  let estimatedNeurons = 0;
  for (const req of missing) {
    const { system, user } = task.buildPrompt(req.payload);
    estimatedNeurons += neuronsFor(MODEL_ID, estimateTokens(system) + estimateTokens(user), 4096);
  }

  console.log('');
  console.log('SLOT G GENERATION PASS — ESTIMATE (quiz.generate.v1)');
  console.log(`  scenarios total           ${requests.length}`);
  console.log(
    `  already cached            ${requests.length - missing.length} / ${requests.length}`,
  );
  console.log(`  missing (to call)         ${missing.length}`);
  console.log(`  model                     ${MODEL_ID}`);
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
        `${LANE_CAP_NEURONS} — stopping per ol-opmb.3's brief. Report the arithmetic; do not raise the cap here.`,
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
      taskId: TASK_ID,
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
      `  recorded ${req.queryId} (${req.retrieveStatus}) — replayed: ${outcome.replayed}, ` +
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
