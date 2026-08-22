#!/usr/bin/env node

// precompute-embeddings.mjs — the one paid embedding pass over
// olea-synthetic's retrieval corpus + labelled query set (`ol-opmb.2` [TB-2]).
//
// ================================================================================================
// WHAT THIS IS
// ================================================================================================
// Mirrors olea-service/scripts/harness/embed-corpus.mjs's shape and spend discipline exactly
// (plan-only by default, --spend required to call anything, one reservation, content-hash-keyed
// reuse so a second pass over unchanged text is free) but targets the SYNTHETIC world instead of
// the real vault snapshot. There is no privacy concern in what gets embedded here — every text is
// coined nonsense over olea-synthetic's own vetted vocabulary (INV-3) — but the SPEND discipline
// is identical, and this script reuses olea-service's EXISTING spend guard and neuron ledger
// rather than inventing a second one that could disagree about the daily budget.
//
// It writes packages/workbench/.embedding-cassette/cassette.json (gitignored): a content-hash
// keyed, model-pinned store of full-precision vectors, in the shape olea-synthetic's
// embedding-cassette.ts defines. packages/workbench/build.mjs copies it into dist/ verbatim when
// present (see copyEmbeddingCassette there), so the workbench's browser bundle fetches it as a
// static asset and never calls a model itself (D-021, INV-1 — see embedding-provider.ts's module
// doc). Never embeds anything from olea-service/eval/data/ or the vault snapshot — synthetic
// corpus only, by construction: everything embedded here comes from olea-synthetic's own
// retrieval-corpus.ts and queries.ts.
//
// ================================================================================================
// USAGE (from packages/workbench/)
// ================================================================================================
//   node scripts/precompute-embeddings.mjs                 # plan only, spends nothing
//   node scripts/precompute-embeddings.mjs --spend          # the real pass
//   node scripts/precompute-embeddings.mjs --target local   # against a local wrangler dev Worker
//
// Requires OLEA_STAGING_URL / OLEA_STAGING_TOKEN (or OLEA_LOCAL_* for --target local) in the
// environment — source olea-service/.olea-harness/staging.env first; never print its contents.
//
// Exit codes match the rest of the harness: 3 = spend guard refusal, 2 = harness error, 0 = done.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_ROOT = resolve(here, '..');
const OLEA_ROOT = resolve(WORKBENCH_ROOT, '..', '..');
const OLEA_SERVICE_ROOT = resolve(OLEA_ROOT, '..', 'olea-service');
const CORE_DIST = resolve(OLEA_ROOT, 'packages', 'core', 'dist');
const CASSETTE_PATH = join(WORKBENCH_ROOT, '.embedding-cassette', 'cassette.json');

function serviceUrl(...segments) {
  return pathToFileURL(join(OLEA_SERVICE_ROOT, ...segments)).href;
}
function oleaUrl(...segments) {
  return pathToFileURL(join(OLEA_ROOT, ...segments)).href;
}

// --- olea-service's harness machinery, imported (never modified) — same ledger, same guard, same
// pricing table, per this bead's brief: reuse, do not reimplement. -------------------------------
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
const { SLOT_MODEL_CONFIG } = await import(serviceUrl('src', 'slots.ts'));
const { baseUrlFor, fileLedgerStore, HarnessError, parseArgs, readMetadataHeaders, tokenFor } =
  await import(serviceUrl('scripts', 'harness', 'lib.mjs'));

/** The Slot E pin, read from the Worker's own config — never restated as a second literal. */
const SLOT_E_MODEL = SLOT_MODEL_CONFIG.E.modelId;

// --- olea-synthetic's own corpus + queries + cassette shape ---------------------------------------
const { buildRetrievalIndex } = await import(
  oleaUrl('packages', 'synthetic', 'src', 'retrieval-corpus.ts')
);
const { QUERIES } = await import(oleaUrl('packages', 'synthetic', 'src', 'queries.ts'));
const {
  CASSETTE_MODEL_ID,
  CassetteMismatchError,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
  toSerialisableCassette,
} = await import(oleaUrl('packages', 'synthetic', 'src', 'embedding-cassette.ts'));

// The one drift guard that matters here: the cassette's pinned model id is restated in
// olea-synthetic (a public package that may not depend on olea-service at runtime — see
// embedding-cassette.ts's module doc) rather than imported. This is the one place both values are
// in scope, so a mismatch is caught here rather than silently mixing vector spaces later.
if (CASSETTE_MODEL_ID !== SLOT_E_MODEL) {
  die(2, [
    `olea-synthetic's CASSETTE_MODEL_ID (${CASSETTE_MODEL_ID}) has drifted from Slot E's pin ` +
      `(${SLOT_E_MODEL}). Update embedding-cassette.ts's CASSETTE_MODEL_ID to match before ` +
      'spending anything — a cassette pinned to the wrong model is exactly the corruption ' +
      'readCassette() exists to refuse downstream.',
  ]);
}

