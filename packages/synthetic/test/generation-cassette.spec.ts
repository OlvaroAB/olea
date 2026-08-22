// generation-cassette.spec.ts — the hard-refusal cache-invalidation logic for
// the generative chat tasks (`olea-service`'s `ol-opmb.3` [TB-3]), ported
// field-for-field from `embedding-cassette.spec.ts`'s style, one key axis
// wider: (taskId, promptVersion, modelId, payloadHash) rather than a single
// pinned model. Asserts the REFUSE, never the silent-rebuild, behaviour.

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  findGenerationEntry,
  findGenerationEntryByRequest,
  GENERATION_CASSETTE_VERSION,
  GENERATION_DATASET_VERSION,
  GenerationCassetteMismatchError,
  hashGenerationPayload,
  readGenerationCassette,
  toSerialisableGenerationCassette,
} from '../src/generation-cassette.js';

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

  it('throws — never silently misses, never silently replays — on a PROMPT VERSION mismatch for an otherwise-matching key', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    expect(() =>
      findGenerationEntry(cassette, {
        taskId: 'quiz.generate.v1',
        promptVersion: '9.9.9',
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        payloadHash: 'a',
      }),
    ).toThrow(GenerationCassetteMismatchError);
  });

  it('throws on a MODEL mismatch for an otherwise-matching key', () => {
    const cassette = readGenerationCassette(validCassette(), EXPECTED);
    expect(() =>
      findGenerationEntry(cassette, {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.3.0',
        modelId: '@cf/some-other/model',
        payloadHash: 'a',
      }),
    ).toThrow(GenerationCassetteMismatchError);
  });

  it('is a genuine miss (not a mismatch) for a different taskId at the same payloadHash', () => {
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
