// generate.spec.ts — the retrieve -> generate chain and INV-6's accept gate
// (`olea-service`'s `ol-opmb.3` [TB-3]), against the REAL, once-recorded
// generation cassette (`.generation-cassette/cassette.json`) — never a fake
// response.
//
// Every assertion here is about MECHANISM (does an inherited refusal fire
// with the right attribution, does the accept gate genuinely withhold
// McqFields until called, is the run deterministic) — never card quality.
// Generation quality over this coined-token corpus is uninterpretable by
// construction (parent bead, `ol-opmb`) and nothing here reports one.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  acceptCandidates,
  CassetteGenerationProvider,
  GenerationReplayError,
  generateScenario,
  QUIZ_GENERATE_TASK_ID,
} from '../src/oracle/generate.js';
import { retrieveScenario } from '../src/oracle/retrieve.js';
import type { GeneratedMcqCandidate } from '../src/oracle-bridge.js';
import {
  CASSETTE_MODEL_ID,
  type EmbeddingCassette,
  findQuery,
  GENERATION_DATASET_VERSION,
  type GenerationCassette,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
  readGenerationCassette,
} from '../src/synthetic-bridge.js';

const EMBEDDING_CASSETTE_PATH = '.embedding-cassette/cassette.json';
const GENERATION_CASSETTE_PATH = '.generation-cassette/cassette.json';

let embeddingCassette: EmbeddingCassette;
let generationCassette: GenerationCassette;

beforeAll(() => {
  const loadJson = (path: string, what: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(
        `generate.spec.ts: no ${what} at ${path}. Run the matching precompute pass from ` +
          'packages/workbench/ once before running this suite — see ol-opmb.2 and ol-opmb.3.',
      );
    }
  };
  embeddingCassette = readCassette(loadJson(EMBEDDING_CASSETTE_PATH, 'embedding cassette'), {
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
  });
  generationCassette = readGenerationCassette(
    loadJson(GENERATION_CASSETTE_PATH, 'generation cassette'),
    { datasetVersion: GENERATION_DATASET_VERSION },
  );
});

async function groundedRetrieval() {
  const query = findQuery('ans-03');
  if (!query) throw new Error('unreachable');
  return retrieveScenario({ cassette: embeddingCassette, query });
}

async function refusedRetrieval() {
  const query = findQuery('ans-01');
  if (!query) throw new Error('unreachable');
  return retrieveScenario({ cassette: embeddingCassette, query });
}

describe('CassetteGenerationProvider', () => {
  it('never calls fetch/network — a pure in-memory lookup', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('CassetteGenerationProvider must never call fetch');
    };
    try {
      const retrieval = await groundedRetrieval();
      const provider = new CassetteGenerationProvider({ cassette: generationCassette });
      const result = await provider.call(QUIZ_GENERATE_TASK_ID, {
        courseCode: 'syn:course:quorbin',
        conceptName: 'syn:concept:ilmenor',
        sourceChunks:
          retrieval.result.status === 'grounded' ? retrieval.result.chunks.map((c) => c.text) : [],
      });
      expect(result.response.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses (throws GenerationReplayError) rather than inventing an answer for an unrecorded request', async () => {
    const provider = new CassetteGenerationProvider({ cassette: generationCassette });
    await expect(
      provider.call(QUIZ_GENERATE_TASK_ID, { neverRecorded: 'this-exact-payload' }),
    ).rejects.toThrow(GenerationReplayError);
  });
});

describe('generateScenario — inherited refusal (INV-5) and attribution', () => {
  it('when retrieval refuses, sourceChunks is empty and generation is a REAL recorded empty-context call', async () => {
    const retrieval = await refusedRetrieval();
    expect(retrieval.result.status).toBe('refused');

    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:vantrel',
      conceptName: 'syn:concept:melspar',
      retrieval: retrieval.result,
    });

    expect(scenario.request.sourceChunks).toEqual([]);
    expect(scenario.call.response.ok).toBe(true);
    expect(scenario.candidates).toEqual([]);
  });

  it('attributes the empty-context refusal to retrieve, not generate — neither stage did anything wrong', async () => {
    const retrieval = await refusedRetrieval();
    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:vantrel',
      conceptName: 'syn:concept:melspar',
      retrieval: retrieval.result,
    });
    expect(scenario.trace.stages).toHaveLength(1);
    const stage = scenario.trace.stages[0];
    expect(stage?.stage).toBe('generate');
    expect(stage?.couldHaveSucceeded).toBe(false);
    expect(stage?.attributedTo).toBe('retrieve');
  });
});