// --- olea-core, from its BUILT dist (not source — see embed-corpus.mjs's own module doc: core's
// source uses TypeScript syntax (parameter properties) Node's strip-only mode cannot parse). ------
async function loadCore(coreDist) {
  const need = {
    chunksFromIndex: ['retrieval', 'chunks.js'],
    EmbeddingCacheEngine: ['retrieval', 'embeddingCache.js'],
    WorkerEmbeddingProvider: ['retrieval', 'workerProvider.js'],
    hashText: ['ingestion', 'hash.js'],
  };
  const out = {};
  for (const [name, segments] of Object.entries(need)) {
    const file = join(coreDist, ...segments);
    if (!existsSync(file)) {
      throw new HarnessError(
        `olea-core is not built for this pipeline: ${file} is missing.\n` +
          '  Fix:  pnpm --filter olea-core build     (run it in the public checkout)',
      );
    }
    const module = await import(pathToFileURL(file).href);
    if (!(name in module)) {
      throw new HarnessError(`olea-core's ${segments.join('/')} no longer exports ${name}.`);
    }
    out[name] = module[name];
  }
  return out;
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

/**
 * This LANE's own hard cap, distinct from and stricter than the harness's shared daily ceiling —
 * `ol-opmb.2`'s brief: "Hard cap for this lane: 40,000 neurons [raised 2026-08-16 from 5,000 under
 * the run-11 TEMPORARY_CEILING_RAISE window, src/harness/neurons.ts]. If the plan exceeds that,
 * STOP and report — do not spend." Checked BEFORE the shared guard's own reservation, so a plan
 * that is fine against the daily ceiling can still be refused here.
 */
const LANE_CAP_NEURONS = 40_000;

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
  if (error instanceof HarnessError || error instanceof CassetteMismatchError)
    die(2, [error.message]);
  throw error;
}

