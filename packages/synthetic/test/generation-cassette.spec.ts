// generation-cassette.spec.ts — the hard-refusal cache-invalidation logic for
// the generative chat tasks (`olea-service`'s `ol-opmb.3` [TB-3]), ported
// field-for-field from `embedding-cassette.spec.ts`'s style, one key axis
// wider: (taskId, promptVersion, modelId, payloadHash) rather than a single
// pinned model. Asserts the REFUSE-on-malformed-input behaviour on
// `readGenerationCassette`, and the model-comparison keystone's own
// contract on `findGenerationEntry`: a lookup pinned to one model coexists
// with, and never disturbs, another model's recording of the identical
// payload (`ol-3ux7.15`, the fix this file exists to prove).
//
// D-009 note (dialability, not cassette behaviour): nothing in this file
// calls a model, live or otherwise — a cassette lookup is pure local data
// matching. What makes a candidate model eligible to ever PRODUCE a new
// entry here is decided entirely upstream, in `olea-service`: every routed
// call passes `assertModelRouteAllowed` (`src/ai/modelRoute.ts`) at the
// slot catalogue's module load and again at the call site, and a model that
// fails it throws before any request leaves the process. That gate is
// private-repo code and stays there — this public spec only needs to say
// that a modelId showing up as a cassette entry's `modelId` field already
// cleared it, the same way every `modelId` this project has ever recorded
// already has.

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  diagnoseGenerationCassetteMiss,
  findGenerationEntry,
  findGenerationEntryByRequest,
  GENERATION_CASSETTE_VERSION,
  GENERATION_DATASET_VERSION,
  GenerationCassetteMismatchError,
  hashGenerationPayload,
  readGenerationCassette,
  toSerialisableGenerationCassette,
} from '../src/generation-cassette.js';

const MODEL_A = '@cf/google/gemma-4-26b-a4b-it';
const MODEL_B = '@cf/openai/gpt-oss-20b';

const EXPECTED = { datasetVersion: GENERATION_DATASET_VERSION };

function validCassette() {
  return {
    version: GENERATION_CASSETTE_VERSION,
    datasetVersion: GENERATION_DATASET_VERSION,
    entries: [
      {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.3.0',
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        payloadHash: 'b',
        response: { ok: true, result: { questions: [] } },
      },
      {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.3.0',
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        payloadHash: 'a',
        response: { ok: true, result: { questions: [{ stem: 'x' }] } },
      },
    ],
  };
}

describe('readGenerationCassette — the happy path', () => {
  it('accepts a cassette that matches dataset version', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    expect(cassette.entries.length).toBe(2);
  });
});

describe('readGenerationCassette — hard refusal (never softened)', () => {
  it('throws on a DATASET VERSION mismatch', () => {
    const stale = { ...validCassette(), datasetVersion: EXPECTED.datasetVersion - 1 };
    expect(() => readGenerationCassette(stale, EXPECTED)).toThrow(GenerationCassetteMismatchError);
    expect(() => readGenerationCassette(stale, EXPECTED)).toThrow(/dataset version/);
  });

  it('throws on a SCHEMA VERSION mismatch', () => {
    const stale = { ...validCassette(), version: 999 };
    expect(() => readGenerationCassette(stale, EXPECTED)).toThrow(GenerationCassetteMismatchError);
  });

  it('throws on a non-object', () => {
    expect(() => readGenerationCassette(null, EXPECTED)).toThrow(GenerationCassetteMismatchError);
    expect(() => readGenerationCassette('not json', EXPECTED)).toThrow(
      GenerationCassetteMismatchError,
    );
  });

  it('throws on a malformed entry (missing promptVersion or modelId)', () => {
    const malformed = {
      ...validCassette(),
      entries: [{ taskId: 'quiz.generate.v1', payloadHash: 'a', response: { ok: true } }],
    };
    expect(() => readGenerationCassette(malformed, EXPECTED)).toThrow(
      GenerationCassetteMismatchError,
    );
  });

  it('never returns a partially-trusted result: a thrown call produces nothing usable', () => {
    const stale = { ...validCassette(), datasetVersion: -1 };
    let cassette: unknown;
    try {
      cassette = readGenerationCassette(stale, EXPECTED);
    } catch {
      cassette = undefined;
    }
    expect(cassette).toBeUndefined();
  });
});