describe('generateScenario — grounded retrieval', () => {
  it('produces real candidates from real cited chunks, couldHaveSucceeded true, attributedTo null', async () => {
    const retrieval = await groundedRetrieval();
    expect(retrieval.result.status).toBe('grounded');

    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });

    expect(scenario.request.sourceChunks.length).toBeGreaterThan(0);
    expect(scenario.candidates.length).toBeGreaterThan(0);
    const stage = scenario.trace.stages[0];
    expect(stage?.couldHaveSucceeded).toBe(true);
    expect(stage?.attributedTo).toBeNull();
  });

  it('never logs source-chunk or question text in the trace summaries — only ids/counts', async () => {
    const retrieval = await groundedRetrieval();
    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });
    const serialised = JSON.stringify(scenario.trace.stages[0]);
    for (const chunk of scenario.request.sourceChunks) {
      expect(serialised).not.toContain(chunk);
    }
  });
});

describe('determinism — byte-identical outcome across two runs', () => {
  it('the SAME grounded call replays identically twice', async () => {
    const retrieval = await groundedRetrieval();
    const a = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });
    const b = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });
    expect(a.candidates).toEqual(b.candidates);
    expect(a.call.response).toEqual(b.call.response);
  });
});

describe('acceptCandidates — INV-6, the gate made real', () => {
  it('turns every valid candidate into McqFields via acceptGeneratedMcq, never automatically', async () => {
    const retrieval = await groundedRetrieval();
    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });
    expect(scenario.candidates.length).toBeGreaterThan(0);

    const gate = acceptCandidates(scenario.candidates as readonly GeneratedMcqCandidate[]);
    expect(gate.accepted.length + gate.rejected.length).toBe(scenario.candidates.length);
    for (const field of gate.accepted) {
      expect(field.feedback).toBeTruthy();
      expect(field.stem).toBeTruthy();
    }
  });

  it('records exactly one "accept" StageRecord, present ONLY when this function is called', async () => {
    const retrieval = await groundedRetrieval();
    const scenario = await generateScenario({
      cassette: generationCassette,
      courseCode: 'syn:course:quorbin',
      conceptName: 'syn:concept:ilmenor',
      retrieval: retrieval.result,
    });
    const gate = acceptCandidates(scenario.candidates as readonly GeneratedMcqCandidate[]);
    expect(gate.trace.stages).toHaveLength(1);
    expect(gate.trace.stages[0]?.stage).toBe('accept');
    expect(gate.trace.stages[0]?.couldHaveSucceeded).toBe(true);
  });

  it('a candidate with blank feedback is REJECTED, never silently accepted', () => {
    const bad: GeneratedMcqCandidate = {
      stem: 'x',
      correctAnswer: 'y',
      distractors: ['a', 'b', 'c', 'd'],
      feedback: '   ',
    };
    const gate = acceptCandidates([bad]);
    expect(gate.accepted).toHaveLength(0);
    expect(gate.rejected).toHaveLength(1);
    expect(gate.rejected[0]?.reason).toMatch(/feedback/i);
  });

  it('an empty candidate list with no attribution given produces an "empty" status, not "abstained"', () => {
    const gate = acceptCandidates([]);
    expect(gate.trace.stages[0]?.status).toBe('empty');
    expect(gate.trace.stages[0]?.couldHaveSucceeded).toBe(true);
  });

  it('an empty candidate list WITH an upstream-blocked attribution carries it through', () => {
    const gate = acceptCandidates([], { couldHaveSucceeded: false, attributedTo: 'retrieve' });
    expect(gate.trace.stages[0]?.status).toBe('abstained');
    expect(gate.trace.stages[0]?.couldHaveSucceeded).toBe(false);
    expect(gate.trace.stages[0]?.attributedTo).toBe('retrieve');
  });
});