async function main() {
  const core = await loadCore(CORE_DIST);
  const index = buildRetrievalIndex();
  const chunks = await core.chunksFromIndex(index);

  const textByHash = new Map();
  for (const chunk of chunks) {
    if (!textByHash.has(chunk.contentHash)) textByHash.set(chunk.contentHash, chunk.text);
  }
  const distinctChunkHashes = textByHash.size;
  for (const q of QUERIES) {
    const hash = await core.hashText(q.query);
    if (!textByHash.has(hash)) textByHash.set(hash, q.query);
  }
  const distinctQueryHashes = textByHash.size - distinctChunkHashes;

  // --- reuse whatever is already cached, hard-refusing a model/dataset mismatch rather than
  // silently starting over (`ol-opmb.2`'s brief: copy the harness's cache-invalidation logic
  // exactly, do not soften it). ---------------------------------------------------------------
  let existing = {
    version: 1,
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
    entries: [],
  };
  if (existsSync(CASSETTE_PATH)) {
    const raw = JSON.parse(readFileSync(CASSETTE_PATH, 'utf8'));
    try {
      existing = readCassette(raw, {
        model: CASSETTE_MODEL_ID,
        datasetVersion: RETRIEVAL_DATASET_VERSION,
      });
    } catch (error) {
      if (error instanceof CassetteMismatchError) {
        throw new HarnessError(
          `${error.message}\n  Delete ${CASSETTE_PATH} before re-running if you intend to rebuild it from zero.`,
        );
      }
      throw error;
    }
  }
  const existingHashes = new Set(existing.entries.map((e) => e.contentHash));
  const missing = [...textByHash.entries()].filter(([hash]) => !existingHashes.has(hash));

  const missingTokens = missing.reduce((sum, [, text]) => sum + estimateTokens(text), 0);
  const estimatedNeurons = neuronsFor(SLOT_E_MODEL, missingTokens, 0);

  console.log('');
  console.log('SLOT E SYNTHETIC PASS — ESTIMATE');
  console.log(`  corpus documents          ${index.documents.length}`);
  console.log(`  corpus chunks             ${chunks.length} (${distinctChunkHashes} distinct)`);
  console.log(
    `  labelled queries          ${QUERIES.length} (${distinctQueryHashes} distinct, net of any chunk overlap)`,
  );
  console.log(
    `  already cached            ${existing.entries.length} / ${textByHash.size} distinct texts`,
  );
  console.log(`  missing (to embed)        ${missing.length}`);
  console.log(`  model                     ${SLOT_E_MODEL}`);
  console.log(`  input tokens (missing)    ${missingTokens}`);
  console.log(
    `  ESTIMATE                  ${missingTokens} / 1e6 x 1,075 = ${estimatedNeurons.toFixed(3)} neurons (~US$${neuronsToUsd(estimatedNeurons).toFixed(6)})`,
  );
  console.log(
    `  today's ceiling            ${authorisedDailyNeurons(Date.now())} neurons; harness budget ${harnessBudgetNeurons(Date.now())}`,
  );
  console.log(`  THIS LANE's own cap        ${LANE_CAP_NEURONS} neurons`);
  console.log(`  single-reservation tripwire ${MAX_SINGLE_RESERVATION_NEURONS} neurons`);
  console.log('');

  if (missing.length === 0) {
    console.log('Nothing to embed. Every distinct text is already cached — this run is FREE.');
    writeCassette(existing);
    return;
  }

  if (estimatedNeurons > LANE_CAP_NEURONS) {
    throw new HarnessError(
      `estimated ${estimatedNeurons.toFixed(3)} neurons exceeds this lane's own cap of ` +
        `${LANE_CAP_NEURONS} — stopping per ol-opmb.2's brief. Report the arithmetic; do not raise the cap here.`,
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
  const reservation = guard.reserve({
    modelId: SLOT_E_MODEL,
    estimatedInputTokens: missingTokens,
    maxOutputTokens: 0,
  });
  console.log(`Reserved ${reservation.reservedNeurons.toFixed(3)} neurons (id ${reservation.id}).`);

  const wire = { calls: 0, inputTokens: 0, estimatedTokensSent: 0 };
  const provider = new core.WorkerEmbeddingProvider({
    transport: makeTransport({ baseUrl, token, wire }),
  });

  const BATCH = 16;
  const newEntries = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const result = await provider.embed({
      model: SLOT_E_MODEL,
      texts: batch.map(([, text]) => text),
    });
    batch.forEach(([hash], j) => {
      const vector = result.vectors[j];
      if (vector) newEntries.push({ contentHash: hash, vector: Array.from(vector) });
    });
  }

  const settled = wire.inputTokens > 0 ? wire.inputTokens : wire.estimatedTokensSent;
  guard.settle(reservation, { modelId: SLOT_E_MODEL, inputTokens: settled, outputTokens: 0 });

  const merged = {
    version: 1,
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
    entries: [...existing.entries, ...newEntries],
  };
  writeCassette(merged);

  const actualNeurons = neuronsFor(SLOT_E_MODEL, settled, 0);
  console.log(
    `Embedded ${newEntries.length} / ${missing.length} missing texts over ${wire.calls} call(s).`,
  );
  console.log(
    `Settled ${settled} tokens = ${actualNeurons.toFixed(3)} neurons (~US$${neuronsToUsd(actualNeurons).toFixed(6)}).`,
  );
  console.log(`  wrote ${CASSETTE_PATH} (${merged.entries.length} total entries)`);
  if (options.json) {
    console.log(
      JSON.stringify(
        { estimatedNeurons, actualNeurons, missing: missing.length, embedded: newEntries.length },
        null,
        2,
      ),
    );
  }
}

function writeCassette(cassette) {
  mkdirSync(dirname(CASSETTE_PATH), { recursive: true });
  const serialisable = toSerialisableCassette(cassette);
  writeFileSync(CASSETTE_PATH, `${JSON.stringify(serialisable)}\n`);
}

function makeTransport({ baseUrl, token, wire }) {
  return {
    async send(request) {
      for (const chunk of request.payload?.chunks ?? []) {
        wire.estimatedTokensSent += estimateTokens(chunk.text);
      }
      const response = await fetch(`${baseUrl}/v1/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      });
      wire.calls++;
      const metadata = readMetadataHeaders(response);
      if (metadata.inputTokens !== null) wire.inputTokens += metadata.inputTokens;
      const body = await response.json().catch(() => null);
      if (body === null) {
        throw new HarnessError(`the Worker answered ${response.status} with a non-JSON body.`);
      }
      return body;
    },
  };
}

function die(code, lines) {
  console.error('');
  console.error('!'.repeat(96));
  console.error('!!  PRECOMPUTE-EMBEDDINGS: STOPPED.');
  console.error('!!');
  for (const line of lines) console.error(`!!  ${line}`);
  console.error('!'.repeat(96));
  console.error('');
  process.exit(code);
}
