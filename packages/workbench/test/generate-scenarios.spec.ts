// generate-scenarios.spec.ts — the three addressable generation states
// (`olea-service`'s `ol-opmb.3` [TB-3]), against the REAL cassettes.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildGenerateScenario,
  findGenerateState,
  GENERATE_STATES,
} from '../src/generate-scenarios.js';
import {
  CASSETTE_MODEL_ID,
  type EmbeddingCassette,
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
  embeddingCassette = readCassette(JSON.parse(readFileSync(EMBEDDING_CASSETTE_PATH, 'utf8')), {
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
  });
  generationCassette = readGenerationCassette(
    JSON.parse(readFileSync(GENERATION_CASSETTE_PATH, 'utf8')),
    { datasetVersion: GENERATION_DATASET_VERSION },
  );
});

describe('the three addressable generation states', () => {
  it('GENERATE_STATES has exactly the three states this bead names', () => {
    expect(GENERATE_STATES.map((s) => s.id)).toEqual([
      'generation-refused-upstream',
      'generation-pending-accept',
      'generation-accepted',
    ]);
  });

  it('findGenerateState resolves every id in GENERATE_STATES and nothing else', () => {
    for (const state of GENERATE_STATES) {
      expect(findGenerateState(state.id)?.id).toBe(state.id);
    }
    expect(findGenerateState('not-a-real-state')).toBeUndefined();
  });

  it('generation-refused-upstream: retrieval refused, generate ran with empty context and REALLY refused, nothing to accept', async () => {
    const scenario = await buildGenerateScenario(
      'generation-refused-upstream',
      embeddingCassette,
      generationCassette,
    );
    expect(scenario.retrieval.result.status).toBe('refused');
    expect(scenario.generation.request.sourceChunks).toEqual([]);
    expect(scenario.generation.candidates).toEqual([]);
    expect(scenario.generation.trace.stages[0]?.couldHaveSucceeded).toBe(false);
    expect(scenario.generation.trace.stages[0]?.attributedTo).toBe('retrieve');
    expect(scenario.accepted).toBeNull();
  });

  it('generation-pending-accept: grounded, real candidates, but the gate has NOT been passed through — no accept trace', async () => {
    const scenario = await buildGenerateScenario(
      'generation-pending-accept',
      embeddingCassette,
      generationCassette,
    );
    expect(scenario.retrieval.result.status).toBe('grounded');
    expect(scenario.generation.candidates.length).toBeGreaterThan(0);
    // INV-6: nothing here is vault-ready. `accepted` is null — the accept
    // stage never ran, not merely "ran with zero output".
    expect(scenario.accepted).toBeNull();
  });

  it('generation-accepted: the IDENTICAL grounded scenario, but the gate WAS passed — real McqFields, real accept trace', async () => {
    const pending = await buildGenerateScenario(
      'generation-pending-accept',
      embeddingCassette,
      generationCassette,
    );
    const accepted = await buildGenerateScenario(
      'generation-accepted',
      embeddingCassette,
      generationCassette,
    );

    // Same request, same candidates — the ONLY difference is the accept gate.
    expect(accepted.generation.request).toEqual(pending.generation.request);
    expect(accepted.generation.candidates).toEqual(pending.generation.candidates);

    expect(accepted.accepted).not.toBeNull();
    if (accepted.accepted === null) throw new Error('unreachable');
    expect(accepted.accepted.accepted.length).toBeGreaterThan(0);
    expect(accepted.accepted.trace.stages).toHaveLength(1);
    expect(accepted.accepted.trace.stages[0]?.stage).toBe('accept');
    for (const field of accepted.accepted.accepted) {
      expect(field.feedback).toBeTruthy();
    }
  });
});

describe('determinism — byte-identical outcome across two runs', () => {
  it('every generate state produces the identical candidates and trace outputSummary twice', async () => {
    for (const state of GENERATE_STATES) {
      const a = await buildGenerateScenario(state.id, embeddingCassette, generationCassette);
      const b = await buildGenerateScenario(state.id, embeddingCassette, generationCassette);
      expect(a.generation.candidates).toEqual(b.generation.candidates);
      expect(a.generation.trace.stages[0]?.outputSummary).toEqual(
        b.generation.trace.stages[0]?.outputSummary,
      );
    }
  });
});