describe('findGenerationEntry', () => {
  it('returns undefined on a genuine miss (unknown payload hash)', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: '@cf/google/gemma-4-26b-a4b-it',
      payloadHash: 'never-recorded',
    });
    expect(found).toBeUndefined();
  });

  it('returns the entry when taskId, promptVersion, modelId and payloadHash all match', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: '@cf/google/gemma-4-26b-a4b-it',
      payloadHash: 'a',
    });
    expect(found?.response).toEqual({ ok: true, result: { questions: [{ stem: 'x' }] } });
  });

  it('is an ORDINARY MISS (never a throw) for a PROMPT VERSION not held under this exact pin, even when the same payload IS recorded under a different prompt version', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    let found: unknown;
    expect(() => {
      found = findGenerationEntry(cassette, {
        taskId: 'quiz.generate.v1',
        promptVersion: '9.9.9',
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        payloadHash: 'a',
      });
    }).not.toThrow();
    expect(found).toBeUndefined();
  });

  it('is an ORDINARY MISS (never a throw) for a MODEL not held under this exact pin, even when the same payload IS recorded under a different model', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    let found: unknown;
    expect(() => {
      found = findGenerationEntry(cassette, {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.3.0',
        modelId: '@cf/some-other/model',
        payloadHash: 'a',
      });
    }).not.toThrow();
    expect(found).toBeUndefined();
  });

  it('is a genuine miss for a different taskId at the same payloadHash', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'cards.generate.v1',
      promptVersion: '1.1.0',
      modelId: '@cf/google/gemma-4-26b-a4b-it',
      payloadHash: 'a',
    });
    expect(found).toBeUndefined();
  });
});

describe('two models recording the same payload COEXIST and replay independently (the model-comparison keystone)', () => {
  function twoModelCassette() {
    return {
      version: GENERATION_CASSETTE_VERSION,
      datasetVersion: GENERATION_DATASET_VERSION,
      entries: [
        {
          taskId: 'quiz.generate.v1',
          promptVersion: '1.3.0',
          modelId: MODEL_A,
          payloadHash: 'shared-payload',
          response: { ok: true, result: { questions: [{ stem: 'from-model-a' }] } },
        },
        {
          taskId: 'quiz.generate.v1',
          promptVersion: '1.3.0',
          modelId: MODEL_B,
          payloadHash: 'shared-payload',
          response: { ok: true, result: { questions: [{ stem: 'from-model-b' }] } },
        },
      ],
    };
  }

  it('accepts both entries — recording model B never displaced or refused model A’s entry', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    expect(cassette.entries.length).toBe(2);
  });

  it('replays model A’s recording when queried with model A’s pin — never model B’s', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: MODEL_A,
      payloadHash: 'shared-payload',
    });
    expect(found?.response).toEqual({
      ok: true,
      result: { questions: [{ stem: 'from-model-a' }] },
    });
  });

  it('replays model B’s recording when queried with model B’s pin — never model A’s, and never throws for sitting beside a different model’s entry', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: MODEL_B,
      payloadHash: 'shared-payload',
    });
    expect(found?.response).toEqual({
      ok: true,
      result: { questions: [{ stem: 'from-model-b' }] },
    });
  });

  it('a THIRD, never-recorded model is a genuine miss, not disturbed by the two coexisting entries', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    const found = findGenerationEntry(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: '@cf/a-third/candidate',
      payloadHash: 'shared-payload',
    });
    expect(found).toBeUndefined();
  });
});

