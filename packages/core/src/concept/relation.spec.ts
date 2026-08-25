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
import type { Provenance } from '../extract/types.js';
import {
  assertionsForTriage,
  type ConceptRelation,
  deriveRelationSet,
  PER_DOCUMENT_EMITTABLE_TYPES,
  RELATION_DIRECTEDNESS,
  RELATION_EMISSION_STATUS,
  RELATION_TYPES,
  type RelationProvenanceKind,
  type RelationType,
  relationKey,
  servedRelations,
  stageForRelationType,
  TRIAGE_STANDING_BY_PROVENANCE,
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

// ===========================================================================
// THE FOLD (`ol-2zfj.12`) — where both producers' edges land.
// ===========================================================================
//
// INV-3, restated for this block: every concept name below is coined for the
// test. None is drawn from any real vault.

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

function edge(
  type: RelationType,
  from: string,
  to: string,
  options: { confidence?: number; provenance?: RelationProvenanceKind } = {},
): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance: options.provenance ?? 'model-proposed',
    confidence: options.confidence ?? 0.5,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

describe('stageForRelationType — derived from the emission table, never restated', () => {
  it('routes the two single-document facts to the per-document stage', () => {
    expect(stageForRelationType('is-a')).toBe('per-document');
    expect(stageForRelationType('part-of')).toBe('per-document');
  });

  it('routes the two cross-document facts to the corpus stage', () => {
    expect(stageForRelationType('contrasts-with')).toBe('corpus');
    expect(stageForRelationType('prerequisite')).toBe('corpus');
  });

  it('has no stage for a type v0.9 does not emit at all', () => {
    expect(stageForRelationType('causes')).toBeUndefined();
    expect(stageForRelationType('related')).toBeUndefined();
  });
});

describe('relationKey — directedness decides the identity', () => {
  it('a directed type keys on order: A is-a B is not B is-a A', () => {
    expect(relationKey(edge('is-a', 'Bud', 'Shoot'))).not.toBe(
      relationKey(edge('is-a', 'Shoot', 'Bud')),
    );
  });

  it('a symmetric type keys the same in either orientation — the two stages cannot double-count it', () => {
    expect(relationKey(edge('contrasts-with', 'Bud', 'Shoot'))).toBe(
      relationKey(edge('contrasts-with', 'Shoot', 'Bud')),
    );
  });

  it('the type is part of the identity — two types over the same pair are two edges', () => {
    expect(relationKey(edge('is-a', 'Bud', 'Shoot'))).not.toBe(
      relationKey(edge('part-of', 'Bud', 'Shoot')),
    );
  });

  it('separates endpoints with a character a concept name cannot contain', () => {
    // Without a non-printable separator, ('is-a', 'A B', 'C') and
    // ('is-a', 'A', 'B C') would collide on any printable joiner.
    expect(relationKey(edge('is-a', 'Bud Scale', 'Shoot'))).not.toBe(
      relationKey(edge('is-a', 'Bud', 'Scale Shoot')),
    );
  });
});

describe('deriveRelationSet — the merge of both producers', () => {
  it('an empty fold is a measurement, not an absence', () => {
    const set = deriveRelationSet([], []);
    expect(set.entries).toEqual([]);
    expect(set.mergedDuplicates).toBe(0);
    expect(set.contradictions).toBe(0);
    expect(set.droppedUnemittable).toBe(0);
  });

  it('carries both stages through and labels each edge with the stage its TYPE belongs to, not the argument it arrived in', () => {
    const set = deriveRelationSet(
      [edge('is-a', 'Bud', 'Shoot')],
      [edge('contrasts-with', 'Bud', 'Scale')],
    );
    const stages = Object.fromEntries(set.entries.map((e) => [e.edge.type, e.stage]));
    expect(stages).toEqual({ 'is-a': 'per-document', 'contrasts-with': 'corpus' });
  });

  it('drops an edge of a type no stage may emit, and counts it — a producer defect, never trusted twice', () => {
    const set = deriveRelationSet([
      edge('causes', 'Bud', 'Shoot'),
      edge('related', 'Bud', 'Scale'),
    ]);
    expect(set.entries).toEqual([]);
    expect(set.droppedUnemittable).toBe(2);
  });

  it('folds the same edge from both producers into one entry, keeping both attestations', () => {
    const fromRead = edge('is-a', 'Bud', 'Shoot', { confidence: 0.6 });
    const fromCorpus = edge('is-a', 'Bud', 'Shoot', { confidence: 0.9 });

    const set = deriveRelationSet([fromRead], [fromCorpus]);

    expect(set.entries).toHaveLength(1);
    expect(set.mergedDuplicates).toBe(1);
    expect(set.entries[0]?.attestations).toHaveLength(2);
  });

  it('folds a symmetric edge emitted in opposite orientations into one entry', () => {
    const set = deriveRelationSet(
      [edge('contrasts-with', 'Bud', 'Scale')],
      [edge('contrasts-with', 'Scale', 'Bud')],
    );
    expect(set.entries).toHaveLength(1);
    expect(set.mergedDuplicates).toBe(1);
  });

  it('ranks by provenance FIRST — an edge she authored outranks a more confident model proposal (D-070)', () => {
    // A corpus-stage type on purpose: `hers` is only ever stamped there
    // (`corpus-relations/verdict.ts`, `ol-9qwy`), never on is-a/part-of.
    const hers = edge('prerequisite', 'Bud', 'Shoot', { confidence: 0.2, provenance: 'hers' });
    const model = edge('prerequisite', 'Bud', 'Shoot', { confidence: 0.99 });

    const set = deriveRelationSet([model], [hers]);

    expect(set.entries[0]?.edge.provenance).toBe('hers');
    expect(set.entries[0]?.triageStanding).toBe('assertion');
  });

  it('within one provenance, the higher confidence wins', () => {
    const set = deriveRelationSet(
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.4 })],
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.8 })],
    );
    expect(set.entries[0]?.edge.confidence).toBe(0.8);
  });

  it("never combines confidences — the winner's own number travels verbatim", () => {
    const set = deriveRelationSet(
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.6 })],
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.6 })],
    );
    expect(set.entries[0]?.edge.confidence).toBe(0.6);
  });

  it('is order-independent — the same inputs in either order fold identically', () => {
    const a = edge('is-a', 'Bud', 'Shoot', { confidence: 0.4 });
    const b = edge('part-of', 'Scale', 'Bud', { confidence: 0.8 });
    expect(deriveRelationSet([a], [b])).toEqual(deriveRelationSet([b], [a]));
  });

  it('counts a directed contradiction once per pair, and resolves neither side', () => {
    const set = deriveRelationSet([edge('is-a', 'Bud', 'Shoot'), edge('is-a', 'Shoot', 'Bud')]);
    expect(set.contradictions).toBe(1);
    expect(set.entries).toHaveLength(2);
  });

  it('a symmetric edge is never a contradiction with itself reversed', () => {
    const set = deriveRelationSet([
      edge('contrasts-with', 'Bud', 'Scale'),
      edge('contrasts-with', 'Scale', 'Bud'),
    ]);
    expect(set.contradictions).toBe(0);
  });

  it('every entry starts with current evidence — nothing in this module degrades an edge ([D-093] is CORP-3s)', () => {
    const set = deriveRelationSet([edge('is-a', 'Bud', 'Shoot')]);
    expect(set.entries[0]?.evidence).toBe('current');
  });

  it("keeps each attestation's own introducing passages, so a later degrade can act per attestation", () => {
    const set = deriveRelationSet(
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.9 })],
      [edge('is-a', 'Bud', 'Shoot', { confidence: 0.3 })],
    );
    const passages = set.entries[0]?.attestations.map((a) => a.introducingPassages.from.sourcePath);
    expect(passages).toEqual(['Bud.md', 'Bud.md']);
    expect(set.entries[0]?.attestations.map((a) => a.confidence)).toEqual([0.9, 0.3]);
  });
});

