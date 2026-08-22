// retrieve.spec.ts — the query -> retrieve -> ground/refuse chain
// (`olea-service`'s `ol-opmb.2` [TB-2]), against the REAL, once-embedded
// cassette (`.embedding-cassette/cassette.json`) — never a fake vector.
//
// Every assertion here is about MECHANISM (does refusal fire with the right
// reason, does attribution point at a real corpus location, is the run
// deterministic) — never a quality number. Retrieval ranking quality over
// this coined-token corpus is uninterpretable by construction (parent bead,
// `ol-opmb`) and nothing here reports one.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  emptyRetrievalIndex,
  type RetrieveScenarioResult,
  retrieveScenario,
} from '../src/oracle/retrieve.js';
import {
  buildRetrieveScenario,
  findRetrieveState,
  RETRIEVE_STATES,
} from '../src/retrieve-scenarios.js';
import {
  buildRetrievalIndex,
  CASSETTE_MODEL_ID,
  type EmbeddingCassette,
  findQuery,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
} from '../src/synthetic-bridge.js';

const CASSETTE_PATH = '.embedding-cassette/cassette.json';

let cassette: EmbeddingCassette;

beforeAll(() => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CASSETTE_PATH, 'utf8'));
  } catch {
    throw new Error(
      `retrieve.spec.ts: no cassette at ${CASSETTE_PATH}. Run ` +
        '`node scripts/precompute-embeddings.mjs --spend` from packages/workbench/ once before ' +
        'running this suite — see ol-opmb.2 for the one paid pass.',
    );
  }
  cassette = readCassette(raw, {
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
  });
});

describe('the four addressable retrieve states — mechanism, not quality', () => {
  it('RETRIEVE_STATES has exactly the four states the bead names', () => {
    expect(RETRIEVE_STATES.map((s) => s.id)).toEqual([
      'grounding-refused-no-hits',
      'grounding-refused-below-threshold',
      'grounding-refused-composite',
      'grounded-with-citations',
    ]);
  });

  it('grounding-refused-no-hits: refuses with reason no-hits (empty index)', async () => {
    const scenario = await buildRetrieveScenario('grounding-refused-no-hits', cassette);
    expect(scenario.result.result).toEqual({ status: 'refused', reason: 'no-hits' });
  });

  it('grounding-refused-below-threshold: refuses with reason below-relevance-threshold', async () => {
    const scenario = await buildRetrieveScenario('grounding-refused-below-threshold', cassette);
    expect(scenario.result.result).toEqual({
      status: 'refused',
      reason: 'below-relevance-threshold',
    });
    expect(scenario.result.requireComposite).toBe(false);
  });

  it('grounding-refused-composite: refuses with reason below-composite-threshold, at the RATIFIED operating point', async () => {
    const scenario = await buildRetrieveScenario('grounding-refused-composite', cassette);
    expect(scenario.result.result).toEqual({
      status: 'refused',
      reason: 'below-composite-threshold',
    });
    expect(scenario.result.requireComposite).toBe(true);
  });

  it('grounded-with-citations: grounds with real citations, at the SAME ratified operating point', async () => {
    const scenario = await buildRetrieveScenario('grounded-with-citations', cassette);
    expect(scenario.result.result.status).toBe('grounded');
    expect(scenario.result.requireComposite).toBe(true);
    if (scenario.result.result.status !== 'grounded') throw new Error('unreachable');
    expect(scenario.result.result.chunks.length).toBeGreaterThan(0);

    // Attribution: every cited chunk points at a REAL location in the corpus
    // this driver built, never an invented path.
    const index = buildRetrievalIndex();
    const realLocations = new Set(
      index.documents.flatMap((doc) => doc.blocks.map((b) => `${doc.path}#${b.blockIndex}`)),
    );
    for (const chunk of scenario.result.result.chunks) {
      expect(realLocations.has(`${chunk.path}#${chunk.blockIndex}`)).toBe(true);
    }
  });

  it('findRetrieveState resolves every id in RETRIEVE_STATES and nothing else', () => {
    for (const state of RETRIEVE_STATES) {
      expect(findRetrieveState(state.id)?.id).toBe(state.id);
    }
    expect(findRetrieveState('not-a-real-state')).toBeUndefined();
  });
});

describe('determinism — byte-identical outcome across two runs', () => {
  it('every retrieve state produces the identical GroundingResult twice', async () => {
    for (const state of RETRIEVE_STATES) {
      const a = await buildRetrieveScenario(state.id, cassette);
      const b = await buildRetrieveScenario(state.id, cassette);
      expect(a.result.result).toEqual(b.result.result);
      expect(a.result.trace.stages[0]?.outputSummary).toEqual(
        b.result.trace.stages[0]?.outputSummary,
      );
    }
  });
});

describe('retrieveScenario — the trace, one stage per call', () => {
  it('records exactly one "retrieve" StageRecord, with couldHaveSucceeded true (nothing upstream in this pipeline could have blocked it)', async () => {
    const query = findQuery('ans-01');
    if (!query) throw new Error('unreachable');
    const scenario: RetrieveScenarioResult = await retrieveScenario({ cassette, query });
    expect(scenario.trace.stages).toHaveLength(1);
    expect(scenario.trace.stages[0]?.stage).toBe('retrieve');
    expect(scenario.trace.stages[0]?.couldHaveSucceeded).toBe(true);
    expect(scenario.trace.stages[0]?.attributedTo).toBeNull();
  });

  it('never logs raw query text or chunk text in the trace summaries — only ids/counts', async () => {
    const query = findQuery('ans-01');
    if (!query) throw new Error('unreachable');
    const scenario = await retrieveScenario({ cassette, query });
    const serialised = JSON.stringify(scenario.trace.stages[0]);
    expect(serialised).not.toContain(query.query);
  });

  it('an explicitly empty index short-circuits to no-hits regardless of query content', async () => {
    const query = findQuery('unans-gib-01');
    if (!query) throw new Error('unreachable');
    const scenario = await retrieveScenario({ cassette, query, index: emptyRetrievalIndex() });
    expect(scenario.result).toEqual({ status: 'refused', reason: 'no-hits' });
  });
});
