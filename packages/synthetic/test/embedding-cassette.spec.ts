// embedding-cassette.spec.ts — the hard-refusal cache-invalidation logic
// (`olea-service`'s `ol-opmb.2` [TB-2]), ported field-for-field from
// `olea-service/scripts/harness/grounding-eval.mjs`'s `loadCorpusCache`/
// `ensureQueryVectors`. Asserts the REFUSE, never the silent-rebuild,
// behaviour — see `embedding-cassette.ts`'s module doc for why that is the
// opposite of `olea-core`'s `EmbeddingCacheEngine`, deliberately.

import { describe, expect, it } from 'vitest';
import {
  CASSETTE_MODEL_ID,
  CassetteMismatchError,
  cassetteEntriesByHash,
  EMBEDDING_CASSETTE_VERSION,
  emptyCassette,
  RETRIEVAL_DATASET_VERSION,
  readCassette,
  toSerialisableCassette,
} from '../src/embedding-cassette.js';

const EXPECTED = { model: CASSETTE_MODEL_ID, datasetVersion: RETRIEVAL_DATASET_VERSION };

function validCassette() {
  return {
    version: EMBEDDING_CASSETTE_VERSION,
    model: CASSETTE_MODEL_ID,
    datasetVersion: RETRIEVAL_DATASET_VERSION,
    entries: [
      { contentHash: 'b', vector: [1, 2, 3] },
      { contentHash: 'a', vector: [4, 5, 6] },
    ],
  };
}

describe('readCassette — the happy path', () => {
  it('accepts a cassette that matches model + dataset version', () => {
    const cassette = readCassette(validCassette(), EXPECTED);
    expect(cassette.entries.length).toBe(2);
    expect(cassetteEntriesByHash(cassette).get('a')).toEqual([4, 5, 6]);
  });
});

describe('readCassette — hard refusal (copied from grounding-eval.mjs, not softened)', () => {
  it('throws CassetteMismatchError on a MODEL mismatch, never silently starting from zero', () => {
    const stale = { ...validCassette(), model: '@cf/some-other/model' };
    expect(() => readCassette(stale, EXPECTED)).toThrow(CassetteMismatchError);
    expect(() => readCassette(stale, EXPECTED)).toThrow(/holds vectors for/);
  });

  it('throws CassetteMismatchError on a DATASET VERSION mismatch (config mismatch)', () => {
    const stale = { ...validCassette(), datasetVersion: EXPECTED.datasetVersion - 1 };
    expect(() => readCassette(stale, EXPECTED)).toThrow(CassetteMismatchError);
    expect(() => readCassette(stale, EXPECTED)).toThrow(/dataset version/);
  });

  it('throws CassetteMismatchError on a SCHEMA VERSION mismatch', () => {
    const stale = { ...validCassette(), version: 999 };
    expect(() => readCassette(stale, EXPECTED)).toThrow(CassetteMismatchError);
  });

  it('throws on a non-object', () => {
    expect(() => readCassette(null, EXPECTED)).toThrow(CassetteMismatchError);
    expect(() => readCassette('not json', EXPECTED)).toThrow(CassetteMismatchError);
  });

  it('throws on a malformed entry (missing contentHash or vector)', () => {
    const malformed = { ...validCassette(), entries: [{ contentHash: 'a' }] };
    expect(() => readCassette(malformed, EXPECTED)).toThrow(CassetteMismatchError);
  });

  it('never returns a partially-trusted result: a thrown call produces nothing usable', () => {
    const stale = { ...validCassette(), model: 'drifted' };
    let cassette: unknown;
    try {
      cassette = readCassette(stale, EXPECTED);
    } catch {
      cassette = undefined;
    }
    expect(cassette).toBeUndefined();
  });
});

describe('emptyCassette / toSerialisableCassette', () => {
  it('emptyCassette starts with zero entries at the given model/dataset version', () => {
    const cassette = emptyCassette('m', 7);
    expect(cassette.entries).toEqual([]);
    expect(cassette.model).toBe('m');
    expect(cassette.datasetVersion).toBe(7);
  });

  it('toSerialisableCassette sorts entries ascending by content hash, deterministically', () => {
    const cassette = readCassette(validCassette(), EXPECTED);
    const serialisable = toSerialisableCassette(cassette);
    expect(serialisable.entries.map((e) => e.contentHash)).toEqual(['a', 'b']);
    // idempotent
    expect(toSerialisableCassette(serialisable).entries.map((e) => e.contentHash)).toEqual([
      'a',
      'b',
    ]);
  });
});