describe('TRIAGE_STANDING_BY_PROVENANCE — D-070s rule, as data', () => {
  it('hers is an assertion; a model proposal is a candidate', () => {
    expect(TRIAGE_STANDING_BY_PROVENANCE.hers).toBe('assertion');
    expect(TRIAGE_STANDING_BY_PROVENANCE['model-proposed']).toBe('candidate');
  });
});

describe('servedRelations — the abstention gate, not the triage gate', () => {
  it('serves a model-proposed edge: candidate AT TRIAGE is not the same as withheld from readers', () => {
    // Concept size (`./size.js`) has read model-proposed is-a edges since
    // EXT-6. Filtering on triage standing here would silently switch that off.
    const set = deriveRelationSet([edge('is-a', 'Bud', 'Shoot')]);
    expect(servedRelations(set)).toHaveLength(1);
  });

  it('withholds an edge whose evidence has gone stale — abstention is automatic ([D-093])', () => {
    const set = deriveRelationSet([edge('is-a', 'Bud', 'Shoot')]);
    const degraded = {
      ...set,
      entries: set.entries.map((entry) => ({ ...entry, evidence: 'stale' as const })),
    };
    expect(servedRelations(degraded)).toEqual([]);
  });
});

describe('assertionsForTriage — the rule written before the surface exists', () => {
  it('a per-document edge is never an assertion — that stage has no path to hers at all', () => {
    const set = deriveRelationSet([edge('is-a', 'Bud', 'Shoot'), edge('part-of', 'Scale', 'Bud')]);
    expect(assertionsForTriage(set)).toEqual([]);
  });

  it('separates an authored edge from a model proposal — never rendered identically (F1-sources)', () => {
    const set = deriveRelationSet([
      edge('contrasts-with', 'Bud', 'Shoot', { provenance: 'hers' }),
      edge('part-of', 'Scale', 'Bud'),
    ]);
    expect(assertionsForTriage(set).map((e) => e.edge.type)).toEqual(['contrasts-with']);
  });
});