describe('diagnoseGenerationCassetteMiss — separate, diagnostic-only, never thrown', () => {
  function twoModelCassette() {
    return {
      version: GENERATION_CASSETTE_VERSION,
      datasetVersion: GENERATION_DATASET_VERSION,
      entries: [
        {
          taskId: 'quiz.generate.v1',
          promptVersion: '1.3.0',
          modelId: MODEL_A,
          payloadHash: 'shared-payload',
          response: { ok: true, result: { questions: [] } },
        },
      ],
    };
  }

  it('reports otherPinExists:false for a genuine miss (no recording under any pin)', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    const diagnostic = diagnoseGenerationCassetteMiss(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: MODEL_A,
      payloadHash: 'never-recorded',
    });
    expect(diagnostic).toEqual({ otherPinExists: false, otherPins: [] });
  });

  it('reports otherPinExists:true, naming the other pin, when the payload IS recorded under a different model', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    const diagnostic = diagnoseGenerationCassetteMiss(cassette, {
      taskId: 'quiz.generate.v1',
      promptVersion: '1.3.0',
      modelId: MODEL_B,
      payloadHash: 'shared-payload',
    });
    expect(diagnostic).toEqual({
      otherPinExists: true,
      otherPins: [{ promptVersion: '1.3.0', modelId: MODEL_A }],
    });
  });

  it('never throws — it is called only AFTER findGenerationEntry has already returned undefined', () => {
    const cassette = readGenerationCassette(twoModelCassette(), EXPECTED);
    expect(() =>
      diagnoseGenerationCassetteMiss(cassette, {
        taskId: 'quiz.generate.v1',
        promptVersion: '9.9.9',
        modelId: '@cf/nonexistent/model',
        payloadHash: 'shared-payload',
      }),
    ).not.toThrow();
  });
});

describe('findGenerationEntryByRequest — the browser-safe lookup, no mismatch check', () => {
  it('returns the entry on a match, trusting its stamped promptVersion/modelId as-is', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    const found = findGenerationEntryByRequest(cassette, {
      taskId: 'quiz.generate.v1',
      payloadHash: 'a',
    });
    expect(found?.promptVersion).toBe('1.3.0');
    expect(found?.modelId).toBe('@cf/google/gemma-4-26b-a4b-it');
  });

  it('never throws on what would be a Node-side mismatch — there is nothing to compare against', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    expect(() =>
      findGenerationEntryByRequest(cassette, { taskId: 'quiz.generate.v1', payloadHash: 'a' }),
    ).not.toThrow();
  });

  it('returns undefined on a genuine miss', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    expect(
      findGenerationEntryByRequest(cassette, { taskId: 'quiz.generate.v1', payloadHash: 'nope' }),
    ).toBeUndefined();
  });
});

describe('canonicalJson / hashGenerationPayload', () => {
  it('produces the same hash regardless of object key order', async () => {
    const a = await hashGenerationPayload({ courseCode: 'X', conceptName: 'Y', sourceChunks: [] });
    const b = await hashGenerationPayload({ sourceChunks: [], conceptName: 'Y', courseCode: 'X' });
    expect(a).toBe(b);
  });

  it('produces a DIFFERENT hash when array order changes (order is meaningful)', () => {
    expect(canonicalJson({ sourceChunks: ['one', 'two'] })).not.toBe(
      canonicalJson({ sourceChunks: ['two', 'one'] }),
    );
  });

  it('produces a DIFFERENT hash for genuinely different content', async () => {
    const a = await hashGenerationPayload({ sourceChunks: ['one'] });
    const b = await hashGenerationPayload({ sourceChunks: ['two'] });
    expect(a).not.toBe(b);
  });

  it('is deterministic across two calls with the same payload', async () => {
    const payload = { courseCode: 'syn:course:quorbin', conceptName: 'syn:concept:ilmenor' };
    const a = await hashGenerationPayload(payload);
    const b = await hashGenerationPayload(payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('toSerialisableGenerationCassette', () => {
  it('sorts entries ascending by (taskId, payloadHash)', () => {
    const serialised = toSerialisableGenerationCassette(
      readGenerationCassette(validCassette(), EXPECTED),
    );
    expect(serialised.entries.map((e) => e.payloadHash)).toEqual(['a', 'b']);
  });
});
