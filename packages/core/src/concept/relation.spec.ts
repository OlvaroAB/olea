/**
 * The six ruled relation types (`[REL-1]`, C7.10, `[D-070]`) — this module's
 * own vocabulary, not the extraction pipeline. `read.spec.ts` and
 * `reconcile.spec.ts` cover the pipeline; this file fixes the vocabulary
 * itself: exactly six types, each with a directedness and an emission
 * status that matches the ruling's own argument.
 *
 * INV-3: every string here is coined or drawn from the closed, ruled
 * vocabulary itself. No course code, note title or wording comes from any
 * real vault.
 */

import { describe, expect, it } from 'vitest';
import {
  PER_DOCUMENT_EMITTABLE_TYPES,
  RELATION_DIRECTEDNESS,
  RELATION_EMISSION_STATUS,
  RELATION_TYPES,
  type RelationType,
} from './relation.js';

const SIX_RULED_TYPES: readonly RelationType[] = [
  'is-a',
  'part-of',
  'contrasts-with',
  'prerequisite',
  'causes',
  'related',
];

describe('RELATION_TYPES', () => {
  it('is exactly the six ruled types — not five, not seven', () => {
    expect([...RELATION_TYPES].sort()).toEqual([...SIX_RULED_TYPES].sort());
    expect(RELATION_TYPES.length).toBe(6);
  });

  it('is frozen — the set is ruled, not extensible from this module', () => {
    expect(Object.isFrozen(RELATION_TYPES)).toBe(true);
  });
});

describe('RELATION_DIRECTEDNESS', () => {
  it('covers every ruled type with no omission', () => {
    for (const type of SIX_RULED_TYPES) {
      expect(RELATION_DIRECTEDNESS[type]).toBeDefined();
    }
  });

  it('contrasts-with and related are the only symmetric types', () => {
    const symmetric = SIX_RULED_TYPES.filter((t) => RELATION_DIRECTEDNESS[t] === 'symmetric');
    expect(symmetric.sort()).toEqual(['contrasts-with', 'related']);
  });

  it('is-a, part-of, prerequisite and causes are directed', () => {
    const directed = SIX_RULED_TYPES.filter((t) => RELATION_DIRECTEDNESS[t] === 'directed');
    expect(directed.sort()).toEqual(['causes', 'is-a', 'part-of', 'prerequisite']);
  });
});

describe('RELATION_EMISSION_STATUS — the governing test, per type', () => {
  it('is-a and part-of are emitted: single-document facts with a v0.9 reader', () => {
    expect(RELATION_EMISSION_STATUS['is-a']).toBe('emitted');
    expect(RELATION_EMISSION_STATUS['part-of']).toBe('emitted');
  });

  it('contrasts-with and prerequisite are blocked on the corpus-level stage, not withheld outright', () => {
    expect(RELATION_EMISSION_STATUS['contrasts-with']).toBe('blocked-on-corpus-stage');
    expect(RELATION_EMISSION_STATUS.prerequisite).toBe('blocked-on-corpus-stage');
  });

  it('causes is blocked on its deferred reader — defined now, not a withheld type', () => {
    expect(RELATION_EMISSION_STATUS.causes).toBe('blocked-on-deferred-reader');
  });

  it('related has no reader at all — the one type with no path to emission named', () => {
    expect(RELATION_EMISSION_STATUS.related).toBe('no-reader');
  });

  it('every status is one of exactly two things: emitted, or a reason it is not yet', () => {
    const emitted = SIX_RULED_TYPES.filter((t) => RELATION_EMISSION_STATUS[t] === 'emitted');
    expect(emitted.sort()).toEqual(['is-a', 'part-of']);
  });
});

describe('PER_DOCUMENT_EMITTABLE_TYPES', () => {
  it('is exactly is-a and part-of — the two single-document facts', () => {
    expect([...PER_DOCUMENT_EMITTABLE_TYPES].sort()).toEqual(['is-a', 'part-of']);
  });

  it('excludes every cross-document or withheld type', () => {
    for (const type of ['contrasts-with', 'prerequisite', 'causes', 'related'] as const) {
      expect(PER_DOCUMENT_EMITTABLE_TYPES.has(type)).toBe(false);
    }
  });

  it('is exactly the set RELATION_EMISSION_STATUS marks "emitted" — the two tables agree by construction', () => {
    const emittedFromStatus = SIX_RULED_TYPES.filter(
      (t) => RELATION_EMISSION_STATUS[t] === 'emitted',
    );
    expect([...PER_DOCUMENT_EMITTABLE_TYPES].sort()).toEqual(emittedFromStatus.sort());
  });
});
